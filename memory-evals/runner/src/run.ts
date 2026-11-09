#!/usr/bin/env tsx
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AgentBuilderTarget,
  buildClient,
  buildJudge,
  ClaudeCodeTarget,
  ContextEngineTarget,
  createAnthropicAnswerer,
  type Answerer,
  boolFlag,
  err,
  fromLongMemEval,
  fromLoCoMo,
  type IngestMode,
  loadLongBenchV2,
  loadLongMemEval,
  loadLongMemEvalV2,
  loadInfiniteBench,
  loadLoCoMo,
  loadRulerJsonl,
  DEFAULT_CHUNK_CHARS,
  type JudgeBenchmark,
  log,
  type MemoryTarget,
  type NormalizedSample,
  numberFlag,
  optionalString,
  type ParsedEnv,
  parseArgs,
  parseEnv,
  type PhaseResult,
  requireFlag,
  runSample,
  splitList,
  type TargetName,
  warn,
  PendingApiError,
  type DreamPhase,
} from '@memory-evals/shared';

import { summarize } from './summary.js';

const USAGE = `Usage:
  npm run runner -- --benchmark longmemeval|locomo|longmemeval_v2|longbench_v2|infinitebench|ruler|helmet
                     --dataset <file, or directory for longmemeval_v2>
                     --target agent_builder|context_engine|claude_code
                     [--ingest ce_memory|ce_transcript|ab_import]
                     [--dream none|pre_post]
                     [--questions N] [--question-ids a,b] [--question-types t1,t2]
                     [--sample-ids s1,s2] [--run-id name] [--results-dir dir]
                     [--split small|medium] [--domain web|enterprise] [--max-state-chars N]
                     [--chunk-chars N] [--no-teardown] [--dry-run]

Environment (see memory-evals/README.md):
  KBN_URL, KBN_API_KEY | KBN_USERNAME + KBN_PASSWORD, KBN_SPACE, KBN_AGENT_ID,
  KBN_CONNECTOR_ID, KBN_AI_INDEX_ID (required), KBN_CE_RETRIEVAL_QUERY,
  KBN_ANSWER_MODEL, KBN_CLAUDE_BIN, KBN_CLAUDE_MODEL, ANTHROPIC_API_KEY,
  KBN_JUDGE, KBN_JUDGE_MODEL`;

const TARGETS: TargetName[] = ['agent_builder', 'context_engine', 'claude_code'];
const INGEST_MODES: IngestMode[] = ['ce_memory', 'ce_transcript', 'ab_import'];
const BENCHMARKS = [
  'longmemeval',
  'locomo',
  'longmemeval_v2',
  'longbench_v2',
  'infinitebench',
  'ruler',
  'helmet',
] as const;
type Benchmark = (typeof BENCHMARKS)[number];

interface RunOptions {
  benchmark: Benchmark;
  datasetPath: string;
  /** LongMemEval-V2 haystack split. */
  split: 'small' | 'medium';
  domain?: 'web' | 'enterprise';
  /** LongMemEval-V2 per-state accessibility tree cap. */
  maxStateChars: number;
  chunkChars: number;
  target: TargetName;
  ingest: IngestMode;
  dream: DreamPhase;
  questionLimit?: number;
  questionIds?: string[];
  questionTypes?: string[];
  sampleIds?: string[];
  runId: string;
  resultsRoot: string;
  teardown: boolean;
  dryRun: boolean;
}

const defaultRunId = (): string =>
  `mem-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}`;

const oneOf = <T extends string>(name: string, value: string | undefined, allowed: readonly T[], def: T): T => {
  if (value === undefined) return def;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new Error(`--${name} must be one of: ${allowed.join(', ')}`);
};

const parseOpts = (argv: string[]): RunOptions => {
  const flags = parseArgs(argv, {
    booleanFlags: ['no-teardown', 'dry-run', 'help'],
    arrayFlags: ['question-ids', 'question-types', 'sample-ids'],
    flags: {
      'run-id': { default: defaultRunId() },
      split: { default: 'small' },
      'max-state-chars': { default: '2000' },
      'chunk-chars': { default: String(DEFAULT_CHUNK_CHARS) },
    },
  });
  if (flags.help) {
    log(USAGE);
    process.exit(0);
  }
  const list = (name: string): string[] | undefined => {
    const v = flags[name];
    if (Array.isArray(v)) return v as string[];
    return typeof v === 'string' ? splitList(v) : undefined;
  };
  const benchmark = oneOf('benchmark', requireFlag(flags, 'benchmark'), BENCHMARKS, 'longmemeval');
  const opts: RunOptions = {
    benchmark,
    datasetPath: requireFlag(flags, 'dataset'),
    split: oneOf('split', optionalString(flags, 'split'), ['small', 'medium'] as const, 'small'),
    maxStateChars: numberFlag(flags, 'max-state-chars', 2000) ?? 2000,
    chunkChars: numberFlag(flags, 'chunk-chars', DEFAULT_CHUNK_CHARS) ?? DEFAULT_CHUNK_CHARS,
    target: oneOf('target', requireFlag(flags, 'target'), TARGETS, 'agent_builder'),
    ingest: oneOf('ingest', optionalString(flags, 'ingest'), INGEST_MODES, 'ce_memory'),
    dream: oneOf('dream', optionalString(flags, 'dream'), ['none', 'pre_post'] as const, 'none'),
    runId: requireFlag(flags, 'run-id'),
    resultsRoot: optionalString(flags, 'results-dir') ?? join(fileURLToPath(new URL('.', import.meta.url)), '..', 'results'),
    teardown: !boolFlag(flags, 'no-teardown'),
    dryRun: boolFlag(flags, 'dry-run'),
  };
  const domain = optionalString(flags, 'domain');
  if (domain === 'web' || domain === 'enterprise') opts.domain = domain;
  const limit = numberFlag(flags, 'questions');
  if (limit !== undefined) opts.questionLimit = limit;
  const ids = list('question-ids');
  if (ids) opts.questionIds = ids;
  const types = list('question-types');
  if (types) opts.questionTypes = types;
  const samples = list('sample-ids');
  if (samples) opts.sampleIds = samples;
  return opts;
};

const envOrThrow = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var ${key}. See memory-evals/README.md.`);
  return v;
};

const authorizationHeader = (env: ParsedEnv): string => {
  if (env.apiKey) return `ApiKey ${env.apiKey}`;
  const basic = Buffer.from(`${env.username ?? ''}:${env.password ?? ''}`).toString('base64');
  return `Basic ${basic}`;
};

/** Benchmarks without their own prompt use the LongMemEval one; their judged questions are rare. */
const judgeBenchmarkFor = (benchmark: Benchmark): JudgeBenchmark => {
  if (benchmark === 'longmemeval_v2' || benchmark === 'infinitebench') return benchmark;
  if (benchmark === 'locomo') return 'locomo';
  return 'longmemeval';
};

const loadSamples = async (opts: RunOptions): Promise<NormalizedSample[]> => {
  let samples: NormalizedSample[];
  const loadOpts = { chunkChars: opts.chunkChars, ...(opts.questionLimit !== undefined ? { limit: opts.questionLimit } : {}) };
  if (opts.benchmark === 'longmemeval') {
    const items = await loadLongMemEval(opts.datasetPath);
    samples = items.map(fromLongMemEval);
  } else if (opts.benchmark === 'locomo') {
    const items = await loadLoCoMo(opts.datasetPath);
    samples = items.map(fromLoCoMo);
  } else if (opts.benchmark === 'longmemeval_v2') {
    const loaded = await loadLongMemEvalV2({
      ...loadOpts,
      dir: opts.datasetPath,
      split: opts.split,
      maxStateChars: opts.maxStateChars,
      ...(opts.domain ? { domain: opts.domain } : {}),
      ...(opts.questionIds ? { questionIds: opts.questionIds } : {}),
    });
    if (loaded.skippedImageQuestions > 0) {
      warn(`Skipped ${loaded.skippedImageQuestions} image question(s); the harness sends text only.`);
    }
    samples = loaded.samples;
  } else if (opts.benchmark === 'longbench_v2') {
    samples = await loadLongBenchV2(opts.datasetPath, loadOpts);
  } else if (opts.benchmark === 'infinitebench') {
    samples = await loadInfiniteBench(opts.datasetPath, loadOpts);
  } else {
    samples = await loadRulerJsonl(opts.datasetPath, opts.benchmark, loadOpts);
  }

  if (opts.sampleIds) samples = samples.filter((s) => opts.sampleIds!.includes(s.sample_id));
  samples = samples
    .map((s) => ({
      ...s,
      questions: s.questions.filter(
        (q) =>
          (!opts.questionIds || opts.questionIds.includes(q.question_id)) &&
          (!opts.questionTypes || opts.questionTypes.includes(q.question_type))
      ),
    }))
    .filter((s) => s.questions.length > 0);

  if (opts.questionLimit !== undefined) {
    let remaining = opts.questionLimit;
    const limited: NormalizedSample[] = [];
    for (const s of samples) {
      if (remaining <= 0) break;
      const questions = s.questions.slice(0, remaining);
      remaining -= questions.length;
      limited.push({ ...s, questions });
    }
    samples = limited;
  }
  return samples;
};

const buildTarget = (opts: RunOptions, env: ParsedEnv, answerer: Answerer | undefined): MemoryTarget => {
  const client = buildClient(env);
  const aiIndexId = envOrThrow('KBN_AI_INDEX_ID');
  if (opts.target === 'agent_builder') {
    const t: ConstructorParameters<typeof AgentBuilderTarget>[0] = {
      client,
      agentId: env.agentId,
      aiIndexId,
      spaceId: env.space,
      runId: opts.runId,
    };
    if (env.connectorId) t.connectorId = env.connectorId;
    return new AgentBuilderTarget(t);
  }
  if (opts.target === 'context_engine') {
    if (!answerer) throw new Error('context_engine target needs ANTHROPIC_API_KEY for the answerer');
    const t: ConstructorParameters<typeof ContextEngineTarget>[0] = {
      client,
      aiIndexId,
      spaceId: env.space,
      runId: opts.runId,
      answerer,
    };
    const query = process.env.KBN_CE_RETRIEVAL_QUERY;
    if (query) t.retrievalQuery = query;
    return new ContextEngineTarget(t);
  }
  const t: ConstructorParameters<typeof ClaudeCodeTarget>[0] = {
    client,
    kbnUrl: env.url,
    authorization: authorizationHeader(env),
    aiIndexId,
    spaceId: env.space,
    runId: opts.runId,
  };
  const bin = process.env.KBN_CLAUDE_BIN;
  if (bin) t.claudeBin = bin;
  const model = process.env.KBN_CLAUDE_MODEL;
  if (model) t.model = model;
  return new ClaudeCodeTarget(t);
};

async function main() {
  const opts = parseOpts(process.argv.slice(2));
  log(`Memory runner — benchmark=${opts.benchmark} target=${opts.target} ingest=${opts.ingest} dream=${opts.dream} run_id=${opts.runId}`);

  const samples = await loadSamples(opts);
  const questionCount = samples.reduce((n, s) => n + s.questions.length, 0);
  log(`Selected ${questionCount} question(s) across ${samples.length} sample(s).`);

  if (opts.dryRun) {
    const phases = opts.dream === 'pre_post' ? 2 : 1;
    log(`DRY RUN — would ask ${questionCount * phases} question(s). No Kibana or model calls made.`);
    return;
  }

  const env = parseEnv();
  const judge = buildJudge(env, judgeBenchmarkFor(opts.benchmark));
  const anthropicKey = env.anthropicKey;
  const answerer = anthropicKey
    ? createAnthropicAnswerer({ apiKey: anthropicKey, model: process.env.KBN_ANSWER_MODEL ?? 'claude-sonnet-5-5' })
    : undefined;
  const target = buildTarget(opts, env, answerer);
  log(`Judge: ${judge.name}`);

  const runDir = join(opts.resultsRoot, opts.runId);
  await mkdir(runDir, { recursive: true });
  const rowsPath = join(runDir, 'results.jsonl');
  await writeFile(rowsPath, '');

  const rows: PhaseResult[] = [];
  let index = 0;
  for (const sample of samples) {
    index += 1;
    log(`(${index}/${samples.length}) ${sample.sample_id} — ${sample.questions.length} question(s)`);
    let sampleRows: PhaseResult[];
    try {
      sampleRows = await runSample(sample, {
        target,
        judge,
        ingestMode: opts.ingest,
        dream: opts.dream,
        teardown: opts.teardown,
        warn,
      });
    } catch (e) {
      if (e instanceof PendingApiError) {
        err(`Stopped: ${e.message}`);
        err('This ingest or dreaming mode needs Kibana support that has not landed yet. No summary was written.');
        process.exit(2);
      }
      throw e;
    }
    for (const row of sampleRows) {
      rows.push(row);
      await appendFile(rowsPath, `${JSON.stringify(row)}\n`);
    }
  }

  const summary = summarize(rows);
  const summaryPath = join(runDir, 'summary.json');
  await writeFile(summaryPath, JSON.stringify({ run_id: opts.runId, benchmark: opts.benchmark, target: opts.target, ingest: opts.ingest, dream: opts.dream, ...summary }, null, 2));
  for (const p of summary.phases) {
    log(
      `${p.phase}: questions=${p.questions} scored=${p.scored} errors=${p.errors} accuracy=${p.accuracy?.toFixed(3) ?? 'n/a'} recall=${p.recall?.toFixed(3) ?? 'n/a'} hit_rate=${p.hit_rate?.toFixed(3) ?? 'n/a'}`
    );
  }
  if (summary.dreaming_delta) {
    const d = summary.dreaming_delta;
    log(`dreaming delta (post - pre, n=${d.questions}): accuracy=${d.accuracy?.toFixed(3) ?? 'n/a'} recall=${d.recall?.toFixed(3) ?? 'n/a'} hit_rate=${d.hit_rate?.toFixed(3) ?? 'n/a'}`);
  }
  log(`Wrote ${rowsPath} and ${summaryPath}`);
}

main().catch((e) => {
  err((e as Error).stack ?? String(e));
  process.exit(1);
});

