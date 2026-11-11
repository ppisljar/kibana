/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

jest.mock('./ai_index_search');

import { elasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';
import { loggerMock } from '@kbn/logging-mocks';
import type { AiIndexHttpItem } from '../../common/http_api/ai_indices';
import { MAX_RECALL_AI_INDICES } from '../../common/http_api/recall';
import { searchAiIndex } from './ai_index_search';
import { recall, type RecallDeps } from './recall';
import type { RecallCandidate, RecallCandidateLists } from './types';

const aiIndex = (id: string): AiIndexHttpItem => ({
  id,
  managed: false,
  dest: { type: 'index', value: `ai-index-idx-${id}` },
  automations: [],
  sources: [],
  traces: [],
  date_created: 'x',
  date_modified: 'x',
});

const ki = (id: string, content: string, aiIndexId = 'support'): RecallCandidate => ({
  source: 'ai_index',
  id,
  ai_index_id: aiIndexId,
  title: `KI ${id}`,
  content,
});

const memory = (id: string, content: string): RecallCandidate => ({
  source: 'session_memory',
  id,
  session_id: 's-1',
  content,
});

const chunk = (id: string, content: string): RecallCandidate => ({
  source: 'transcript',
  id,
  session_id: 's-1',
  content,
});

describe('recall', () => {
  let internalEsClient: ReturnType<typeof elasticsearchClientMock.createElasticsearchClient>;
  let sessionLists: RecallCandidateLists;
  let transcriptLists: RecallCandidateLists;
  let deps: RecallDeps;

  beforeEach(() => {
    jest.mocked(searchAiIndex).mockReset();
    jest.mocked(searchAiIndex).mockResolvedValue({
      lexical: [ki('ki-1', 'Hotels up to 200 EUR in Lisbon.'), ki('ki-2', 'Revenue in EUR.')],
      semantic: [ki('ki-1', 'Hotels up to 200 EUR in Lisbon.')],
    });
    sessionLists = {
      lexical: [memory('m1', 'Budget is 180 EUR a night.')],
      semantic: [memory('m1', 'Budget is 180 EUR a night.')],
    };
    transcriptLists = { lexical: [chunk('sess-1#0', 'User: I fly to Lisbon.')], semantic: [] };
    internalEsClient = elasticsearchClientMock.createElasticsearchClient();
    internalEsClient.inference.rerank.mockImplementation(
      async ({ input }) =>
        ({
          // Scores the inputs mentioning a budget highest.
          rerank: (input as string[])
            .map((text, index) => ({
              index,
              relevance_score: text.includes('Budget') ? 5 : -index,
            }))
            .sort((a, b) => b.relevance_score - a.relevance_score),
        } as never)
    );
    deps = {
      scope: { spaceId: 'default', owner: { id: 'u1', username: 'jdoe' } },
      esClient: elasticsearchClientMock.createElasticsearchClient(),
      internalEsClient,
      listReadableAiIndices: jest.fn().mockResolvedValue([aiIndex('support')]),
      listRegisteredAiIndices: jest.fn().mockResolvedValue([aiIndex('support')]),
      sessionMemories: { search: jest.fn(async () => sessionLists) },
      transcripts: { search: jest.fn(async () => transcriptLists) },
      logger: loggerMock.create(),
    };
  });

  it('searches every source, fuses the lists and reranks them as one', async () => {
    const response = await recall(deps, { query: 'hotel budget' });

    expect(deps.sessionMemories.search).toHaveBeenCalledWith(deps.scope, {
      query: 'hotel budget',
      filters: {},
      size: 30,
    });
    expect(searchAiIndex).toHaveBeenCalledWith(
      expect.objectContaining({
        aiIndex: aiIndex('support'),
        registeredDests: [aiIndex('support').dest],
        spaceId: 'default',
        query: 'hotel budget',
      })
    );
    expect(internalEsClient.inference.rerank).toHaveBeenCalledWith(
      expect.objectContaining({
        inference_id: '.rerank-v1-elasticsearch',
        query: 'hotel budget',
        input: expect.arrayContaining(['KI ki-1\nHotels up to 200 EUR in Lisbon.']),
      })
    );
    expect(response.reranked).toBe(true);
    expect(response.rerank_inference_id).toBe('.rerank-v1-elasticsearch');
    expect(response.results[0]).toMatchObject({
      source: 'session_memory',
      id: 'm1',
      score: 5,
      truncated: false,
      retrieval: { rerank_score: 5, source_rank: 1 },
    });
    expect(response.results.map(({ id }) => id).sort()).toEqual(
      ['ki-1', 'ki-2', 'm1', 'sess-1#0'].sort()
    );
    expect(response.sources).toEqual([
      { source: 'ai_indices', candidates: 2, ai_index_ids: ['support'], semantic: true },
      { source: 'session_memories', candidates: 1, semantic: true },
      { source: 'transcripts', candidates: 1, semantic: true },
    ]);
    expect(response.truncated).toBe(false);
  });

  it('falls back to the fused order when the reranker fails', async () => {
    internalEsClient.inference.rerank.mockRejectedValue(new Error('inference endpoint not found'));

    const response = await recall(deps, { query: 'hotel budget' });

    expect(response.reranked).toBe(false);
    expect(response.rerank_error).toBe('inference endpoint not found');
    expect(response.rerank_inference_id).toBeUndefined();
    // Every source list leads with one item; equal ranks break on the source name.
    expect(response.results.map(({ id }) => id)).toEqual(['ki-1', 'm1', 'sess-1#0', 'ki-2']);
    expect(response.results[0].score).toBe(response.results[0].retrieval.fused_score);
    expect(response.results[0].retrieval).not.toHaveProperty('rerank_score');
  });

  it('does not rerank when asked not to, and uses the endpoint it is given', async () => {
    await recall(deps, { query: 'q', rerank: { enabled: false } });
    expect(internalEsClient.inference.rerank).not.toHaveBeenCalled();

    await recall(deps, { query: 'q', rerank: { inference_id: 'my-reranker', window: 2 } });
    expect(internalEsClient.inference.rerank).toHaveBeenCalledWith(
      expect.objectContaining({ inference_id: 'my-reranker' })
    );
    // The window never drops below the limit (10 by default), so all four candidates go.
    expect((internalEsClient.inference.rerank.mock.calls[0][0].input as string[]).length).toBe(4);
  });

  it('drops reranked results below min_score, and ignores it without reranking', async () => {
    const reranked = await recall(deps, { query: 'q', min_score: 1 });
    expect(reranked.results.map(({ id }) => id)).toEqual(['m1']);

    const unranked = await recall(deps, { query: 'q', min_score: 1, rerank: { enabled: false } });
    expect(unranked.results).toHaveLength(4);
  });

  it('caps the result count, the content of each result and the total characters', async () => {
    sessionLists = { lexical: [memory('m1', 'Budget '.repeat(100))] };
    transcriptLists = { lexical: [chunk('sess-1#0', 'x'.repeat(500))] };

    const limited = await recall(deps, { query: 'q', limit: 1 });
    expect(limited.results).toHaveLength(1);
    expect(limited.truncated).toBe(true);

    const perResult = await recall(deps, { query: 'q', max_content_chars: 50 });
    expect(perResult.results.every(({ content }) => content.length <= 50)).toBe(true);
    expect(perResult.results.find(({ id }) => id === 'm1')).toMatchObject({ truncated: true });

    const budget = await recall(deps, { query: 'q', max_total_chars: 900 });
    const total = budget.results.reduce((sum, { content }) => sum + content.length, 0);
    expect(total).toBeLessThanOrEqual(900);
    expect(budget.truncated).toBe(true);
  });

  it('searches only the sources asked for', async () => {
    const response = await recall(deps, { query: 'q', sources: ['transcripts'] });
    expect(searchAiIndex).not.toHaveBeenCalled();
    expect(deps.sessionMemories.search).not.toHaveBeenCalled();
    expect(response.sources.map(({ source }) => source)).toEqual(['transcripts']);
    expect(response.results.map(({ source }) => source)).toEqual(['transcript']);
  });

  it('reports AI indices it could not read or search, and searches the rest', async () => {
    jest
      .mocked(deps.listReadableAiIndices)
      .mockResolvedValue([aiIndex('support'), aiIndex('broken')]);
    jest.mocked(searchAiIndex).mockImplementation(async ({ aiIndex: { id } }) =>
      id === 'broken'
        ? Promise.reject(new Error('verification_exception'))
        : {
            lexical: [ki('ki-1', 'a')],
            semanticError: 'The AI index has no semantic_text fields.',
          }
    );

    const response = await recall(deps, {
      query: 'q',
      sources: ['ai_indices'],
      ai_index_ids: ['support', 'broken', 'hidden'],
    });

    expect(deps.listReadableAiIndices).toHaveBeenCalledWith(['support', 'broken', 'hidden']);
    expect(response.sources[0]).toEqual({
      source: 'ai_indices',
      candidates: 1,
      ai_index_ids: ['support', 'broken'],
      semantic: false,
      errors: expect.arrayContaining([
        { ai_index_id: 'hidden', message: 'Not found, or not readable by the caller.' },
        { ai_index_id: 'broken', message: 'verification_exception' },
        {
          ai_index_id: 'support',
          message: 'Semantic search skipped: The AI index has no semantic_text fields.',
        },
      ]),
    });
    expect(response.results.map(({ id }) => id)).toEqual(['ki-1']);
  });

  it(`searches at most ${MAX_RECALL_AI_INDICES} AI indices and says so`, async () => {
    const many = Array.from({ length: MAX_RECALL_AI_INDICES + 2 }, (_, i) => aiIndex(`ai-${i}`));
    jest.mocked(deps.listReadableAiIndices).mockResolvedValue(many);

    const response = await recall(deps, { query: 'q', sources: ['ai_indices'] });

    expect(searchAiIndex).toHaveBeenCalledTimes(MAX_RECALL_AI_INDICES);
    expect(response.sources[0].errors).toContainEqual({
      message: `Searched the first ${MAX_RECALL_AI_INDICES} of ${
        MAX_RECALL_AI_INDICES + 2
      } readable AI indices; pass ai_index_ids to choose.`,
    });
  });

  it('reports a store that fails instead of failing the recall', async () => {
    jest.mocked(deps.transcripts.search).mockRejectedValue(new Error('index closed'));

    const response = await recall(deps, { query: 'q' });

    expect(response.sources).toContainEqual({
      source: 'transcripts',
      candidates: 0,
      semantic: false,
      errors: [{ message: 'index closed' }],
    });
    expect(response.results.length).toBeGreaterThan(0);
  });

  it('keeps one of items with the same content found in different sources', async () => {
    sessionLists = { lexical: [memory('m1', 'Hotels up to 200 EUR in Lisbon.')] };

    const response = await recall(deps, { query: 'q', rerank: { enabled: false } });

    const contents = response.results.map(({ content }) => content);
    expect(new Set(contents).size).toBe(contents.length);
  });
});
