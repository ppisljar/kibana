import { mean, type PhaseResult, type Phase } from '@memory-evals/shared';

export interface PhaseSummary {
  phase: Phase;
  questions: number;
  scored: number;
  errors: number;
  /** Mean judge score (1 correct, 0.5 partial, 0 wrong). */
  accuracy: number | null;
  /** Mean share of gold evidence sessions retrieved, over questions with evidence. */
  recall: number | null;
  /** Share of questions that retrieved at least one gold evidence session. */
  hit_rate: number | null;
  mean_duration_ms: number | null;
}

export interface PairedDelta {
  /** Questions answered in both phases with a score in each. */
  questions: number;
  accuracy: number | null;
  recall: number | null;
  hit_rate: number | null;
}

export interface RunSummary {
  phases: PhaseSummary[];
  /** `post_dream` minus `pre_dream`, paired by question. Present only for `pre_post` runs. */
  dreaming_delta?: PairedDelta;
}

const numbers = (values: Array<number | null | undefined>): number[] =>
  values.filter((v): v is number => typeof v === 'number');

const summarizePhase = (phase: Phase, rows: PhaseResult[]): PhaseSummary => {
  const scored = rows.filter((r) => r.judge_score !== null);
  const withEvidence = rows.filter((r) => r.recall !== null);
  const withHit = rows.filter((r) => r.hit !== null);
  return {
    phase,
    questions: rows.length,
    scored: scored.length,
    errors: rows.filter((r) => r.error !== undefined).length,
    accuracy: mean(numbers(scored.map((r) => r.judge_score))),
    recall: mean(numbers(withEvidence.map((r) => r.recall))),
    hit_rate: mean(withHit.map((r) => (r.hit ? 1 : 0))),
    mean_duration_ms: mean(rows.map((r) => r.duration_ms)),
  };
};

const pairedDelta = (before: PhaseResult[], after: PhaseResult[]): PairedDelta => {
  const beforeById = new Map(before.map((r) => [r.question_id, r]));
  const pairs = after
    .map((a) => ({ a, b: beforeById.get(a.question_id) }))
    .filter((p): p is { a: PhaseResult; b: PhaseResult } => p.b !== undefined);

  const delta = (pick: (r: PhaseResult) => number | null | undefined): number | null => {
    const diffs = pairs.flatMap(({ a, b }) => {
      const x = pick(a);
      const y = pick(b);
      return typeof x === 'number' && typeof y === 'number' ? [x - y] : [];
    });
    return mean(diffs);
  };

  return {
    questions: pairs.length,
    accuracy: delta((r) => r.judge_score),
    recall: delta((r) => r.recall),
    hit_rate: delta((r) => (r.hit === null ? null : r.hit ? 1 : 0)),
  };
};

export const summarize = (rows: PhaseResult[]): RunSummary => {
  const phases: Phase[] = ['single', 'pre_dream', 'post_dream'];
  const byPhase = (phase: Phase) => rows.filter((r) => r.phase === phase);
  const summary: RunSummary = {
    phases: phases.filter((p) => byPhase(p).length > 0).map((p) => summarizePhase(p, byPhase(p))),
  };
  const pre = byPhase('pre_dream');
  const post = byPhase('post_dream');
  if (pre.length > 0 && post.length > 0) summary.dreaming_delta = pairedDelta(pre, post);
  return summary;
};
