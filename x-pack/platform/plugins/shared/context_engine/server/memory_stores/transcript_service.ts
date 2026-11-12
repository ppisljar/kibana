/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type {
  FieldValue,
  QueryDslQueryContainer,
  SearchHit,
} from '@elastic/elasticsearch/lib/api/types';
import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type {
  DeleteTranscriptsRequest,
  PutTranscriptRequest,
  PutTranscriptResponse,
  Transcript,
  TranscriptTurn,
} from '../../common/http_api/transcripts';
import type { RecallCandidate, RecallCandidateLists, RecallSearchParams } from '../recall/types';
import { formatErrorMessage } from '../utils/format_es_error';
import {
  MemoryStoreConflictError,
  MemoryStoreValidationError,
  TranscriptNotFoundError,
} from './errors';
import { scopedDocumentId } from './owner';
import { ownerScopeFilters, timeRangeFilter } from './query_filters';
import type { SessionMemoryScope } from './session_memory_service';
import {
  transcriptsIndexName,
  type StoredTranscriptChunk,
  type StoredTranscriptDocument,
  type StoredTranscriptSession,
  type TranscriptsStorageClient,
} from './storage';
import { chunkTranscriptTurns } from './transcript_chunks';

/** Chunks per bulk request: each one runs inference for its semantic field on ingest. */
const WRITE_BATCH_SIZE = 200;
const READ_PAGE_SIZE = 1000;

const headerDocumentId = ({ spaceId, owner }: SessionMemoryScope, sessionId: string): string =>
  scopedDocumentId(spaceId, owner, 'transcript', sessionId);

const chunkDocumentId = (
  { spaceId, owner }: SessionMemoryScope,
  sessionId: string,
  chunkIndex: number
): string => scopedDocumentId(spaceId, owner, 'transcript', sessionId, String(chunkIndex));

const toCandidate = (hit: SearchHit<StoredTranscriptDocument>): RecallCandidate | undefined => {
  const source = hit._source;
  if (!source || source.kind !== 'chunk') {
    return undefined;
  }
  return {
    source: 'transcript',
    id: `${source.session_id}#${source.chunk_index}`,
    content: source.content,
    session_id: source.session_id,
    ...(source.agent_id ? { agent_id: source.agent_id } : {}),
    ...(source.ai_index_id ? { ai_index_id: source.ai_index_id } : {}),
    timestamp: source.timestamp,
    transcript: {
      chunk_index: source.chunk_index,
      turn_start: source.turn_start,
      turn_end: source.turn_end,
      source: source.source,
    },
  };
};

/**
 * Whole transcripts of sessions with an agent, from any source. A session is stored as a header
 * document and chunks of consecutive turns, which are what recall searches.
 */
export class TranscriptService {
  constructor(
    private readonly deps: {
      storage: TranscriptsStorageClient;
      /** Internal user: the store is a restricted system index. */
      esClient: ElasticsearchClient;
      logger: Logger;
      getCurrentDate?: () => Date;
    }
  ) {}

  private now(): Date {
    return this.deps.getCurrentDate?.() ?? new Date();
  }

  private sessionFilters(scope: SessionMemoryScope, sessionId: string): QueryDslQueryContainer[] {
    return [...ownerScopeFilters(scope.spaceId, scope.owner), { term: { session_id: sessionId } }];
  }

  private async getHeader(
    scope: SessionMemoryScope,
    sessionId: string
  ): Promise<StoredTranscriptSession | undefined> {
    const response = await this.deps.storage.search({
      track_total_hits: false,
      size: 1,
      query: {
        bool: { filter: [...this.sessionFilters(scope, sessionId), { term: { kind: 'session' } }] },
      },
    });
    const source = response.hits.hits[0]?._source;
    return source?.kind === 'session' ? source : undefined;
  }

  private async deleteWhere(filter: QueryDslQueryContainer[]): Promise<number> {
    const { deleted } = await this.deps.esClient.deleteByQuery({
      index: transcriptsIndexName,
      allow_no_indices: true,
      ignore_unavailable: true,
      conflicts: 'proceed',
      refresh: true,
      query: { bool: { filter } },
    });
    return deleted ?? 0;
  }

  /** Writes a session. `append` adds the turns after the stored ones and keeps its identity fields. */
  async put(
    scope: SessionMemoryScope,
    sessionId: string,
    request: PutTranscriptRequest
  ): Promise<PutTranscriptResponse> {
    const { storage } = this.deps;
    const mode = request.mode ?? 'replace';
    const existing = await this.getHeader(scope, sessionId);
    const appending = mode === 'append' && existing !== undefined;

    if (appending) {
      const changed = (['source', 'agent_id', 'ai_index_id'] as const).find(
        (field) => request[field] !== undefined && request[field] !== existing[field]
      );
      if (changed) {
        throw new MemoryStoreConflictError(
          `Cannot append to session '${sessionId}' with a different ${changed} than it was written with.`
        );
      }
    }

    const nowIso = this.now().toISOString();
    const firstTurn = appending ? existing.turn_count : 0;
    const firstChunk = appending ? existing.chunk_count : 0;
    const chunks = chunkTranscriptTurns(request.turns, { firstTurn });

    const agentId = request.agent_id ?? (appending ? existing.agent_id : undefined);
    const aiIndexId = request.ai_index_id ?? (appending ? existing.ai_index_id : undefined);
    const startedAt = request.started_at ?? (appending ? existing.started_at : undefined);
    const identity = {
      space: scope.spaceId,
      owner_id: scope.owner.id,
      owner_username: scope.owner.username,
      session_id: sessionId,
      source: request.source,
      ...(agentId !== undefined && { agent_id: agentId }),
      ...(aiIndexId !== undefined && { ai_index_id: aiIndexId }),
    };

    const sourceRef = request.source_ref ?? (appending ? existing.source_ref : undefined);
    const title = request.title ?? (appending ? existing.title : undefined);
    const tags = request.tags ?? (appending ? existing.tags : undefined);
    const attributes = request.attributes ?? (appending ? existing.attributes : undefined);
    const header: StoredTranscriptSession = {
      ...identity,
      kind: 'session',
      ...(sourceRef !== undefined && { source_ref: sourceRef }),
      ...(title !== undefined && { title }),
      ...(startedAt !== undefined && { started_at: startedAt }),
      ...(tags !== undefined && { tags }),
      ...(attributes !== undefined && { attributes }),
      turn_count: firstTurn + request.turns.length,
      chunk_count: firstChunk + chunks.length,
      created_at: existing?.created_at ?? nowIso,
      updated_at: nowIso,
    };

    const chunkDocuments = chunks.map(
      (chunk, offset): { _id: string; document: StoredTranscriptChunk } => {
        const chunkIndex = firstChunk + offset;
        return {
          _id: chunkDocumentId(scope, sessionId, chunkIndex),
          document: {
            ...identity,
            kind: 'chunk',
            chunk_index: chunkIndex,
            turn_start: chunk.turn_start,
            turn_end: chunk.turn_end,
            roles: chunk.roles,
            content: chunk.content,
            turns: chunk.turns,
            timestamp: chunk.timestamp ?? startedAt ?? nowIso,
            created_at: nowIso,
          },
        };
      }
    );

    const refresh = request.refresh === false ? false : 'wait_for';
    const batches = [
      ...Array.from({ length: Math.ceil(chunkDocuments.length / WRITE_BATCH_SIZE) }, (_, batch) =>
        chunkDocuments.slice(batch * WRITE_BATCH_SIZE, (batch + 1) * WRITE_BATCH_SIZE)
      ),
      [{ _id: headerDocumentId(scope, sessionId), document: header }],
    ];
    for (const batch of batches) {
      const response = await storage.bulk({
        refresh,
        operations: batch.map(({ _id, document }) => ({ index: { _id, document } })),
      });
      const failure = response.items.find((item) => item.index?.error)?.index?.error;
      if (failure) {
        throw new Error(
          `Failed to write the transcript of session '${sessionId}' to '${transcriptsIndexName}': ${
            failure.reason ?? failure.type
          }`
        );
      }
    }

    // A replaced session that shrank leaves chunks past the new end behind.
    if (!appending && existing && existing.chunk_count > chunks.length) {
      await this.deleteWhere([
        ...this.sessionFilters(scope, sessionId),
        { term: { kind: 'chunk' } },
        { range: { chunk_index: { gte: chunks.length } } },
      ]);
    }

    return {
      session_id: sessionId,
      result: existing ? 'updated' : 'created',
      turn_count: header.turn_count,
      chunk_count: header.chunk_count,
    };
  }

  /** Rebuilds a session from its chunks, in turn order. */
  async get(scope: SessionMemoryScope, sessionId: string): Promise<Transcript> {
    const header = await this.getHeader(scope, sessionId);
    if (!header) {
      throw new TranscriptNotFoundError(sessionId);
    }

    const turns: TranscriptTurn[] = [];
    let searchAfter: FieldValue[] | undefined;
    for (;;) {
      const response = await this.deps.storage.search({
        track_total_hits: false,
        size: READ_PAGE_SIZE,
        _source: ['turns'],
        sort: [{ chunk_index: { order: 'asc' } }],
        ...(searchAfter !== undefined && { search_after: searchAfter }),
        query: {
          bool: { filter: [...this.sessionFilters(scope, sessionId), { term: { kind: 'chunk' } }] },
        },
      });
      const { hits } = response.hits;
      for (const hit of hits) {
        const source = hit._source as Partial<StoredTranscriptChunk> | undefined;
        turns.push(...(source?.turns ?? []));
      }
      if (hits.length < READ_PAGE_SIZE) {
        break;
      }
      searchAfter = hits[hits.length - 1].sort;
    }

    return {
      session_id: sessionId,
      source: header.source,
      ...(header.source_ref !== undefined && { source_ref: header.source_ref }),
      ...(header.agent_id !== undefined && { agent_id: header.agent_id }),
      ...(header.ai_index_id !== undefined && { ai_index_id: header.ai_index_id }),
      ...(header.title !== undefined && { title: header.title }),
      ...(header.started_at !== undefined && { started_at: header.started_at }),
      ...(header.tags !== undefined && { tags: header.tags }),
      ...(header.attributes !== undefined && { attributes: header.attributes }),
      turns,
      created_at: header.created_at,
      updated_at: header.updated_at,
    };
  }

  /** Returns whether the session existed. */
  async delete(scope: SessionMemoryScope, sessionId: string): Promise<boolean> {
    return (await this.deleteWhere(this.sessionFilters(scope, sessionId))) > 0;
  }

  /** Deletes the owner's sessions matching every given criterion. Returns the sessions removed. */
  async deleteMany(
    scope: SessionMemoryScope,
    {
      session_ids: sessionIds,
      source,
      agent_id: agentId,
      ai_index_id: aiIndexId,
    }: DeleteTranscriptsRequest
  ): Promise<number> {
    const criteria: QueryDslQueryContainer[] = [
      ...(sessionIds !== undefined ? [{ terms: { session_id: sessionIds } }] : []),
      ...(source !== undefined ? [{ term: { source } }] : []),
      ...(agentId !== undefined ? [{ term: { agent_id: agentId } }] : []),
      ...(aiIndexId !== undefined ? [{ term: { ai_index_id: aiIndexId } }] : []),
    ];
    if (criteria.length === 0) {
      throw new MemoryStoreValidationError(
        'Give session_ids, a source, an agent_id or an ai_index_id.'
      );
    }
    const filter = [...ownerScopeFilters(scope.spaceId, scope.owner), ...criteria];
    const sessions = await this.deps.storage.search({
      track_total_hits: true,
      size: 0,
      query: { bool: { filter: [...filter, { term: { kind: 'session' } }] } },
    });
    const total = sessions.hits.total;
    const sessionCount = typeof total === 'number' ? total : total?.value ?? 0;
    await this.deleteWhere(filter);
    return sessionCount;
  }

  /**
   * Every owner's transcript chunks for an AI index written since a time, oldest first, with
   * their session title, for transcript dreaming. `resumeFrom` is set when `size` cut the list.
   */
  async readForDreaming({
    spaceId,
    aiIndexId,
    since,
    after,
    size,
  }: {
    spaceId: string;
    aiIndexId: string;
    since: string;
    /** The sort values of the last document of the read that stopped at `since`. */
    after?: FieldValue[];
    size: number;
  }): Promise<{
    chunks: Array<{ documentId: string; chunk: StoredTranscriptChunk; title?: string }>;
    resumeFrom?: string;
    resumeAfter?: FieldValue[];
  }> {
    const { storage } = this.deps;
    const response = await storage.search({
      track_total_hits: false,
      size,
      sort: [
        { created_at: { order: 'asc' } },
        { owner_id: { order: 'asc' } },
        { session_id: { order: 'asc' } },
        { chunk_index: { order: 'asc' } },
      ],
      query: {
        bool: {
          filter: [
            { term: { space: spaceId } },
            { term: { ai_index_id: aiIndexId } },
            { term: { kind: 'chunk' } },
            { range: { created_at: { gte: since } } },
          ],
        },
      },
      ...(after !== undefined && { search_after: after }),
    });
    const { hits } = response.hits;
    const chunks = hits.flatMap((hit) =>
      hit._source?.kind === 'chunk' ? [{ documentId: hit._id ?? '', chunk: hit._source }] : []
    );

    const headerIds = [
      ...new Set(
        chunks.map(({ chunk }) =>
          headerDocumentId(
            { spaceId, owner: { id: chunk.owner_id, username: chunk.owner_username } },
            chunk.session_id
          )
        )
      ),
    ];
    const titles = new Map<string, string>();
    if (headerIds.length > 0) {
      const headers = await storage.search({
        track_total_hits: false,
        size: headerIds.length,
        _source: ['owner_id', 'session_id', 'title'],
        query: {
          bool: { filter: [{ ids: { values: headerIds } }, { term: { kind: 'session' } }] },
        },
      });
      for (const { _source: header } of headers.hits.hits) {
        if (header?.kind !== 'chunk' && header?.title) {
          titles.set(JSON.stringify([header.owner_id, header.session_id]), header.title);
        }
      }
    }

    const last = hits[hits.length - 1];
    return {
      chunks: chunks.map((entry) => {
        const title = titles.get(JSON.stringify([entry.chunk.owner_id, entry.chunk.session_id]));
        return title !== undefined ? { ...entry, title } : entry;
      }),
      ...(hits.length === size &&
        last?._source?.kind === 'chunk' && {
          resumeFrom: last._source.created_at,
          resumeAfter: last.sort,
        }),
    };
  }

  /** Recall candidates over transcript chunks: a lexical list, and a semantic list unless inference fails. */
  async search(
    scope: SessionMemoryScope,
    { query, filters, size }: RecallSearchParams
  ): Promise<RecallCandidateLists> {
    const filter: QueryDslQueryContainer[] = [
      ...ownerScopeFilters(scope.spaceId, scope.owner),
      { term: { kind: 'chunk' } },
      ...(filters.agent_id !== undefined ? [{ term: { agent_id: filters.agent_id } }] : []),
      ...(filters.session_ids?.length ? [{ terms: { session_id: filters.session_ids } }] : []),
      ...timeRangeFilter('timestamp', filters.from, filters.to),
    ];
    const mustNot: QueryDslQueryContainer[] = filters.exclude_session_ids?.length
      ? [{ terms: { session_id: filters.exclude_session_ids } }]
      : [];

    const run = async (must: QueryDslQueryContainer) => {
      const response = await this.deps.storage.search({
        track_total_hits: false,
        size,
        _source: { excludes: ['turns'] },
        query: { bool: { must, filter, must_not: mustNot } },
      });
      return response.hits.hits.flatMap((hit) => {
        const candidate = toCandidate(hit);
        return candidate ? [candidate] : [];
      });
    };

    const [lexical, semantic] = await Promise.allSettled([
      run({ match: { content: { query } } }),
      run({ semantic: { field: 'content.semantic', query } }),
    ]);
    if (lexical.status === 'rejected') {
      throw lexical.reason;
    }
    if (semantic.status === 'rejected') {
      this.deps.logger.debug(
        `Semantic recall over '${transcriptsIndexName}' failed: ${String(semantic.reason)}`
      );
      return { lexical: lexical.value, semanticError: formatErrorMessage(semantic.reason) };
    }
    return { lexical: lexical.value, semantic: semantic.value };
  }
}
