import { createHash } from 'node:crypto';

import type { KibanaClient } from '../../kibana_client.js';
import type { ConverseResponse } from '../../types.js';
import { ceDeleteKis, ceTriggerDreaming, ceWriteMemories, ceWriteTranscripts } from '../ce.js';
import { questionText } from '../answerer.js';
import { turnsToRounds } from '../normalize.js';
import {
  type IngestMode,
  type IngestReceipt,
  type MemoryTarget,
  type NormalizedQuestion,
  type NormalizedSample,
  type SessionIndex,
  type TargetAnswer,
} from '../types.js';

export interface AgentBuilderTargetOptions {
  client: KibanaClient;
  agentId: string;
  connectorId?: string;
  /** Context Engine AI index the agent reads memories from. */
  aiIndexId: string;
  runId: string;
}

const conversationIdFor = (runId: string, sampleId: string, sessionId: string): string => {
  const h = createHash('sha256').update(`${runId}\x00${sampleId}\x00${sessionId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const extractAnswer = (raw: ConverseResponse): string => {
  const direct = raw.response?.message;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  for (let i = (raw.steps?.length ?? 0) - 1; i >= 0; i--) {
    const step = raw.steps?.[i] as Record<string, unknown> | undefined;
    const message = step?.message ?? (step?.response as Record<string, unknown> | undefined)?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  }
  return '';
};

/**
 * Agent Builder as the system under test. Ingest prefers Context Engine
 * memories and transcripts; `ab_import` writes conversations for the
 * conversation-history case. Every question runs in a fresh, non-persisted
 * conversation, so the only way to answer is through memory.
 */
export class AgentBuilderTarget implements MemoryTarget {
  readonly name = 'agent_builder' as const;
  readonly ingestModes: readonly IngestMode[] = ['ce_memory', 'ce_transcript', 'ab_import'];

  constructor(private readonly opts: AgentBuilderTargetOptions) {}

  async ingest(sample: NormalizedSample, mode: IngestMode): Promise<IngestReceipt> {
    const { client, aiIndexId, runId } = this.opts;
    if (mode === 'ce_memory') return ceWriteMemories(client, aiIndexId, sample, runId);
    if (mode === 'ce_transcript') return ceWriteTranscripts(client, aiIndexId, sample, runId);
    return this.importConversations(sample);
  }

  async dream(_receipt: IngestReceipt): Promise<void> {
    await ceTriggerDreaming(this.opts.client, this.opts.aiIndexId);
  }

  async ask(question: NormalizedQuestion, _receipt: IngestReceipt): Promise<TargetAnswer> {
    const { client, agentId, connectorId } = this.opts;
    const request: Parameters<KibanaClient['converse']>[0] = {
      agent_id: agentId,
      input: questionText(question),
      persist: false,
    };
    if (connectorId) request.connector_id = connectorId;
    const raw = await client.converse(request);
    return { predicted_answer: extractAnswer(raw), raw };
  }

  async cleanup(receipt: IngestReceipt): Promise<void> {
    if (receipt.ingest_mode === 'ab_import') {
      await this.opts.client.bulkDeleteConversations({ conversation_ids: receipt.handles });
      return;
    }
    await ceDeleteKis(this.opts.client, this.opts.aiIndexId, receipt.handles);
  }

  /** Imports each session as its own conversation. On failure, the ones already imported are removed. */
  private async importConversations(sample: NormalizedSample): Promise<IngestReceipt> {
    const { client, agentId, runId } = this.opts;
    const sessionIndex: SessionIndex = new Map();
    const handles: string[] = [];
    try {
      for (const session of sample.sessions) {
        const id = conversationIdFor(runId, sample.sample_id, session.session_id);
        await client.importConversation({
          agent_id: agentId,
          id,
          title: `eval:${runId}:${sample.sample_id}:${session.session_id}`,
          mode: 'overwrite',
          rounds: turnsToRounds(session.turns, session.started_at),
        });
        handles.push(id);
        sessionIndex.set(id, session.session_id);
      }
    } catch (e) {
      if (handles.length > 0) {
        await client.bulkDeleteConversations({ conversation_ids: handles }).catch(() => undefined);
      }
      throw e;
    }
    return { sample_id: sample.sample_id, ingest_mode: 'ab_import', session_index: sessionIndex, handles };
  }
}
