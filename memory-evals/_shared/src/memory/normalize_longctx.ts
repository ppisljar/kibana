import type { QuestionScoring, NormalizedQuestion, NormalizedSample, NormalizedSession, SessionTurn } from './types.js';

/** Default size of one document session. Matches the memory chunk size used on ingest. */
export const DEFAULT_CHUNK_CHARS = 8000;

/**
 * Splits a document on blank lines into sessions of about `chunkChars` characters. A paragraph
 * longer than the limit is cut at the limit. Each session carries one user turn with the text.
 */
export const documentSessions = (
  idPrefix: string,
  text: string,
  chunkChars: number = DEFAULT_CHUNK_CHARS
): NormalizedSession[] => {
  const pieces: string[] = [];
  const pushCut = (unit: string) => {
    let rest = unit.trim();
    while (rest.length > chunkChars) {
      pieces.push(rest.slice(0, chunkChars));
      rest = rest.slice(chunkChars);
    }
    if (rest.length > 0) pieces.push(rest);
  };
  for (const paragraph of text.split(/\n\s*\n/)) {
    if (paragraph.trim().length <= chunkChars) {
      pushCut(paragraph);
      continue;
    }
    // Long paragraphs break at line boundaries first, so key-value pairs and table rows stay whole.
    let lines = '';
    for (const line of paragraph.split('\n')) {
      if (lines.length > 0 && lines.length + line.length + 1 > chunkChars) {
        pushCut(lines);
        lines = '';
      }
      lines = lines.length > 0 ? `${lines}\n${line}` : line;
    }
    pushCut(lines);
  }

  const sessions: NormalizedSession[] = [];
  let current = '';
  const flush = () => {
    if (current.length === 0) return;
    const turn: SessionTurn = { role: 'user', content: current };
    sessions.push({ session_id: `${idPrefix}-${String(sessions.length).padStart(5, '0')}`, turns: [turn] });
    current = '';
  };
  for (const piece of pieces) {
    if (current.length > 0 && current.length + piece.length + 2 > chunkChars) flush();
    current = current.length > 0 ? `${current}\n\n${piece}` : piece;
  }
  flush();
  return sessions;
};

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Question text with lettered options and an instruction to answer with one letter. */
export const multipleChoiceQuestion = (question: string, options: string[]): string => {
  const lines = options.map((option, i) => `${LETTERS[i] ?? String(i)}. ${option}`);
  return [question, '', ...lines, '', 'Answer with the letter of the correct option only.'].join('\n');
};

export interface LongBenchV2Record {
  _id: string;
  domain: string;
  sub_domain?: string;
  difficulty?: string;
  length?: string;
  question: string;
  choice_A: string;
  choice_B: string;
  choice_C: string;
  choice_D: string;
  answer: string;
  context: string;
}

/** One LongBench v2 record is one sample: its context is the haystack and its question is graded by letter. */
export const fromLongBenchV2 = (
  record: LongBenchV2Record,
  chunkChars: number = DEFAULT_CHUNK_CHARS
): NormalizedSample => {
  const options = [record.choice_A, record.choice_B, record.choice_C, record.choice_D];
  const scoring: QuestionScoring = { kind: 'letter', letter: record.answer.trim().toUpperCase() };
  const question: NormalizedQuestion = {
    question_id: record._id,
    question_type: record.domain,
    question: multipleChoiceQuestion(record.question, options),
    gold_answer: record.answer,
    evidence_session_ids: [],
    scoring,
  };
  return {
    sample_id: record._id,
    sessions: documentSessions(record._id, record.context, chunkChars),
    questions: [question],
  };
};

export interface InfiniteBenchRecord {
  id: number | string;
  context: string;
  input: string;
  answer: string[];
  options?: string[];
}

/**
 * Tasks whose answers are short strings the response must contain. Anything else with options is
 * graded by letter, and the rest go to the judge.
 */
const CONTAINS_TASKS = new Set(['passkey', 'number_string', 'kv_retrieval', 'math_find', 'math_calc', 'code_run']);

export const infiniteBenchScoring = (
  task: string,
  answer: string[],
  options: string[]
): QuestionScoring => {
  if (options.length > 0) {
    const first = answer[0] ?? '';
    const isLetter = /^[A-H]$/.test(first.trim());
    const index = options.indexOf(first);
    const letter = isLetter ? first.trim() : index >= 0 ? (LETTERS[index] ?? '') : '';
    return { kind: 'letter', letter };
  }
  if (CONTAINS_TASKS.has(task)) return { kind: 'contains_any', golds: answer };
  return { kind: 'judge' };
};

/**
 * One InfiniteBench record is one sample. `task` is the dataset file name (e.g. `passkey`), which
 * sets how the answer is graded.
 */
export const fromInfiniteBench = (
  record: InfiniteBenchRecord,
  task: string,
  chunkChars: number = DEFAULT_CHUNK_CHARS
): NormalizedSample => {
  const options = record.options ?? [];
  const id = `${task}:${String(record.id)}`;
  const question: NormalizedQuestion = {
    question_id: id,
    question_type: task,
    question: options.length > 0 ? multipleChoiceQuestion(record.input, options) : record.input,
    gold_answer: record.answer.join(' | '),
    evidence_session_ids: [],
    scoring: infiniteBenchScoring(task, record.answer, options),
  };
  return {
    sample_id: id,
    sessions: documentSessions(id, record.context, chunkChars),
    questions: [question],
  };
};

/**
 * Gold strings from a RULER or HELMET `outputs` field. The files store it either as a JSON array or
 * as a Python list repr such as `['abc', 'def']`.
 */
export const parseRulerOutputs = (raw: unknown): string[] => {
  if (Array.isArray(raw)) return raw.map((item) => String(item));
  if (typeof raw !== 'string') return [];
  const trimmed = raw.trim();
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {
    // Not JSON: fall through to the Python-repr path.
  }
  const values: string[] = [];
  for (const match of trimmed.matchAll(/'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"/g)) {
    values.push(match[1] ?? match[2] ?? '');
  }
  // A bare value, as HELMET's key-value answers are stored, is one gold string.
  if (values.length === 0 && trimmed.length > 0) return [trimmed];
  return values;
};

export interface RulerRecord {
  index?: number | string;
  input?: string;
  outputs?: unknown;
  answer?: unknown;
  length?: number | string;
  type_needle_v?: string;
  query?: string;
  /** HELMET key-value records name the key here. */
  question?: string;
  context?: string;
}

/**
 * A RULER or HELMET recall record. The memory is the `context`. The question is built from the
 * `query` and needle type for needle-in-a-haystack tasks, and from `query` for key-value tasks.
 * Grading is the fraction of gold strings the response contains.
 */
export const fromRulerRecord = (
  record: RulerRecord,
  benchmark: string,
  task: string,
  chunkChars: number = DEFAULT_CHUNK_CHARS
): NormalizedSample => {
  const context = record.context ?? record.input ?? '';
  const golds = parseRulerOutputs(record.outputs ?? record.answer);
  const key = record.query ?? record.question ?? '';
  const sampleId = `${benchmark}:${task}:${String(record.index ?? key ?? 'x')}`;
  const questionText = task.startsWith('niah')
    ? `What is the special magic ${record.type_needle_v ?? 'value'} for ${key} mentioned in the provided text?`
    : `What is the value associated with the key "${key}"?`;
  const question: NormalizedQuestion = {
    question_id: sampleId,
    question_type: task,
    question: questionText,
    gold_answer: golds.join(' | '),
    evidence_session_ids: [],
    scoring: { kind: 'contains_fraction', golds },
  };
  return {
    sample_id: sampleId,
    sessions: documentSessions(sampleId, context, chunkChars),
    questions: [question],
  };
};
