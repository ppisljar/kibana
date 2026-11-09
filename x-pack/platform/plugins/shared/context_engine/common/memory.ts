/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

export const MEMORY_KI_TYPES = ['memory.session', 'memory.session_fact'] as const;

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
