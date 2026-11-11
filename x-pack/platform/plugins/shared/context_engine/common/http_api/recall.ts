/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { MemoryStoreReference } from './session_memories';

export const RECALL_SOURCES = ['ai_indices', 'session_memories', 'transcripts'] as const;
export type RecallSource = (typeof RECALL_SOURCES)[number];

export type RecallResultSource = 'ai_index' | 'session_memory' | 'transcript';

export const MAX_RECALL_QUERY_LENGTH = 2048;
export const MAX_RECALL_AI_INDICES = 20;
/** Enough session ids for a long-haystack sample (LongMemEval M has about 500 sessions). */
export const MAX_RECALL_FILTER_VALUES = 1000;
/** Type filters: exact KI or memory types, or a prefix ending in `*` such as `fact.*`. */
export const RECALL_TYPE_FILTER_PATTERN = /^[a-z0-9_.-]+\*?$/;
export const MAX_RECALL_TYPE_FILTER_LENGTH = 256;

export const DEFAULT_RECALL_LIMIT = 10;
export const MAX_RECALL_LIMIT = 100;
export const DEFAULT_RECALL_CANDIDATES_PER_SOURCE = 30;
export const MAX_RECALL_CANDIDATES_PER_SOURCE = 200;
export const DEFAULT_RECALL_MAX_CONTENT_CHARS = 2000;
export const MAX_RECALL_MAX_CONTENT_CHARS = 20_000;
export const DEFAULT_RECALL_MAX_TOTAL_CHARS = 20_000;
export const MAX_RECALL_MAX_TOTAL_CHARS = 200_000;

export const DEFAULT_RECALL_RERANK_INFERENCE_ID = '.rerank-v1-elasticsearch';
export const MAX_RECALL_RERANK_INFERENCE_ID_LENGTH = 256;
/** How many fused candidates the reranker sees. */
export const DEFAULT_RECALL_RERANK_WINDOW = 50;
export const MAX_RECALL_RERANK_WINDOW = 200;
/** Characters of each candidate handed to the reranker. */
export const RECALL_RERANK_INPUT_CHARS = 2000;

export interface RecallFilters {
  /** Session memories and transcripts of this agent only. */
  agent_id?: string;
  /** Session memories and transcripts of these sessions only. */
  session_ids?: string[];
  /** Leaves out session memories and transcripts of these sessions. */
  exclude_session_ids?: string[];
  /** Knowledge item and memory types, exact or prefix (`fact.*`). Does not apply to transcripts. */
  types?: string[];
  /** Any of these tags. Does not apply to transcripts. */
  tags?: string[];
  /** ISO 8601 bounds on when the item was last updated (transcripts: when the turns happened). */
  from?: string;
  to?: string;
}

export interface RecallRerankOptions {
  /** Defaults to `true`. */
  enabled?: boolean;
  /** A `rerank` inference endpoint. Defaults to {@link DEFAULT_RECALL_RERANK_INFERENCE_ID}. */
  inference_id?: string;
  /** Defaults to {@link DEFAULT_RECALL_RERANK_WINDOW}. */
  window?: number;
}

export interface RecallRequest {
  query: string;
  /** Defaults to every source. */
  sources?: RecallSource[];
  /** AI indices to search. Defaults to every AI index the caller can read in the space. */
  ai_index_ids?: string[];
  filters?: RecallFilters;
  /** Results returned. Defaults to {@link DEFAULT_RECALL_LIMIT}. */
  limit?: number;
  /** Candidates taken from each AI index, the session memory store and the transcript store. */
  candidates_per_source?: number;
  /** Characters of content kept per result. */
  max_content_chars?: number;
  /** Characters of content kept across all results; results past the budget are dropped. */
  max_total_chars?: number;
  /** Drops results whose rerank score is lower. Ignored when the results are not reranked. */
  min_score?: number;
  rerank?: RecallRerankOptions;
}

export interface RecallTranscriptLocation {
  chunk_index: number;
  /** Zero-based, inclusive. */
  turn_start: number;
  turn_end: number;
  source: string;
}

export interface RecallResult {
  source: RecallResultSource;
  /** Knowledge item id, memory id, or `<session id>#<chunk index>` for a transcript chunk. */
  id: string;
  /** The rerank score when reranked, the fused score otherwise. */
  score: number;
  title?: string;
  description?: string;
  content: string;
  /** Whether `content` was cut to `max_content_chars`. */
  truncated: boolean;
  type?: string;
  tags?: string[];
  ai_index_id?: string;
  session_id?: string;
  agent_id?: string;
  timestamp?: string;
  references?: MemoryStoreReference[];
  transcript?: RecallTranscriptLocation;
  retrieval: {
    /** Reciprocal rank fusion score across every source list. */
    fused_score: number;
    /** One-based rank within the list it came from. */
    source_rank: number;
    rerank_score?: number;
  };
}

export interface RecallSourceReport {
  source: RecallSource;
  /** Candidates this source returned before fusion. */
  candidates: number;
  /** AI indices searched (`ai_indices` only). */
  ai_index_ids?: string[];
  /** Whether the semantic branch ran; it is skipped when no semantic field or inference is available. */
  semantic: boolean;
  errors?: Array<{ ai_index_id?: string; message: string }>;
}

export interface RecallResponse {
  results: RecallResult[];
  reranked: boolean;
  rerank_inference_id?: string;
  /** Why results were not reranked although reranking was requested. */
  rerank_error?: string;
  sources: RecallSourceReport[];
  /** Whether the result count or the character budget dropped results. */
  truncated: boolean;
}
