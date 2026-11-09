import type { Judge } from '../judge.js';

import { evidenceHit, evidenceRecall } from './metrics.js';
import { scoreDeterministic } from './scoring.js';
import { resolveSessionIds } from './session_ids.js';
import {
  PendingApiError,
  type DreamPhase,
  type IngestMode,
  type IngestReceipt,
  type MemoryTarget,
  type NormalizedQuestion,
  type NormalizedSample,
  type Phase,
  type TargetName,
} from './types.js';

export interface PhaseResult {
  sample_id: string;
  question_id: string;
  question_type: string;
  question: string;
  gold_answer: string;
  target: TargetName;
  ingest_mode: IngestMode;
  phase: Phase;
  predicted_answer: string;
  judge_score: number | null;
  /** Who produced `judge_score`: the LLM judge, code, or nothing when scoring failed. */
  scorer: 'judge' | 'deterministic' | 'none';
  judge_reason?: string;
  evidence_session_ids: string[];
  retrieved_session_ids: string[];
  recall: number | null;
  hit: boolean | null;
  sessions_ingested: number;
  duration_ms: number;
  error?: string;
}

export interface PipelineOptions {
  target: MemoryTarget;
  judge: Judge;
  ingestMode: IngestMode;
  dream: DreamPhase;
  teardown: boolean;
  warn?: (msg: string) => void;
}

const now = (): number => Date.now();

const errorRow = (
  sample: NormalizedSample,
  question: NormalizedQuestion,
  opts: PipelineOptions,
  phase: Phase,
  receipt: IngestReceipt | undefined,
  started: number,
  message: string
): PhaseResult => ({
  sample_id: sample.sample_id,
  question_id: question.question_id,
  question_type: question.question_type,
  question: question.question,
  gold_answer: question.gold_answer,
  target: opts.target.name,
  ingest_mode: opts.ingestMode,
  phase,
  predicted_answer: '',
  judge_score: null,
  scorer: 'none',
  evidence_session_ids: question.evidence_session_ids,
  retrieved_session_ids: [],
  recall: null,
  hit: null,
  sessions_ingested: receipt ? new Set(receipt.session_index.values()).size : 0,
  duration_ms: now() - started,
  error: message,
});

const answerOne = async (
  sample: NormalizedSample,
  question: NormalizedQuestion,
  receipt: IngestReceipt,
  opts: PipelineOptions,
  phase: Phase
): Promise<PhaseResult> => {
  const started = now();
  let answer;
  try {
    answer = await opts.target.ask(question, receipt);
  } catch (e) {
    if (e instanceof PendingApiError) throw e;
    return errorRow(sample, question, opts, phase, receipt, started, (e as Error).message);
  }

  const retrieved = resolveSessionIds(answer.raw, receipt.session_index);
  let judgeScore: number | null = null;
  let judgeReason: string | undefined;
  let scorer: PhaseResult['scorer'] = 'none';
  const deterministic = scoreDeterministic(question.scoring, answer.predicted_answer);
  if (deterministic) {
    judgeScore = deterministic.score;
    judgeReason = deterministic.reason;
    scorer = 'deterministic';
  } else {
    try {
      const verdict = await opts.judge.score({
        question: question.question,
        gold_answer: question.gold_answer,
        predicted_answer: answer.predicted_answer,
        category: question.question_type,
        context: question.question_date ? { question_date: question.question_date } : {},
      });
      if (verdict) {
        judgeScore = verdict.score;
        if (verdict.reason) judgeReason = verdict.reason;
        scorer = 'judge';
      }
    } catch (e) {
      opts.warn?.(`judge error for ${question.question_id}: ${(e as Error).message}`);
    }
  }

  const row: PhaseResult = {
    sample_id: sample.sample_id,
    question_id: question.question_id,
    question_type: question.question_type,
    question: question.question,
    gold_answer: question.gold_answer,
    target: opts.target.name,
    ingest_mode: opts.ingestMode,
    phase,
    predicted_answer: answer.predicted_answer,
    judge_score: judgeScore,
    scorer,
    evidence_session_ids: question.evidence_session_ids,
    retrieved_session_ids: retrieved,
    recall: evidenceRecall(retrieved, question.evidence_session_ids),
    hit: evidenceHit(retrieved, question.evidence_session_ids),
    sessions_ingested: new Set(receipt.session_index.values()).size,
    duration_ms: now() - started,
  };
  if (judgeReason !== undefined) row.judge_reason = judgeReason;
  return row;
};

/**
 * Ingests one sample, asks every question, and (with `dream: 'pre_post'`)
 * dreams and asks again on the same ingest. Comparing the two phases isolates
 * what dreaming adds. {@link PendingApiError} aborts the run rather than
 * producing rows.
 */
export const runSample = async (
  sample: NormalizedSample,
  opts: PipelineOptions
): Promise<PhaseResult[]> => {
  const rows: PhaseResult[] = [];
  const firstPhase: Phase = opts.dream === 'pre_post' ? 'pre_dream' : 'single';
  let receipt: IngestReceipt | undefined;

  try {
    try {
      receipt = await opts.target.ingest(sample, opts.ingestMode);
    } catch (e) {
      if (e instanceof PendingApiError) throw e;
      for (const q of sample.questions) {
        rows.push(errorRow(sample, q, opts, firstPhase, undefined, now(), (e as Error).message));
      }
      return rows;
    }

    for (const q of sample.questions) {
      rows.push(await answerOne(sample, q, receipt, opts, firstPhase));
    }

    if (opts.dream === 'pre_post') {
      const dreamStarted = now();
      try {
        await opts.target.dream(receipt);
      } catch (e) {
        if (e instanceof PendingApiError) throw e;
        for (const q of sample.questions) {
          rows.push(errorRow(sample, q, opts, 'post_dream', receipt, dreamStarted, (e as Error).message));
        }
        return rows;
      }
      for (const q of sample.questions) {
        rows.push(await answerOne(sample, q, receipt, opts, 'post_dream'));
      }
    }
    return rows;
  } finally {
    if (receipt && opts.teardown) {
      try {
        await opts.target.cleanup(receipt);
      } catch (e) {
        opts.warn?.(`cleanup failed for ${sample.sample_id}: ${(e as Error).message}`);
      }
    }
  }
};
