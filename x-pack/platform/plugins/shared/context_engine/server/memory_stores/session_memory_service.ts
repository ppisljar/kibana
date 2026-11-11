/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { QueryDslQueryContainer, SearchHit } from '@elastic/elasticsearch/lib/api/types';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import {
  DEFAULT_SESSION_MEMORIES_PAGE_SIZE,
  DEFAULT_SESSION_MEMORY_EXPIRATION_MS,
  type DeleteSessionMemoriesRequest,
  type ListSessionMemoriesQuery,
  type ListSessionMemoriesResponse,
  type SessionMemory,
  type SessionMemoryInput,
  type WriteSessionMemoriesResponse,
} from '../../common/http_api/session_memories';
import type { RecallCandidate, RecallCandidateLists, RecallSearchParams } from '../recall/types';
import { formatErrorMessage } from '../utils/format_es_error';
import { MemoryStoreValidationError } from './errors';
import { scopedDocumentId, type MemoryOwner } from './owner';
import { notExpiredFilter, ownerScopeFilters, timeRangeFilter, typeFilter } from './query_filters';
import {
  sessionMemoriesIndexName,
  type SessionMemoriesStorageClient,
  type StoredSessionMemory,
} from './storage';

export interface SessionMemoryScope {
  spaceId: string;
  owner: MemoryOwner;
}

const memoryDocumentId = ({ spaceId, owner }: SessionMemoryScope, id: string): string =>
  scopedDocumentId(spaceId, owner, 'session_memory', id);

const toSessionMemory = ({
  space: _space,
  owner_id: _ownerId,
  owner_username: _ownerUsername,
  ...memory
}: StoredSessionMemory): SessionMemory => memory;

const toCandidate = (hit: SearchHit<StoredSessionMemory>): RecallCandidate | undefined => {
  const source = hit._source;
  if (!source) {
    return undefined;
  }
  return {
    source: 'session_memory',
    id: source.id,
    title: source.title,
    ...(source.description ? { description: source.description } : {}),
    content: source.content,
    type: source.type,
    ...(source.tags?.length ? { tags: source.tags } : {}),
    session_id: source.session_id,
    ...(source.agent_id ? { agent_id: source.agent_id } : {}),
    ...(source.ai_index_id ? { ai_index_id: source.ai_index_id } : {}),
    timestamp: source.updated_at,
    ...(source.references?.length ? { references: source.references } : {}),
  };
};

const resolveExpiry = (expiresAt: string | null | undefined, now: Date): string | undefined => {
  if (expiresAt === null) {
    return undefined;
  }
  if (expiresAt === undefined) {
    return new Date(now.getTime() + DEFAULT_SESSION_MEMORY_EXPIRATION_MS).toISOString();
  }
  return new Date(expiresAt).toISOString();
};

/**
 * The session memory store: memories of one owner, scoped to sessions and optionally to an agent
 * and an AI index. Separate from AI index knowledge items, which are shared with every reader.
 */
export class SessionMemoryService {
  constructor(
    private readonly deps: {
      storage: SessionMemoriesStorageClient;
      /** Internal user: the store is a restricted system index. */
      esClient: ElasticsearchClient;
      logger: Logger;
      getCurrentDate?: () => Date;
    }
  ) {}

  private now(): Date {
    return this.deps.getCurrentDate?.() ?? new Date();
  }

  private scopeFilters(scope: SessionMemoryScope): QueryDslQueryContainer[] {
    return ownerScopeFilters(scope.spaceId, scope.owner);
  }

  /** Creates or replaces memories by id. An id is the caller's own: another owner's id is a new memory. */
  async write(
    scope: SessionMemoryScope,
    memories: readonly SessionMemoryInput[],
    { refresh = true }: { refresh?: boolean } = {}
  ): Promise<WriteSessionMemoriesResponse> {
    const { storage } = this.deps;
    const now = this.now();
    const nowIso = now.toISOString();
    const ids = memories.map((memory) => memory.id ?? randomUUID());

    if (new Set(ids).size !== ids.length) {
      throw new MemoryStoreValidationError('A memory id is listed more than once.');
    }

    const documentIds = ids.map((id) => memoryDocumentId(scope, id));
    const existing = await storage.search({
      track_total_hits: false,
      size: documentIds.length,
      _source: ['created_at'],
      query: { bool: { filter: [...this.scopeFilters(scope), { ids: { values: documentIds } }] } },
    });
    const createdAtById = new Map(
      existing.hits.hits.map((hit) => [hit._id, hit._source?.created_at ?? nowIso])
    );

    const response = await storage.bulk({
      refresh: refresh ? 'wait_for' : false,
      operations: memories.map((memory, position) => {
        const documentId = documentIds[position];
        const expiresAt = resolveExpiry(memory.expires_at, now);
        const document: StoredSessionMemory = {
          id: ids[position],
          space: scope.spaceId,
          owner_id: scope.owner.id,
          owner_username: scope.owner.username,
          session_id: memory.session_id,
          ...(memory.agent_id !== undefined && { agent_id: memory.agent_id }),
          ...(memory.ai_index_id !== undefined && { ai_index_id: memory.ai_index_id }),
          type: memory.type,
          title: memory.title,
          ...(memory.description !== undefined && { description: memory.description }),
          content: memory.content,
          ...(memory.tags !== undefined && { tags: memory.tags }),
          ...(memory.references !== undefined && { references: memory.references }),
          ...(memory.attributes !== undefined && { attributes: memory.attributes }),
          created_at: createdAtById.get(documentId) ?? nowIso,
          updated_at: nowIso,
          ...(expiresAt !== undefined && { expires_at: expiresAt }),
        };
        return { index: { _id: documentId, document } };
      }),
    });

    const failure = response.items.find((item) => item.index?.error);
    if (failure?.index?.error) {
      throw new Error(
        `Failed to write session memories to '${sessionMemoriesIndexName}': ${
          failure.index.error.reason ?? failure.index.error.type
        }`
      );
    }

    return {
      items: response.items.map((item, position) => ({
        id: ids[position],
        result: item.index?.result === 'updated' ? 'updated' : 'created',
      })),
    };
  }

  /** The owner's unexpired memories, newest first. */
  async list(
    scope: SessionMemoryScope,
    {
      session_id: sessionId,
      agent_id: agentId,
      ai_index_id: aiIndexId,
      type,
      page = 1,
      per_page: perPage = DEFAULT_SESSION_MEMORIES_PAGE_SIZE,
    }: ListSessionMemoriesQuery
  ): Promise<ListSessionMemoriesResponse> {
    const response = await this.deps.storage.search({
      track_total_hits: true,
      from: (page - 1) * perPage,
      size: perPage,
      sort: [{ updated_at: { order: 'desc' } }, { id: { order: 'asc' } }],
      query: {
        bool: {
          filter: [
            ...this.scopeFilters(scope),
            notExpiredFilter(this.now().toISOString()),
            ...(sessionId !== undefined ? [{ term: { session_id: sessionId } }] : []),
            ...(agentId !== undefined ? [{ term: { agent_id: agentId } }] : []),
            ...(aiIndexId !== undefined ? [{ term: { ai_index_id: aiIndexId } }] : []),
            ...(type !== undefined ? [{ term: { type } }] : []),
          ],
        },
      },
    });
    const total = response.hits.total;
    return {
      memories: response.hits.hits.flatMap((hit) =>
        hit._source ? [toSessionMemory(hit._source)] : []
      ),
      total: typeof total === 'number' ? total : total?.value ?? 0,
      page,
      per_page: perPage,
    };
  }

  /** Deletes the owner's memories matching every given criterion. */
  async delete(
    scope: SessionMemoryScope,
    {
      ids,
      session_id: sessionId,
      agent_id: agentId,
      ai_index_id: aiIndexId,
    }: DeleteSessionMemoriesRequest
  ): Promise<number> {
    const criteria: QueryDslQueryContainer[] = [
      ...(ids !== undefined ? [{ terms: { id: ids } }] : []),
      ...(sessionId !== undefined ? [{ term: { session_id: sessionId } }] : []),
      ...(agentId !== undefined ? [{ term: { agent_id: agentId } }] : []),
      ...(aiIndexId !== undefined ? [{ term: { ai_index_id: aiIndexId } }] : []),
    ];
    if (criteria.length === 0) {
      throw new MemoryStoreValidationError(
        'Give ids, a session_id, an agent_id or an ai_index_id.'
      );
    }
    const { deleted } = await this.deps.esClient.deleteByQuery({
      index: sessionMemoriesIndexName,
      allow_no_indices: true,
      ignore_unavailable: true,
      conflicts: 'proceed',
      refresh: true,
      query: { bool: { filter: [...this.scopeFilters(scope), ...criteria] } },
    });
    return deleted ?? 0;
  }

  /** Recall candidates: a lexical list, and a semantic list unless the inference step fails. */
  async search(
    scope: SessionMemoryScope,
    { query, filters, size }: RecallSearchParams
  ): Promise<RecallCandidateLists> {
    const filter: QueryDslQueryContainer[] = [
      ...this.scopeFilters(scope),
      notExpiredFilter(this.now().toISOString()),
      ...(filters.agent_id !== undefined ? [{ term: { agent_id: filters.agent_id } }] : []),
      ...(filters.session_ids?.length ? [{ terms: { session_id: filters.session_ids } }] : []),
      ...(filters.types?.length ? [typeFilter(filters.types)] : []),
      ...(filters.tags?.length
        ? [{ terms: { tags: filters.tags.map((tag) => tag.toLowerCase()) } }]
        : []),
      ...timeRangeFilter('updated_at', filters.from, filters.to),
    ];
    const mustNot: QueryDslQueryContainer[] = filters.exclude_session_ids?.length
      ? [{ terms: { session_id: filters.exclude_session_ids } }]
      : [];

    const run = async (must: QueryDslQueryContainer) => {
      const response = await this.deps.storage.search({
        track_total_hits: false,
        size,
        query: { bool: { must, filter, must_not: mustNot } },
      });
      return response.hits.hits.flatMap((hit) => {
        const candidate = toCandidate(hit);
        return candidate ? [candidate] : [];
      });
    };

    const [lexical, semantic] = await Promise.allSettled([
      run({
        multi_match: {
          query,
          fields: ['title^2', 'description', 'content'],
          type: 'best_fields',
        },
      }),
      run({
        bool: {
          should: [
            { semantic: { field: 'title.semantic', query } },
            { semantic: { field: 'description.semantic', query } },
            { semantic: { field: 'content.semantic', query } },
          ],
          minimum_should_match: 1,
        },
      }),
    ]);

    if (lexical.status === 'rejected') {
      throw lexical.reason;
    }
    if (semantic.status === 'rejected') {
      this.deps.logger.debug(
        `Semantic recall over '${sessionMemoriesIndexName}' failed: ${String(semantic.reason)}`
      );
      return { lexical: lexical.value, semanticError: formatErrorMessage(semantic.reason) };
    }
    return { lexical: lexical.value, semantic: semantic.value };
  }
}
