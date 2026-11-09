import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { join } from 'node:path';

import {
  fromInfiniteBench,
  fromLongBenchV2,
  fromRulerRecord,
  type InfiniteBenchRecord,
  type LongBenchV2Record,
  type RulerRecord,
} from './normalize_longctx.js';
import {
  fromLmeV2Group,
  groupByHaystack,
  type LmeV2Question,
  type LmeV2Trajectory,
} from './normalize_lme_v2.js';
import type { NormalizedSample } from './types.js';

export interface LoadOptions {
  /** Stop after this many samples or questions. Undefined loads everything. */
  limit?: number;
  /** Chunk size for document sessions. */
  chunkChars?: number;
}

/** Calls `onLine` for each non-empty line of a JSONL file. Returning false stops the read. */
export const streamJsonlLines = async (
  path: string,
  onLine: (line: string, lineNo: number) => boolean | void
): Promise<void> => {
  const reader = createInterface({ input: createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity });
  let lineNo = 0;
  try {
    for await (const line of reader) {
      lineNo += 1;
      if (line.trim().length === 0) continue;
      if (onLine(line, lineNo) === false) break;
    }
  } finally {
    reader.close();
  }
};

const parseLine = <T>(line: string, path: string, lineNo: number): T => {
  try {
    return JSON.parse(line) as T;
  } catch (e) {
    throw new Error(`Invalid JSON at ${path}:${lineNo}: ${(e as Error).message}`);
  }
};

/** LongBench v2 ships as one JSON array, `data.json`. */
export const loadLongBenchV2 = async (path: string, opts: LoadOptions = {}): Promise<NormalizedSample[]> => {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`LongBench v2 dataset at ${path} is not an array.`);
  const records = opts.limit !== undefined ? parsed.slice(0, opts.limit) : parsed;
  return (records as LongBenchV2Record[]).map((r) => fromLongBenchV2(r, opts.chunkChars));
};

/** An InfiniteBench task file, one JSON object per line. `task` is the file name without extension. */
export const loadInfiniteBench = async (path: string, opts: LoadOptions = {}): Promise<NormalizedSample[]> => {
  const task = taskFromPath(path);
  const samples: NormalizedSample[] = [];
  await streamJsonlLines(path, (line, lineNo) => {
    samples.push(fromInfiniteBench(parseLine<InfiniteBenchRecord>(line, path, lineNo), task, opts.chunkChars));
    return opts.limit === undefined || samples.length < opts.limit;
  });
  return samples;
};

/** A RULER or HELMET recall file. `benchmark` labels the samples; the task comes from the directory name. */
export const loadRulerJsonl = async (
  path: string,
  benchmark: 'ruler' | 'helmet',
  opts: LoadOptions = {}
): Promise<NormalizedSample[]> => {
  const task = taskFromPath(path);
  const samples: NormalizedSample[] = [];
  await streamJsonlLines(path, (line, lineNo) => {
    samples.push(fromRulerRecord(parseLine<RulerRecord>(line, path, lineNo), benchmark, task, opts.chunkChars));
    return opts.limit === undefined || samples.length < opts.limit;
  });
  return samples;
};

/**
 * The task a file belongs to. `…/niah_multikey_3/validation_8192.jsonl` and
 * `…/json_kv/test_k50_dep6.jsonl` take the directory name. `…/passkey.jsonl` takes the file name.
 */
export const taskFromPath = (path: string): string => {
  const parts = path.split(/[\\/]/).filter(Boolean);
  const file = parts[parts.length - 1] ?? '';
  const base = file.replace(/\.jsonl?$/, '');
  if (/^(validation|test)_/.test(base)) return parts[parts.length - 2] ?? base;
  return base;
};

export interface LmeV2Options extends LoadOptions {
  /** Directory with questions.jsonl, haystacks/, and trajectories.jsonl. */
  dir: string;
  split: 'small' | 'medium';
  /** Per-state accessibility tree cap, in characters. */
  maxStateChars: number;
  domain?: 'web' | 'enterprise';
  questionIds?: string[];
}

const TRAJECTORY_ID = /^\s*\{\s*"id"\s*:\s*"([^"]+)"/;

/**
 * LongMemEval-V2. Questions that share a haystack become one sample, so one ingest answers them
 * all. Questions with an image are skipped because the harness sends text only.
 */
export const loadLongMemEvalV2 = async (
  opts: LmeV2Options
): Promise<{ samples: NormalizedSample[]; skippedImageQuestions: number }> => {
  const questionsAll = (await readFile(join(opts.dir, 'questions.jsonl'), 'utf8'))
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l) as LmeV2Question);
  const haystacks = JSON.parse(
    await readFile(join(opts.dir, 'haystacks', `lme_v2_${opts.split}.json`), 'utf8')
  ) as Record<string, string[]>;

  const textOnly = questionsAll.filter((q) => q.image === null);
  const skippedImageQuestions = questionsAll.length - textOnly.length;
  let questions = textOnly.filter(
    (q) => (opts.domain === undefined || q.domain === opts.domain) && (!opts.questionIds || opts.questionIds.includes(q.id))
  );
  if (opts.limit !== undefined) questions = questions.slice(0, opts.limit);

  const groups = groupByHaystack(questions, haystacks);
  const needed = new Set(groups.flatMap((g) => g.haystack));
  const byId = new Map<string, LmeV2Trajectory>();
  await streamJsonlLines(join(opts.dir, 'trajectories.jsonl'), (line, lineNo) => {
    const id = TRAJECTORY_ID.exec(line)?.[1];
    if (id === undefined || !needed.has(id)) return true;
    byId.set(id, parseLine<LmeV2Trajectory>(line, 'trajectories.jsonl', lineNo));
    return byId.size < needed.size;
  });

  const samples = groups.map((group) => {
    const trajectories = group.haystack.map((id) => {
      const trajectory = byId.get(id);
      if (!trajectory) throw new Error(`LongMemEval-V2 trajectory ${id} is missing from trajectories.jsonl.`);
      return trajectory;
    });
    return fromLmeV2Group(group.questions, trajectories, opts.maxStateChars);
  });
  return { samples, skippedImageQuestions };
};
