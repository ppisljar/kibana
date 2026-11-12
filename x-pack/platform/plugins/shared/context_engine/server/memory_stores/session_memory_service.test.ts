/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { elasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';
import { loggerMock } from '@kbn/logging-mocks';
import { MemoryStoreValidationError } from './errors';
import { scopedDocumentId } from './owner';
import { SessionMemoryService } from './session_memory_service';
import { sessionMemoriesIndexName, type SessionMemoriesStorageClient } from './storage';

const NOW = new Date('2026-11-11T12:00:00.000Z');
const scope = { spaceId: 'default', owner: { id: 'u_profile', username: 'jdoe' } };
const ownerFilters = [{ term: { space: 'default' } }, { term: { owner_id: 'u_profile' } }];
const notExpired = {
  bool: {
    should: [
      { bool: { must_not: { exists: { field: 'expires_at' } } } },
      { range: { expires_at: { gt: NOW.toISOString() } } },
    ],
    minimum_should_match: 1,
  },
};

const emptySearch = { hits: { hits: [], total: { value: 0, relation: 'eq' } } };

describe('SessionMemoryService', () => {
  let storage: { search: jest.Mock; bulk: jest.Mock };
  let esClient: ReturnType<typeof elasticsearchClientMock.createElasticsearchClient>;
  let service: SessionMemoryService;

  beforeEach(() => {
    storage = { search: jest.fn().mockResolvedValue(emptySearch), bulk: jest.fn() };
    esClient = elasticsearchClientMock.createElasticsearchClient();
    service = new SessionMemoryService({
      storage: storage as unknown as SessionMemoriesStorageClient,
      esClient,
      logger: loggerMock.create(),
      getCurrentDate: () => NOW,
    });
  });

  describe('write', () => {
    it("stores memories under ids scoped to the owner, with the owner's fields and a default expiry", async () => {
      storage.bulk.mockResolvedValue({
        errors: false,
        items: [{ index: { result: 'created' } }, { index: { result: 'created' } }],
      });

      const response = await service.write(scope, [
        {
          id: 'm1',
          session_id: 's-1',
          agent_id: 'agent-a',
          type: 'memory.session_fact',
          title: 'Safari crash',
          content: 'Safari crashes on billing.',
          tags: ['billing'],
        },
        {
          id: 'm2',
          session_id: 's-1',
          type: 'memory.session',
          title: 'Summary',
          content: 'What happened.',
          expires_at: null,
        },
      ]);

      expect(response).toEqual({
        items: [
          { id: 'm1', result: 'created' },
          { id: 'm2', result: 'created' },
        ],
      });
      const [{ operations, refresh }] = storage.bulk.mock.calls[0];
      expect(refresh).toBe('wait_for');
      expect(operations[0]).toEqual({
        index: {
          _id: scopedDocumentId('default', scope.owner, 'session_memory', 'm1'),
          document: {
            id: 'm1',
            space: 'default',
            owner_id: 'u_profile',
            owner_username: 'jdoe',
            session_id: 's-1',
            agent_id: 'agent-a',
            type: 'memory.session_fact',
            title: 'Safari crash',
            content: 'Safari crashes on billing.',
            tags: ['billing'],
            created_at: NOW.toISOString(),
            updated_at: NOW.toISOString(),
            expires_at: '2027-02-09T12:00:00.000Z',
          },
        },
      });
      expect(operations[1].index.document).not.toHaveProperty('expires_at');
    });

    it('keeps the creation time of a memory it replaces and reports it as updated', async () => {
      const documentId = scopedDocumentId('default', scope.owner, 'session_memory', 'm1');
      storage.search.mockResolvedValue({
        hits: { hits: [{ _id: documentId, _source: { created_at: '2026-01-01T00:00:00.000Z' } }] },
      });
      storage.bulk.mockResolvedValue({ errors: false, items: [{ index: { result: 'updated' } }] });

      const response = await service.write(
        scope,
        [{ id: 'm1', session_id: 's', type: 'memory.session', title: 't', content: 'c' }],
        { refresh: false }
      );

      expect(storage.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { bool: { filter: [...ownerFilters, { ids: { values: [documentId] } }] } },
        })
      );
      const [{ operations, refresh }] = storage.bulk.mock.calls[0];
      expect(refresh).toBe(false);
      expect(operations[0].index.document.created_at).toBe('2026-01-01T00:00:00.000Z');
      expect(response.items).toEqual([{ id: 'm1', result: 'updated' }]);
    });

    it('generates ids for memories without one', async () => {
      storage.bulk.mockResolvedValue({ errors: false, items: [{ index: { result: 'created' } }] });
      const { items } = await service.write(scope, [
        { session_id: 's', type: 'memory.session', title: 't', content: 'c' },
      ]);
      expect(items[0].id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('rejects an id listed twice', async () => {
      await expect(
        service.write(scope, [
          { id: 'm1', session_id: 's', type: 'memory.session', title: 't', content: 'c' },
          { id: 'm1', session_id: 's', type: 'memory.session', title: 't', content: 'c' },
        ])
      ).rejects.toBeInstanceOf(MemoryStoreValidationError);
      expect(storage.bulk).not.toHaveBeenCalled();
    });

    it('fails when Elasticsearch rejects a memory', async () => {
      storage.bulk.mockResolvedValue({
        errors: true,
        items: [
          { index: { error: { type: 'inference_exception', reason: 'model not deployed' } } },
        ],
      });
      await expect(
        service.write(scope, [
          { session_id: 's', type: 'memory.session', title: 't', content: 'c' },
        ])
      ).rejects.toThrow('model not deployed');
    });
  });

  describe('list', () => {
    it("pages through the owner's unexpired memories, newest first, without owner fields", async () => {
      storage.search.mockResolvedValue({
        hits: {
          total: { value: 3, relation: 'eq' },
          hits: [
            {
              _source: {
                id: 'm1',
                space: 'default',
                owner_id: 'u_profile',
                owner_username: 'jdoe',
                session_id: 's-1',
                type: 'memory.session',
                title: 't',
                content: 'c',
                created_at: 'x',
                updated_at: 'y',
              },
            },
          ],
        },
      });

      const response = await service.list(scope, { session_id: 's-1', page: 2, per_page: 2 });

      expect(storage.search).toHaveBeenCalledWith({
        track_total_hits: true,
        from: 2,
        size: 2,
        sort: [{ updated_at: { order: 'desc' } }, { id: { order: 'asc' } }],
        query: { bool: { filter: [...ownerFilters, notExpired, { term: { session_id: 's-1' } }] } },
      });
      expect(response).toEqual({
        memories: [
          {
            id: 'm1',
            session_id: 's-1',
            type: 'memory.session',
            title: 't',
            content: 'c',
            created_at: 'x',
            updated_at: 'y',
          },
        ],
        total: 3,
        page: 2,
        per_page: 2,
      });
    });
  });

  describe('delete', () => {
    it("deletes only the owner's memories matching every criterion", async () => {
      esClient.deleteByQuery.mockResolvedValue({ deleted: 4 });
      await expect(service.delete(scope, { ids: ['m1'], agent_id: 'a' })).resolves.toBe(4);
      expect(esClient.deleteByQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          index: sessionMemoriesIndexName,
          refresh: true,
          query: {
            bool: {
              filter: [...ownerFilters, { terms: { id: ['m1'] } }, { term: { agent_id: 'a' } }],
            },
          },
        })
      );
    });

    it('refuses to delete without a criterion', async () => {
      await expect(service.delete(scope, {})).rejects.toBeInstanceOf(MemoryStoreValidationError);
      expect(esClient.deleteByQuery).not.toHaveBeenCalled();
    });
  });

  describe('readForDreaming', () => {
    it("reads every owner's unexpired memories for the AI index since a time, oldest first", async () => {
      storage.search.mockResolvedValue({
        hits: {
          hits: [
            { _id: 'doc-1', _source: { id: 'm1', updated_at: '2026-11-02T00:00:00.000Z' } },
            {
              _id: 'doc-2',
              _source: { id: 'm2', updated_at: '2026-11-03T00:00:00.000Z' },
              sort: [1762128000000, 'u2', 'm2'],
            },
          ],
        },
      });

      const read = await service.readForDreaming({
        spaceId: 'default',
        aiIndexId: 'support',
        since: '2026-11-01T00:00:00.000Z',
        size: 2,
      });

      expect(storage.search).toHaveBeenCalledWith({
        track_total_hits: false,
        size: 2,
        sort: [
          { updated_at: { order: 'asc' } },
          { owner_id: { order: 'asc' } },
          { id: { order: 'asc' } },
        ],
        query: {
          bool: {
            filter: [
              { term: { space: 'default' } },
              { term: { ai_index_id: 'support' } },
              { range: { updated_at: { gte: '2026-11-01T00:00:00.000Z' } } },
              notExpired,
            ],
          },
        },
      });
      expect(read.memories.map(({ documentId }) => documentId)).toEqual(['doc-1', 'doc-2']);
      // Two read with size 2: there may be more, after the last one.
      expect(read.resumeFrom).toBe('2026-11-03T00:00:00.000Z');
      expect(read.resumeAfter).toEqual([1762128000000, 'u2', 'm2']);
    });

    it('continues after the last memory of the read that stopped', async () => {
      storage.search.mockResolvedValue({ hits: { hits: [] } });
      await service.readForDreaming({
        spaceId: 'default',
        aiIndexId: 'support',
        since: '2026-11-03T00:00:00.000Z',
        after: [1762128000000, 'u2', 'm2'],
        size: 500,
      });
      expect(storage.search.mock.calls[0][0].search_after).toEqual([1762128000000, 'u2', 'm2']);
    });

    it('has nowhere to resume from when it read fewer than it could', async () => {
      storage.search.mockResolvedValue({
        hits: { hits: [{ _id: 'doc-1', _source: { id: 'm1', updated_at: 'x' } }] },
      });
      const read = await service.readForDreaming({
        spaceId: 'default',
        aiIndexId: 'support',
        since: '2026-11-01T00:00:00.000Z',
        size: 500,
      });
      expect(read.resumeFrom).toBeUndefined();
    });
  });

  describe('search', () => {
    const hit = {
      _source: {
        id: 'm1',
        space: 'default',
        owner_id: 'u_profile',
        owner_username: 'jdoe',
        session_id: 's-1',
        agent_id: 'agent-a',
        type: 'memory.session_fact',
        title: 'Safari crash',
        content: 'Safari crashes on billing.',
        tags: ['billing'],
        created_at: 'x',
        updated_at: '2026-11-01T00:00:00.000Z',
      },
    };

    it('runs a lexical and a semantic query under the owner scope and the recall filters', async () => {
      storage.search.mockResolvedValue({ hits: { hits: [hit] } });

      const lists = await service.search(scope, {
        query: 'safari',
        size: 5,
        filters: {
          agent_id: 'agent-a',
          session_ids: ['s-1'],
          exclude_session_ids: ['s-9'],
          types: ['memory.*'],
          tags: ['Billing'],
          from: '2026-01-01T00:00:00.000Z',
        },
      });

      const [[lexicalRequest], [semanticRequest]] = storage.search.mock.calls;
      expect(lexicalRequest.size).toBe(5);
      expect(lexicalRequest.query.bool.filter).toEqual([
        ...ownerFilters,
        notExpired,
        { term: { agent_id: 'agent-a' } },
        { terms: { session_id: ['s-1'] } },
        { bool: { should: [{ prefix: { type: 'memory.' } }], minimum_should_match: 1 } },
        { terms: { tags: ['billing'] } },
        { range: { updated_at: { gte: '2026-01-01T00:00:00.000Z' } } },
      ]);
      expect(lexicalRequest.query.bool.must_not).toEqual([{ terms: { session_id: ['s-9'] } }]);
      expect(lexicalRequest.query.bool.must).toHaveProperty('multi_match');
      expect(semanticRequest.query.bool.must.bool.should).toContainEqual({
        semantic: { field: 'content.semantic', query: 'safari' },
      });
      expect(lists.lexical).toEqual([
        {
          source: 'session_memory',
          id: 'm1',
          title: 'Safari crash',
          content: 'Safari crashes on billing.',
          type: 'memory.session_fact',
          tags: ['billing'],
          session_id: 's-1',
          agent_id: 'agent-a',
          timestamp: '2026-11-01T00:00:00.000Z',
        },
      ]);
      expect(lists.semantic).toHaveLength(1);
    });

    it('keeps the lexical list when the semantic query fails', async () => {
      storage.search
        .mockResolvedValueOnce({ hits: { hits: [hit] } })
        .mockRejectedValueOnce(new Error('inference endpoint not found'));

      const lists = await service.search(scope, { query: 'safari', size: 5, filters: {} });

      expect(lists.lexical).toHaveLength(1);
      expect(lists.semantic).toBeUndefined();
      expect(lists.semanticError).toBe('inference endpoint not found');
    });
  });
});
