import type { KibanaClient } from '../../kibana_client.js';
import type { Answerer } from '../answerer.js';
import {
  CE_PUBLIC_HEADERS,
  ceDeleteKis,
  ceDeleteTranscripts,
  ceRecall,
  ceTriggerDreaming,
  ceWriteMemories,
  ceWriteTranscripts,
  type CeRecallOptions,
  type CeScope,
} from '../ce.js';
import { evalSessionRef } from '../session_ids.js';
import type {
  IngestMode,
  IngestReceipt,
  MemoryTarget,
  NormalizedQuestion,
  NormalizedSample,
  TargetAnswer,
} from '../types.js';

export interface ContextEngineTargetOptions {
  client: KibanaClient;
  aiIndexId: string;
  spaceId: string;
  runId: string;
  answerer: Answerer;
  /**
   * ES|QL query run against the AI index for each question instead of recall. `{question}` is
   * replaced with the question text. Must return the memory text in its rows.
   */
  retrievalQuery?: string;
  /** How the recall API is called when there is no `retrievalQuery`. */
  recall?: CeRecallOptions;
}

interface QueryResponse {
  columns: Array<{ name: string }>;
  values: unknown[][];
}

const escapeEsql = (text: string): string => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/**
 * Context Engine API as the system under test, with no agent in between. The
 * harness retrieves from the Context Engine (recall, or an ES|QL query) and
 * answers with its own model, so the score reflects memory retrieval and the
 * answerer, not an agent's tool-use strategy.
 */
export class ContextEngineTarget implements MemoryTarget {
  readonly name = 'context_engine' as const;
  readonly ingestModes: readonly IngestMode[] = ['ce_memory', 'ce_transcript'];

  constructor(private readonly opts: ContextEngineTargetOptions) {}

  private scope(): CeScope {
    const { client, aiIndexId, spaceId, runId } = this.opts;
    return { client, aiIndexId, spaceId, runId };
  }

  async ingest(sample: NormalizedSample, mode: IngestMode): Promise<IngestReceipt> {
    if (mode === 'ce_memory') return ceWriteMemories(this.scope(), sample);
    if (mode === 'ce_transcript') return ceWriteTranscripts(this.scope(), sample);
    throw new Error(`ingest mode ${mode} is not supported by the context_engine target`);
  }

  async dream(receipt: IngestReceipt): Promise<void> {
    await ceTriggerDreaming(
      this.scope(),
      receipt.ingest_mode === 'ce_transcript' ? 'transcripts' : 'memories'
    );
  }

  async ask(question: NormalizedQuestion, receipt: IngestReceipt): Promise<TargetAnswer> {
    const { answerer } = this.opts;
    const { memories, raw } = this.opts.retrievalQuery
      ? await this.retrieveWithQuery(question, this.opts.retrievalQuery)
      : await this.retrieveWithRecall(question, receipt);
    const predicted = await answerer.answer({
      question: question.question,
      ...(question.question_date ? { question_date: question.question_date } : {}),
      memories,
    });
    return { predicted_answer: predicted, raw };
  }

  private async retrieveWithQuery(question: NormalizedQuestion, retrievalQuery: string) {
    const query = retrievalQuery.replace('{question}', escapeEsql(question.question));
    const response = await this.opts.client.call<QueryResponse>(
      'POST',
      '/api/context_engine/ai_index/_query',
      { query },
      CE_PUBLIC_HEADERS
    );
    const memories = response.values.map((row) =>
      response.columns.map((col, i) => `${col.name}: ${JSON.stringify(row[i])}`).join(' | ')
    );
    return { memories, raw: { rows: response.values } };
  }

  /** Transcript chunks are labelled with their session, so the answerer can tell sessions apart. */
  private async retrieveWithRecall(question: NormalizedQuestion, receipt: IngestReceipt) {
    const response = await ceRecall(this.scope(), question.question, receipt, this.opts.recall);
    const memories = response.results.map(({ content, session_id: sessionId, timestamp }) => {
      const session = sessionId ? receipt.session_index.get(sessionId) : undefined;
      const label = [session ? `[${evalSessionRef(session)}]` : undefined, timestamp ? `(${timestamp})` : undefined]
        .filter(Boolean)
        .join(' ');
      return label ? `${label}\n${content}` : content;
    });
    return { memories, raw: response };
  }

  async cleanup(receipt: IngestReceipt): Promise<void> {
    if (receipt.ingest_mode === 'ce_transcript') {
      await ceDeleteTranscripts(this.scope(), receipt.handles);
      return;
    }
    await ceDeleteKis(this.scope(), receipt.handles);
  }
}
