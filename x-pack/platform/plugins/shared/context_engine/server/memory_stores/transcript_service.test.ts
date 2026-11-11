/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';
import { loggerMock } from '@kbn/logging-mocks';
import {
  MemoryStoreConflictError,
  MemoryStoreValidationError,
  TranscriptNotFoundError,
} from './errors';
import { scopedDocumentId } from './owner';
import { transcriptsIndexName, type TranscriptsStorageClient } from './storage';
import { TranscriptService } from './transcript_service';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const scope = { spaceId: 'default', owner: { id: 'u_profile', username: 'jdoe' } };
const ownerFilters = [{ term: { space: 'default' } }, { term: { owner_id: 'u_profile' } }];
const sessionFilters = [...ownerFilters, { term: { session_id: 'sess-1' } }];

const storedHeader = {
  kind: 'session',
  space: 'default',
  owner_id: 'u_profile',
  owner_username: 'jdoe',
  session_id: 'sess-1',
  source: 'longmemeval',
  agent_id: 'agent-a',
  title: 'Trip',
  turn_count: 3,
  chunk_count: 2,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const headerSearch = (header?: object) => ({
  hits: { hits: header ? [{ _source: header }] : [] },
});

const okBulk = (count: number) => ({
  errors: false,
  items: Array.from({ length: count }, () => ({ index: { result: 'created' } })),
});

describe('TranscriptService', () => {
  let storage: { search: jest.Mock; bulk: jest.Mock };
  let esClient: ReturnType<typeof elasticsearchClientMock.createElasticsearchClient>;
  let service: TranscriptService;

  beforeEach(() => {
    storage = { search: jest.fn(), bulk: jest.fn().mockResolvedValue(okBulk(1)) };
    esClient = elasticsearchClientMock.createElasticsearchClient();
    esClient.deleteByQuery.mockResolvedValue({ deleted: 0 });
    service = new TranscriptService({
      storage: storage as unknown as TranscriptsStorageClient,
      esClient,
      logger: loggerMock.create(),
      getCurrentDate: () => NOW,
    });
  });

  describe('put', () => {
    it('writes the chunks, then the header, under ids scoped to the owner', async () => {
      storage.search.mockResolvedValue(headerSearch());

      const response = await service.put(scope, 'sess-1', {
        source: 'longmemeval',
        agent_id: 'agent-a',
        title: 'Trip',
        started_at: '2026-10-01T09:00:00.000Z',
        turns: [
          { role: 'user', content: 'Hotel near Alfama?' },
          { role: 'assistant', content: 'Memmo Alfama.', timestamp: '2026-10-01T09:01:00.000Z' },
        ],
      });

      expect(response).toEqual({
        session_id: 'sess-1',
        result: 'created',
        turn_count: 2,
        chunk_count: 1,
      });
      const [[chunkBulk], [headerBulk]] = storage.bulk.mock.calls;
      expect(chunkBulk.operations).toEqual([
        {
          index: {
            _id: scopedDocumentId('default', scope.owner, 'transcript', 'sess-1', '0'),
            document: {
              space: 'default',
              owner_id: 'u_profile',
              owner_username: 'jdoe',
              session_id: 'sess-1',
              source: 'longmemeval',
              agent_id: 'agent-a',
              kind: 'chunk',
              chunk_index: 0,
              turn_start: 0,
              turn_end: 1,
              roles: ['user', 'assistant'],
              content: 'User: Hotel near Alfama?\nAssistant: Memmo Alfama.',
              turns: [
                { role: 'user', content: 'Hotel near Alfama?' },
                {
                  role: 'assistant',
                  content: 'Memmo Alfama.',
                  timestamp: '2026-10-01T09:01:00.000Z',
                },
              ],
              // The first turn has no time of its own, so the chunk takes the session start.
              timestamp: '2026-10-01T09:00:00.000Z',
              created_at: NOW.toISOString(),
            },
          },
        },
      ]);
      expect(headerBulk.operations).toEqual([
        {
          index: {
            _id: scopedDocumentId('default', scope.owner, 'transcript', 'sess-1'),
            document: expect.objectContaining({
              kind: 'session',
              title: 'Trip',
              started_at: '2026-10-01T09:00:00.000Z',
              turn_count: 2,
              chunk_count: 1,
              created_at: NOW.toISOString(),
            }),
          },
        },
      ]);
      expect(esClient.deleteByQuery).not.toHaveBeenCalled();
    });

    it('removes the chunks past the end of a replaced session that shrank', async () => {
      storage.search.mockResolvedValue(headerSearch(storedHeader));

      const response = await service.put(scope, 'sess-1', {
        source: 'longmemeval',
        turns: [{ role: 'user', content: 'Only this now.' }],
      });

      expect(response).toMatchObject({ result: 'updated', turn_count: 1, chunk_count: 1 });
      expect(esClient.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          index: transcriptsIndexName,
          query: {
            bool: {
              filter: [
                ...sessionFilters,
                { term: { kind: 'chunk' } },
                { range: { chunk_index: { gte: 1 } } },
              ],
            },
          },
        })
      );
      const headerDocument = storage.bulk.mock.calls[1][0].operations[0].index.document;
      expect(headerDocument.created_at).toBe(storedHeader.created_at);
      // A replace does not carry over fields the new write leaves out.
      expect(headerDocument).not.toHaveProperty('title');
    });

    it('appends after the stored turns and chunks, keeping identity and header fields', async () => {
      storage.search.mockResolvedValue(headerSearch(storedHeader));

      const response = await service.put(scope, 'sess-1', {
        source: 'longmemeval',
        mode: 'append',
        turns: [{ role: 'assistant', content: 'Booked.' }],
      });

      expect(response).toEqual({
        session_id: 'sess-1',
        result: 'updated',
        turn_count: 4,
        chunk_count: 3,
      });
      const chunk = storage.bulk.mock.calls[0][0].operations[0].index;
      expect(chunk._id).toBe(scopedDocumentId('default', scope.owner, 'transcript', 'sess-1', '2'));
      expect(chunk.document).toMatchObject({
        chunk_index: 2,
        turn_start: 3,
        turn_end: 3,
        agent_id: 'agent-a',
      });
      expect(storage.bulk.mock.calls[1][0].operations[0].index.document).toMatchObject({
        title: 'Trip',
        agent_id: 'agent-a',
      });
      expect(esClient.deleteByQuery).not.toHaveBeenCalled();
    });

    it('refuses to append with a different source, agent or AI index', async () => {
      storage.search.mockResolvedValue(headerSearch(storedHeader));
      await expect(
        service.put(scope, 'sess-1', {
          source: 'longmemeval',
          agent_id: 'agent-b',
          mode: 'append',
          turns: [{ role: 'user', content: 'x' }],
        })
      ).rejects.toBeInstanceOf(MemoryStoreConflictError);
      expect(storage.bulk).not.toHaveBeenCalled();
    });

    it('treats an append to a missing session as its first write', async () => {
      storage.search.mockResolvedValue(headerSearch());
      const response = await service.put(scope, 'sess-1', {
        source: 'longmemeval',
        mode: 'append',
        turns: [{ role: 'user', content: 'x' }],
      });
      expect(response).toMatchObject({ result: 'created', turn_count: 1, chunk_count: 1 });
    });

    it('fails when Elasticsearch rejects a chunk', async () => {
      storage.search.mockResolvedValue(headerSearch());
      storage.bulk.mockResolvedValue({
        errors: true,
        items: [{ index: { error: { type: 'x', reason: 'inference failed' } } }],
      });
      await expect(
        service.put(scope, 'sess-1', { source: 's', turns: [{ role: 'user', content: 'x' }] })
      ).rejects.toThrow('inference failed');
    });
  });

  describe('get', () => {
    it('rebuilds the turns from the chunks in order', async () => {
      storage.search.mockResolvedValueOnce(headerSearch(storedHeader)).mockResolvedValueOnce({
        hits: {
          hits: [
            { _source: { turns: [{ role: 'user', content: 'a' }] }, sort: [0] },
            { _source: { turns: [] }, sort: [1] },
            { _source: { turns: [{ role: 'assistant', content: 'b' }] }, sort: [2] },
          ],
        },
      });

      const transcript = await service.get(scope, 'sess-1');

      expect(transcript).toEqual({
        session_id: 'sess-1',
        source: 'longmemeval',
        agent_id: 'agent-a',
        title: 'Trip',
        turns: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
        ],
        created_at: storedHeader.created_at,
        updated_at: storedHeader.updated_at,
      });
      expect(storage.search.mock.calls[1][0]).toMatchObject({
        sort: [{ chunk_index: { order: 'asc' } }],
        query: { bool: { filter: [...sessionFilters, { term: { kind: 'chunk' } }] } },
      });
    });

    it("is not found for another owner's or a missing session", async () => {
      storage.search.mockResolvedValue(headerSearch());
      await expect(service.get(scope, 'sess-1')).rejects.toBeInstanceOf(TranscriptNotFoundError);
    });
  });

  describe('delete', () => {
    it("deletes the owner's session and reports whether it existed", async () => {
      esClient.deleteByQuery.mockResolvedValue({ deleted: 3 });
      await expect(service.delete(scope, 'sess-1')).resolves.toBe(true);
      expect(esClient.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({ query: { bool: { filter: sessionFilters } } })
      );
    });

    it('counts the sessions a filtered delete removes', async () => {
      storage.search.mockResolvedValue({ hits: { hits: [], total: { value: 2 } } });
      await expect(service.deleteMany(scope, { source: 'longmemeval' })).resolves.toBe(2);
      expect(esClient.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { bool: { filter: [...ownerFilters, { term: { source: 'longmemeval' } }] } },
        })
      );
    });

    it('refuses a filtered delete without a criterion', async () => {
      await expect(service.deleteMany(scope, {})).rejects.toBeInstanceOf(
        MemoryStoreValidationError
      );
    });
  });

  describe('search', () => {
    it('searches chunks only, with the session, agent and time filters', async () => {
      storage.search.mockResolvedValue({
        hits: {
          hits: [
            {
              _source: {
                kind: 'chunk',
                session_id: 'sess-1',
                source: 'longmemeval',
                chunk_index: 2,
                turn_start: 4,
                turn_end: 6,
                content: 'User: hi',
                timestamp: '2026-10-01T09:00:00.000Z',
              },
            },
          ],
        },
      });

      const lists = await service.search(scope, {
        query: 'hi',
        size: 3,
        filters: { agent_id: 'agent-a', exclude_session_ids: ['old'], to: '2026-12-01' },
      });

      const [lexicalRequest] = storage.search.mock.calls[0];
      expect(lexicalRequest.query.bool.filter).toEqual([
        ...ownerFilters,
        { term: { kind: 'chunk' } },
        { term: { agent_id: 'agent-a' } },
        { range: { timestamp: { lte: '2026-12-01' } } },
      ]);
      expect(lexicalRequest._source).toEqual({ excludes: ['turns'] });
      expect(lists.lexical).toEqual([
        {
          source: 'transcript',
          id: 'sess-1#2',
          content: 'User: hi',
          session_id: 'sess-1',
          timestamp: '2026-10-01T09:00:00.000Z',
          transcript: { chunk_index: 2, turn_start: 4, turn_end: 6, source: 'longmemeval' },
        },
      ]);
    });
  });
});
