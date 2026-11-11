/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

/** A request the stores reject: maps to 400. */
export class MemoryStoreValidationError extends Error {
  override readonly name = 'MemoryStoreValidationError';
}
