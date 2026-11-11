/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import { RECALL_RERANK_INPUT_CHARS } from '../../common/http_api/recall';
import type { RecallCandidate } from './types';

const RERANK_TIMEOUT = '60s';

/** What the reranker reads of a candidate: its title, description and content, cut to a budget. */
export const rerankInput = ({ title, description, content }: RecallCandidate): string =>
  [title, description, content]
    .filter((part): part is string => Boolean(part))
    .join('\n')
    .slice(0, RECALL_RERANK_INPUT_CHARS);

export interface RerankedPosition {
  /** Position in the candidates passed in. */
  index: number;
  score: number;
}

/**
 * Scores candidates against the query with a `rerank` inference endpoint, best first. Candidates
 * come from stores read with different credentials, so they are reranked as one list here rather
 * than with ES|QL `RERANK` inside any one query.
 */
export const rerankCandidates = async ({
  esClient,
  inferenceId,
  query,
  candidates,
}: {
  esClient: ElasticsearchClient;
  inferenceId: string;
  query: string;
  candidates: readonly RecallCandidate[];
}): Promise<RerankedPosition[]> => {
  if (candidates.length === 0) {
    return [];
  }
  const { rerank } = await esClient.inference.rerank({
    inference_id: inferenceId,
    query,
    input: candidates.map(rerankInput),
    timeout: RERANK_TIMEOUT,
  });
  return rerank
    .filter(({ index }) => index >= 0 && index < candidates.length)
    .map(({ index, relevance_score: score }) => ({ index, score }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
};
