/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

jest.mock('../recall/recall');

import type { Type } from '@kbn/config-schema';
import type { IRouter, RequestHandler } from '@kbn/core/server';
import { httpServerMock } from '@kbn/core/server/mocks';
import type { SecurityServiceStart } from '@kbn/core-security-server';
import { loggerMock } from '@kbn/logging-mocks';
import { spacesMock } from '@kbn/spaces-plugin/server/mocks';
import {
  RECALL_PATH,
  SESSION_MEMORIES_BULK_DELETE_PATH,
  SESSION_MEMORIES_BULK_PATH,
  SESSION_MEMORIES_PATH,
  TRANSCRIPT_BY_SESSION_PATH,
  TRANSCRIPTS_BULK_DELETE_PATH,
} from '../../common/constants';
import { apiPrivileges } from '../../common/features';
import { MAX_TRANSCRIPT_REQUEST_BYTES } from '../../common/http_api/transcripts';
import { AiIndexNotFoundError } from '../ai_indices/errors';
import type { AiIndexDataReadServiceApi } from '../ai_indices/data_read_service';
import type { AiIndexService } from '../ai_indices/service';
import { MemoryStoreConflictError } from '../memory_stores/errors';
import type { SessionMemoryService } from '../memory_stores/session_memory_service';
import type { TranscriptService } from '../memory_stores/transcript_service';
import { recall } from '../recall/recall';
import { registerMemoryStoreRoutes } from './memory_stores';

interface RegisteredRoute {
  config: {
    path: string;
    access: string;
    security: { authz: { requiredPrivileges: string[] } };
    options?: { body?: { maxBytes?: number }; timeout?: { idleSocket?: number } };
  };
  handler: RequestHandler;
  validate: { request?: { params?: Type<unknown>; query?: Type<unknown>; body?: Type<unknown> } };
}

const owner = { id: 'u_profile', username: 'jdoe' };
const scope = { spaceId: 'default', owner };

describe('memory store routes', () => {
  let routes: Record<string, RegisteredRoute>;
  let featureFlagEnabled: boolean;
  let memoryEnabled: boolean;
  let auditLogger: { log: jest.Mock };
  let sessionMemories: jest.Mocked<Pick<SessionMemoryService, 'write' | 'list' | 'delete'>>;
  let transcripts: jest.Mocked<Pick<TranscriptService, 'put' | 'get' | 'delete' | 'deleteMany'>>;
  let aiIndexService: jest.Mocked<Pick<AiIndexService, 'get' | 'list'>>;
  let readService: jest.Mocked<AiIndexDataReadServiceApi>;
  let response: ReturnType<typeof httpServerMock.createResponseFactory>;

  const createContext = () =>
    ({
      core: Promise.resolve({
        uiSettings: { client: { get: jest.fn(async () => featureFlagEnabled) } },
        security: { audit: { logger: auditLogger } },
        elasticsearch: {
          client: {
            asCurrentUser: { security: { authenticate: jest.fn() } },
            asInternalUser: { inference: {} },
          },
        },
      }),
    } as unknown as Parameters<RequestHandler>[0]);

  const getRoute = (method: string, path: string) => {
    const route = routes[`${method}:${path}`];
    expect(route).toBeDefined();
    return route;
  };

  const call = async (method: string, path: string, request: Record<string, unknown> = {}) =>
    getRoute(method, path).handler(
      createContext(),
      httpServerMock.createKibanaRequest(request),
      response
    );

  const validateBody = (method: string, path: string, body: unknown) =>
    getRoute(method, path).validate.request?.body?.validate(body);

  beforeEach(() => {
    jest.clearAllMocks();
    routes = {};
    featureFlagEnabled = true;
    memoryEnabled = true;
    auditLogger = { log: jest.fn() };
    response = httpServerMock.createResponseFactory();
    sessionMemories = { write: jest.fn(), list: jest.fn(), delete: jest.fn() };
    transcripts = { put: jest.fn(), get: jest.fn(), delete: jest.fn(), deleteMany: jest.fn() };
    aiIndexService = { get: jest.fn(), list: jest.fn().mockResolvedValue([]) };
    readService = { query: jest.fn(), describe: jest.fn(), list: jest.fn().mockResolvedValue([]) };

    const createVersionedRoute = (method: string) => (config: RegisteredRoute['config']) => ({
      addVersion: (
        versionConfig: { validate: RegisteredRoute['validate'] },
        handler: RequestHandler
      ) => {
        routes[`${method}:${config.path}`] = { config, handler, validate: versionConfig.validate };
      },
    });
    const router = {
      versioned: {
        get: createVersionedRoute('GET'),
        post: createVersionedRoute('POST'),
        put: createVersionedRoute('PUT'),
        delete: createVersionedRoute('DELETE'),
      },
    } as unknown as IRouter;

    const security = {
      authc: {
        getCurrentUser: jest.fn().mockReturnValue({ username: 'jdoe', profile_uid: 'u_profile' }),
        getPrincipal: jest.fn().mockReturnValue(null),
      },
    } as unknown as SecurityServiceStart;

    registerMemoryStoreRoutes({
      router,
      logger: loggerMock.create(),
      getSpaces: async () => spacesMock.createStart(),
      getSecurity: async () => security,
      isMemoryEnabled: async () => memoryEnabled,
      getSessionMemoryService: () => sessionMemories as unknown as SessionMemoryService,
      getTranscriptService: () => transcripts as unknown as TranscriptService,
      getAiIndexService: () => aiIndexService as unknown as AiIndexService,
      getAiIndexDataReadService: () => readService,
    });
  });

  it('registers internal routes with read and write privileges', () => {
    const expected: Array<[string, string, string]> = [
      ['POST', SESSION_MEMORIES_BULK_PATH, apiPrivileges.writeContextEngine],
      ['GET', SESSION_MEMORIES_PATH, apiPrivileges.readContextEngine],
      ['POST', SESSION_MEMORIES_BULK_DELETE_PATH, apiPrivileges.writeContextEngine],
      ['PUT', TRANSCRIPT_BY_SESSION_PATH, apiPrivileges.writeContextEngine],
      ['GET', TRANSCRIPT_BY_SESSION_PATH, apiPrivileges.readContextEngine],
      ['DELETE', TRANSCRIPT_BY_SESSION_PATH, apiPrivileges.writeContextEngine],
      ['POST', TRANSCRIPTS_BULK_DELETE_PATH, apiPrivileges.writeContextEngine],
      ['POST', RECALL_PATH, apiPrivileges.readContextEngine],
    ];
    for (const [method, path, privilege] of expected) {
      const { config } = getRoute(method, path);
      expect(config.access).toBe('internal');
      expect(config.security.authz.requiredPrivileges).toEqual([privilege]);
    }
    expect(Object.keys(routes)).toHaveLength(expected.length);
    expect(getRoute('PUT', TRANSCRIPT_BY_SESSION_PATH).config.options?.body?.maxBytes).toBe(
      MAX_TRANSCRIPT_REQUEST_BYTES
    );
  });

  it('is not found while Context Engine is off in the space', async () => {
    featureFlagEnabled = false;
    await call('POST', RECALL_PATH, { body: { query: 'q' } });
    expect(response.notFound).toHaveBeenCalled();
    expect(recall).not.toHaveBeenCalled();
  });

  it('rejects every call while the global memory setting is off', async () => {
    memoryEnabled = false;
    await call('POST', SESSION_MEMORIES_BULK_PATH, { body: { memories: [] } });
    expect(response.badRequest).toHaveBeenCalledWith({
      body: {
        message: 'Context Engine memory is disabled. Enable the global memory setting first.',
      },
    });
    expect(sessionMemories.write).not.toHaveBeenCalled();
    expect(auditLogger.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: expect.objectContaining({ outcome: 'failure' }) })
    );
  });

  describe('session memories', () => {
    const memory = {
      session_id: 's-1',
      ai_index_id: 'support',
      type: 'memory.session_fact',
      title: 't',
      content: 'c',
    };

    it('writes memories for the caller, after checking the AI index exists', async () => {
      sessionMemories.write.mockResolvedValue({ items: [{ id: 'm1', result: 'created' }] });
      await call('POST', SESSION_MEMORIES_BULK_PATH, {
        body: { memories: [memory], refresh: false },
      });

      expect(aiIndexService.get).toHaveBeenCalledWith('support', 'default');
      expect(sessionMemories.write).toHaveBeenCalledWith(scope, [memory], { refresh: false });
      expect(response.ok).toHaveBeenCalledWith({
        body: { items: [{ id: 'm1', result: 'created' }] },
      });
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({
            action: 'context_engine_session_memory_write',
            outcome: 'success',
          }),
        })
      );
    });

    it('is not found for an AI index that does not exist', async () => {
      aiIndexService.get.mockRejectedValue(new AiIndexNotFoundError('support'));
      await call('POST', SESSION_MEMORIES_BULK_PATH, { body: { memories: [memory] } });
      expect(response.notFound).toHaveBeenCalled();
      expect(sessionMemories.write).not.toHaveBeenCalled();
    });

    it('validates and bounds the write body', () => {
      expect(() => validateBody('POST', SESSION_MEMORIES_BULK_PATH, { memories: [] })).toThrow();
      expect(() =>
        validateBody('POST', SESSION_MEMORIES_BULK_PATH, {
          memories: [{ ...memory, session_id: '_bulk' }],
        })
      ).toThrow('Must not start with `_`');
      expect(() =>
        validateBody('POST', SESSION_MEMORIES_BULK_PATH, {
          memories: [{ ...memory, type: 'fact.other' }],
        })
      ).toThrow();
      expect(() =>
        validateBody('POST', SESSION_MEMORIES_BULK_PATH, {
          memories: [{ ...memory, expires_at: 'tomorrow' }],
        })
      ).toThrow('Must be an ISO 8601 date.');
      expect(
        validateBody('POST', SESSION_MEMORIES_BULK_PATH, {
          memories: [{ ...memory, expires_at: null, attributes: { 'eval.run': 'r1', n: 2 } }],
        })
      ).toBeDefined();
    });

    it('lists with the page defaults', async () => {
      sessionMemories.list.mockResolvedValue({ memories: [], total: 0, page: 1, per_page: 25 });
      const query = getRoute('GET', SESSION_MEMORIES_PATH).validate.request?.query?.validate({});
      expect(query).toEqual({ page: 1, per_page: 25 });
      await call('GET', SESSION_MEMORIES_PATH, { query });
      expect(sessionMemories.list).toHaveBeenCalledWith(scope, { page: 1, per_page: 25 });
    });

    it('needs a criterion to delete', async () => {
      expect(() => validateBody('POST', SESSION_MEMORIES_BULK_DELETE_PATH, {})).toThrow(
        'Give ids, a session_id, an agent_id or an ai_index_id.'
      );
      sessionMemories.delete.mockResolvedValue(2);
      await call('POST', SESSION_MEMORIES_BULK_DELETE_PATH, { body: { session_id: 's-1' } });
      expect(sessionMemories.delete).toHaveBeenCalledWith(scope, { session_id: 's-1' });
      expect(response.ok).toHaveBeenCalledWith({ body: { deleted: 2 } });
    });
  });

  describe('transcripts', () => {
    const body = { source: 'longmemeval', turns: [{ role: 'user', content: 'hi' }] };

    it('answers 201 for a new session and 200 for a stored one', async () => {
      transcripts.put.mockResolvedValueOnce({
        session_id: 'sess-1',
        result: 'created',
        turn_count: 1,
        chunk_count: 1,
      });
      await call('PUT', TRANSCRIPT_BY_SESSION_PATH, { params: { sessionId: 'sess-1' }, body });
      expect(transcripts.put).toHaveBeenCalledWith(scope, 'sess-1', body);
      expect(response.created).toHaveBeenCalled();

      transcripts.put.mockResolvedValueOnce({
        session_id: 'sess-1',
        result: 'updated',
        turn_count: 2,
        chunk_count: 1,
      });
      await call('PUT', TRANSCRIPT_BY_SESSION_PATH, { params: { sessionId: 'sess-1' }, body });
      expect(response.ok).toHaveBeenCalled();
    });

    it('answers 409 for an append that contradicts the stored session', async () => {
      transcripts.put.mockRejectedValue(new MemoryStoreConflictError('different source'));
      await call('PUT', TRANSCRIPT_BY_SESSION_PATH, { params: { sessionId: 'sess-1' }, body });
      expect(response.conflict).toHaveBeenCalledWith({ body: { message: 'different source' } });
    });

    it('validates the transcript body', () => {
      expect(() =>
        validateBody('PUT', TRANSCRIPT_BY_SESSION_PATH, { ...body, turns: [] })
      ).toThrow();
      expect(() =>
        validateBody('PUT', TRANSCRIPT_BY_SESSION_PATH, {
          ...body,
          turns: [{ role: 'narrator', content: 'x' }],
        })
      ).toThrow();
      expect(() =>
        validateBody('PUT', TRANSCRIPT_BY_SESSION_PATH, { ...body, mode: 'merge' })
      ).toThrow();
      expect(() =>
        getRoute('PUT', TRANSCRIPT_BY_SESSION_PATH).validate.request?.params?.validate({
          sessionId: '_bulk_delete',
        })
      ).toThrow();
    });

    it('is not found when deleting a session the caller does not have', async () => {
      transcripts.delete.mockResolvedValue(false);
      await call('DELETE', TRANSCRIPT_BY_SESSION_PATH, { params: { sessionId: 'sess-1' } });
      expect(response.notFound).toHaveBeenCalled();
    });

    it('deletes sessions by criteria', async () => {
      expect(() => validateBody('POST', TRANSCRIPTS_BULK_DELETE_PATH, {})).toThrow();
      transcripts.deleteMany.mockResolvedValue(3);
      await call('POST', TRANSCRIPTS_BULK_DELETE_PATH, { body: { source: 'longmemeval' } });
      expect(transcripts.deleteMany).toHaveBeenCalledWith(scope, { source: 'longmemeval' });
      expect(response.ok).toHaveBeenCalledWith({ body: { deleted: 3 } });
    });
  });

  describe('recall', () => {
    it('recalls with the caller scope, reading AI indices through the read service', async () => {
      jest.mocked(recall).mockResolvedValue({
        results: [],
        reranked: false,
        sources: [],
        truncated: false,
      });
      await call('POST', RECALL_PATH, { body: { query: 'hotel' } });

      const [deps, request] = jest.mocked(recall).mock.calls[0];
      expect(request).toEqual({ query: 'hotel' });
      expect(deps.scope).toEqual(scope);
      await deps.listReadableAiIndices(['support']);
      expect(readService.list).toHaveBeenCalledWith(['support']);
      await deps.listRegisteredAiIndices();
      expect(aiIndexService.list).toHaveBeenCalledWith('default');
      expect(response.ok).toHaveBeenCalled();
      expect(auditLogger.log).toHaveBeenCalledWith(
        expect.objectContaining({
          event: expect.objectContaining({ action: 'context_engine_recall', outcome: 'success' }),
        })
      );
    });

    it('validates and bounds the recall body', () => {
      expect(() => validateBody('POST', RECALL_PATH, { query: '' })).toThrow();
      expect(() => validateBody('POST', RECALL_PATH, { query: 'q', limit: 1000 })).toThrow();
      expect(() =>
        validateBody('POST', RECALL_PATH, { query: 'q', sources: ['everything'] })
      ).toThrow();
      expect(() =>
        validateBody('POST', RECALL_PATH, { query: 'q', filters: { types: ['fact.*.x*'] } })
      ).toThrow();
      expect(
        validateBody('POST', RECALL_PATH, {
          query: 'q',
          sources: ['ai_indices', 'transcripts'],
          filters: { types: ['fact.*'], from: '2026-01-01T00:00:00Z' },
          rerank: { inference_id: 'my-reranker', window: 20 },
          min_score: -2.5,
        })
      ).toBeDefined();
    });
  });
});
