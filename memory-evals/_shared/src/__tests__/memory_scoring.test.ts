import { describe, expect, it, vi } from 'vitest';

import type { Judge } from '../judge.js';
import { scoreDeterministic, extractLetter, extractLetterSet } from '../memory/scoring.js';
import { runSample } from '../memory/pipeline.js';
import type { IngestReceipt, MemoryTarget, NormalizedSample } from '../memory/types.js';

describe('extractLetter', () => {
  it('reads a leading letter or an explicit answer phrase', () => {
    expect(extractLetter('B')).toBe('B');
    expect(extractLetter('(C) because the text says so')).toBe('C');
    expect(extractLetter('The answer is D.')).toBe('D');
    expect(extractLetter('Option: a')).toBe('A');
  });

  it('returns undefined when no option is committed to', () => {
    expect(extractLetter('The text does not say.')).toBeUndefined();
  });
});

describe('extractLetterSet', () => {
  it('collects unique capital option letters, sorted', () => {
    expect(extractLetterSet('A, B and F')).toEqual(['A', 'B', 'F']);
    expect(extractLetterSet('F, A, A')).toEqual(['A', 'F']);
  });
});

describe('scoreDeterministic', () => {
  it('returns null for judge-graded specs', () => {
    expect(scoreDeterministic(undefined, 'x')).toBeNull();
    expect(scoreDeterministic({ kind: 'judge' }, 'x')).toBeNull();
    expect(scoreDeterministic({ kind: 'rubric' }, 'x')).toBeNull();
  });

  it('matches any gold string, case-insensitively', () => {
    const scoring = { kind: 'contains_any' as const, golds: ['71432'] };
    expect(scoreDeterministic(scoring, 'The pass key is 71432.')?.score).toBe(1);
    expect(scoreDeterministic(scoring, 'I do not know.')?.score).toBe(0);
  });

  it('scores the fraction of gold strings found', () => {
    const scoring = { kind: 'contains_fraction' as const, golds: ['a-1', 'b-2', 'c-3', 'd-4'] };
    expect(scoreDeterministic(scoring, 'a-1 and c-3')?.score).toBe(0.5);
  });

  it('grades a letter answer', () => {
    const scoring = { kind: 'letter' as const, letter: 'B' };
    expect(scoreDeterministic(scoring, 'B')?.score).toBe(1);
    expect(scoreDeterministic(scoring, 'A')?.score).toBe(0);
    expect(scoreDeterministic(scoring, 'no idea')?.score).toBe(0);
  });

  it('grades a letter set by exact set equality', () => {
    const scoring = { kind: 'letter_set' as const, letters: ['F', 'A', 'B'] };
    expect(scoreDeterministic(scoring, 'A, B, F')?.score).toBe(1);
    expect(scoreDeterministic(scoring, 'A, B')?.score).toBe(0);
  });

  it('checks unordered phrase sets by containment', () => {
    const scoring = { kind: 'phrase_set' as const, phrases: ['Reports', 'Problems'], ordered: false };
    expect(scoreDeterministic(scoring, 'problems and reports')?.score).toBe(1);
    expect(scoreDeterministic(scoring, 'Reports only')?.score).toBe(0);
  });

  it('checks ordered phrase sets by position', () => {
    const scoring = { kind: 'phrase_set' as const, phrases: ['Reports', 'Problems'], ordered: true };
    expect(scoreDeterministic(scoring, 'Reports, then Problems')?.score).toBe(1);
    expect(scoreDeterministic(scoring, 'Problems, then Reports')?.score).toBe(0);
  });
});

describe('pipeline scoring', () => {
  const sample: NormalizedSample = {
    sample_id: 's',
    sessions: [{ session_id: 'd1', turns: [{ role: 'user', content: 'x' }] }],
    questions: [
      {
        question_id: 'q-letter',
        question_type: 't',
        question: 'Pick one.',
        gold_answer: 'B',
        evidence_session_ids: [],
        scoring: { kind: 'letter', letter: 'B' },
      },
      {
        question_id: 'q-judged',
        question_type: 't',
        question: 'Explain.',
        gold_answer: 'something',
        evidence_session_ids: [],
      },
    ],
  };
  const receipt: IngestReceipt = { sample_id: 's', ingest_mode: 'ce_memory', session_index: new Map(), handles: [] };
  const target: MemoryTarget = {
    name: 'context_engine',
    ingestModes: ['ce_memory'],
    ingest: vi.fn(async () => receipt),
    dream: vi.fn(async () => undefined),
    ask: vi.fn(async () => ({ predicted_answer: 'B', raw: {} })),
    cleanup: vi.fn(async () => undefined),
  };

  it('scores deterministic questions without the judge and judges the rest', async () => {
    const judge: Judge = { name: 'stub', score: vi.fn(async () => ({ score: 0.5, reason: 'partly' })) };
    const rows = await runSample(sample, { target, judge, ingestMode: 'ce_memory', dream: 'none', teardown: false });
    expect(rows[0]).toMatchObject({ scorer: 'deterministic', judge_score: 1 });
    expect(rows[1]).toMatchObject({ scorer: 'judge', judge_score: 0.5 });
    expect(judge.score).toHaveBeenCalledTimes(1);
  });
});
