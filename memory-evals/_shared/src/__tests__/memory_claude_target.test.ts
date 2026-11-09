import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { KibanaClient } from '../kibana_client.js';
import { ClaudeCodeTarget } from '../memory/targets/claude_code.js';
import type { IngestReceipt, NormalizedQuestion } from '../memory/types.js';

const FAKE_CLAUDE = `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
const cfgIdx = args.indexOf('--mcp-config');
const mcp = cfgIdx >= 0 ? fs.readFileSync(args[cfgIdx + 1], 'utf8') : null;
const out = { args, mcp };
process.stdout.write(JSON.stringify({ type: 'system', subtype: 'init' }) + '\\n');
process.stdout.write(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(out) }) + '\\n');
`;

const question: NormalizedQuestion = {
  question_id: 'q1',
  question_type: 't',
  question: 'Where do I live?',
  gold_answer: 'Ljubljana',
  evidence_session_ids: [],
};

const receipt: IngestReceipt = {
  sample_id: 's',
  ingest_mode: 'ce_memory',
  session_index: new Map(),
  handles: [],
};

describe('ClaudeCodeTarget.ask', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'memory-eval-test-'));
    await writeFile(join(dir, 'claude'), FAKE_CLAUDE);
    await chmod(join(dir, 'claude'), 0o755);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('runs headless with only the Agent Builder MCP server and returns the answer', async () => {
    const target = new ClaudeCodeTarget({
      client: {} as KibanaClient,
      kbnUrl: 'http://localhost:5601/',
      authorization: 'ApiKey abc',
      aiIndexId: 'idx',
      runId: 'run',
      claudeBin: join(dir, 'claude'),
    });

    const answer = await target.ask(question, receipt);
    const out = JSON.parse(answer.predicted_answer) as { args: string[]; mcp: string };

    expect(out.args).toEqual(expect.arrayContaining(['-p', '--bare', '--strict-mcp-config', '--output-format']));
    const toolsIdx = out.args.indexOf('--tools');
    expect(out.args[toolsIdx + 1]).toBe('');
    const allowIdx = out.args.indexOf('--allowedTools');
    expect(out.args[allowIdx + 1]).toBe('mcp__kibana__*');
    expect(JSON.parse(out.mcp)).toEqual({
      mcpServers: {
        kibana: {
          type: 'http',
          url: 'http://localhost:5601/api/agent_builder/mcp',
          headers: { Authorization: 'ApiKey abc' },
        },
      },
    });
  });
});
