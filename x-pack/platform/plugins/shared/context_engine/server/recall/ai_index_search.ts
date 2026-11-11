/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { AiIndexDest, AiIndexHttpItem } from '../../common/http_api/ai_indices';
import { describeAiIndexFields } from '../ai_indices/describe_fields';
import { queryAiIndices } from '../ai_indices/query';
import { formatErrorMessage } from '../utils/format_es_error';
import type { RecallCandidate, RecallCandidateLists, RecallSearchParams } from './types';

const SEARCHED_FIELDS = ['title', 'description', 'content'] as const;
const LEXICAL_TYPES = new Set(['text', 'match_only_text']);
const SEMANTIC_TYPE = 'semantic_text';
const KEPT_FIELDS = [
  'id',
  'title',
  'description',
  'content',
  'type',
  'tags',
  'updated_at',
  '@timestamp',
  'references.uri',
] as const;

type Row = Record<string, unknown>;

const asString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string').join('\n') || undefined;
  }
  return undefined;
};

const asStrings = (value: unknown): string[] | undefined => {
  if (typeof value === 'string') {
    return [value];
  }
  if (Array.isArray(value)) {
    const strings = value.filter((item): item is string => typeof item === 'string');
    return strings.length > 0 ? strings : undefined;
  }
  return undefined;
};

const typeCondition = (types: readonly string[]): string =>
  types
    .map((type) =>
      type.endsWith('*') ? `type LIKE "${type.toLowerCase()}"` : `type == "${type.toLowerCase()}"`
    )
    .join(' OR ');

/** The query shape both branches share; `search` is the `WHERE` that matches `?query`. */
const buildQuery = ({
  target,
  search,
  filters,
  keep,
  size,
}: {
  target: string;
  search: string;
  filters: string[];
  keep: string[];
  size: number;
}): string =>
  [
    `FROM ${target} METADATA _id, _index, _score`,
    ...filters.map((condition) => `| WHERE ${condition}`),
    `| WHERE ${search}`,
    '| SORT _score DESC, _id ASC',
    `| KEEP ${['_id', '_score', ...keep].join(', ')}`,
    `| LIMIT ${size}`,
  ].join('\n');

const toCandidates = (
  aiIndexId: string,
  { columns, values }: { columns: Array<{ name: string }>; values: unknown[][] }
): RecallCandidate[] =>
  values.flatMap((value) => {
    const row: Row = Object.fromEntries(columns.map(({ name }, i) => [name, value[i]]));
    const id = asString(row.id) ?? asString(row._id);
    const content = asString(row.content) ?? asString(row.description) ?? asString(row.title);
    if (!id || content === undefined) {
      return [];
    }
    const title = asString(row.title);
    const description = asString(row.description);
    const type = asString(row.type);
    const tags = asStrings(row.tags);
    const timestamp = asString(row.updated_at) ?? asString(row['@timestamp']);
    const uris = asStrings(row['references.uri']);
    const candidate: RecallCandidate = {
      source: 'ai_index',
      id,
      ai_index_id: aiIndexId,
      content,
      ...(title !== undefined && { title }),
      ...(description !== undefined && description !== content && { description }),
      ...(type !== undefined && { type }),
      ...(tags !== undefined && { tags }),
      ...(timestamp !== undefined && { timestamp }),
      ...(uris !== undefined && { references: uris.map((uri) => ({ uri })) }),
    };
    return [candidate];
  });

/**
 * Recall candidates from one AI index, read as the caller with the space filter and the KI
 * lifecycle pipeline that `_query` applies. Only fields the index maps are searched or kept: a
 * semantic branch runs where it has `semantic_text` fields.
 */
export const searchAiIndex = async ({
  esClient,
  spaceId,
  aiIndex,
  registeredDests,
  query,
  filters,
  size,
}: RecallSearchParams & {
  /** Scoped to the caller. */
  esClient: ElasticsearchClient;
  spaceId: string;
  aiIndex: AiIndexHttpItem;
  /** Every registered dest, so `_query` recognises this one and applies its lifecycle. */
  registeredDests: AiIndexDest[];
}): Promise<RecallCandidateLists> => {
  const { allFields } = await describeAiIndexFields({ esClient, target: aiIndex.dest.value });
  const typeOf = new Map(
    allFields.map(({ path, type, searchable }) => [path, { type, searchable }])
  );
  const has = (path: string) => typeOf.has(path);

  const lexicalFields = SEARCHED_FIELDS.filter((path) => {
    const field = typeOf.get(path);
    return field !== undefined && field.searchable && LEXICAL_TYPES.has(field.type);
  });
  const semanticFields = SEARCHED_FIELDS.flatMap((path) => [`${path}.semantic`, path]).filter(
    (path) => {
      const field = typeOf.get(path);
      return field !== undefined && field.searchable && field.type === SEMANTIC_TYPE;
    }
  );

  const conditions: string[] = [];
  const params: Record<string, string> = { query };

  // An index with nothing to search (no backing index yet, or other fields), or without the field a
  // filter needs, holds nothing that can match.
  if (
    (lexicalFields.length === 0 && semanticFields.length === 0) ||
    (filters.types?.length && !has('type')) ||
    (filters.tags?.length && !has('tags'))
  ) {
    return { lexical: [], semantic: [] };
  }
  if (filters.types?.length) {
    conditions.push(typeCondition(filters.types));
  }
  if (filters.tags?.length) {
    conditions.push(
      filters.tags
        .map((tag, position) => {
          params[`tag${position}`] = tag.toLowerCase();
          return `MATCH(tags, ?tag${position})`;
        })
        .join(' OR ')
    );
  }
  const timeField = ['updated_at', '@timestamp'].find(has);
  if (timeField && filters.from !== undefined) {
    params.from = filters.from;
    conditions.push(`${timeField} >= TO_DATETIME(?from)`);
  }
  if (timeField && filters.to !== undefined) {
    params.to = filters.to;
    conditions.push(`${timeField} <= TO_DATETIME(?to)`);
  }

  const keep = KEPT_FIELDS.filter(has);
  const run = async (fields: readonly string[]) => {
    const esql = buildQuery({
      target: aiIndex.dest.value,
      search: fields.map((field) => `MATCH(${field}, ?query)`).join(' OR '),
      filters: conditions,
      keep,
      size,
    });
    const response = await queryAiIndices({
      esClient,
      spaceId,
      aiIndexDests: registeredDests,
      query: esql,
      params,
      limit: size,
    });
    return toCandidates(aiIndex.id, response);
  };

  const [lexical, semantic] = await Promise.allSettled([
    lexicalFields.length > 0 ? run(lexicalFields) : Promise.resolve([]),
    semanticFields.length > 0 ? run(semanticFields) : Promise.resolve(undefined),
  ]);
  if (lexical.status === 'rejected') {
    throw lexical.reason;
  }
  if (semantic.status === 'rejected') {
    return { lexical: lexical.value, semanticError: formatErrorMessage(semantic.reason) };
  }
  if (semantic.value === undefined) {
    return { lexical: lexical.value, semanticError: 'The AI index has no semantic_text fields.' };
  }
  return { lexical: lexical.value, semantic: semantic.value };
};
