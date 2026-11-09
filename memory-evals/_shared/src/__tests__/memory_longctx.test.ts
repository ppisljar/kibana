import { describe, expect, it } from 'vitest';

import {
  documentSessions,
  fromInfiniteBench,
  fromLongBenchV2,
  fromRulerRecord,
  infiniteBenchScoring,
  multipleChoiceQuestion,
  parseRulerOutputs,
} from '../memory/normalize_longctx.js';

describe('documentSessions', () => {
  it('splits on blank lines and keeps every session under the limit', () => {
    const text = ['alpha '.repeat(10), 'beta '.repeat(10), 'gamma '.repeat(10)].join('\n\n');
    const sessions = documentSessions('doc', text, 80);
    expect(sessions.length).toBeGreaterThan(1);
    for (const session of sessions) {
      expect(session.turns[0]?.content.length).toBeLessThanOrEqual(80);
    }
    expect(sessions.map((s) => s.session_id)).toEqual(sessions.map((_, i) => `doc-${String(i).padStart(5, '0')}`));
    expect(sessions.map((s) => s.turns[0]?.content).join(' ')).toContain('gamma');
  });

  it('breaks a long block at line boundaries so key-value pairs stay whole', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `"key-${i}": "value-${i}"`).join('\n');
    const sessions = documentSessions('doc', lines, 60);
    for (const session of sessions) {
      for (const line of session.turns[0]?.content.split('\n') ?? []) {
        expect(line).toMatch(/^"key-\d"/);
      }
    }
  });

  it('cuts a paragraph longer than the limit', () => {
    const sessions = documentSessions('doc', 'x'.repeat(250), 100);
    expect(sessions.map((s) => s.turns[0]?.content.length)).toEqual([100, 100, 50]);
  });
});

describe('multipleChoiceQuestion', () => {
  it('lists lettered options and asks for a letter', () => {
    const text = multipleChoiceQuestion('Which?', ['one', 'two']);
    expect(text).toContain('A. one\nB. two');
    expect(text).toContain('Answer with the letter');
  });
});

describe('fromLongBenchV2', () => {
  it('uses the context as sessions and grades by letter', () => {
    const sample = fromLongBenchV2(
      {
        _id: 'lb-1',
        domain: 'Single-Document QA',
        question: 'What is the code?',
        choice_A: 'x',
        choice_B: 'y',
        choice_C: 'z',
        choice_D: 'w',
        answer: 'c',
        context: 'The code is z.\n\nUnrelated text.',
      },
      1000
    );
    expect(sample.sample_id).toBe('lb-1');
    expect(sample.sessions.length).toBe(1);
    expect(sample.questions[0]?.scoring).toEqual({ kind: 'letter', letter: 'C' });
    expect(sample.questions[0]?.question).toContain('C. z');
  });
});

describe('infiniteBenchScoring', () => {
  it('uses option letters when options exist', () => {
    expect(infiniteBenchScoring('longbook_choice_eng', ['Light housework'], ['Walking Georgie', 'Light housework'])).toEqual({
      kind: 'letter',
      letter: 'B',
    });
    expect(infiniteBenchScoring('code_debug', ['C'], ['a', 'b', 'c', 'd'])).toEqual({ kind: 'letter', letter: 'C' });
  });

  it('uses containment for retrieval tasks and the judge for open answers', () => {
    expect(infiniteBenchScoring('passkey', ['71432'], [])).toEqual({ kind: 'contains_any', golds: ['71432'] });
    expect(infiniteBenchScoring('longbook_qa_eng', ['a fox'], [])).toEqual({ kind: 'judge' });
  });
});

describe('fromInfiniteBench', () => {
  it('builds a sample whose id carries the task', () => {
    const sample = fromInfiniteBench(
      { id: 0, context: 'The pass key is 71432.', input: 'What is the pass key?', answer: ['71432'], options: [] },
      'passkey',
      1000
    );
    expect(sample.sample_id).toBe('passkey:0');
    expect(sample.questions[0]?.question).toBe('What is the pass key?');
    expect(sample.questions[0]?.gold_answer).toBe('71432');
  });
});

describe('parseRulerOutputs', () => {
  it('reads Python list reprs and JSON arrays', () => {
    expect(parseRulerOutputs("['abc-1', 'def-2']")).toEqual(['abc-1', 'def-2']);
    expect(parseRulerOutputs('["abc-1"]')).toEqual(['abc-1']);
    expect(parseRulerOutputs(['x'])).toEqual(['x']);
    expect(parseRulerOutputs(undefined)).toEqual([]);
    expect(parseRulerOutputs('6b73c2a3-1111')).toEqual(['6b73c2a3-1111']);
  });
});

describe('fromRulerRecord for HELMET key-value records', () => {
  it('asks for the key and grades by the bare value', () => {
    const sample = fromRulerRecord(
      {
        question: 'bdd6-key',
        answer: '6b73-value',
        context: 'JSON data:\n{\n"bdd6-key": "6b73-value"\n}',
      },
      'helmet',
      'json_kv',
      1000
    );
    expect(sample.questions[0]?.question).toBe('What is the value associated with the key "bdd6-key"?');
    expect(sample.questions[0]?.scoring).toEqual({ kind: 'contains_fraction', golds: ['6b73-value'] });
  });
});

describe('fromRulerRecord', () => {
  it('asks for a needle by its query and scores by the fraction of values found', () => {
    const sample = fromRulerRecord(
      {
        index: 0,
        query: 'key-1',
        type_needle_v: 'uuid',
        outputs: "['v-1', 'v-2']",
        context: 'One magic uuid for key-1 is: v-1.\nAnother for key-1 is: v-2.',
      },
      'ruler',
      'niah_multivalue',
      1000
    );
    expect(sample.questions[0]?.question).toBe(
      'What is the special magic uuid for key-1 mentioned in the provided text?'
    );
    expect(sample.questions[0]?.scoring).toEqual({ kind: 'contains_fraction', golds: ['v-1', 'v-2'] });
    expect(sample.sessions.length).toBe(1);
  });
});
