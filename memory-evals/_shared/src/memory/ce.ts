import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { KibanaClient } from '../kibana_client.js';

import { evalSessionRef } from './session_ids.js';
import {
  PendingApiError,
  type IngestReceipt,
  type NormalizedSample,
  type NormalizedSession,
  type SessionIndex,
} from './types.js';

/** Where a Context Engine target writes and reads memory. */
export interface CeScope {
  client: KibanaClient;
  aiIndexId: string;
  spaceId: string;
  runId: string;
}

/** Context Engine routes under `/internal` take this version header. */
export const CE_INTERNAL_HEADERS: Record<string, string> = { 'elastic-api-version': '1' };
/** Public Context Engine routes take a date version. Keep in sync with `AI_INDEX_API_VERSION`. */
export const CE_PUBLIC_HEADERS: Record<string, string> = { 'elastic-api-version': '2023-10-31' };

/** Keeps each memory well under the knowledge item content limit while leaving room for context. */
const CHUNK_CHARS = 8000;
const WRITE_BATCH = 500;
const DREAMING_POLL_MS = 5000;
const DREAMING_TIMEOUT_MS = 30 * 60 * 1000;

const DREAMING_WORKFLOW_ID = 'system-context-engine-dreaming';
const SPACE_HASH_LENGTH = 16;

/** Mirrors `dreamingWorkflowIdFor` in the Context Engine plugin. */
export const dreamingWorkflowIdFor = (aiIndexId: string, spaceId: string): string => {
  const spaceHash = createHash('sha256').update(spaceId).digest('hex').slice(0, SPACE_HASH_LENGTH);
  return `${DREAMING_WORKFLOW_ID}-${aiIndexId}-${spaceHash}`;
};

const renderTurns = (session: NormalizedSession): string[] =>
  session.turns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`);

/**
 * Splits one session into memory bodies of at most {@link CHUNK_CHARS}. Every chunk starts with
 * its session reference, so retrieval can map a memory back to the session it came from.
 */
export const chunkSession = (session: NormalizedSession): string[] => {
  const header = `[${evalSessionRef(session.session_id)}]${
    session.started_at ? ` (session started ${session.started_at})` : ''
  }`;
  const chunks: string[] = [];
  let current: string[] = [];
  let size = header.length;
  for (const line of renderTurns(session)) {
    if (size + line.length > CHUNK_CHARS && current.length > 0) {
      chunks.push([header, ...current].join('\n'));
      current = [];
      size = header.length;
    }
    current.push(line);
    size += line.length + 1;
  }
  if (current.length > 0) chunks.push([header, ...current].join('\n'));
  return chunks;
};

interface WriteMemoriesResponse {
  ids: string[];
}

/**
 * Writes a sample's sessions as short-term memories. Each memory carries the session reference in
 * its content and its references, so retrieval resolves to the session it came from.
 */
export const ceWriteMemories = async (
  scope: CeScope,
  sample: NormalizedSample
): Promise<IngestReceipt> => {
  const { client, aiIndexId, runId } = scope;
  const memories: Array<Record<string, unknown>> = [];
  const sessionOfMemory: string[] = [];

  for (const session of sample.sessions) {
    const parts = chunkSession(session);
    parts.forEach((content, part) => {
      memories.push({
        type: 'memory.session',
        title: `${sample.sample_id} ${session.session_id} part ${part + 1}`,
        description: session.started_at ?? '',
        content,
        tags: [`eval-run:${runId}`],
        references: [{ uri: evalSessionRef(session.session_id), relation: 'source' }],
        attributes: {
          'eval.run_id': runId,
          'eval.sample_id': sample.sample_id,
          'eval.session_id': session.session_id,
        },
      });
      sessionOfMemory.push(session.session_id);
    });
  }

  const sessionIndex: SessionIndex = new Map();
  const handles: string[] = [];
  try {
    for (let start = 0; start < memories.length; start += WRITE_BATCH) {
      const batch = memories.slice(start, start + WRITE_BATCH);
      const response = await client.call<WriteMemoriesResponse>(
        'POST',
        `/internal/context_engine/ai_index/${encodeURIComponent(aiIndexId)}/memories/_bulk`,
        { memories: batch },
        CE_INTERNAL_HEADERS
      );
      response.ids.forEach((id, i) => {
        handles.push(id);
        sessionIndex.set(id, sessionOfMemory[start + i]!);
      });
    }
  } catch (e) {
    await ceDeleteKis(scope, handles).catch(() => undefined);
    throw e;
  }

  return { sample_id: sample.sample_id, ingest_mode: 'ce_memory', session_index: sessionIndex, handles };
};

/** Transcript ingest needs the conversation transcript index, which is not in upstream yet. */
export const ceWriteTranscripts = async (
  _scope: CeScope,
  _sample: NormalizedSample
): Promise<IngestReceipt> => {
  throw new PendingApiError(
    'Writing round transcripts to the conversation transcript index',
    'stage 2: conversation_transcript index, not in upstream yet'
  );
};

interface WorkflowRunResponse {
  workflowExecutionId: string;
}

interface WorkflowExecutionResponse {
  status: string;
}

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'skipped']);

/**
 * Runs the managed dreaming workflow for the AI index and waits for the execution to finish. The
 * workflow is scheduled by the Context Engine, so this only adds an on-demand run.
 */
export const ceTriggerDreaming = async (scope: CeScope): Promise<void> => {
  const { client, aiIndexId, spaceId } = scope;
  const workflowId = dreamingWorkflowIdFor(aiIndexId, spaceId);
  const run = await client.call<WorkflowRunResponse>(
    'POST',
    `/api/workflows/workflow/${encodeURIComponent(workflowId)}/run`,
    { inputs: {} }
  );

  const deadline = Date.now() + DREAMING_TIMEOUT_MS;
  for (;;) {
    const execution = await client.call<WorkflowExecutionResponse>(
      'GET',
      `/api/workflows/executions/${encodeURIComponent(run.workflowExecutionId)}`
    );
    if (TERMINAL_STATUSES.has(execution.status)) {
      if (execution.status !== 'completed') {
        throw new Error(`dreaming run ${run.workflowExecutionId} ended with status ${execution.status}`);
      }
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`dreaming run ${run.workflowExecutionId} did not finish within 30 minutes`);
    }
    await delay(DREAMING_POLL_MS);
  }
};

/** Deletes knowledge items by id. Used for every Context Engine write, including memories. */
export const ceDeleteKis = async (scope: CeScope, kiIds: readonly string[]): Promise<void> => {
  for (const kiId of kiIds) {
    await scope.client.call(
      'DELETE',
      `/internal/context_engine/ai_index/${encodeURIComponent(scope.aiIndexId)}/kis/${encodeURIComponent(kiId)}`,
      undefined,
      CE_INTERNAL_HEADERS
    );
  }
};
