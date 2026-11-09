import type { KibanaClient } from '../kibana_client.js';

import { PendingApiError, type IngestReceipt, type NormalizedSample } from './types.js';

/**
 * Context Engine operations shared by the Context Engine, Claude Code, and
 * Agent Builder targets. The functions that write memories, transcripts, or
 * trigger dreaming throw until the Kibana endpoints exist; see the stage
 * notes in each message.
 */

const KI_BASE = (aiIndexId: string): string =>
  `/internal/context_engine/ai_index/${encodeURIComponent(aiIndexId)}/kis`;

export const ceWriteMemories = async (
  _client: KibanaClient,
  _aiIndexId: string,
  _sample: NormalizedSample,
  _runId: string
): Promise<IngestReceipt> => {
  throw new PendingApiError(
    'Writing short-term memories (memory.session knowledge items) to an AI index',
    'stage 2: create endpoint for memory knowledge items'
  );
};

export const ceWriteTranscripts = async (
  _client: KibanaClient,
  _aiIndexId: string,
  _sample: NormalizedSample,
  _runId: string
): Promise<IngestReceipt> => {
  throw new PendingApiError(
    'Writing round transcripts to the conversation transcript index',
    'stage 2: conversation_transcript index, not in upstream yet'
  );
};

export const ceTriggerDreaming = async (_client: KibanaClient, _aiIndexId: string): Promise<void> => {
  throw new PendingApiError(
    'Running dreaming on demand',
    'stage 2: run-now for the dreaming workflow; the harness currently cannot wait for a scheduled run'
  );
};

/** Deletes knowledge items by id. Used for every Context Engine write, including memories. */
export const ceDeleteKis = async (
  client: KibanaClient,
  aiIndexId: string,
  kiIds: readonly string[]
): Promise<void> => {
  for (const kiId of kiIds) {
    await client.call('DELETE', `${KI_BASE(aiIndexId)}/${encodeURIComponent(kiId)}`);
  }
};
