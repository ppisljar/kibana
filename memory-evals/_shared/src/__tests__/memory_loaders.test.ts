import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  loadInfiniteBench,
  loadLongBenchV2,
  loadLongMemEvalV2,
  loadRulerJsonl,
  taskFromPath,
} from '../memory/loaders.js';

let root: string;

const question = (id: string, domain: string, image: string | null, evalFn: string) => ({
  id,
  domain,
  environment: 'workarena',
  question_type: 'static-environment',
  question: `Question ${id}?`,
  image,
  answer: 'Reports;Problems',
  eval_function: evalFn,
});

const trajectory = (id: string) => ({
  id,
  domain: 'enterprise',
  environment: 'workarena',
  goal: `Goal ${id}`,
  outcome: 'success',
  start_url: 'https://example.test',
  states: [
    { state_index: 0, url: 'https://example.test', action: null, thought: null, accessibility_tree: 'root' },
    { state_index: 1, url: 'https://example.test/2', action: "click('1')", thought: 'go', accessibility_tree: 'tree' },
  ],
});

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'memory-eval-loaders-'));
  const lme = join(root, 'lme');
  await mkdir(join(lme, 'haystacks'), { recursive: true });
  await writeFile(
    join(lme, 'questions.jsonl'),
    [
      question('q1', 'enterprise', null, 'norm_phrase_set_match_ordered|separators=;'),
      question('q2', 'enterprise', null, 'mc_choice_match|require_non_empty=true'),
      question('q3', 'web', 'question_screenshots/x.png', 'mc_choice_match|require_non_empty=true'),
    ]
      .map((q) => JSON.stringify(q))
      .join('\n') + '\n'
  );
  await writeFile(
    join(lme, 'haystacks', 'lme_v2_small.json'),
    JSON.stringify({ q1: ['t-1', 't-2'], q2: ['t-1', 't-2'], q3: ['t-2'] })
  );
  await writeFile(
    join(lme, 'trajectories.jsonl'),
    [trajectory('t-0'), trajectory('t-1'), trajectory('t-2')].map((t) => JSON.stringify(t)).join('\n') + '\n'
  );

  await writeFile(
    join(root, 'longbench.json'),
    JSON.stringify([
      {
        _id: 'lb-1',
        domain: 'QA',
        question: 'Q?',
        choice_A: 'a',
        choice_B: 'b',
        choice_C: 'c',
        choice_D: 'd',
        answer: 'A',
        context: 'Some context.',
      },
    ])
  );

  await mkdir(join(root, 'infinitebench'), { recursive: true });
  await writeFile(
    join(root, 'infinitebench', 'passkey.jsonl'),
    [0, 1].map((id) =>
      JSON.stringify({ id, context: `The pass key is ${70000 + id}.`, input: 'What is the pass key?', answer: [`${70000 + id}`], options: [] })
    ).join('\n') + '\n'
  );

  await mkdir(join(root, 'helmet', 'niah_multikey_3'), { recursive: true });
  await writeFile(
    join(root, 'helmet', 'niah_multikey_3', 'validation_8192.jsonl'),
    [0, 1].map((index) =>
      JSON.stringify({ index, query: `k-${index}`, type_needle_v: 'uuid', outputs: "['v']", context: `needle for k-${index} is v` })
    ).join('\n') + '\n'
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('loadLongMemEvalV2', () => {
  it('groups questions by haystack, skips image questions, and keeps haystack order', async () => {
    const { samples, skippedImageQuestions } = await loadLongMemEvalV2({
      dir: join(root, 'lme'),
      split: 'small',
      maxStateChars: 100,
    });
    expect(skippedImageQuestions).toBe(1);
    expect(samples.map((s) => s.sample_id)).toEqual(['lme-v2-group:q1+1']);
    expect(samples[0]?.sessions.map((s) => s.session_id)).toEqual(['t-1', 't-2']);
    expect(samples[0]?.questions.map((q) => q.question_id)).toEqual(['q1', 'q2']);
  });

  it('applies the question limit before grouping', async () => {
    const { samples } = await loadLongMemEvalV2({ dir: join(root, 'lme'), split: 'small', maxStateChars: 100, limit: 1 });
    expect(samples.flatMap((s) => s.questions.map((q) => q.question_id))).toEqual(['q1']);
  });

  it('fails loudly when a haystack trajectory is missing', async () => {
    await writeFile(join(root, 'lme', 'haystacks', 'lme_v2_medium.json'), JSON.stringify({ q1: ['t-404'], q2: ['t-404'], q3: ['t-404'] }));
    await expect(
      loadLongMemEvalV2({ dir: join(root, 'lme'), split: 'medium', maxStateChars: 100 })
    ).rejects.toThrow(/t-404/);
  });
});

describe('other loaders', () => {
  it('loads LongBench v2 from its JSON array', async () => {
    const samples = await loadLongBenchV2(join(root, 'longbench.json'));
    expect(samples.map((s) => s.sample_id)).toEqual(['lb-1']);
  });

  it('streams an InfiniteBench file and honours the limit', async () => {
    const samples = await loadInfiniteBench(join(root, 'infinitebench', 'passkey.jsonl'), { limit: 1 });
    expect(samples.map((s) => s.sample_id)).toEqual(['passkey:0']);
    expect(samples[0]?.questions[0]?.scoring).toEqual({ kind: 'contains_any', golds: ['70000'] });
  });

  it('loads a RULER or HELMET file with the task taken from its directory', async () => {
    const samples = await loadRulerJsonl(join(root, 'helmet', 'niah_multikey_3', 'validation_8192.jsonl'), 'helmet');
    expect(samples.map((s) => s.sample_id)).toEqual(['helmet:niah_multikey_3:0', 'helmet:niah_multikey_3:1']);
  });

  it('derives the task name from a path', () => {
    expect(taskFromPath('/data/ruler/niah_multikey_3/validation_8192.jsonl')).toBe('niah_multikey_3');
    expect(taskFromPath('/data/infinitebench/passkey.jsonl')).toBe('passkey');
    expect(taskFromPath('/data/helmet/json_kv/test_k50_dep6.jsonl')).toBe('json_kv');
  });
});
