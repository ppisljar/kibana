/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { schema } from '@kbn/config-schema';
import { MAX_AI_INDEX_ID_LENGTH, MAX_KI_CONTENT_LENGTH } from '../../../common/constants';
import { MEMORY_KI_TYPES } from '../../../common/memory';
import {
  MAX_KI_ATTRIBUTE_ARRAY_VALUES,
  MAX_KI_ATTRIBUTE_KEY_LENGTH,
  MAX_KI_ATTRIBUTE_VALUE_LENGTH,
  MAX_KI_ATTRIBUTES,
  MAX_KI_DESCRIPTION_LENGTH,
  MAX_KI_ID_LENGTH,
  MAX_KI_REFERENCE_DESCRIPTION_LENGTH,
  MAX_KI_REFERENCE_URI_LENGTH,
  MAX_KI_REFERENCES,
  MAX_KI_TAG_LENGTH,
  MAX_KI_TAGS,
  MAX_KI_TITLE_LENGTH,
} from '../../../common/step_types/ki';
import {
  DEFAULT_SESSION_MEMORIES_PAGE_SIZE,
  MAX_MEMORY_STORE_AGENT_ID_LENGTH,
  MAX_SESSION_ID_LENGTH,
  MAX_SESSION_MEMORIES_PAGE_SIZE,
  MAX_SESSION_MEMORIES_PER_WRITE,
  MAX_SESSION_MEMORY_IDS_PER_DELETE,
  SESSION_ID_PATTERN,
} from '../../../common/http_api/session_memories';
import {
  MAX_TRANSCRIPT_SESSION_IDS_PER_DELETE,
  MAX_TRANSCRIPT_SOURCE_LENGTH,
  MAX_TRANSCRIPT_SOURCE_REF_LENGTH,
  MAX_TRANSCRIPT_TURN_CONTENT_LENGTH,
  MAX_TRANSCRIPT_TURN_NAME_LENGTH,
  MAX_TRANSCRIPT_TURNS,
  TRANSCRIPT_ROLES,
} from '../../../common/http_api/transcripts';
import {
  MAX_RECALL_AI_INDICES,
  MAX_RECALL_CANDIDATES_PER_SOURCE,
  MAX_RECALL_FILTER_VALUES,
  MAX_RECALL_LIMIT,
  MAX_RECALL_MAX_CONTENT_CHARS,
  MAX_RECALL_MAX_TOTAL_CHARS,
  MAX_RECALL_QUERY_LENGTH,
  MAX_RECALL_RERANK_INFERENCE_ID_LENGTH,
  MAX_RECALL_RERANK_WINDOW,
  MAX_RECALL_TYPE_FILTER_LENGTH,
  RECALL_SOURCES,
  RECALL_TYPE_FILTER_PATTERN,
} from '../../../common/http_api/recall';
import { validateAiIndexId } from '../../../common/validation';

const MAX_DATE_LENGTH = 64;

const isoDateSchema = (description: string) =>
  schema.string({
    maxLength: MAX_DATE_LENGTH,
    validate: (value) =>
      Number.isNaN(Date.parse(value)) ? 'Must be an ISO 8601 date.' : undefined,
    meta: { description },
  });

const sessionIdSchema = schema.string({
  minLength: 1,
  maxLength: MAX_SESSION_ID_LENGTH,
  validate: (value) =>
    SESSION_ID_PATTERN.test(value)
      ? undefined
      : 'Must not start with `_`, and must not contain whitespace or `/`.',
  meta: { description: 'The session the memory or transcript belongs to.' },
});

const agentIdSchema = schema.string({ minLength: 1, maxLength: MAX_MEMORY_STORE_AGENT_ID_LENGTH });

const aiIndexIdSchema = schema.string({
  minLength: 1,
  maxLength: MAX_AI_INDEX_ID_LENGTH,
  validate: validateAiIndexId,
});

const tagsSchema = schema.arrayOf(schema.string({ minLength: 1, maxLength: MAX_KI_TAG_LENGTH }), {
  maxSize: MAX_KI_TAGS,
});

const attributesSchema = schema.recordOf(
  schema.string({ minLength: 1, maxLength: MAX_KI_ATTRIBUTE_KEY_LENGTH }),
  schema.oneOf([
    schema.string({ maxLength: MAX_KI_ATTRIBUTE_VALUE_LENGTH }),
    schema.number(),
    schema.boolean(),
    schema.arrayOf(schema.string({ maxLength: MAX_KI_ATTRIBUTE_VALUE_LENGTH }), {
      maxSize: MAX_KI_ATTRIBUTE_ARRAY_VALUES,
    }),
  ]),
  {
    validate: (value) =>
      Object.keys(value).length > MAX_KI_ATTRIBUTES
        ? `At most ${MAX_KI_ATTRIBUTES} attributes.`
        : undefined,
  }
);

const referencesSchema = schema.arrayOf(
  schema.object({
    uri: schema.string({ minLength: 1, maxLength: MAX_KI_REFERENCE_URI_LENGTH }),
    relation: schema.maybe(schema.string({ maxLength: MAX_KI_TAG_LENGTH })),
    description: schema.maybe(schema.string({ maxLength: MAX_KI_REFERENCE_DESCRIPTION_LENGTH })),
  }),
  { maxSize: MAX_KI_REFERENCES }
);

const memoryTypeSchema = schema.oneOf([
  schema.literal(MEMORY_KI_TYPES[0]),
  schema.literal(MEMORY_KI_TYPES[1]),
]);

export const writeSessionMemoriesBodySchema = schema.object({
  memories: schema.arrayOf(
    schema.object({
      id: schema.maybe(schema.string({ minLength: 1, maxLength: MAX_KI_ID_LENGTH })),
      session_id: sessionIdSchema,
      agent_id: schema.maybe(agentIdSchema),
      ai_index_id: schema.maybe(aiIndexIdSchema),
      type: memoryTypeSchema,
      title: schema.string({ minLength: 1, maxLength: MAX_KI_TITLE_LENGTH }),
      description: schema.maybe(schema.string({ maxLength: MAX_KI_DESCRIPTION_LENGTH })),
      content: schema.string({ minLength: 1, maxLength: MAX_KI_CONTENT_LENGTH }),
      tags: schema.maybe(tagsSchema),
      references: schema.maybe(referencesSchema),
      attributes: schema.maybe(attributesSchema),
      expires_at: schema.maybe(
        schema.nullable(isoDateSchema('When the memory stops being recalled. `null`: never.'))
      ),
    }),
    { minSize: 1, maxSize: MAX_SESSION_MEMORIES_PER_WRITE }
  ),
  refresh: schema.maybe(schema.boolean()),
});

export const listSessionMemoriesQuerySchema = schema.object({
  session_id: schema.maybe(sessionIdSchema),
  agent_id: schema.maybe(agentIdSchema),
  ai_index_id: schema.maybe(aiIndexIdSchema),
  type: schema.maybe(memoryTypeSchema),
  page: schema.number({ min: 1, max: 10_000, defaultValue: 1 }),
  per_page: schema.number({
    min: 1,
    max: MAX_SESSION_MEMORIES_PAGE_SIZE,
    defaultValue: DEFAULT_SESSION_MEMORIES_PAGE_SIZE,
  }),
});

export const deleteSessionMemoriesBodySchema = schema.object(
  {
    ids: schema.maybe(
      schema.arrayOf(schema.string({ minLength: 1, maxLength: MAX_KI_ID_LENGTH }), {
        minSize: 1,
        maxSize: MAX_SESSION_MEMORY_IDS_PER_DELETE,
      })
    ),
    session_id: schema.maybe(sessionIdSchema),
    agent_id: schema.maybe(agentIdSchema),
    ai_index_id: schema.maybe(aiIndexIdSchema),
  },
  {
    validate: ({ ids, session_id: sessionId, agent_id: agentId, ai_index_id: aiIndexId }) =>
      [ids, sessionId, agentId, aiIndexId].every((value) => value === undefined)
        ? 'Give ids, a session_id, an agent_id or an ai_index_id.'
        : undefined,
  }
);

export const transcriptSessionParamsSchema = schema.object({ sessionId: sessionIdSchema });

export const putTranscriptBodySchema = schema.object({
  source: schema.string({ minLength: 1, maxLength: MAX_TRANSCRIPT_SOURCE_LENGTH }),
  source_ref: schema.maybe(
    schema.string({ minLength: 1, maxLength: MAX_TRANSCRIPT_SOURCE_REF_LENGTH })
  ),
  agent_id: schema.maybe(agentIdSchema),
  ai_index_id: schema.maybe(aiIndexIdSchema),
  title: schema.maybe(schema.string({ maxLength: MAX_KI_TITLE_LENGTH })),
  started_at: schema.maybe(isoDateSchema('When the session started.')),
  turns: schema.arrayOf(
    schema.object({
      role: schema.oneOf([
        schema.literal(TRANSCRIPT_ROLES[0]),
        schema.literal(TRANSCRIPT_ROLES[1]),
        schema.literal(TRANSCRIPT_ROLES[2]),
        schema.literal(TRANSCRIPT_ROLES[3]),
      ]),
      content: schema.string({ maxLength: MAX_TRANSCRIPT_TURN_CONTENT_LENGTH }),
      timestamp: schema.maybe(isoDateSchema('When the turn happened.')),
      name: schema.maybe(schema.string({ maxLength: MAX_TRANSCRIPT_TURN_NAME_LENGTH })),
    }),
    { minSize: 1, maxSize: MAX_TRANSCRIPT_TURNS }
  ),
  tags: schema.maybe(tagsSchema),
  attributes: schema.maybe(attributesSchema),
  mode: schema.maybe(schema.oneOf([schema.literal('replace'), schema.literal('append')])),
  refresh: schema.maybe(schema.boolean()),
});

export const deleteTranscriptsBodySchema = schema.object(
  {
    session_ids: schema.maybe(
      schema.arrayOf(sessionIdSchema, {
        minSize: 1,
        maxSize: MAX_TRANSCRIPT_SESSION_IDS_PER_DELETE,
      })
    ),
    source: schema.maybe(schema.string({ minLength: 1, maxLength: MAX_TRANSCRIPT_SOURCE_LENGTH })),
    agent_id: schema.maybe(agentIdSchema),
    ai_index_id: schema.maybe(aiIndexIdSchema),
  },
  {
    validate: ({ session_ids: sessionIds, source, agent_id: agentId, ai_index_id: aiIndexId }) =>
      [sessionIds, source, agentId, aiIndexId].every((value) => value === undefined)
        ? 'Give session_ids, a source, an agent_id or an ai_index_id.'
        : undefined,
  }
);

const typeFilterSchema = schema.string({
  minLength: 1,
  maxLength: MAX_RECALL_TYPE_FILTER_LENGTH,
  validate: (value) =>
    RECALL_TYPE_FILTER_PATTERN.test(value)
      ? undefined
      : 'Use lowercase letters, digits, `.`, `_` and `-`, with an optional trailing `*`.',
});

export const recallBodySchema = schema.object({
  query: schema.string({ minLength: 1, maxLength: MAX_RECALL_QUERY_LENGTH }),
  sources: schema.maybe(
    schema.arrayOf(
      schema.oneOf([
        schema.literal(RECALL_SOURCES[0]),
        schema.literal(RECALL_SOURCES[1]),
        schema.literal(RECALL_SOURCES[2]),
      ]),
      { minSize: 1, maxSize: RECALL_SOURCES.length }
    )
  ),
  ai_index_ids: schema.maybe(
    schema.arrayOf(aiIndexIdSchema, { minSize: 1, maxSize: MAX_RECALL_AI_INDICES })
  ),
  filters: schema.maybe(
    schema.object({
      agent_id: schema.maybe(agentIdSchema),
      session_ids: schema.maybe(
        schema.arrayOf(sessionIdSchema, { minSize: 1, maxSize: MAX_RECALL_FILTER_VALUES })
      ),
      exclude_session_ids: schema.maybe(
        schema.arrayOf(sessionIdSchema, { minSize: 1, maxSize: MAX_RECALL_FILTER_VALUES })
      ),
      types: schema.maybe(
        schema.arrayOf(typeFilterSchema, { minSize: 1, maxSize: MAX_RECALL_FILTER_VALUES })
      ),
      tags: schema.maybe(
        schema.arrayOf(schema.string({ minLength: 1, maxLength: MAX_KI_TAG_LENGTH }), {
          minSize: 1,
          maxSize: MAX_RECALL_FILTER_VALUES,
        })
      ),
      from: schema.maybe(isoDateSchema('Earliest update or turn time.')),
      to: schema.maybe(isoDateSchema('Latest update or turn time.')),
    })
  ),
  limit: schema.maybe(schema.number({ min: 1, max: MAX_RECALL_LIMIT })),
  candidates_per_source: schema.maybe(
    schema.number({ min: 1, max: MAX_RECALL_CANDIDATES_PER_SOURCE })
  ),
  max_content_chars: schema.maybe(schema.number({ min: 1, max: MAX_RECALL_MAX_CONTENT_CHARS })),
  max_total_chars: schema.maybe(schema.number({ min: 1, max: MAX_RECALL_MAX_TOTAL_CHARS })),
  min_score: schema.maybe(schema.number()),
  rerank: schema.maybe(
    schema.object({
      enabled: schema.maybe(schema.boolean()),
      inference_id: schema.maybe(
        schema.string({ minLength: 1, maxLength: MAX_RECALL_RERANK_INFERENCE_ID_LENGTH })
      ),
      window: schema.maybe(schema.number({ min: 1, max: MAX_RECALL_RERANK_WINDOW })),
    })
  ),
});
