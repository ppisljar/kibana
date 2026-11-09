import { describe, expect, it } from 'vitest';

import {
  fromLmeV2Group,
  groupByHaystack,
  parseEvalFunction,
  renderTrajectory,
  type LmeV2Question,
  type LmeV2Trajectory,
} from '../memory/normalize_lme_v2.js';

const trajectory: LmeV2Trajectory = {
  id: 't-1',
  domain: 'enterprise',
  environment: 'workarena',
  goal: 'Assign the incident',
  outcome: 'success',
  start_url: 'https://example.test/start',
  states: [
    { state_index: 0, url: 'https://example.test/start', action: null, thought: null, accessibility_tree: 'root' },
    {
      state_index: 1,
      url: 'https://example.test/next',
      action: "click('12')",
      thought: 'Open the form',
      accessibility_tree: 'x'.repeat(50),
    },
  ],
};

describe('parseEvalFunction', () => {
  it('maps phrase-set evaluators and honours separators', () => {
    expect(parseEvalFunction('norm_phrase_set_match|lower=true|separators=,;', 'Incident Mobile, Incident Portal')).toEqual({
      kind: 'phrase_set',
      phrases: ['Incident Mobile', 'Incident Portal'],
      ordered: false,
    });
    expect(parseEvalFunction('norm_phrase_set_match_ordered|separators=;', 'Reports;Problems')).toEqual({
      kind: 'phrase_set',
      phrases: ['Reports', 'Problems'],
      ordered: true,
    });
  });

  it('maps multiple-choice evaluators and the LLM checkers', () => {
    expect(parseEvalFunction('mc_choice_match|require_non_empty=true', 'g')).toEqual({ kind: 'letter', letter: 'G' });
    expect(parseEvalFunction('mc_choice_set_match|require_non_empty=true', 'A,B,F')).toEqual({
      kind: 'letter_set',
      letters: ['A', 'B', 'F'],
    });
    expect(parseEvalFunction('llm_gotchas_checker|require_non_empty=true', 'rubric')).toEqual({ kind: 'rubric' });
    expect(parseEvalFunction('llm_abstention_checker', 'rubric')).toEqual({ kind: 'rubric' });
  });

  it('throws on an unknown evaluator instead of scoring with the wrong rule', () => {
    expect(() => parseEvalFunction('new_checker|x=1', 'a')).toThrow(/Unknown LongMemEval-V2 evaluator "new_checker"/);
  });
});

describe('renderTrajectory', () => {
  it('keeps goal, url, thought and action, and caps accessibility trees', () => {
    const text = renderTrajectory(trajectory, 10);
    expect(text).toContain('Goal: Assign the incident');
    expect(text).toContain('Thought: Open the form');
    expect(text).toContain("Action: click('12')");
    expect(text).toContain('Page: xxxxxxxxxx [truncated]');
  });
});

describe('groupByHaystack and fromLmeV2Group', () => {
  const question = (id: string, eval_function = 'mc_choice_match|require_non_empty=true'): LmeV2Question => ({
    id,
    domain: 'enterprise',
    environment: 'workarena',
    question_type: 'static-environment',
    question: `Question ${id}?`,
    image: null,
    answer: 'A',
    eval_function,
  });

  it('groups questions that share an ordered haystack', () => {
    const groups = groupByHaystack([question('q1'), question('q2'), question('q3')], {
      q1: ['a', 'b'],
      q2: ['a', 'b'],
      q3: ['b', 'a'],
    });
    expect(groups.map((g) => g.questions.map((q) => q.id))).toEqual([['q1', 'q2'], ['q3']]);
  });

  it('builds one sample per group with a session per trajectory', () => {
    const sample = fromLmeV2Group([question('q1'), question('q2')], [trajectory], 100);
    expect(sample.sample_id).toBe('lme-v2-group:q1+1');
    expect(sample.sessions.map((s) => s.session_id)).toEqual(['t-1']);
    expect(sample.questions.map((q) => q.scoring)).toEqual([
      { kind: 'letter', letter: 'A' },
      { kind: 'letter', letter: 'A' },
    ]);
  });
});
