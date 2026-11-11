import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import type { KibanaClient } from '../kibana_client.js';

import { evalSessionRef } from './session_ids.js';
import {
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
const TRANSCRIPT_DREAMING_WORKFLOW_ID = 'system-context-engine-transcript-dreaming';
const SPACE_HASH_LENGTH = 16;

const workflowIdFor = (definitionId: string, aiIndexId: string, spaceId: string): string => {
  const spaceHash = createHash('sha256').update(spaceId).digest('hex').slice(0, SPACE_HASH_LENGTH);
  return `${definitionId}-${aiIndexId}-${spaceHash}`;
};

/** Mirrors `dreamingWorkflowIdFor` in the Context Engine plugin. */
export const dreamingWorkflowIdFor = (aiIndexId: string, spaceId: string): string =>
  workflowIdFor(DREAMING_WORKFLOW_ID, aiIndexId, spaceId);

/** Mirrors `transcriptDreamingWorkflowIdFor` in the Context Engine plugin. */
export const transcriptDreamingWorkflowIdFor = (aiIndexId: string, spaceId: string): string =>
  workflowIdFor(TRANSCRIPT_DREAMING_WORKFLOW_ID, aiIndexId, spaceId);

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

const TRANSCRIPTS_PATH = '/internal/context_engine/transcripts';
const TRANSCRIPT_DELETE_BATCH = 1000;
/** The most session ids a recall filter takes. */
const RECALL_SESSION_FILTER_MAX = 1000;

/**
 * Transcript session id for an eval session. Scoped to the run and sample, so samples that share
 * a haystack session do not overwrite or delete each other's copy. The transcript API rejects a
 * leading `_`, whitespace and `/`.
 */
export const transcriptSessionId = (runId: string, sampleId: string, sessionId: string): string =>
  `${runId}.${sampleId}.${sessionId}`.replace(/[\s/]+/g, '-').replace(/^_+/, '');

const isIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}/.test(value) && !Number.isNaN(Date.parse(value));

/** Deletes transcripts by session id. */
export const ceDeleteTranscripts = async (scope: CeScope, sessionIds: readonly string[]): Promise<void> => {
  for (let start = 0; start < sessionIds.length; start += TRANSCRIPT_DELETE_BATCH) {
    await scope.client.call(
      'POST',
      `${TRANSCRIPTS_PATH}/_bulk_delete`,
      { session_ids: sessionIds.slice(start, start + TRANSCRIPT_DELETE_BATCH) },
      CE_INTERNAL_HEADERS
    );
  }
};

/**
 * Writes each session of a sample as a whole transcript. Only the last write waits for a refresh,
 * which makes every earlier one searchable too.
 */
export const ceWriteTranscripts = async (
  scope: CeScope,
  sample: NormalizedSample
): Promise<IngestReceipt> => {
  const { client, aiIndexId, runId } = scope;
  const sessions = sample.sessions.filter((session) => session.turns.length > 0);
  const sessionIndex: SessionIndex = new Map();
  const handles: string[] = [];

  try {
    for (const [position, session] of sessions.entries()) {
      const id = transcriptSessionId(runId, sample.sample_id, session.session_id);
      const startedAt = session.started_at;
      await client.call(
        'PUT',
        `${TRANSCRIPTS_PATH}/${encodeURIComponent(id)}`,
        {
          source: 'memory-evals',
          source_ref: evalSessionRef(session.session_id),
          ai_index_id: aiIndexId,
          title: `${sample.sample_id} ${session.session_id}`,
          ...(startedAt && isIsoDate(startedAt) ? { started_at: startedAt } : {}),
          turns: session.turns.map(({ role, content }) => ({ role, content })),
          tags: [`eval-run:${runId}`],
          attributes: {
            'eval.run_id': runId,
            'eval.sample_id': sample.sample_id,
            'eval.session_id': session.session_id,
            ...(startedAt ? { 'eval.started_at': startedAt } : {}),
          },
          refresh: position === sessions.length - 1,
        },
        CE_INTERNAL_HEADERS
      );
      handles.push(id);
      sessionIndex.set(id, session.session_id);
    }
  } catch (e) {
    await ceDeleteTranscripts(scope, handles).catch(() => undefined);
    throw e;
  }

  return { sample_id: sample.sample_id, ingest_mode: 'ce_transcript', session_index: sessionIndex, handles };
};

export interface CeRecallResult {
  source: 'ai_index' | 'session_memory' | 'transcript';
  id: string;
  score: number;
  title?: string;
  content: string;
  session_id?: string;
  timestamp?: string;
  references?: Array<{ uri: string }>;
}

export interface CeRecallResponse {
  results: CeRecallResult[];
  reranked: boolean;
  rerank_error?: string;
}

export interface CeRecallOptions {
  limit?: number;
  maxTotalChars?: number;
  rerank?: boolean;
}

/**
 * Recalls what a receipt ingested for a question: the transcripts of the sample's sessions, or the
 * memories and dreamed knowledge in the AI index.
 */
export const ceRecall = async (
  scope: CeScope,
  question: string,
  receipt: IngestReceipt,
  { limit = 20, maxTotalChars = 40_000, rerank = true }: CeRecallOptions = {}
): Promise<CeRecallResponse> => {
  const target =
    receipt.ingest_mode === 'ce_transcript'
      ? {
          sources: ['transcripts'],
          ...(receipt.handles.length > 0 && receipt.handles.length <= RECALL_SESSION_FILTER_MAX
            ? { filters: { session_ids: receipt.handles } }
            : {}),
        }
      : { sources: ['ai_indices'], ai_index_ids: [scope.aiIndexId] };
  return scope.client.call<CeRecallResponse>(
    'POST',
    '/internal/context_engine/_recall',
    {
      query: question,
      ...target,
      limit,
      max_total_chars: maxTotalChars,
      rerank: { enabled: rerank },
    },
    CE_INTERNAL_HEADERS
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
 * Runs a managed dreaming workflow for the AI index and waits for the execution to finish:
 * dreaming for memories, transcript dreaming for transcripts. The Context Engine schedules both,
 * so this only adds an on-demand run; transcript dreaming must be turned on in the dreaming config.
 */
export const ceTriggerDreaming = async (
  scope: CeScope,
  source: 'memories' | 'transcripts' = 'memories'
): Promise<void> => {
  const { client, aiIndexId, spaceId } = scope;
  const workflowId =
    source === 'transcripts'
      ? transcriptDreamingWorkflowIdFor(aiIndexId, spaceId)
      : dreamingWorkflowIdFor(aiIndexId, spaceId);
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
