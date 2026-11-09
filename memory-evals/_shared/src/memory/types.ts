/**
 * Target-agnostic model for memory benchmarks. A benchmark sample is
 * normalized once, then any {@link MemoryTarget} (Agent Builder, Context
 * Engine API, Claude Code) can ingest and answer it.
 */

export type TargetName = 'agent_builder' | 'context_engine' | 'claude_code';

/**
 * Where a sample's history is written before questions are asked.
 * - `ce_memory`: short-term memories (`memory.session*` knowledge items) in the AI index.
 * - `ce_transcript`: per-round transcripts recorded in the conversation transcript index.
 * - `ab_import`: Agent Builder conversations created through the import API.
 */
export type IngestMode = 'ce_memory' | 'ce_transcript' | 'ab_import';

/** `pre_post` asks every question before and after dreaming on the same ingest. */
export type DreamPhase = 'none' | 'pre_post';

export type Phase = 'single' | 'pre_dream' | 'post_dream';

export interface SessionTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface NormalizedSession {
  session_id: string;
  started_at?: string;
  turns: SessionTurn[];
}

export interface NormalizedQuestion {
  question_id: string;
  question_type: string;
  question: string;
  gold_answer: string;
  question_date?: string;
  /** Sessions that hold the evidence for the answer. Empty for abstention questions. */
  evidence_session_ids: string[];
}

export interface NormalizedSample {
  sample_id: string;
  sessions: NormalizedSession[];
  questions: NormalizedQuestion[];
}

/**
 * Maps identifiers a target may return (memory ids, conversation ids, transcript
 * ids) to the session they were ingested from.
 */
export type SessionIndex = Map<string, string>;

export interface IngestReceipt {
  sample_id: string;
  ingest_mode: IngestMode;
  session_index: SessionIndex;
  /** Target-specific ids that cleanup() needs to remove what was written. */
  handles: string[];
}

export interface TargetAnswer {
  predicted_answer: string;
  /** Whatever the target saw while answering. Scanned for ingested identifiers. */
  raw: unknown;
}

export interface MemoryTarget {
  readonly name: TargetName;
  readonly ingestModes: readonly IngestMode[];
  ingest(sample: NormalizedSample, mode: IngestMode): Promise<IngestReceipt>;
  /** Runs dreaming over what was ingested. Resolves when the run has finished. */
  dream(receipt: IngestReceipt): Promise<void>;
  ask(question: NormalizedQuestion, receipt: IngestReceipt): Promise<TargetAnswer>;
  cleanup(receipt: IngestReceipt): Promise<void>;
}

/**
 * Thrown where the harness depends on a Kibana API that is not available yet.
 * The run stops instead of recording misleading scores.
 */
export class PendingApiError extends Error {
  override readonly name = 'PendingApiError';

  constructor(readonly capability: string, readonly stage: string) {
    super(`${capability} is not available yet (${stage}).`);
  }
}
