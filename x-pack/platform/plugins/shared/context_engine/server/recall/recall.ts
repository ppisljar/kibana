/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { AiIndexDest, AiIndexHttpItem } from '../../common/http_api/ai_indices';
import {
  DEFAULT_RECALL_CANDIDATES_PER_SOURCE,
  DEFAULT_RECALL_LIMIT,
  DEFAULT_RECALL_MAX_CONTENT_CHARS,
  DEFAULT_RECALL_MAX_TOTAL_CHARS,
  DEFAULT_RECALL_RERANK_INFERENCE_ID,
  DEFAULT_RECALL_RERANK_WINDOW,
  MAX_RECALL_AI_INDICES,
  RECALL_SOURCES,
  type RecallRequest,
  type RecallResponse,
  type RecallResult,
  type RecallSourceReport,
} from '../../common/http_api/recall';
import { formatErrorMessage } from '../utils/format_es_error';
import type { SessionMemoryScope } from '../memory_stores/session_memory_service';
import { searchAiIndex } from './ai_index_search';
import { dedupeByContent, reciprocalRankFusion, type FusedCandidate } from './fusion';
import { rerankCandidates } from './rerank';
import type { RecallCandidate, RecallCandidateLists, RecallSearchParams } from './types';

/** Below this many characters left in the budget, another result is more noise than context. */
const MIN_RESULT_CHARS = 200;

interface StoreSearch {
  search(scope: SessionMemoryScope, params: RecallSearchParams): Promise<RecallCandidateLists>;
}

export interface RecallDeps {
  scope: SessionMemoryScope;
  /** Scoped to the caller: AI indices are read with the caller's Elasticsearch privileges. */
  esClient: ElasticsearchClient;
  /** Runs the reranker; candidates handed to it were already read with the caller's privileges. */
  internalEsClient: ElasticsearchClient;
  /** AI indices in the space the caller can read; `ids` narrows the list. */
  listReadableAiIndices: (ids?: string[]) => Promise<AiIndexHttpItem[]>;
  /** Every AI index registered in the space. */
  listRegisteredAiIndices: () => Promise<AiIndexHttpItem[]>;
  sessionMemories: StoreSearch;
  transcripts: StoreSearch;
  logger: Logger;
}

/** The lexical and semantic lists of one source, fused and cut to the per-source budget. */
const fuseSource = ({ lexical, semantic }: RecallCandidateLists, size: number): RecallCandidate[] =>
  reciprocalRankFusion(semantic ? [lexical, semantic] : [lexical])
    .slice(0, size)
    .map(({ candidate }) => candidate);

const semanticReport = (lists: RecallCandidateLists) => ({
  semantic: lists.semantic !== undefined,
  errors: lists.semanticError
    ? [{ message: `Semantic search skipped: ${lists.semanticError}` }]
    : [],
});

const searchAiIndices = async (
  deps: RecallDeps,
  request: RecallRequest,
  params: RecallSearchParams
): Promise<{ lists: RecallCandidate[][]; report: RecallSourceReport }> => {
  const errors: NonNullable<RecallSourceReport['errors']> = [];
  const [readable, registered] = await Promise.all([
    deps.listReadableAiIndices(request.ai_index_ids),
    deps.listRegisteredAiIndices(),
  ]);

  const readableIds = new Set(readable.map(({ id }) => id));
  for (const id of request.ai_index_ids ?? []) {
    if (!readableIds.has(id)) {
      errors.push({ ai_index_id: id, message: 'Not found, or not readable by the caller.' });
    }
  }
  const searched = readable.slice(0, MAX_RECALL_AI_INDICES);
  if (readable.length > searched.length) {
    errors.push({
      message: `Searched the first ${MAX_RECALL_AI_INDICES} of ${readable.length} readable AI indices; pass ai_index_ids to choose.`,
    });
  }

  const registeredDests: AiIndexDest[] = registered.map(({ dest }) => dest);
  const outcomes = await Promise.all(
    searched.map(async (aiIndex) => {
      try {
        const lists = await searchAiIndex({
          ...params,
          esClient: deps.esClient,
          spaceId: deps.scope.spaceId,
          aiIndex,
          registeredDests,
        });
        if (lists.semanticError) {
          errors.push({
            ai_index_id: aiIndex.id,
            message: `Semantic search skipped: ${lists.semanticError}`,
          });
        }
        return { lists, list: fuseSource(lists, params.size) };
      } catch (error) {
        errors.push({ ai_index_id: aiIndex.id, message: formatErrorMessage(error) });
        return undefined;
      }
    })
  );

  const succeeded = outcomes.filter(
    (outcome): outcome is NonNullable<typeof outcome> => outcome !== undefined
  );
  return {
    lists: succeeded.map(({ list }) => list),
    report: {
      source: 'ai_indices',
      candidates: succeeded.reduce((total, { list }) => total + list.length, 0),
      ai_index_ids: searched.map(({ id }) => id),
      semantic: succeeded.some(({ lists }) => lists.semantic !== undefined),
      ...(errors.length > 0 && { errors }),
    },
  };
};

const searchStore = async (
  source: 'session_memories' | 'transcripts',
  store: StoreSearch,
  scope: SessionMemoryScope,
  params: RecallSearchParams
): Promise<{ lists: RecallCandidate[][]; report: RecallSourceReport }> => {
  try {
    const lists = await store.search(scope, params);
    const list = fuseSource(lists, params.size);
    const { semantic, errors } = semanticReport(lists);
    return {
      lists: [list],
      report: { source, candidates: list.length, semantic, ...(errors.length > 0 && { errors }) },
    };
  } catch (error) {
    return {
      lists: [],
      report: {
        source,
        candidates: 0,
        semantic: false,
        errors: [{ message: formatErrorMessage(error) }],
      },
    };
  }
};

interface OrderedCandidate extends FusedCandidate {
  rerankScore?: number;
}

const toResult = (
  { candidate, fusedScore, sourceRank, rerankScore }: OrderedCandidate,
  maxChars: number
): RecallResult => {
  const truncated = candidate.content.length > maxChars;
  return {
    ...candidate,
    content: truncated ? candidate.content.slice(0, maxChars) : candidate.content,
    truncated,
    score: rerankScore ?? fusedScore,
    retrieval: {
      fused_score: fusedScore,
      source_rank: sourceRank,
      ...(rerankScore !== undefined && { rerank_score: rerankScore }),
    },
  };
};

/**
 * Recall across AI indices, the session memory store and the transcript store: hybrid retrieval
 * per source, reciprocal rank fusion across sources, model reranking when an endpoint answers,
 * then the score, count and character caps. A source that fails is reported, not fatal.
 */
export const recall = async (deps: RecallDeps, request: RecallRequest): Promise<RecallResponse> => {
  const sources = new Set(request.sources ?? RECALL_SOURCES);
  const limit = request.limit ?? DEFAULT_RECALL_LIMIT;
  const maxContentChars = request.max_content_chars ?? DEFAULT_RECALL_MAX_CONTENT_CHARS;
  const maxTotalChars = request.max_total_chars ?? DEFAULT_RECALL_MAX_TOTAL_CHARS;
  const params: RecallSearchParams = {
    query: request.query,
    filters: request.filters ?? {},
    size: request.candidates_per_source ?? DEFAULT_RECALL_CANDIDATES_PER_SOURCE,
  };

  const searches = await Promise.all([
    sources.has('ai_indices')
      ? searchAiIndices(deps, request, params).catch(
          (error): { lists: RecallCandidate[][]; report: RecallSourceReport } => ({
            lists: [],
            report: {
              source: 'ai_indices',
              candidates: 0,
              semantic: false,
              errors: [{ message: formatErrorMessage(error) }],
            },
          })
        )
      : undefined,
    sources.has('session_memories')
      ? searchStore('session_memories', deps.sessionMemories, deps.scope, params)
      : undefined,
    sources.has('transcripts')
      ? searchStore('transcripts', deps.transcripts, deps.scope, params)
      : undefined,
  ]);
  const ran = searches.filter(
    (search): search is NonNullable<typeof search> => search !== undefined
  );

  const fused = dedupeByContent(reciprocalRankFusion(ran.flatMap(({ lists }) => lists)));

  const rerankEnabled = request.rerank?.enabled ?? true;
  const inferenceId = request.rerank?.inference_id ?? DEFAULT_RECALL_RERANK_INFERENCE_ID;
  const window = Math.max(limit, request.rerank?.window ?? DEFAULT_RECALL_RERANK_WINDOW);

  let ordered: OrderedCandidate[] = fused;
  let reranked = false;
  let rerankError: string | undefined;
  if (rerankEnabled && fused.length > 0) {
    const windowed = fused.slice(0, window);
    try {
      const positions = await rerankCandidates({
        esClient: deps.internalEsClient,
        inferenceId,
        query: request.query,
        candidates: windowed.map(({ candidate }) => candidate),
      });
      ordered = positions.map(({ index, score }) => ({ ...windowed[index], rerankScore: score }));
      reranked = true;
    } catch (error) {
      rerankError = formatErrorMessage(error);
      deps.logger.debug(`Recall reranking with '${inferenceId}' failed: ${rerankError}`);
    }
  }

  const minScore = request.min_score;
  const eligible =
    reranked && minScore !== undefined
      ? ordered.filter(({ rerankScore }) => rerankScore !== undefined && rerankScore >= minScore)
      : ordered;

  const results: RecallResult[] = [];
  let used = 0;
  for (const entry of eligible) {
    const remaining = maxTotalChars - used;
    if (results.length >= limit || (results.length > 0 && remaining < MIN_RESULT_CHARS)) {
      break;
    }
    const result = toResult(entry, Math.min(maxContentChars, remaining));
    used += result.content.length;
    results.push(result);
  }

  return {
    results,
    reranked,
    ...(reranked && { rerank_inference_id: inferenceId }),
    ...(rerankError !== undefined && { rerank_error: rerankError }),
    sources: ran.map(({ report }) => report),
    truncated: results.length < eligible.length,
  };
};
