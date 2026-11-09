/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { randomUUID } from 'node:crypto';
import type { ElasticsearchClient } from '@kbn/core/server';
import { isIndexPattern } from '../../common/ai_index_dest';
import { isDreamingConfigured } from '../../common/dreaming';
import type { MemoryKiType } from '../../common/memory';
import type { AiIndexHttpItem } from '../../common/http_api/ai_indices';
import { KiValidationError } from './errors';
import { putKiRevision, type KiWriter, type StoredKi } from './ki_revision';

export interface MemoryInput {
  id?: string;
  type: MemoryKiType;
  title: string;
  description?: string;
  content: string;
  tags?: string[];
  references?: Array<{ uri: string; relation?: string; description?: string }>;
  attributes?: Record<string, string | number | boolean | string[]>;
}

/**
 * Writes memories as knowledge items without an agent. Uses the write path of `remember`
 * (revision store, provenance in governance), so the same dreaming and lifecycle rules apply.
 */
export const writeMemories = async ({
  esClient,
  aiIndex,
  spaceId,
  memories,
}: {
  esClient: ElasticsearchClient;
  aiIndex: AiIndexHttpItem;
  spaceId: string;
  memories: MemoryInput[];
}): Promise<string[]> => {
  if (isIndexPattern(aiIndex.dest.value)) {
    throw new KiValidationError(
      `AI index '${aiIndex.id}' uses an index pattern and cannot accept memory writes.`
    );
  }
  if (!isDreamingConfigured(aiIndex.dreaming)) {
    throw new KiValidationError(
      `AI index '${aiIndex.id}' does not take memories: dreaming is not set up.`
    );
  }

  const writer: KiWriter = {
    uri: 'api://context_engine.memory.write',
    metadata: { space_id: spaceId },
  };
  const now = new Date().toISOString();
  const ids: string[] = [];

  for (const memory of memories) {
    const id = memory.id ?? randomUUID();
    const document = {
      '@timestamp': now,
      id,
      type: memory.type,
      title: memory.title,
      description: memory.description ?? '',
      content: memory.content,
      ...(memory.tags !== undefined ? { tags: memory.tags } : {}),
      updated_at: now,
      references: memory.references ?? [],
      attributes: memory.attributes ?? {},
      governance: {
        provenance: { created_by: writer, updated_by: writer },
        lifecycle: { status: 'active' },
      },
    } as StoredKi;

    await putKiRevision({
      esClient,
      aiIndexId: aiIndex.id,
      dest: aiIndex.dest,
      kiId: id,
      document,
      failIfExists: true,
    });
    ids.push(id);
  }

  await esClient.indices.refresh({ index: aiIndex.dest.value });
  return ids;
};
