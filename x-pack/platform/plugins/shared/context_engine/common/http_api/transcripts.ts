/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { MemoryStoreAttributes } from './session_memories';

export const TRANSCRIPT_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export type TranscriptRole = (typeof TRANSCRIPT_ROLES)[number];

export const MAX_TRANSCRIPT_TURNS = 5000;
export const MAX_TRANSCRIPT_TURN_CONTENT_LENGTH = 100_000;
export const MAX_TRANSCRIPT_SOURCE_LENGTH = 128;
export const MAX_TRANSCRIPT_SOURCE_REF_LENGTH = 2048;
export const MAX_TRANSCRIPT_TURN_NAME_LENGTH = 256;
/** Bound on a whole transcript write: the turns limit times a generous average turn size. */
export const MAX_TRANSCRIPT_REQUEST_BYTES = 20 * 1024 * 1024;
export const MAX_TRANSCRIPT_SESSION_IDS_PER_DELETE = 1000;

/** Turns are grouped into chunks of about this many characters, never splitting a turn unless it alone is larger. */
export const TRANSCRIPT_CHUNK_MAX_CHARS = 2000;

export interface TranscriptTurn {
  role: TranscriptRole;
  content: string;
  /** ISO 8601. */
  timestamp?: string;
  /** Speaker or tool name. */
  name?: string;
}

export type TranscriptWriteMode = 'replace' | 'append';

export interface PutTranscriptRequest {
  /** Where the transcript comes from, such as `agent_builder`, `claude_code` or an eval name. */
  source: string;
  /** An id or URI of the transcript in its source. */
  source_ref?: string;
  agent_id?: string;
  ai_index_id?: string;
  title?: string;
  /** ISO 8601. */
  started_at?: string;
  turns: TranscriptTurn[];
  tags?: string[];
  attributes?: MemoryStoreAttributes;
  /** `replace` (default) overwrites the session; `append` adds turns after the stored ones. */
  mode?: TranscriptWriteMode;
  /** Wait until the transcript is searchable before responding. Defaults to `true`. */
  refresh?: boolean;
}

export interface PutTranscriptResponse {
  session_id: string;
  result: 'created' | 'updated';
  turn_count: number;
  chunk_count: number;
}

export interface Transcript {
  session_id: string;
  source: string;
  source_ref?: string;
  agent_id?: string;
  ai_index_id?: string;
  title?: string;
  started_at?: string;
  tags?: string[];
  attributes?: MemoryStoreAttributes;
  turns: TranscriptTurn[];
  created_at: string;
  updated_at: string;
}

export type GetTranscriptResponse = Transcript;

export interface DeleteTranscriptResponse {
  deleted: boolean;
}

/** At least one criterion is required; criteria are combined with AND. */
export interface DeleteTranscriptsRequest {
  session_ids?: string[];
  source?: string;
  agent_id?: string;
  ai_index_id?: string;
}

export interface DeleteTranscriptsResponse {
  /** Sessions removed. */
  deleted: number;
}
