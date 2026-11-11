/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient, Logger } from '@kbn/core/server';
import type { IndexStorageSettings, IStorageClient } from '@kbn/storage-adapter';
import { StorageIndexAdapter, types } from '@kbn/storage-adapter';
import type { MemoryKiType } from '../../common/memory';
import type {
  MemoryStoreAttributes,
  MemoryStoreReference,
} from '../../common/http_api/session_memories';
import type { TranscriptTurn } from '../../common/http_api/transcripts';

export const sessionMemoriesIndexName = '.contextengine-session-memories';
export const transcriptsIndexName = '.contextengine-transcripts';

/** Lexical text with a `semantic` multi-field, the layout of the built-in `ai-index@mappings` template. */
const searchableText = () => types.text({ fields: { semantic: { type: 'semantic_text' } } });

const ownerFields = {
  space: types.keyword({}),
  owner_id: types.keyword({}),
  owner_username: types.keyword({}),
  session_id: types.keyword({}),
  agent_id: types.keyword({}),
  ai_index_id: types.keyword({}),
};

const sessionMemoriesStorageSettings = {
  name: sessionMemoriesIndexName,
  schema: {
    properties: {
      ...ownerFields,
      id: types.keyword({}),
      type: types.keyword({ normalizer: 'lowercase' }),
      title: searchableText(),
      description: searchableText(),
      content: searchableText(),
      tags: types.keyword({ normalizer: 'lowercase' }),
      references: types.object({
        properties: {
          uri: types.keyword({}),
          relation: types.keyword({}),
          description: types.text({}),
        },
      }),
      attributes: types.flattened({}),
      created_at: types.date({}),
      updated_at: types.date({}),
      expires_at: types.date({}),
    },
  },
} satisfies IndexStorageSettings;

/** Session headers (`kind: session`) and the chunks of their turns (`kind: chunk`) share the index. */
const transcriptsStorageSettings = {
  name: transcriptsIndexName,
  schema: {
    properties: {
      ...ownerFields,
      kind: types.keyword({}),
      source: types.keyword({}),
      source_ref: types.keyword({ index: false, doc_values: false }),
      title: types.text({}),
      started_at: types.date({}),
      tags: types.keyword({ normalizer: 'lowercase' }),
      attributes: types.flattened({}),
      turn_count: types.long({}),
      chunk_count: types.long({}),
      chunk_index: types.long({}),
      turn_start: types.long({}),
      turn_end: types.long({}),
      roles: types.keyword({}),
      content: searchableText(),
      // Read back to rebuild the session, never queried.
      turns: types.object({ enabled: false }),
      timestamp: types.date({}),
      created_at: types.date({}),
      updated_at: types.date({}),
    },
  },
} satisfies IndexStorageSettings;

interface StoredOwnerFields {
  space: string;
  owner_id: string;
  owner_username: string;
  session_id: string;
  agent_id?: string;
  ai_index_id?: string;
}

export interface StoredSessionMemory extends StoredOwnerFields {
  id: string;
  type: MemoryKiType;
  title: string;
  description?: string;
  content: string;
  tags?: string[];
  references?: MemoryStoreReference[];
  attributes?: MemoryStoreAttributes;
  created_at: string;
  updated_at: string;
  expires_at?: string;
}

export interface StoredTranscriptSession extends StoredOwnerFields {
  kind: 'session';
  source: string;
  source_ref?: string;
  title?: string;
  started_at?: string;
  tags?: string[];
  attributes?: MemoryStoreAttributes;
  turn_count: number;
  chunk_count: number;
  created_at: string;
  updated_at: string;
}

export interface StoredTranscriptChunk extends StoredOwnerFields {
  kind: 'chunk';
  source: string;
  chunk_index: number;
  turn_start: number;
  turn_end: number;
  roles: string[];
  content: string;
  /** The turns that start in this chunk; a turn split across chunks is kept whole in its first one. */
  turns: TranscriptTurn[];
  timestamp: string;
  created_at: string;
}

export type StoredTranscriptDocument = StoredTranscriptSession | StoredTranscriptChunk;

export type SessionMemoriesStorageClient = IStorageClient<
  typeof sessionMemoriesStorageSettings,
  StoredSessionMemory
>;

export type TranscriptsStorageClient = IStorageClient<
  typeof transcriptsStorageSettings,
  StoredTranscriptDocument
>;

/** The stores are restricted system indices: pass the internal user. Kibana enforces owner scope. */
export const createSessionMemoriesStorageClient = ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): SessionMemoriesStorageClient =>
  new StorageIndexAdapter<typeof sessionMemoriesStorageSettings, StoredSessionMemory>(
    esClient,
    logger,
    sessionMemoriesStorageSettings
  ).getClient();

export const createTranscriptsStorageClient = ({
  esClient,
  logger,
}: {
  esClient: ElasticsearchClient;
  logger: Logger;
}): TranscriptsStorageClient =>
  new StorageIndexAdapter<typeof transcriptsStorageSettings, StoredTranscriptDocument>(
    esClient,
    logger,
    transcriptsStorageSettings
  ).getClient();
