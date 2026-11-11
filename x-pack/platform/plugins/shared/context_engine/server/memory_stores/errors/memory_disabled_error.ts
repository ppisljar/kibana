/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** The global Context Engine memory setting is off: maps to 400. */
export class MemoryDisabledError extends Error {
  override readonly name = 'MemoryDisabledError';
  constructor() {
    super('Context Engine memory is disabled. Enable the global memory setting first.');
  }
}
