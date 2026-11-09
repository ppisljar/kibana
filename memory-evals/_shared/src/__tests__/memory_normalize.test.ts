import { describe, expect, it } from 'vitest';

import { fromLongMemEval, fromLoCoMo, turnsToRounds } from '../memory/normalize.js';
import type { LongMemEvalItem, LoCoMoSample } from '../types.js';

const lmeItem: LongMemEvalItem = {
  question_id: 'q1',
  question_type: 'single-session-user',
  question: 'Where do I live?',
  question_date: '2024/05/01 (Wed) 10:00',
  answer: 'Ljubljana',
  answer_session_ids: ['s2'],
  haystack_dates: ['2024/04/01 (Mon) 09:00', '2024/04/02 (Tue) 09:00'],
  haystack_session_ids: ['s1', 's2'],
  haystack_sessions: [
    [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ],
    [
      { role: 'user', content: 'I moved to Ljubljana' },
      { role: 'assistant', content: '   ' },
    ],
  ],
};

describe('fromLongMemEval', () => {
  it('keeps session ids, evidence and question date', () => {
    const sample = fromLongMemEval(lmeItem);
    expect(sample.sample_id).toBe('q1');
    expect(sample.sessions.map((s) => s.session_id)).toEqual(['s1', 's2']);
    expect(sample.questions[0]).toMatchObject({
      question_id: 'q1',
      gold_answer: 'Ljubljana',
      evidence_session_ids: ['s2'],
      question_date: '2024/05/01 (Wed) 10:00',
    });
  });

  it('drops whitespace-only turns', () => {
    const sample = fromLongMemEval(lmeItem);
    expect(sample.sessions[1]?.turns).toEqual([{ role: 'user', content: 'I moved to Ljubljana' }]);
  });
});

const locomoSample: LoCoMoSample = {
  sample_id: 'conv-1',
  conversation: {
    speaker_a: 'Ana',
    speaker_b: 'Bo',
    session_1: [
      { speaker: 'Ana', dia_id: 'D1:1', text: 'I adopted a dog' },
      { speaker: 'Bo', dia_id: 'D1:2', text: 'Nice', blip_caption: 'a photo of a dog' },
    ],
    session_1_date_time: '1:56 pm on 8 May, 2023',
    session_2: [{ speaker: 'Ana', dia_id: 'D2:1', text: 'It is called Rex' }],
    session_2_date_time: '2:00 pm on 9 May, 2023',
  },
  qa: [
    { question: 'What did Ana adopt?', answer: 'a dog', evidence: ['D1:1', 'D1:2'], category: 1 },
    { question: 'Unanswerable', answer: 'none', evidence: [], category: 5 },
  ],
};

describe('fromLoCoMo', () => {
  it('maps dia references to their session and speakers to roles', () => {
    const sample = fromLoCoMo(locomoSample);
    expect(sample.sessions.map((s) => s.session_id)).toEqual(['session_1', 'session_2']);
    expect(sample.sessions[0]?.turns[0]).toEqual({ role: 'user', content: 'I adopted a dog' });
    expect(sample.sessions[0]?.turns[1]?.role).toBe('assistant');
    expect(sample.sessions[0]?.turns[1]?.content).toContain('[image: a photo of a dog]');
    expect(sample.questions[0]?.evidence_session_ids).toEqual(['session_1']);
    expect(sample.questions[1]?.evidence_session_ids).toEqual([]);
    expect(sample.questions[0]?.question_type).toBe('1');
  });
});

describe('turnsToRounds', () => {
  it('pairs user and assistant turns and fills missing sides', () => {
    const rounds = turnsToRounds(
      [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
        { role: 'user', content: 'c' },
        { role: 'user', content: 'd' },
        { role: 'assistant', content: 'e' },
        { role: 'user', content: 'f' },
      ],
      '2024-04-01T09:00:00.000Z'
    );
    expect(rounds.map((r) => [r.user_message, r.assistant_message])).toEqual([
      ['a', 'b'],
      ['c', '(no reply recorded)'],
      ['d', 'e'],
      ['f', '(no reply recorded)'],
    ]);
    expect(rounds[0]?.started_at).toBe('2024-04-01T09:00:00.000Z');
  });
});
