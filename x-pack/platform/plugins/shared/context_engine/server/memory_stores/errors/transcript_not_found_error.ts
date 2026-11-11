/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** Maps to 404. Also used for another owner's session, which must not be distinguishable. */
export class TranscriptNotFoundError extends Error {
  override readonly name = 'TranscriptNotFoundError';
  constructor(sessionId: string) {
    super(`Transcript of session '${sessionId}' not found.`);
  }
}
