/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { loggerMock } from '@kbn/logging-mocks';
import { createClient, type ConversationClient } from './client';
import type { AgentRegistry } from '../../agents/agent_registry';
import type { AgentExecutionClient } from '../../execution/persistence';
import type { ConversationEventsServiceStart } from '../../conversation_events';

const mockEs = {
  search: jest.fn(),
  index: jest.fn(),
  delete: jest.fn(),
  get: jest.fn(),
};

jest.mock('./storage', () => ({
  createStorage: jest.fn(() => ({
    getClient: jest.fn(() => mockEs),
  })),
  conversationIndexName: '.kibana_agent_builder_conversations',
}));

jest.mock('../templates/registry', () => ({ getTemplate: jest.fn() }));

const USER = { id: 'user-1', username: 'test-user', isAdmin: false };
const SPACE = 'default';

const hitsOf = (hits: Array<{ _id: string; _source?: Record<string, unknown> }>) => ({
  hits: { hits, total: { value: hits.length, relation: 'eq' } },
});

const validRound = { user_message: 'hello', assistant_message: 'hi' };

describe('ConversationClient.import', () => {
  let client: ConversationClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEs.search.mockReset();
    mockEs.index.mockReset();
    mockEs.delete.mockReset();
    mockEs.search.mockResolvedValue(hitsOf([]));
    mockEs.index.mockResolvedValue({ _seq_no: 0, _primary_term: 1 });
    mockEs.delete.mockResolvedValue({ result: 'deleted' });
    client = createClient({
      space: SPACE,
      logger: loggerMock.create(),
      esClient: {} as unknown as ElasticsearchClient,
      executionClient: {} as unknown as AgentExecutionClient,
      agentRegistry: {
        get: jest.fn().mockResolvedValue({ id: 'agent-1' }),
        getIds: jest.fn().mockResolvedValue(['agent-1']),
      } as unknown as AgentRegistry,
      conversationEvents: {
        getDefinition: jest.fn(),
        list: jest.fn().mockReturnValue([]),
      } as unknown as ConversationEventsServiceStart,
      user: USER,
    });
  });

  it('rejects an import without rounds', async () => {
    await expect(client.import({ agent_id: 'agent-1', rounds: [] })).rejects.toThrow(
      'At least one round is required'
    );
    expect(mockEs.index).not.toHaveBeenCalled();
  });

  it('rejects an invalid started_at timestamp', async () => {
    await expect(
      client.import({
        agent_id: 'agent-1',
        rounds: [{ ...validRound, started_at: 'not-a-date' }],
      })
    ).rejects.toThrow('rounds[0].started_at is not a valid ISO timestamp');
  });

  it('refuses to replace a conversation owned by another user', async () => {
    mockEs.search.mockResolvedValueOnce(
      hitsOf([{ _id: 'conv-1', _source: { user_name: 'someone-else' } }])
    );
    await expect(
      client.import({ agent_id: 'agent-1', id: 'conv-1', mode: 'overwrite', rounds: [validRound] })
    ).rejects.toMatchObject({ meta: { statusCode: 403 } });
    expect(mockEs.delete).not.toHaveBeenCalled();
  });

  it('fails in create mode when the id already exists', async () => {
    mockEs.search.mockResolvedValueOnce(
      hitsOf([{ _id: 'conv-1', _source: { user_name: USER.username } }])
    );
    await expect(
      client.import({ agent_id: 'agent-1', id: 'conv-1', rounds: [validRound] })
    ).rejects.toThrow(/already exists/);
    expect(mockEs.index).not.toHaveBeenCalled();
  });

  it('deletes the owned conversation before recreating it in overwrite mode', async () => {
    mockEs.search.mockResolvedValueOnce(
      hitsOf([{ _id: 'conv-1', _source: { user_name: USER.username } }])
    );
    const deleteSpy = jest.spyOn(client, 'delete').mockResolvedValue(true);
    const createSpy = jest
      .spyOn(client, 'create')
      .mockResolvedValue({ id: 'conv-1' } as unknown as Awaited<ReturnType<ConversationClient['create']>>);

    await client.import({
      agent_id: 'agent-1',
      id: 'conv-1',
      mode: 'overwrite',
      rounds: [validRound],
    });

    expect(deleteSpy).toHaveBeenCalledWith('conv-1');
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conv-1', agent_id: 'agent-1', title: 'hello' }),
      { source: 'http_api' }
    );
    expect(deleteSpy.mock.invocationCallOrder[0]).toBeLessThan(createSpy.mock.invocationCallOrder[0]);
  });
});

describe('ConversationClient.bulkDelete', () => {
  let client: ConversationClient;

  beforeEach(() => {
    jest.clearAllMocks();
    mockEs.search.mockReset();
    mockEs.index.mockReset();
    mockEs.delete.mockReset();
    mockEs.search.mockResolvedValue(hitsOf([]));
    mockEs.delete.mockResolvedValue({ result: 'deleted' });
    client = createClient({
      space: SPACE,
      logger: loggerMock.create(),
      esClient: {} as unknown as ElasticsearchClient,
      executionClient: {} as unknown as AgentExecutionClient,
      agentRegistry: {
        get: jest.fn(),
        getIds: jest.fn(),
      } as unknown as AgentRegistry,
      conversationEvents: {
        getDefinition: jest.fn(),
        list: jest.fn().mockReturnValue([]),
      } as unknown as ConversationEventsServiceStart,
      user: USER,
    });
  });

  it('requires at least one filter', async () => {
    await expect(client.bulkDelete({})).rejects.toThrow('bulkDelete requires at least one of');
  });

  it('scopes every query to the current user and space', async () => {
    mockEs.search.mockResolvedValueOnce({ hits: { hits: [], total: { value: 0, relation: 'eq' } } });
    await client.bulkDelete({ agent_id: 'agent-1' });
    const query = mockEs.search.mock.calls[0][0].query;
    expect(query.bool.filter).toEqual(
      expect.arrayContaining([{ term: { user_name: USER.username } }, { term: { agent_id: 'agent-1' } }])
    );
  });

  it('reports matches without deleting on dry run', async () => {
    mockEs.search.mockResolvedValueOnce({ hits: { hits: [], total: { value: 3, relation: 'eq' } } });
    await expect(client.bulkDelete({ agent_id: 'agent-1', dry_run: true })).resolves.toEqual({
      deleted: 0,
      matched: 3,
      not_found: [],
    });
    expect(mockEs.delete).not.toHaveBeenCalled();
  });

  it('lists explicit ids that were not found', async () => {
    mockEs.search
      .mockResolvedValueOnce({ hits: { hits: [], total: { value: 1, relation: 'eq' } } })
      .mockResolvedValueOnce(hitsOf([{ _id: 'a' }]))
      .mockResolvedValueOnce({ hits: { hits: [], total: { value: 0, relation: 'eq' } } });
    const result = await client.bulkDelete({ conversation_ids: ['a', 'b'], dry_run: true });
    expect(result.not_found).toEqual(['b']);
  });

  it('deletes matching pages until none remain', async () => {
    mockEs.search
      .mockResolvedValueOnce({ hits: { hits: [], total: { value: 2, relation: 'eq' } } })
      .mockResolvedValueOnce(hitsOf([{ _id: 'a' }, { _id: 'b' }]))
      .mockResolvedValueOnce(hitsOf([{ _id: 'a' }, { _id: 'b' }]));
    const result = await client.bulkDelete({ conversation_ids: ['a', 'b'] });
    expect(mockEs.delete).toHaveBeenCalledWith({ id: 'a' });
    expect(mockEs.delete).toHaveBeenCalledWith({ id: 'b' });
    expect(result).toEqual({ deleted: 2, matched: 2, not_found: [] });
  });

  it('stops when a full page deletes nothing', async () => {
    mockEs.search
      .mockResolvedValueOnce({ hits: { hits: [], total: { value: 5, relation: 'eq' } } })
      .mockResolvedValueOnce(hitsOf([{ _id: 'a' }]));
    mockEs.delete.mockResolvedValueOnce({ result: 'not_found' });
    const result = await client.bulkDelete({ agent_id: 'agent-1' });
    expect(result.deleted).toBe(0);
    expect(mockEs.search).toHaveBeenCalledTimes(2);
  });
});
