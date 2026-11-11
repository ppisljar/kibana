/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { QueryDslQueryContainer } from '@elastic/elasticsearch/lib/api/types';
import type { MemoryOwner } from './owner';

/** Every read and delete of a store goes through this: the caller's own documents in the space. */
export const ownerScopeFilters = (
  spaceId: string,
  owner: MemoryOwner
): QueryDslQueryContainer[] => [{ term: { space: spaceId } }, { term: { owner_id: owner.id } }];

export const notExpiredFilter = (now: string): QueryDslQueryContainer => ({
  bool: {
    should: [
      { bool: { must_not: { exists: { field: 'expires_at' } } } },
      { range: { expires_at: { gt: now } } },
    ],
    minimum_should_match: 1,
  },
});

/** Exact types, or prefixes written with a trailing `*`. */
export const typeFilter = (typeFilters: readonly string[]): QueryDslQueryContainer => ({
  bool: {
    should: typeFilters.map((type) =>
      type.endsWith('*')
        ? { prefix: { type: type.slice(0, -1).toLowerCase() } }
        : { term: { type: type.toLowerCase() } }
    ),
    minimum_should_match: 1,
  },
});

export const timeRangeFilter = (
  field: string,
  from: string | undefined,
  to: string | undefined
): QueryDslQueryContainer[] =>
  from === undefined && to === undefined
    ? []
    : [
        {
          range: {
            [field]: {
              ...(from !== undefined && { gte: from }),
              ...(to !== undefined && { lte: to }),
            },
          },
        },
      ];
