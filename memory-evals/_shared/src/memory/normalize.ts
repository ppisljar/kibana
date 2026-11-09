import { locomoGoldAnswer, locomoSessions, parseLongMemEvalDate } from '../dataset.js';
import type { ImportRound, LongMemEvalItem, LoCoMoSample, LoCoMoTurn } from '../types.js';

import type { NormalizedQuestion, NormalizedSample, NormalizedSession, SessionTurn } from './types.js';

const toRole = (role: string): SessionTurn['role'] => (role === 'assistant' ? 'assistant' : 'user');

const nonEmpty = (turns: SessionTurn[]): SessionTurn[] =>
  turns.filter((t) => t.content.trim().length > 0);

export const fromLongMemEval = (item: LongMemEvalItem): NormalizedSample => {
  const sessions: NormalizedSession[] = [];
  item.haystack_sessions.forEach((turns, idx) => {
    const turnList = nonEmpty(turns.map((t) => ({ role: toRole(t.role), content: t.content })));
    if (turnList.length === 0) return;
    const session: NormalizedSession = {
      session_id: item.haystack_session_ids[idx] ?? `s${idx}`,
      turns: turnList,
    };
    const startedAt = parseLongMemEvalDate(item.haystack_dates[idx]);
    if (startedAt !== undefined) session.started_at = startedAt;
    sessions.push(session);
  });

  const question: NormalizedQuestion = {
    question_id: item.question_id,
    question_type: item.question_type,
    question: item.question,
    gold_answer: item.answer,
    evidence_session_ids: [...item.answer_session_ids],
  };
  if (item.question_date) question.question_date = item.question_date;

  return { sample_id: item.question_id, sessions, questions: [question] };
};

const flattenLoCoMoTurn = (turn: LoCoMoTurn): string => {
  const parts: string[] = [];
  if (turn.blip_caption) parts.push(`[image: ${turn.blip_caption}]`);
  if (turn.text) parts.push(turn.text);
  return parts.join(' ').trim();
};

/** `D3:12` → `session_3`. */
const locomoSessionOfEvidence = (ref: string): string | undefined => {
  const m = ref.match(/^D(\d+):/);
  return m ? `session_${m[1]}` : undefined;
};

export const fromLoCoMo = (sample: LoCoMoSample): NormalizedSample => {
  const { speaker_a: speakerA } = sample.conversation;

  const sessions: NormalizedSession[] = locomoSessions(sample)
    .map((s) => {
      const session: NormalizedSession = {
        session_id: s.key,
        turns: nonEmpty(
          s.turns.map((t) => ({
            role: t.speaker === speakerA ? 'user' : 'assistant',
            content: flattenLoCoMoTurn(t),
          }))
        ),
      };
      if (s.dateIso !== undefined) session.started_at = s.dateIso;
      return session;
    })
    .filter((s) => s.turns.length > 0);

  const questions: NormalizedQuestion[] = (sample.qa ?? []).map((qa, idx) => {
    const evidence = new Set<string>();
    for (const ref of qa.evidence ?? []) {
      const session = locomoSessionOfEvidence(ref);
      if (session !== undefined) evidence.add(session);
    }
    return {
      question_id: `${sample.sample_id}:q${idx}`,
      question_type: String(qa.category),
      question: qa.question,
      gold_answer: locomoGoldAnswer(qa),
      evidence_session_ids: [...evidence],
    };
  });

  return { sample_id: sample.sample_id, sessions, questions };
};

/**
 * Pairs consecutive user/assistant turns into Agent Builder import rounds. A
 * missing side becomes a short placeholder because the import API rejects
 * empty messages.
 */
export const turnsToRounds = (turns: SessionTurn[], startedAt?: string): ImportRound[] => {
  const rounds: ImportRound[] = [];
  let pendingUser: string | undefined;
  const push = (user: string | undefined, assistant: string | undefined) => {
    const round: ImportRound = {
      user_message: user ?? '(prior context)',
      assistant_message: assistant ?? '(no reply recorded)',
    };
    if (startedAt !== undefined) round.started_at = startedAt;
    rounds.push(round);
  };
  for (const turn of turns) {
    if (turn.role === 'user') {
      if (pendingUser !== undefined) push(pendingUser, undefined);
      pendingUser = turn.content;
    } else {
      push(pendingUser, turn.content);
      pendingUser = undefined;
    }
  }
  if (pendingUser !== undefined) push(pendingUser, undefined);
  return rounds;
};
