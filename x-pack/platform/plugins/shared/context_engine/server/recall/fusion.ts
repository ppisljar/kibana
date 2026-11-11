/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'node:crypto';
import type { RecallCandidate } from './types';

/** The `k` of reciprocal rank fusion: damps the weight of the top ranks. */
export const RRF_RANK_CONSTANT = 60;

export interface FusedCandidate {
  candidate: RecallCandidate;
  fusedScore: number;
  /** One-based rank in the best list it appeared in. */
  sourceRank: number;
}

/** Identity of a candidate across lists: the same item found lexically and semantically is one. */
export const candidateKey = ({ source, ai_index_id: aiIndexId, id }: RecallCandidate): string =>
  JSON.stringify([source, aiIndexId ?? '', id]);

/**
 * Reciprocal rank fusion: each list adds `1 / (k + rank)` to the items it holds. Scores do not have
 * to be comparable across lists, which is why it fuses lexical with semantic, and stores with stores.
 */
export const reciprocalRankFusion = (
  lists: ReadonlyArray<readonly RecallCandidate[]>,
  k: number = RRF_RANK_CONSTANT
): FusedCandidate[] => {
  const fused = new Map<string, FusedCandidate>();
  for (const list of lists) {
    list.forEach((candidate, position) => {
      const key = candidateKey(candidate);
      const rank = position + 1;
      const contribution = 1 / (k + rank);
      const entry = fused.get(key);
      if (entry) {
        entry.fusedScore += contribution;
        entry.sourceRank = Math.min(entry.sourceRank, rank);
      } else {
        fused.set(key, { candidate, fusedScore: contribution, sourceRank: rank });
      }
    });
  }
  return [...fused.entries()]
    .sort(
      ([keyA, a], [keyB, b]) =>
        b.fusedScore - a.fusedScore || a.sourceRank - b.sourceRank || (keyA < keyB ? -1 : 1)
    )
    .map(([, entry]) => entry);
};

const fingerprint = ({ content }: RecallCandidate): string =>
  createHash('sha256').update(content.replace(/\s+/g, ' ').trim().toLowerCase()).digest('hex');

/** Keeps the first of candidates whose content is the same, ignoring case and whitespace. */
export const dedupeByContent = (candidates: readonly FusedCandidate[]): FusedCandidate[] => {
  const seen = new Set<string>();
  return candidates.filter((entry) => {
    const key = fingerprint(entry.candidate);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
};
