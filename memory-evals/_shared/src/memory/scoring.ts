import type { QuestionScoring } from './types.js';

export interface DeterministicScore {
  score: number;
  reason: string;
}

const LETTER_PREFIX = /^\(?([A-H])\)?(?:[.):\s]|$)/;
const LETTER_IN_TEXT = /\b(?:answer|option|choice)\s*(?:is|:)?\s*\(?([A-H])\)?\b/i;
const CAPITAL_LETTER = /\b([A-H])\b/g;

/** The option letter a response commits to, or undefined when none is clear. */
export const extractLetter = (predicted: string): string | undefined => {
  const trimmed = predicted.trim();
  const leading = LETTER_PREFIX.exec(trimmed);
  if (leading?.[1]) return leading[1];
  const inText = LETTER_IN_TEXT.exec(trimmed);
  return inText?.[1]?.toUpperCase();
};

/** Capital option letters in a response, unique and sorted, for multi-select questions. */
export const extractLetterSet = (predicted: string): string[] => {
  const found = new Set<string>();
  for (const match of predicted.matchAll(CAPITAL_LETTER)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found].sort();
};

const normalizePhrase = (text: string): string =>
  text
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Each gold phrase must appear in the normalized response. With `ordered`, the phrases must also
 * appear in the gold order. Free-text answers pass when they name every phrase.
 */
const scorePhraseSet = (phrases: string[], ordered: boolean, predicted: string): DeterministicScore => {
  const text = normalizePhrase(predicted);
  const positions = phrases.map((phrase) => text.indexOf(normalizePhrase(phrase)));
  const missing = phrases.filter((_, i) => positions[i] === -1);
  if (missing.length > 0) {
    return { score: 0, reason: `missing phrases: ${missing.join(', ')}` };
  }
  if (ordered && positions.some((pos, i) => i > 0 && pos < (positions[i - 1] ?? 0))) {
    return { score: 0, reason: 'phrases out of order' };
  }
  return { score: 1, reason: 'all phrases present' };
};

/**
 * Grades a question without the LLM judge. Returns null for `judge` and `rubric`, which the
 * pipeline sends to the judge. Assumptions are documented in memory-evals/README.md.
 */
export const scoreDeterministic = (
  scoring: QuestionScoring | undefined,
  predicted: string
): DeterministicScore | null => {
  if (scoring === undefined || scoring.kind === 'judge' || scoring.kind === 'rubric') return null;

  switch (scoring.kind) {
    case 'contains_any': {
      const text = predicted.toLowerCase();
      const hit = scoring.golds.find((gold) => text.includes(gold.toLowerCase()));
      return hit !== undefined
        ? { score: 1, reason: `contains "${hit}"` }
        : { score: 0, reason: 'no gold string found' };
    }
    case 'contains_fraction': {
      const text = predicted.toLowerCase();
      const found = scoring.golds.filter((gold) => text.includes(gold.toLowerCase())).length;
      const total = scoring.golds.length;
      return {
        score: total === 0 ? 0 : found / total,
        reason: `${found}/${total} gold strings found`,
      };
    }
    case 'letter': {
      const got = extractLetter(predicted);
      return {
        score: got === scoring.letter ? 1 : 0,
        reason: `chose ${got ?? 'no option'}, expected ${scoring.letter}`,
      };
    }
    case 'letter_set': {
      const got = extractLetterSet(predicted);
      const want = [...scoring.letters].sort();
      const same = got.length === want.length && got.every((letter, i) => letter === want[i]);
      return { score: same ? 1 : 0, reason: `chose [${got.join(',')}], expected [${want.join(',')}]` };
    }
    case 'phrase_set':
      return scorePhraseSet(scoring.phrases, scoring.ordered, predicted);
  }
};
