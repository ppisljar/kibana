/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { RecallFilters, RecallResult } from '../../common/http_api/recall';

/** A recall result before scoring, truncation and fusion. */
export type RecallCandidate = Omit<RecallResult, 'score' | 'truncated' | 'retrieval'>;

/** What one source returned: a lexical list, and a semantic one when the source could run it. */
export interface RecallCandidateLists {
  lexical: RecallCandidate[];
  semantic?: RecallCandidate[];
  /** Why the semantic branch did not run or failed; the lexical list still counts. */
  semanticError?: string;
}

export interface RecallSearchParams {
  query: string;
  filters: RecallFilters;
  /** Candidates per branch. */
  size: number;
}
