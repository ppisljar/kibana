import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { KibanaClient } from '../kibana_client.js';
import type { Judge } from '../judge.js';
import { fromLongMemEval } from '../memory/normalize.js';
import { dreamingWorkflowIdFor } from '../memory/ce.js';
import { runSample, type PhaseResult } from '../memory/pipeline.js';
import { AgentBuilderTarget } from '../memory/targets/agent_builder.js';
import { ContextEngineTarget } from '../memory/targets/context_engine.js';
import type { Answerer } from '../memory/answerer.js';
import type { LongMemEvalItem } from '../types.js';

/**
 * End-to-end wiring against a stub Kibana: checks the request shapes the harness sends and that
 * retrieved memories map back to the session they came from.
 */

interface Recorded {
  method: string;
  path: string;
  body: unknown;
}

const memories = new Map<string, { content: string; references: Array<{ uri: string }> }>();
const transcripts = new Map<string, string>();
let recorded: Recorded[] = [];
let server: Server;
let baseUrl: string;

const json = (res: ServerResponse, status: number, body: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : undefined));
  });

const WORKFLOW_ID = dreamingWorkflowIdFor('idx', 'default');
let nextId = 0;

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;
    const body = await readBody(req);
    recorded.push({ method: req.method ?? 'GET', path, body });
    const version = req.headers['elastic-api-version'];
    if (path.startsWith('/internal/context_engine') && version !== '1') {
      return json(res, 400, { message: 'internal Context Engine route needs elastic-api-version 1' });
    }
    if (path.startsWith('/api/context_engine') && version !== '2023-10-31') {
      return json(res, 400, { message: 'public Context Engine route needs its date version' });
    }

    if (req.method === 'POST' && path === '/internal/context_engine/ai_index/idx/memories/_bulk') {
      const { memories: items } = body as { memories: Array<Record<string, any>> };
      const ids = items.map((m) => {
        const id = `ki-${++nextId}`;
        memories.set(id, { content: m.content, references: m.references ?? [] });
        return id;
      });
      return json(res, 200, { ids });
    }
    if (req.method === 'POST' && path === `/api/workflows/workflow/${WORKFLOW_ID}/run`) {
      return json(res, 200, { workflowExecutionId: 'exec-1' });
    }
    if (req.method === 'GET' && path === '/api/workflows/executions/exec-1') {
      return json(res, 200, { status: 'completed' });
    }
    if (req.method === 'POST' && path === '/api/context_engine/ai_index/_query') {
      const query = (body as { query: string }).query;
      const question = /"([^"]+)"/.exec(query)?.[1] ?? '';
      const words = question.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
      const rows = [...memories.values()]
        .filter((m) => words.some((w) => m.content.toLowerCase().includes(w)))
        .map((m) => [m.content, m.references.map((r) => r.uri)]);
      return json(res, 200, {
        columns: [{ name: 'content' }, { name: 'references.uri' }],
        values: rows,
      });
    }
    if (req.method === 'PUT' && path.startsWith('/internal/context_engine/transcripts/')) {
      const sessionId = decodeURIComponent(path.split('/').pop()!);
      const { turns } = body as { turns: Array<{ role: string; content: string }> };
      transcripts.set(sessionId, turns.map((t) => `${t.role}: ${t.content}`).join('\n'));
      return json(res, 201, { session_id: sessionId, result: 'created', turn_count: turns.length, chunk_count: 1 });
    }
    if (req.method === 'POST' && path === '/internal/context_engine/transcripts/_bulk_delete') {
      const { session_ids: ids } = body as { session_ids: string[] };
      ids.forEach((id) => transcripts.delete(id));
      return json(res, 200, { deleted: ids.length });
    }
    if (req.method === 'POST' && path === '/internal/context_engine/_recall') {
      const { query, sources, filters } = body as {
        query: string;
        sources: string[];
        filters?: { session_ids?: string[] };
      };
      const words = query.toLowerCase().split(/\s+/).filter((w) => w.length >= 4);
      const matches = (content: string) => words.some((w) => content.toLowerCase().includes(w));
      const results = sources.includes('transcripts')
        ? [...transcripts.entries()]
            .filter(([id, content]) => (filters?.session_ids ?? [id]).includes(id) && matches(content))
            .map(([id, content]) => ({ source: 'transcript', id: `${id}#0`, score: 1, content, session_id: id }))
        : [...memories.entries()]
            .filter(([, m]) => matches(m.content))
            .map(([id, m]) => ({ source: 'ai_index', id, score: 1, content: m.content, references: m.references }));
      return json(res, 200, { results, reranked: true, sources: [], truncated: false });
    }
    if (req.method === 'DELETE' && path.startsWith('/internal/context_engine/ai_index/idx/kis/')) {
      memories.delete(decodeURIComponent(path.split('/').pop()!));
      return json(res, 200, {});
    }
    if (req.method === 'POST' && path === '/api/agent_builder/converse') {
      return json(res, 200, {
        conversation_id: 'conv-ask-1',
        round_id: 'r1',
        response: { message: 'Ljubljana' },
        steps: [],
      });
    }
    if (req.method === 'POST' && path === '/internal/agent_builder/conversations/_import') {
      return json(res, 200, {
        conversation_id: (body as { id: string }).id,
        round_count: 1,
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      });
    }
    if (req.method === 'POST' && path === '/internal/agent_builder/conversations/_bulk_delete') {
      const ids = (body as { conversation_ids?: string[] }).conversation_ids ?? [];
      return json(res, 200, { deleted: ids.length, matched: ids.length, not_found: [] });
    }
    return json(res, 404, { message: `unexpected ${req.method} ${path}` });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  memories.clear();
  transcripts.clear();
  recorded = [];
  nextId = 0;
});

const client = () => new KibanaClient({ url: baseUrl, apiKey: 'test', basePath: '', retryBaseMs: 1 });

const item: LongMemEvalItem = {
  question_id: 'q-live',
  question_type: 'single-session-user',
  question: 'Where did I move recently?',
  question_date: '2024/05/01 (Wed) 10:00',
  answer: 'Ljubljana',
  answer_session_ids: ['s2'],
  haystack_dates: ['2024/04/01 (Mon) 09:00', '2024/04/02 (Tue) 09:00'],
  haystack_session_ids: ['s1', 's2'],
  haystack_sessions: [
    [
      { role: 'user', content: 'I like hiking' },
      { role: 'assistant', content: 'Nice' },
    ],
    [
      { role: 'user', content: 'I moved to Ljubljana last week' },
      { role: 'assistant', content: 'Congratulations' },
    ],
  ],
};

const judge: Judge = {
  name: 'stub',
  score: vi.fn(async (req) => ({ score: req.predicted_answer === req.gold_answer ? 1 : 0 })),
};

const answerer: Answerer = {
  name: 'stub',
  answer: vi.fn(async ({ memories: m }: { memories: string[] }) =>
    m.some((x) => x.includes('Ljubljana')) ? 'Ljubljana' : 'unknown'
  ),
};

describe('context_engine target against a stub Kibana', () => {
  it('ingests memories, dreams, retrieves evidence, and cleans up', async () => {
    const target = new ContextEngineTarget({
      client: client(),
      aiIndexId: 'idx',
      spaceId: 'default',
      runId: 'run-1',
      answerer,
      retrievalQuery: 'FROM ai-index-idx | WHERE content:"{question}" | LIMIT 10',
    });

    const rows: PhaseResult[] = await runSample(fromLongMemEval(item), {
      target,
      judge,
      ingestMode: 'ce_memory',
      dream: 'pre_post',
      teardown: true,
    });

    expect(rows.map((r) => r.phase)).toEqual(['pre_dream', 'post_dream']);
    for (const row of rows) {
      expect(row.error).toBeUndefined();
      expect(row.predicted_answer).toBe('Ljubljana');
      expect(row.judge_score).toBe(1);
      expect(row.retrieved_session_ids).toEqual(['s2']);
      expect(row.recall).toBe(1);
      expect(row.hit).toBe(true);
    }

    const bulk = recorded.find((r) => r.path.endsWith('/memories/_bulk'))!;
    const memoriesSent = (bulk.body as { memories: Array<Record<string, any>> }).memories;
    expect(memoriesSent).toHaveLength(2);
    expect(memoriesSent[1]).toMatchObject({
      type: 'memory.session',
      references: [{ uri: 'eval-session://s2', relation: 'source' }],
    });
    expect(memoriesSent[1]!.content).toContain('[eval-session://s2]');
    expect(recorded.filter((r) => r.method === 'DELETE')).toHaveLength(2);
    expect(memories.size).toBe(0);
  });

  it('ingests transcripts, recalls from the sample sessions only, and deletes them', async () => {
    const target = new ContextEngineTarget({
      client: client(),
      aiIndexId: 'idx',
      spaceId: 'default',
      runId: 'run-t',
      answerer,
    });

    const rows = await runSample(fromLongMemEval(item), {
      target,
      judge,
      ingestMode: 'ce_transcript',
      dream: 'none',
      teardown: true,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toBeUndefined();
    expect(rows[0]!.predicted_answer).toBe('Ljubljana');
    expect(rows[0]!.retrieved_session_ids).toEqual(['s2']);
    expect(rows[0]!.hit).toBe(true);

    const puts = recorded.filter((r) => r.method === 'PUT');
    expect(puts.map((r) => r.path)).toEqual([
      '/internal/context_engine/transcripts/run-t.q-live.s1',
      '/internal/context_engine/transcripts/run-t.q-live.s2',
    ]);
    expect(puts[0]!.body).toMatchObject({
      source: 'memory-evals',
      source_ref: 'eval-session://s1',
      ai_index_id: 'idx',
      refresh: false,
      started_at: '2024-04-01T09:00:00.000Z',
      attributes: { 'eval.session_id': 's1', 'eval.started_at': '2024-04-01T09:00:00.000Z' },
    });
    expect(puts[1]!.body).toMatchObject({ refresh: true });

    const recall = recorded.find((r) => r.path === '/internal/context_engine/_recall')!;
    expect(recall.body).toMatchObject({
      query: item.question,
      sources: ['transcripts'],
      filters: { session_ids: ['run-t.q-live.s1', 'run-t.q-live.s2'] },
      rerank: { enabled: true },
    });
    expect(transcripts.size).toBe(0);
  });

  it('recalls memories from the AI index when no ES|QL query is configured', async () => {
    const target = new ContextEngineTarget({
      client: client(),
      aiIndexId: 'idx',
      spaceId: 'default',
      runId: 'run-r',
      answerer,
      recall: { limit: 5, rerank: false },
    });

    const rows = await runSample(fromLongMemEval(item), {
      target,
      judge,
      ingestMode: 'ce_memory',
      dream: 'none',
      teardown: true,
    });

    expect(rows[0]!.predicted_answer).toBe('Ljubljana');
    expect(rows[0]!.retrieved_session_ids).toEqual(['s2']);
    const recall = recorded.find((r) => r.path === '/internal/context_engine/_recall')!;
    expect(recall.body).toMatchObject({
      sources: ['ai_indices'],
      ai_index_ids: ['idx'],
      limit: 5,
      rerank: { enabled: false },
    });
  });

  it('stops before asking when dreaming reports a failed run', async () => {
    const target = new ContextEngineTarget({
      client: client(),
      aiIndexId: 'idx',
      spaceId: 'default',
      runId: 'run-2',
      answerer,
      retrievalQuery: 'FROM ai-index-idx | WHERE content:"{question}"',
    });
    vi.spyOn(target, 'dream').mockRejectedValueOnce(new Error('dreaming run failed'));
    const rows = await runSample(fromLongMemEval(item), {
      target,
      judge,
      ingestMode: 'ce_memory',
      dream: 'pre_post',
      teardown: true,
    });
    const post = rows.filter((r) => r.phase === 'post_dream');
    expect(post).toHaveLength(1);
    expect(post[0]!.error).toBe('dreaming run failed');
  });
});

describe('agent_builder target against a stub Kibana', () => {
  it('imports the sample, asks in a fresh conversation, and deletes what it created', async () => {
    const target = new AgentBuilderTarget({
      client: client(),
      agentId: 'default',
      aiIndexId: 'idx',
      spaceId: 'default',
      runId: 'run-3',
    });
    const rows = await runSample(fromLongMemEval(item), {
      target,
      judge,
      ingestMode: 'ab_import',
      dream: 'none',
      teardown: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.error).toBeUndefined();
    expect(rows[0]!.judge_score).toBe(1);

    const imports = recorded.filter((r) => r.path.endsWith('conversations/_import'));
    expect(imports).toHaveLength(2);
    expect((imports[1]!.body as { rounds: unknown[] }).rounds).toHaveLength(1);

    const deletes = recorded.filter((r) => r.path.endsWith('conversations/_bulk_delete'));
    const deleted = deletes.flatMap((d) => (d.body as { conversation_ids: string[] }).conversation_ids);
    expect(deleted).toContain('conv-ask-1');
    expect(deleted).toHaveLength(3);
  });
});
