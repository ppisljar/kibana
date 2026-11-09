import type { SessionIndex } from './types.js';

/** Targets can tag what they write with this reference so retrieval maps back to a session. */
export const EVAL_SESSION_URI = 'eval-session://';

export const evalSessionRef = (sessionId: string): string => `${EVAL_SESSION_URI}${sessionId}`;

const TOKEN = /[A-Za-z0-9_:\-/.]+/g;

const collectStrings = (value: unknown, out: string[]): void => {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
  } else if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, out);
  }
};

/**
 * Finds sessions referenced anywhere in a target's raw response, in first-seen
 * order. Matches either an ingested identifier (exact token) or an
 * `eval-session://` reference. Exact tokens avoid false positives from
 * substrings of longer ids.
 */
export const resolveSessionIds = (raw: unknown, index: SessionIndex): string[] => {
  const strings: string[] = [];
  collectStrings(raw, strings);

  const seen = new Set<string>();
  for (const text of strings) {
    for (const token of text.match(TOKEN) ?? []) {
      if (token.startsWith(EVAL_SESSION_URI)) {
        seen.add(token.slice(EVAL_SESSION_URI.length));
        continue;
      }
      const id = token.split(/[:/]/).pop() ?? token;
      const session = index.get(token) ?? index.get(id);
      if (session !== undefined) seen.add(session);
    }
  }
  return [...seen];
};
