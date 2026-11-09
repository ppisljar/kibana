import type { KibanaClient } from '../../kibana_client.js';
import type { Answerer } from '../answerer.js';
import { ceTriggerDreaming, ceWriteMemories, ceWriteTranscripts, ceDeleteKis } from '../ce.js';
import {
  PendingApiError,
  type IngestMode,
  type IngestReceipt,
  type MemoryTarget,
  type NormalizedQuestion,
  type NormalizedSample,
  type TargetAnswer,
} from '../types.js';

export interface ContextEngineTargetOptions {
  client: KibanaClient;
  aiIndexId: string;
  runId: string;
  answerer: Answerer;
  /**
   * ES|QL query run against the AI index for each question. `{question}` is
   * replaced with the question text. Must return the memory text in its rows.
   */
  retrievalQuery?: string;
}

interface QueryResponse {
  columns: Array<{ name: string }>;
  values: unknown[][];
}

const escapeEsql = (text: string): string => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Context Engine API as the system under test, with no agent in between. The
 * harness retrieves rows from the AI index and answers with its own model, so
 * the score reflects memory retrieval and the answerer, not an agent's
 * tool-use strategy.
 */
export class ContextEngineTarget implements MemoryTarget {
  readonly name = 'context_engine' as const;
  readonly ingestModes: readonly IngestMode[] = ['ce_memory', 'ce_transcript'];

  constructor(private readonly opts: ContextEngineTargetOptions) {}

  async ingest(sample: NormalizedSample, mode: IngestMode): Promise<IngestReceipt> {
    const { client, aiIndexId, runId } = this.opts;
    if (mode === 'ce_memory') return ceWriteMemories(client, aiIndexId, sample, runId);
    if (mode === 'ce_transcript') return ceWriteTranscripts(client, aiIndexId, sample, runId);
    throw new Error(`ingest mode ${mode} is not supported by the context_engine target`);
  }

  async dream(_receipt: IngestReceipt): Promise<void> {
    await ceTriggerDreaming(this.opts.client, this.opts.aiIndexId);
  }

  async ask(question: NormalizedQuestion, _receipt: IngestReceipt): Promise<TargetAnswer> {
    const { client, answerer, retrievalQuery } = this.opts;
    if (!retrievalQuery) {
      throw new PendingApiError(
        'A retrieval query for the Context Engine AI index',
        'set KBN_CE_RETRIEVAL_QUERY; stage 3 confirms the query_ai_indices query shape'
      );
    }
    const query = retrievalQuery.replace('{question}', escapeEsql(question.question));
    const response = await client.call<QueryResponse>('POST', '/api/context_engine/ai_index/_query', {
      query,
    });
    const memories = response.values.map((row) =>
      response.columns.map((col, i) => `${col.name}: ${JSON.stringify(row[i])}`).join(' | ')
    );
    const predicted = await answerer.answer({
      question: question.question,
      ...(question.question_date ? { question_date: question.question_date } : {}),
      memories,
    });
    return { predicted_answer: predicted, raw: { rows: response.values } };
  }

  async cleanup(receipt: IngestReceipt): Promise<void> {
    await ceDeleteKis(this.opts.client, this.opts.aiIndexId, receipt.handles);
  }
}
