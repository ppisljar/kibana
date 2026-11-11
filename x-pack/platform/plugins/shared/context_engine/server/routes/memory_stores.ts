/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  IRouter,
  KibanaRequest,
  KibanaResponseFactory,
  Logger,
  RequestHandlerContext,
} from '@kbn/core/server';
import type { RouteSecurity } from '@kbn/core-http-server';
import type { SecurityServiceStart } from '@kbn/core-security-server';
import { isResponseError } from '@kbn/es-errors';
import type { SpacesPluginStart } from '@kbn/spaces-plugin/server';
import {
  AI_INDEX_INTERNAL_API_VERSION,
  RECALL_PATH,
  SESSION_MEMORIES_BULK_DELETE_PATH,
  SESSION_MEMORIES_BULK_PATH,
  SESSION_MEMORIES_PATH,
  TRANSCRIPT_BY_SESSION_PATH,
  TRANSCRIPTS_BULK_DELETE_PATH,
} from '../../common/constants';
import { apiPrivileges } from '../../common/features';
import type {
  DeleteSessionMemoriesResponse,
  ListSessionMemoriesResponse,
  WriteSessionMemoriesResponse,
} from '../../common/http_api/session_memories';
import {
  MAX_TRANSCRIPT_REQUEST_BYTES,
  type DeleteTranscriptResponse,
  type DeleteTranscriptsResponse,
  type GetTranscriptResponse,
  type PutTranscriptResponse,
} from '../../common/http_api/transcripts';
import type { RecallResponse } from '../../common/http_api/recall';
import { AiIndexNotFoundError } from '../ai_indices/errors';
import type { AiIndexDataReadServiceApi } from '../ai_indices/data_read_service';
import type { AiIndexService } from '../ai_indices/service';
import { MemoryStoreAuditAction, memoryStoreAuditEvent } from '../audit/audit_events';
import {
  MemoryDisabledError,
  MemoryStoreConflictError,
  MemoryStoreValidationError,
  TranscriptNotFoundError,
} from '../memory_stores/errors';
import { resolveMemoryOwner } from '../memory_stores/owner';
import type {
  SessionMemoryScope,
  SessionMemoryService,
} from '../memory_stores/session_memory_service';
import type { TranscriptService } from '../memory_stores/transcript_service';
import { recall } from '../recall/recall';
import type { GetAiIndexDataReadServiceParams } from '../types';
import { formatErrorMessage } from '../utils/format_es_error';
import { resolveSpaceId } from '../utils/resolve_space_id';
import {
  deleteSessionMemoriesBodySchema,
  deleteTranscriptsBodySchema,
  listSessionMemoriesQuerySchema,
  putTranscriptBodySchema,
  recallBodySchema,
  transcriptSessionParamsSchema,
  writeSessionMemoriesBodySchema,
} from './schemas/memory_stores_schema';
import { withContextEngineFeatureFlag } from './with_feature_flag';

const READ_SECURITY: RouteSecurity = {
  authz: { requiredPrivileges: [apiPrivileges.readContextEngine] },
};

const WRITE_SECURITY: RouteSecurity = {
  authz: { requiredPrivileges: [apiPrivileges.writeContextEngine] },
};

/** Writing a long transcript runs inference on every chunk it is split into. */
const TRANSCRIPT_WRITE_IDLE_SOCKET_MS = 10 * 60 * 1000;
/** Recall waits for the reranker, which deploys on first use. */
const RECALL_IDLE_SOCKET_MS = 5 * 60 * 1000;

const STORE_NOTE =
  'Reads and writes only the calling user’s own documents in the current space. Requires the global Context Engine memory setting.';

const handleError = (error: unknown, response: KibanaResponseFactory, logger: Logger) => {
  if (error instanceof MemoryDisabledError || error instanceof MemoryStoreValidationError) {
    return response.badRequest({ body: { message: error.message } });
  }
  if (error instanceof AiIndexNotFoundError || error instanceof TranscriptNotFoundError) {
    return response.notFound({ body: { message: error.message } });
  }
  if (error instanceof MemoryStoreConflictError) {
    return response.conflict({ body: { message: error.message } });
  }
  logger.error(error instanceof Error ? error.stack ?? error.message : String(error));
  return response.customError({
    statusCode: isResponseError(error) ? error.statusCode ?? 500 : 500,
    body: { message: formatErrorMessage(error) },
  });
};

const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const registerMemoryStoreRoutes = ({
  router,
  logger,
  getSpaces,
  getSecurity,
  isMemoryEnabled,
  getSessionMemoryService,
  getTranscriptService,
  getAiIndexService,
  getAiIndexDataReadService,
}: {
  router: IRouter;
  logger: Logger;
  getSpaces: () => Promise<SpacesPluginStart | undefined>;
  getSecurity: () => Promise<SecurityServiceStart>;
  isMemoryEnabled: (request: KibanaRequest) => Promise<boolean>;
  getSessionMemoryService: () => SessionMemoryService;
  getTranscriptService: () => TranscriptService;
  getAiIndexService: () => AiIndexService;
  getAiIndexDataReadService: (params: GetAiIndexDataReadServiceParams) => AiIndexDataReadServiceApi;
}) => {
  const resolveScope = async (
    ctx: RequestHandlerContext,
    request: KibanaRequest
  ): Promise<SessionMemoryScope> => {
    if (!(await isMemoryEnabled(request))) {
      throw new MemoryDisabledError();
    }
    const [spaces, security, core] = await Promise.all([getSpaces(), getSecurity(), ctx.core]);
    const owner = await resolveMemoryOwner({
      request,
      security,
      esClient: core.elasticsearch.client.asCurrentUser,
    });
    return { spaceId: resolveSpaceId(spaces, request), owner };
  };

  /** Rejects AI index ids that are not registered in the space. */
  const assertAiIndicesExist = async (spaceId: string, ids: Array<string | undefined>) => {
    const unique = [...new Set(ids.filter((id): id is string => id !== undefined))];
    const aiIndexService = getAiIndexService();
    await Promise.all(unique.map((id) => aiIndexService.get(id, spaceId)));
  };

  // Write session memories
  router.versioned
    .post({
      path: SESSION_MEMORIES_BULK_PATH,
      security: WRITE_SECURITY,
      access: 'internal',
      summary: 'Write session memories',
      description: `Creates or replaces session memories by id. ${STORE_NOTE}`,
    })
    .addVersion(
      {
        version: AI_INDEX_INTERNAL_API_VERSION,
        validate: { request: { body: writeSessionMemoriesBodySchema } },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const auditLogger = (await ctx.core).security.audit.logger;
        try {
          const scope = await resolveScope(ctx, request);
          const { memories, refresh } = request.body;
          await assertAiIndicesExist(
            scope.spaceId,
            memories.map(({ ai_index_id: aiIndexId }) => aiIndexId)
          );
          const body: WriteSessionMemoriesResponse = await getSessionMemoryService().write(
            scope,
            memories,
            { refresh }
          );
          auditLogger.log(
            memoryStoreAuditEvent({ action: MemoryStoreAuditAction.SESSION_MEMORY_WRITE })
          );
          return response.ok({ body });
        } catch (error) {
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.SESSION_MEMORY_WRITE,
              error: asError(error),
            })
          );
          return handleError(error, response, logger);
        }
      })
    );

  // List session memories
  router.versioned
    .get({
      path: SESSION_MEMORIES_PATH,
      security: READ_SECURITY,
      access: 'internal',
      summary: 'List session memories',
      description: `Lists unexpired session memories, newest first. ${STORE_NOTE}`,
    })
    .addVersion(
      {
        version: AI_INDEX_INTERNAL_API_VERSION,
        validate: { request: { query: listSessionMemoriesQuerySchema } },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const auditLogger = (await ctx.core).security.audit.logger;
        try {
          const scope = await resolveScope(ctx, request);
          const body: ListSessionMemoriesResponse = await getSessionMemoryService().list(
            scope,
            request.query
          );
          auditLogger.log(
            memoryStoreAuditEvent({ action: MemoryStoreAuditAction.SESSION_MEMORY_LIST })
          );
          return response.ok({ body });
        } catch (error) {
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.SESSION_MEMORY_LIST,
              error: asError(error),
            })
          );
          return handleError(error, response, logger);
        }
      })
    );

  // Delete session memories
  router.versioned
    .post({
      path: SESSION_MEMORIES_BULK_DELETE_PATH,
      security: WRITE_SECURITY,
      access: 'internal',
      summary: 'Delete session memories',
      description: `Deletes the session memories matching every given criterion. ${STORE_NOTE}`,
    })
    .addVersion(
      {
        version: AI_INDEX_INTERNAL_API_VERSION,
        validate: { request: { body: deleteSessionMemoriesBodySchema } },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const auditLogger = (await ctx.core).security.audit.logger;
        try {
          const scope = await resolveScope(ctx, request);
          const deleted = await getSessionMemoryService().delete(scope, request.body);
          auditLogger.log(
            memoryStoreAuditEvent({ action: MemoryStoreAuditAction.SESSION_MEMORY_DELETE })
          );
          const body: DeleteSessionMemoriesResponse = { deleted };
          return response.ok({ body });
        } catch (error) {
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.SESSION_MEMORY_DELETE,
              error: asError(error),
            })
          );
          return handleError(error, response, logger);
        }
      })
    );

  // Write a transcript
  router.versioned
    .put({
      path: TRANSCRIPT_BY_SESSION_PATH,
      security: WRITE_SECURITY,
      access: 'internal',
      summary: 'Write the transcript of a session',
      description: `Stores the turns of a session from any source, replacing the stored session or appending to it. ${STORE_NOTE}`,
      options: {
        body: { maxBytes: MAX_TRANSCRIPT_REQUEST_BYTES },
        timeout: { idleSocket: TRANSCRIPT_WRITE_IDLE_SOCKET_MS },
      },
    })
    .addVersion(
      {
        version: AI_INDEX_INTERNAL_API_VERSION,
        validate: {
          request: { params: transcriptSessionParamsSchema, body: putTranscriptBodySchema },
        },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const auditLogger = (await ctx.core).security.audit.logger;
        const { sessionId } = request.params;
        try {
          const scope = await resolveScope(ctx, request);
          await assertAiIndicesExist(scope.spaceId, [request.body.ai_index_id]);
          const body: PutTranscriptResponse = await getTranscriptService().put(
            scope,
            sessionId,
            request.body
          );
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.TRANSCRIPT_WRITE,
              id: sessionId,
            })
          );
          return body.result === 'created' ? response.created({ body }) : response.ok({ body });
        } catch (error) {
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.TRANSCRIPT_WRITE,
              id: sessionId,
              error: asError(error),
            })
          );
          return handleError(error, response, logger);
        }
      })
    );

  // Get a transcript
  router.versioned
    .get({
      path: TRANSCRIPT_BY_SESSION_PATH,
      security: READ_SECURITY,
      access: 'internal',
      summary: 'Get the transcript of a session',
      description: `Returns a stored session with its turns in order. ${STORE_NOTE}`,
    })
    .addVersion(
      {
        version: AI_INDEX_INTERNAL_API_VERSION,
        validate: { request: { params: transcriptSessionParamsSchema } },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const auditLogger = (await ctx.core).security.audit.logger;
        const { sessionId } = request.params;
        try {
          const scope = await resolveScope(ctx, request);
          const body: GetTranscriptResponse = await getTranscriptService().get(scope, sessionId);
          auditLogger.log(
            memoryStoreAuditEvent({ action: MemoryStoreAuditAction.TRANSCRIPT_GET, id: sessionId })
          );
          return response.ok({ body });
        } catch (error) {
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.TRANSCRIPT_GET,
              id: sessionId,
              error: asError(error),
            })
          );
          return handleError(error, response, logger);
        }
      })
    );

  // Delete a transcript
  router.versioned
    .delete({
      path: TRANSCRIPT_BY_SESSION_PATH,
      security: WRITE_SECURITY,
      access: 'internal',
      summary: 'Delete the transcript of a session',
      description: `Deletes a stored session and its turns. ${STORE_NOTE}`,
    })
    .addVersion(
      {
        version: AI_INDEX_INTERNAL_API_VERSION,
        validate: { request: { params: transcriptSessionParamsSchema } },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const auditLogger = (await ctx.core).security.audit.logger;
        const { sessionId } = request.params;
        try {
          const scope = await resolveScope(ctx, request);
          const deleted = await getTranscriptService().delete(scope, sessionId);
          if (!deleted) {
            throw new TranscriptNotFoundError(sessionId);
          }
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.TRANSCRIPT_DELETE,
              id: sessionId,
            })
          );
          const body: DeleteTranscriptResponse = { deleted };
          return response.ok({ body });
        } catch (error) {
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.TRANSCRIPT_DELETE,
              id: sessionId,
              error: asError(error),
            })
          );
          return handleError(error, response, logger);
        }
      })
    );

  // Delete transcripts
  router.versioned
    .post({
      path: TRANSCRIPTS_BULK_DELETE_PATH,
      security: WRITE_SECURITY,
      access: 'internal',
      summary: 'Delete transcripts',
      description: `Deletes the sessions matching every given criterion. ${STORE_NOTE}`,
    })
    .addVersion(
      {
        version: AI_INDEX_INTERNAL_API_VERSION,
        validate: { request: { body: deleteTranscriptsBodySchema } },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const auditLogger = (await ctx.core).security.audit.logger;
        try {
          const scope = await resolveScope(ctx, request);
          const deleted = await getTranscriptService().deleteMany(scope, request.body);
          auditLogger.log(
            memoryStoreAuditEvent({ action: MemoryStoreAuditAction.TRANSCRIPT_DELETE })
          );
          const body: DeleteTranscriptsResponse = { deleted };
          return response.ok({ body });
        } catch (error) {
          auditLogger.log(
            memoryStoreAuditEvent({
              action: MemoryStoreAuditAction.TRANSCRIPT_DELETE,
              error: asError(error),
            })
          );
          return handleError(error, response, logger);
        }
      })
    );

  // Recall
  router.versioned
    .post({
      path: RECALL_PATH,
      security: READ_SECURITY,
      access: 'internal',
      summary: 'Recall',
      description:
        'Searches AI indices the caller can read, and the caller’s session memories and transcripts, with lexical and semantic retrieval. Fuses the results, reranks them with a rerank inference endpoint when one answers, then filters and caps them. Requires the global Context Engine memory setting.',
      options: { timeout: { idleSocket: RECALL_IDLE_SOCKET_MS } },
    })
    .addVersion(
      {
        version: AI_INDEX_INTERNAL_API_VERSION,
        validate: { request: { body: recallBodySchema } },
      },
      withContextEngineFeatureFlag(async (ctx, request, response) => {
        const core = await ctx.core;
        const auditLogger = core.security.audit.logger;
        try {
          const scope = await resolveScope(ctx, request);
          const esClient = core.elasticsearch.client.asCurrentUser;
          const dataReadService = getAiIndexDataReadService({ esClient, request });
          const body: RecallResponse = await recall(
            {
              scope,
              esClient,
              internalEsClient: core.elasticsearch.client.asInternalUser,
              listReadableAiIndices: (ids) => dataReadService.list(ids),
              listRegisteredAiIndices: () => getAiIndexService().list(scope.spaceId),
              sessionMemories: getSessionMemoryService(),
              transcripts: getTranscriptService(),
              logger,
            },
            request.body
          );
          auditLogger.log(memoryStoreAuditEvent({ action: MemoryStoreAuditAction.RECALL }));
          return response.ok({ body });
        } catch (error) {
          auditLogger.log(
            memoryStoreAuditEvent({ action: MemoryStoreAuditAction.RECALL, error: asError(error) })
          );
          return handleError(error, response, logger);
        }
      })
    );
};
