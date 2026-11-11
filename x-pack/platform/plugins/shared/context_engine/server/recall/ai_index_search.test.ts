/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { Parser } from '@elastic/esql';
import { elasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';
import type { AiIndexHttpItem } from '../../common/http_api/ai_indices';
import { searchAiIndex } from './ai_index_search';

const aiIndex: AiIndexHttpItem = {
  id: 'support',
  managed: false,
  dest: { type: 'index', value: 'ai-index-idx-support' },
  automations: [],
  sources: [],
  traces: [],
  date_created: 'x',
  date_modified: 'x',
};

const searchable = (type: string) => ({ [type]: { type, searchable: true, aggregatable: false } });

/** The canonical KI mapping of the built-in `ai-index@mappings` template, trimmed. */
const canonicalMapping = {
  properties: {
    id: { type: 'keyword' },
    type: { type: 'keyword' },
    tags: { type: 'keyword' },
    updated_at: { type: 'date' },
    title: { type: 'text', fields: { semantic: { type: 'semantic_text' } } },
    description: { type: 'text', fields: { semantic: { type: 'semantic_text' } } },
    content: { type: 'text', fields: { semantic: { type: 'semantic_text' } } },
  },
};

const canonicalFieldCaps = {
  fields: {
    id: searchable('keyword'),
    type: searchable('keyword'),
    tags: searchable('keyword'),
    updated_at: searchable('date'),
    title: searchable('text'),
    'title.semantic': searchable('semantic_text'),
    description: searchable('text'),
    'description.semantic': searchable('semantic_text'),
    content: searchable('text'),
    'content.semantic': searchable('semantic_text'),
  },
};

describe('searchAiIndex', () => {
  let esClient: ReturnType<typeof elasticsearchClientMock.createElasticsearchClient>;

  const mockFields = (mapping: object, fieldCaps: object) => {
    esClient.indices.getMapping.mockResolvedValue({
      'ai-index-idx-support': { mappings: mapping },
    } as never);
    esClient.fieldCaps.mockResolvedValue(fieldCaps as never);
  };

  const queries = () => esClient.esql.query.mock.calls.map(([request]) => request);
  // The lifecycle rewrite pretty-prints the query, wrapping long lines.
  const flat = (query: string) => query.replace(/\s+/g, ' ');

  beforeEach(() => {
    esClient = elasticsearchClientMock.createElasticsearchClient();
    esClient.esql.query.mockResolvedValue({
      columns: [
        { name: '_id', type: 'keyword' },
        { name: '_score', type: 'double' },
        { name: 'id', type: 'keyword' },
        { name: 'title', type: 'text' },
        { name: 'description', type: 'text' },
        { name: 'content', type: 'text' },
        { name: 'type', type: 'keyword' },
        { name: 'tags', type: 'keyword' },
        { name: 'updated_at', type: 'date' },
      ],
      values: [
        [
          'doc-1',
          3.2,
          'ki-1',
          'Lisbon hotels',
          'Travel policy',
          'Up to 200 EUR per night.',
          'document',
          ['travel', 'policy'],
          '2026-11-01T10:00:00.000Z',
        ],
      ],
    } as never);
  });

  it('runs a lexical and a semantic ES|QL query, with the lifecycle and space filter of _query', async () => {
    mockFields(canonicalMapping, canonicalFieldCaps);

    const lists = await searchAiIndex({
      esClient,
      spaceId: 'default',
      aiIndex,
      registeredDests: [aiIndex.dest],
      query: 'hotel budget',
      filters: {},
      size: 7,
    });

    const [lexical, semantic] = queries();
    expect(flat(lexical.query)).toContain('FROM ai-index-idx-support METADATA _id, _index, _score');
    expect(flat(lexical.query)).toContain(
      'MATCH(title, ?query) OR MATCH(description, ?query) OR MATCH(content, ?query)'
    );
    expect(flat(lexical.query)).toContain('governance.lifecycle.status');
    expect(flat(lexical.query)).toContain('LIMIT 7');
    expect(flat(semantic.query)).toContain(
      'MATCH(title.semantic, ?query) OR MATCH(description.semantic, ?query) OR MATCH(content.semantic, ?query)'
    );
    expect(lexical.params).toEqual([{ query: 'hotel budget' }]);
    expect(lexical.filter).toBeDefined();
    for (const { query } of queries()) {
      expect(Parser.parse(query).errors).toEqual([]);
    }

    expect(lists.lexical).toEqual([
      {
        source: 'ai_index',
        id: 'ki-1',
        ai_index_id: 'support',
        title: 'Lisbon hotels',
        description: 'Travel policy',
        content: 'Up to 200 EUR per night.',
        type: 'document',
        tags: ['travel', 'policy'],
        timestamp: '2026-11-01T10:00:00.000Z',
      },
    ]);
    expect(lists.semantic).toHaveLength(1);
  });

  it('adds the type, tag and time filters as WHERE conditions with parameters', async () => {
    mockFields(canonicalMapping, canonicalFieldCaps);

    await searchAiIndex({
      esClient,
      spaceId: 'default',
      aiIndex,
      registeredDests: [aiIndex.dest],
      query: 'q',
      filters: {
        types: ['fact.*', 'document'],
        tags: ['Travel'],
        from: '2026-01-01T00:00:00Z',
        to: '2026-12-31T00:00:00Z',
      },
      size: 5,
    });

    const [{ query, params }] = queries();
    expect(flat(query)).toContain('| WHERE type LIKE "fact.*" OR type == "document"');
    expect(flat(query)).toContain('| WHERE MATCH(tags, ?tag0)');
    expect(flat(query)).toContain('| WHERE updated_at >= TO_DATETIME(?from)');
    expect(flat(query)).toContain('| WHERE updated_at <= TO_DATETIME(?to)');
    expect(params).toEqual([
      { query: 'q' },
      { tag0: 'travel' },
      { from: '2026-01-01T00:00:00Z' },
      { to: '2026-12-31T00:00:00Z' },
    ]);
    expect(Parser.parse(query).errors).toEqual([]);
  });

  it('searches lexically only, and says why, when the index has no semantic_text field', async () => {
    mockFields(
      { properties: { title: { type: 'text' }, content: { type: 'text' } } },
      { fields: { title: searchable('text'), content: searchable('text') } }
    );

    const lists = await searchAiIndex({
      esClient,
      spaceId: 'default',
      aiIndex,
      registeredDests: [aiIndex.dest],
      query: 'q',
      filters: {},
      size: 5,
    });

    expect(queries()).toHaveLength(1);
    expect(flat(queries()[0].query)).toContain('| KEEP _id, _score, title, content');
    expect(lists.semantic).toBeUndefined();
    expect(lists.semanticError).toBe('The AI index has no semantic_text fields.');
  });

  it('queries nothing for an index without searchable fields, or without the field a filter needs', async () => {
    mockFields({ properties: {} }, { fields: {} });
    await expect(
      searchAiIndex({
        esClient,
        spaceId: 'default',
        aiIndex,
        registeredDests: [aiIndex.dest],
        query: 'q',
        filters: {},
        size: 5,
      })
    ).resolves.toEqual({ lexical: [], semantic: [] });

    mockFields(
      { properties: { content: { type: 'text' } } },
      { fields: { content: searchable('text') } }
    );
    await expect(
      searchAiIndex({
        esClient,
        spaceId: 'default',
        aiIndex,
        registeredDests: [aiIndex.dest],
        query: 'q',
        filters: { tags: ['x'] },
        size: 5,
      })
    ).resolves.toEqual({ lexical: [], semantic: [] });
    expect(esClient.esql.query).not.toHaveBeenCalled();
  });

  it('keeps the lexical results when the semantic query fails', async () => {
    mockFields(canonicalMapping, canonicalFieldCaps);
    esClient.esql.query
      .mockResolvedValueOnce({ columns: [], values: [] } as never)
      .mockRejectedValueOnce(new Error('no inference endpoint'));

    const lists = await searchAiIndex({
      esClient,
      spaceId: 'default',
      aiIndex,
      registeredDests: [aiIndex.dest],
      query: 'q',
      filters: {},
      size: 5,
    });

    expect(lists).toEqual({ lexical: [], semanticError: 'no inference endpoint' });
  });
});
