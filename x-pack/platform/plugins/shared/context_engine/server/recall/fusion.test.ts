/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { candidateKey, dedupeByContent, reciprocalRankFusion, RRF_RANK_CONSTANT } from './fusion';
import type { RecallCandidate } from './types';

const memory = (id: string, content = `content of ${id}`): RecallCandidate => ({
  source: 'session_memory',
  id,
  content,
});

describe('candidateKey', () => {
  it('tells apart the same id in different AI indices and sources', () => {
    const a: RecallCandidate = { source: 'ai_index', ai_index_id: 'a', id: '1', content: '' };
    const b: RecallCandidate = { ...a, ai_index_id: 'b' };
    const c: RecallCandidate = { source: 'session_memory', id: '1', content: '' };
    expect(new Set([a, b, c].map(candidateKey)).size).toBe(3);
  });
});

describe('reciprocalRankFusion', () => {
  it('sums 1 / (k + rank) over the lists an item appears in', () => {
    const fused = reciprocalRankFusion([
      [memory('a'), memory('b')],
      [memory('b'), memory('c')],
    ]);
    expect(fused.map(({ candidate }) => candidate.id)).toEqual(['b', 'a', 'c']);
    expect(fused[0].fusedScore).toBeCloseTo(
      1 / (RRF_RANK_CONSTANT + 2) + 1 / (RRF_RANK_CONSTANT + 1)
    );
    expect(fused[0].sourceRank).toBe(1);
    expect(fused[2]).toMatchObject({ sourceRank: 2 });
  });

  it('interleaves single lists by rank, deterministically on ties', () => {
    const fused = reciprocalRankFusion([[memory('x1'), memory('x2')], [memory('y1')]]);
    expect(fused.map(({ candidate }) => candidate.id)).toEqual(['x1', 'y1', 'x2']);
  });

  it('returns nothing for no lists', () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});

describe('dedupeByContent', () => {
  it('keeps the first of items with the same content, ignoring case and whitespace', () => {
    const fused = reciprocalRankFusion([
      [
        memory('a', 'Safari  crashes\non billing'),
        memory('b', 'safari crashes on billing'),
        memory('c'),
      ],
    ]);
    expect(dedupeByContent(fused).map(({ candidate }) => candidate.id)).toEqual(['a', 'c']);
  });
});
