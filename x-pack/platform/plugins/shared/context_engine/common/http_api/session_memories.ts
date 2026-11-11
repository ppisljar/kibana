/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { MemoryKiType } from '../memory';

/** Session ids are caller-chosen; a leading `_` is reserved for `_bulk` style sub-paths. */
export const SESSION_ID_PATTERN = /^[^_\s/][^\s/]*$/;
export const MAX_SESSION_ID_LENGTH = 512;
export const MAX_MEMORY_STORE_AGENT_ID_LENGTH = 256;

export const MAX_SESSION_MEMORIES_PER_WRITE = 500;
export const MAX_SESSION_MEMORY_IDS_PER_DELETE = 1000;
export const DEFAULT_SESSION_MEMORIES_PAGE_SIZE = 25;
export const MAX_SESSION_MEMORIES_PAGE_SIZE = 100;

/** Applied when a write omits `expires_at`; `null` keeps the memory until it is deleted. */
export const DEFAULT_SESSION_MEMORY_EXPIRATION_MS = 90 * 24 * 60 * 60 * 1000;

export interface MemoryStoreReference {
  uri: string;
  relation?: string;
  description?: string;
}

export type MemoryStoreAttributeValue = string | number | boolean | string[];

export type MemoryStoreAttributes = Record<string, MemoryStoreAttributeValue>;

export interface SessionMemoryInput {
  /** Caller-chosen id. Writing an existing id replaces that memory. Omitted: a new id. */
  id?: string;
  session_id: string;
  agent_id?: string;
  /** The AI index the memory belongs to, for dreaming and filtering. */
  ai_index_id?: string;
  type: MemoryKiType;
  title: string;
  description?: string;
  content: string;
  tags?: string[];
  references?: MemoryStoreReference[];
  attributes?: MemoryStoreAttributes;
  /** ISO 8601. `null`: never expires. Omitted: {@link DEFAULT_SESSION_MEMORY_EXPIRATION_MS} after the write. */
  expires_at?: string | null;
}

export interface WriteSessionMemoriesRequest {
  memories: SessionMemoryInput[];
  /** Wait until the memories are searchable before responding. Defaults to `true`. */
  refresh?: boolean;
}

export interface WriteSessionMemoriesResponse {
  /** One item per memory, in request order. */
  items: Array<{ id: string; result: 'created' | 'updated' }>;
}

export interface SessionMemory extends Omit<SessionMemoryInput, 'id' | 'expires_at'> {
  id: string;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface ListSessionMemoriesQuery {
  session_id?: string;
  agent_id?: string;
  ai_index_id?: string;
  type?: MemoryKiType;
  page?: number;
  per_page?: number;
}

export interface ListSessionMemoriesResponse {
  memories: SessionMemory[];
  total: number;
  page: number;
  per_page: number;
}

/** At least one criterion is required; criteria are combined with AND. */
export interface DeleteSessionMemoriesRequest {
  ids?: string[];
  session_id?: string;
  agent_id?: string;
  ai_index_id?: string;
}

export interface DeleteSessionMemoriesResponse {
  deleted: number;
}
