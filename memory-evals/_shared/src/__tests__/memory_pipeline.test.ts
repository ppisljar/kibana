import { describe, expect, it, vi } from 'vitest';

import type { Judge } from '../judge.js';
import { runSample } from '../memory/pipeline.js';
import { resolveSessionIds, evalSessionRef } from '../memory/session_ids.js';
import { evidenceHit, evidenceRecall, mean } from '../memory/metrics.js';
import {
  PendingApiError,
  type IngestReceipt,
  type MemoryTarget,
  type NormalizedSample,
  type TargetAnswer,
} from '../memory/types.js';

const sample: NormalizedSample = {
  sample_id: 'smp',
  sessions: [
    { session_id: 's1', turns: [{ role: 'user', content: 'x' }] },
    { session_id: 's2', turns: [{ role: 'user', content: 'y' }] },
  ],
  questions: [
    {
      question_id: 'q1',
      question_type: 't',
      question: 'what?',
      gold_answer: 'yes',
      evidence_session_ids: ['s2'],
    },
    {
      question_id: 'q2',
      question_type: 't',
      question: 'unanswerable?',
      gold_answer: 'none',
      evidence_session_ids: [],
    },
  ],
};

const judgeOk: Judge = {
  name: 'fake',
  score: vi.fn(async () => ({ score: 1, reason: 'matches' })),
};

const makeTarget = (overrides: Partial<MemoryTarget> = {}): MemoryTarget & {
  calls: string[];
} => {
  const calls: string[] = [];
  const base: MemoryTarget & { calls: string[] } = {
    name: 'context_engine',
    ingestModes: ['ce_memory'],
    calls,
    ingest: vi.fn(async (s): Promise<IngestReceipt> => {
      calls.push('ingest');
      return {
        sample_id: s.sample_id,
        ingest_mode: 'ce_memory',
        session_index: new Map([
          ['ki-1', 's1'],
          ['ki-2', 's2'],
        ]),
        handles: ['ki-1', 'ki-2'],
      };
    }),
    dream: vi.fn(async () => {
      calls.push('dream');
    }),
    ask: vi.fn(async (q): Promise<TargetAnswer> => {
      calls.push(`ask:${q.question_id}`);
      return {
        predicted_answer: 'yes',
        raw: { rows: q.question_id === 'q1' ? [['ki-2']] : [['ki-1']] },
      };
    }),
    cleanup: vi.fn(async () => {
      calls.push('cleanup');
    }),
    ...overrides,
  };
  return base;
};

describe('runSample', () => {
  it('asks every question once and cleans up when no dreaming is requested', async () => {
    const target = makeTarget();
    const rows = await runSample(sample, {
      target,
      judge: judgeOk,
      ingestMode: 'ce_memory',
      dream: 'none',
      teardown: true,
    });
    expect(target.calls).toEqual(['ingest', 'ask:q1', 'ask:q2', 'cleanup']);
    expect(rows.map((r) => r.phase)).toEqual(['single', 'single']);
    expect(rows[0]).toMatchObject({ judge_score: 1, retrieved_session_ids: ['s2'], recall: 1, hit: true });
    expect(rows[1]).toMatchObject({ recall: null, hit: null, retrieved_session_ids: ['s1'] });
  });

  it('asks before and after dreaming on the same ingest', async () => {
    const target = makeTarget();
    const rows = await runSample(sample, {
      target,
      judge: judgeOk,
      ingestMode: 'ce_memory',
      dream: 'pre_post',
      teardown: false,
    });
    expect(target.calls).toEqual(['ingest', 'ask:q1', 'ask:q2', 'dream', 'ask:q1', 'ask:q2']);
    expect(rows.map((r) => r.phase)).toEqual(['pre_dream', 'pre_dream', 'post_dream', 'post_dream']);
  });

  it('records target errors per question instead of stopping', async () => {
    const target = makeTarget({
      ask: vi.fn(async () => {
        throw new Error('converse 500');
      }),
    });
    const rows = await runSample(sample, {
      target,
      judge: judgeOk,
      ingestMode: 'ce_memory',
      dream: 'none',
      teardown: true,
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.error === 'converse 500' && r.judge_score === null)).toBe(true);
    expect(target.cleanup).toHaveBeenCalledTimes(1);
  });

  it('stops the run when a required API is pending', async () => {
    const target = makeTarget({
      ingest: vi.fn(async () => {
        throw new PendingApiError('memory writes', 'stage 2');
      }),
    });
    await expect(
      runSample(sample, { target, judge: judgeOk, ingestMode: 'ce_memory', dream: 'none', teardown: true })
    ).rejects.toBeInstanceOf(PendingApiError);
    expect(target.cleanup).not.toHaveBeenCalled();
  });

  it('records dreaming failures as post-dream errors and still cleans up', async () => {
    const target = makeTarget({
      dream: vi.fn(async () => {
        throw new Error('workflow failed');
      }),
    });
    const rows = await runSample(sample, {
      target,
      judge: judgeOk,
      ingestMode: 'ce_memory',
      dream: 'pre_post',
      teardown: true,
    });
    expect(rows.filter((r) => r.phase === 'pre_dream')).toHaveLength(2);
    expect(rows.filter((r) => r.phase === 'post_dream').map((r) => r.error)).toEqual([
      'workflow failed',
      'workflow failed',
    ]);
    expect(target.cleanup).toHaveBeenCalledTimes(1);
  });
});

describe('resolveSessionIds', () => {
  const index = new Map([
    ['ki-1', 's1'],
    ['conv-2', 's2'],
  ]);

  it('maps exact ids and eval-session references, first-seen order, deduplicated', () => {
    const raw = {
      steps: [{ text: `found ${evalSessionRef('s3')} and ki-2` }, { id: 'ki-1' }, { id: 'ki-1' }],
      conv: 'conversation://conv-2',
    };
    expect(resolveSessionIds(raw, new Map([...index, ['ki-2', 's4']]))).toEqual(['s3', 's4', 's1', 's2']);
  });

  it('does not match substrings of longer identifiers', () => {
    expect(resolveSessionIds({ text: 'xki-1x' }, index)).toEqual([]);
  });
});

describe('metrics', () => {
  it('computes recall over gold sessions and skips abstention questions', () => {
    expect(evidenceRecall(['a'], ['a', 'b'])).toBe(0.5);
    expect(evidenceHit(['a'], ['a', 'b'])).toBe(true);
    expect(evidenceRecall(['a'], [])).toBeNull();
    expect(mean([1, 0, 0.5])).toBeCloseTo(0.5);
    expect(mean([])).toBeNull();
  });
});
