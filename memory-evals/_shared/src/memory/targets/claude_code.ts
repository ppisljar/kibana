import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { KibanaClient } from '../../kibana_client.js';
import { questionText } from '../answerer.js';
import { ceDeleteKis, ceTriggerDreaming, ceWriteMemories, ceWriteTranscripts, type CeScope } from '../ce.js';
import {
  type IngestMode,
  type IngestReceipt,
  type MemoryTarget,
  type NormalizedQuestion,
  type NormalizedSample,
  type TargetAnswer,
} from '../types.js';

/** Agent Builder MCP endpoint. Exposes the Context Engine tools alongside the agent tools. */
export const AGENT_BUILDER_MCP_PATH = '/api/agent_builder/mcp';
const MCP_SERVER_NAME = 'kibana';

export interface ClaudeCodeTargetOptions {
  client: KibanaClient;
  kbnUrl: string;
  /** Full `Authorization` header value for the MCP connection, e.g. `ApiKey <key>`. */
  authorization: string;
  aiIndexId: string;
  spaceId: string;
  runId: string;
  claudeBin?: string;
  model?: string;
  timeoutMs?: number;
}

export interface ClaudeStreamResult {
  /** Every parsed stream-json event, kept as the trace for retrieval scoring. */
  events: unknown[];
  answer: string;
  isError: boolean;
  errorText?: string;
}

/**
 * Parses `claude -p --output-format stream-json`: one JSON object per line.
 * The answer comes from the final `result` event.
 */
export const parseClaudeStream = (stdout: string): ClaudeStreamResult => {
  const events: unknown[] = [];
  let answer = '';
  let isError = false;
  let errorText: string | undefined;
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      continue;
    }
    events.push(event);
    const e = event as { type?: string; result?: unknown; is_error?: boolean; subtype?: string };
    if (e.type === 'result') {
      answer = typeof e.result === 'string' ? e.result : '';
      isError = e.is_error === true;
      if (isError) errorText = `${e.subtype ?? 'error'}: ${answer}`;
    }
  }
  return { events, answer, isError, ...(errorText !== undefined ? { errorText } : {}) };
};

/**
 * Claude Code as the system under test (third-party use). Runs headless with
 * only the Agent Builder MCP server, built-in tools disabled, and the user's
 * settings, CLAUDE.md, and auto-memory skipped (`--bare`), so the score
 * reflects Context Engine memory alone.
 */
export class ClaudeCodeTarget implements MemoryTarget {
  readonly name = 'claude_code' as const;
  readonly ingestModes: readonly IngestMode[] = ['ce_memory', 'ce_transcript'];

  constructor(private readonly opts: ClaudeCodeTargetOptions) {}

  private scope(): CeScope {
    const { client, aiIndexId, spaceId, runId } = this.opts;
    return { client, aiIndexId, spaceId, runId };
  }

  async ingest(sample: NormalizedSample, mode: IngestMode): Promise<IngestReceipt> {
    if (mode === 'ce_memory') return ceWriteMemories(this.scope(), sample);
    if (mode === 'ce_transcript') return ceWriteTranscripts(this.scope(), sample);
    throw new Error(`ingest mode ${mode} is not supported by the claude_code target`);
  }

  async dream(_receipt: IngestReceipt): Promise<void> {
    await ceTriggerDreaming(this.scope());
  }

  async ask(question: NormalizedQuestion, _receipt: IngestReceipt): Promise<TargetAnswer> {
    const dir = await mkdtemp(join(tmpdir(), 'memory-eval-claude-'));
    try {
      const mcpConfig = join(dir, 'mcp.json');
      await writeFile(mcpConfig, JSON.stringify(this.mcpConfig()));
      const stdout = await this.run(dir, mcpConfig, question);
      const parsed = parseClaudeStream(stdout);
      if (parsed.isError) throw new Error(`claude -p failed: ${parsed.errorText ?? 'unknown error'}`);
      return { predicted_answer: parsed.answer, raw: parsed.events };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  async cleanup(receipt: IngestReceipt): Promise<void> {
    await ceDeleteKis(this.scope(), receipt.handles);
  }

  private mcpConfig(): unknown {
    return {
      mcpServers: {
        [MCP_SERVER_NAME]: {
          type: 'http',
          url: `${this.opts.kbnUrl.replace(/\/$/, '')}${AGENT_BUILDER_MCP_PATH}`,
          headers: { Authorization: this.opts.authorization },
        },
      },
    };
  }

  private run(cwd: string, mcpConfig: string, question: NormalizedQuestion): Promise<string> {
    const args = [
      '-p',
      `Answer the question using only what your memory tools return. Question: ${questionText(question)}`,
      '--output-format',
      'stream-json',
      '--verbose',
      '--bare',
      '--tools',
      '',
      '--mcp-config',
      mcpConfig,
      '--strict-mcp-config',
      '--allowedTools',
      `mcp__${MCP_SERVER_NAME}__*`,
    ];
    if (this.opts.model) args.push('--model', this.opts.model);

    const timeoutMs = this.opts.timeoutMs ?? 300_000;
    return new Promise((resolve, reject) => {
      const child = spawn(this.opts.claudeBin ?? 'claude', args, {
        cwd,
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || stdout.includes('"type":"result"')) resolve(stdout);
        else reject(new Error(`claude exited with ${code}: ${stderr.slice(0, 500)}`));
      });
    });
  }
}
