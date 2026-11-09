import { describe, expect, it } from 'vitest';

import type { PhaseResult } from '@memory-evals/shared';

import { summarize } from '../summary.js';

const row = (overrides: Partial<PhaseResult>): PhaseResult => ({
  sample_id: 's',
  question_id: 'q',
  question_type: 't',
  question: '?',
  gold_answer: 'a',
  target: 'context_engine',
  ingest_mode: 'ce_memory',
  phase: 'single',
  predicted_answer: 'a',
  judge_score: 1,
  evidence_session_ids: ['s1'],
  retrieved_session_ids: ['s1'],
  recall: 1,
  hit: true,
  sessions_ingested: 1,
  duration_ms: 10,
  ...overrides,
});

describe('summarize', () => {
  it('aggregates a single phase and skips abstention questions in recall', () => {
    const summary = summarize([
      row({ question_id: 'q1' }),
      row({ question_id: 'q2', judge_score: 0, recall: 0, hit: false, retrieved_session_ids: [] }),
      row({ question_id: 'q3', judge_score: null, recall: null, hit: null, evidence_session_ids: [], error: 'boom' }),
    ]);
    expect(summary.dreaming_delta).toBeUndefined();
    expect(summary.phases).toHaveLength(1);
    expect(summary.phases[0]).toMatchObject({
      phase: 'single',
      questions: 3,
      scored: 2,
      errors: 1,
      accuracy: 0.5,
      recall: 0.5,
      hit_rate: 0.5,
    });
  });

  it('pairs pre and post dreaming by question and reports the difference', () => {
    const summary = summarize([
      row({ question_id: 'q1', phase: 'pre_dream', judge_score: 0, recall: 0, hit: false }),
      row({ question_id: 'q2', phase: 'pre_dream', judge_score: 0.5, recall: 0.5, hit: true }),
      row({ question_id: 'q1', phase: 'post_dream', judge_score: 1, recall: 1, hit: true }),
      row({ question_id: 'q2', phase: 'post_dream', judge_score: 0.5, recall: 0.5, hit: true }),
    ]);
    expect(summary.phases.map((p) => p.phase)).toEqual(['pre_dream', 'post_dream']);
    expect(summary.dreaming_delta).toEqual({ questions: 2, accuracy: 0.5, recall: 0.5, hit_rate: 0.5 });
  });
});
