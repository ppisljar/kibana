/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { RELATIONSHIP_KI_TYPE } from './dreaming';

export const MEMORY_KI_TYPES = ['memory.session', 'memory.session_fact'] as const;

/** The memory KI types left out of ordinary retrieval: memories, and dreamed relationships. */
export const RETRIEVAL_EXCLUDED_MEMORY_KI_TYPES: readonly string[] = [
  ...MEMORY_KI_TYPES,
  RELATIONSHIP_KI_TYPE,
];

export type MemoryKiType = (typeof MEMORY_KI_TYPES)[number];

export interface WriteMemoriesRequestBody {
  memories: Array<{
    id?: string;
    type: MemoryKiType;
    title: string;
    description?: string;
    content: string;
    tags?: string[];
    references?: Array<{ uri: string; relation?: string; description?: string }>;
    attributes?: Record<string, string | number | boolean | string[]>;
  }>;
}

export interface WriteMemoriesResponse {
  /** Ids of the written memories, in request order. */
  ids: string[];
}
