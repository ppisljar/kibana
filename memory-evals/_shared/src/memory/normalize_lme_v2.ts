import type { NormalizedQuestion, NormalizedSample, NormalizedSession, QuestionScoring } from './types.js';

export interface LmeV2Question {
  id: string;
  domain: string;
  environment: string;
  question_type: string;
  question: string;
  image: string | null;
  answer: string;
  eval_function: string;
}

export interface LmeV2State {
  state_index: number | string;
  step?: number | string | null;
  url?: string | null;
  action?: string | null;
  thought?: string | null;
  accessibility_tree?: string | null;
  screenshot?: string | null;
}

export interface LmeV2Trajectory {
  id: string;
  domain: string;
  environment: string;
  goal: string;
  outcome: string;
  start_url: string;
  states: LmeV2State[];
}

/**
 * Turns a `eval_function` spec such as `norm_phrase_set_match|lower=true|separators=,;` into a
 * scoring spec. Throws on an unknown evaluator so a run never scores with the wrong rule.
 */
export const parseEvalFunction = (spec: string, answer: string): QuestionScoring => {
  const [head = '', ...rest] = spec.split('|');
  const params = new Map<string, string>();
  for (const part of rest) {
    const eq = part.indexOf('=');
    if (eq > 0) params.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const separators = params.get('separators') ?? ',';
  const separatorClass = new RegExp(`[${separators.replace(/[\]\\^-]/g, '\\$&')}]`);
  const phrases = (text: string) =>
    text
      .split(separatorClass)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

  switch (head) {
    case 'norm_phrase_set_match':
      return { kind: 'phrase_set', phrases: phrases(answer), ordered: false };
    case 'norm_phrase_set_match_ordered':
      return { kind: 'phrase_set', phrases: phrases(answer), ordered: true };
    case 'mc_choice_match':
      return { kind: 'letter', letter: answer.trim().toUpperCase() };
    case 'mc_choice_set_match':
      return {
        kind: 'letter_set',
        letters: answer
          .split(/[\s,;]+/)
          .map((letter) => letter.trim().toUpperCase())
          .filter((letter) => letter.length > 0),
      };
    case 'llm_abstention_checker':
    case 'llm_gotchas_checker':
      return { kind: 'rubric' };
    default:
      throw new Error(`Unknown LongMemEval-V2 evaluator "${head}" in eval_function "${spec}".`);
  }
};

/**
 * Renders a trajectory as one document. Each state keeps its url, thought, action, and the first
 * `maxStateChars` characters of its accessibility tree. The full trees make a trajectory several
 * hundred kilobytes, so the cap is a deliberate trade-off.
 */
export const renderTrajectory = (trajectory: LmeV2Trajectory, maxStateChars: number): string => {
  const lines = [
    `Trajectory ${trajectory.id} (${trajectory.domain}, ${trajectory.environment}). Outcome: ${trajectory.outcome}.`,
    `Goal: ${trajectory.goal}`,
    `Start URL: ${trajectory.start_url}`,
  ];
  for (const state of trajectory.states) {
    lines.push(`Step ${state.state_index}${state.url ? ` at ${state.url}` : ''}`);
    if (state.thought) lines.push(`Thought: ${state.thought}`);
    if (state.action) lines.push(`Action: ${state.action}`);
    if (state.accessibility_tree) {
      const tree = state.accessibility_tree;
      const shown = tree.length > maxStateChars ? `${tree.slice(0, maxStateChars)} [truncated]` : tree;
      lines.push(`Page: ${shown}`);
    }
  }
  return lines.join('\n');
};

/** One trajectory is one session, so retrieval can map a memory back to it. */
export const trajectorySession = (trajectory: LmeV2Trajectory, maxStateChars: number): NormalizedSession => ({
  session_id: trajectory.id,
  turns: [{ role: 'user', content: renderTrajectory(trajectory, maxStateChars) }],
});

/** Questions that share an ordered haystack can share one ingest. */
export const groupByHaystack = (
  questions: LmeV2Question[],
  haystacks: Record<string, string[]>
): Array<{ haystack: string[]; questions: LmeV2Question[] }> => {
  const groups = new Map<string, { haystack: string[]; questions: LmeV2Question[] }>();
  for (const question of questions) {
    const haystack = haystacks[question.id];
    if (!haystack) throw new Error(`No haystack for LongMemEval-V2 question ${question.id}.`);
    const key = haystack.join(',');
    const group = groups.get(key) ?? { haystack, questions: [] };
    group.questions.push(question);
    groups.set(key, group);
  }
  return [...groups.values()];
};

/** Builds one sample from a haystack group. `trajectories` must already be in haystack order. */
export const fromLmeV2Group = (
  group: LmeV2Question[],
  trajectories: LmeV2Trajectory[],
  maxStateChars: number
): NormalizedSample => {
  const first = group[0];
  if (!first) throw new Error('LongMemEval-V2 group is empty.');
  const sampleId = group.length === 1 ? `lme-v2:${first.id}` : `lme-v2-group:${first.id}+${group.length - 1}`;
  const questions: NormalizedQuestion[] = group.map((q) => ({
    question_id: q.id,
    question_type: q.question_type,
    question: q.question,
    gold_answer: q.answer,
    evidence_session_ids: [],
    scoring: parseEvalFunction(q.eval_function, q.answer),
  }));
  return {
    sample_id: sampleId,
    sessions: trajectories.map((t) => trajectorySession(t, maxStateChars)),
    questions,
  };
};
