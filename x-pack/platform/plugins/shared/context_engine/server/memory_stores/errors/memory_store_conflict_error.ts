/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** A write that contradicts what is stored: maps to 409. */
export class MemoryStoreConflictError extends Error {
  override readonly name = 'MemoryStoreConflictError';
}
