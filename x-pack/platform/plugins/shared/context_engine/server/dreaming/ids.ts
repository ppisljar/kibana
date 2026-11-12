/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'crypto';

const MAX_SLUG_LENGTH = 96;
const HASH_LENGTH = 16;

export const shortHash = (...parts: string[]): string =>
  createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, HASH_LENGTH);

const identityOf = (name: string): string =>
  name
    .normalize('NFKD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .toLowerCase()
    .split(/[^\p{L}\p{M}\p{N}]+/u)
    .filter(Boolean)
    .join(' ');

/** A readable id segment for a name, hash-suffixed when it cannot carry the whole name. */
export const slugify = (name: string): string => {
  const identity = identityOf(name);
  const readable = identity.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const slug = readable.slice(0, MAX_SLUG_LENGTH).replace(/-+$/g, '');
  if (slug.length === 0) {
    return shortHash(identity.length > 0 ? identity : name);
  }
  const lossless = readable.length <= MAX_SLUG_LENGTH && readable.replace(/-/g, ' ') === identity;
  return lossless ? slug : `${slug}-${shortHash(identity)}`;
};

/** The KI id of an entity, from its type, name and audience; a slug never holds `--`, so they cannot run together. */
export const entityId = (type: string, name: string, audience?: string): string =>
  `entity-${slugify(type)}--${slugify(name)}${audience ? `--${audience}` : ''}`;

/** The KI id of a new fact, from the run, the batch of memories and the model's key. */
export const factId = (executionId: string, batchKey: string, ref: string): string =>
  `fact-${shortHash(executionId, batchKey, ref)}`;

/** A relationship's `memory.key`: `<from id>|<relationship type>|<to id>`. */
export const relationshipKey = (from: string, relation: string, to: string): string =>
  `${from}|${relation}|${to}`;

/** The KI id of a relationship, from its key, so proposing it again updates it. */
export const relationshipId = (key: string): string => `relationship-${shortHash(key)}`;

/** The key of a batch of memories. */
export const batchKeyOf = (memoryIds: Iterable<string>): string =>
  shortHash(...[...memoryIds].sort());

const KI_URI_PREFIX = 'ki://';

/** The URI of a KI in the same AI index. */
export const kiUri = (kiId: string): string => `${KI_URI_PREFIX}${kiId}`;

export const kiIdFromUri = (uri: string): string | undefined =>
  uri.startsWith(KI_URI_PREFIX) ? uri.slice(KI_URI_PREFIX.length) : undefined;

/**
 * Memory ids of the sources outside the AI index, by where they come from. The rest of the id is
 * the trace id of an agent round, or the store's document id, which is unique across owners where a
 * caller's own id is not.
 */
export const TRACE_ROUND_ID_PREFIX = 'trace:';
export const SESSION_MEMORY_ID_PREFIX = 'session-memory:';
export const TRANSCRIPT_CHUNK_ID_PREFIX = 'transcript:';

const SOURCE_URI_SCHEMES: ReadonlyArray<{ idPrefix: string; uriPrefix: string }> = [
  { idPrefix: TRACE_ROUND_ID_PREFIX, uriPrefix: 'trace://' },
  { idPrefix: SESSION_MEMORY_ID_PREFIX, uriPrefix: 'session-memory://' },
  { idPrefix: TRANSCRIPT_CHUNK_ID_PREFIX, uriPrefix: 'transcript://' },
];

/** The URI a dreamed KI cites a memory by: `ki://` for a memory KI, the source's scheme otherwise. */
export const memoryUri = (memoryId: string): string => {
  const scheme = SOURCE_URI_SCHEMES.find(({ idPrefix }) => memoryId.startsWith(idPrefix));
  return scheme ? `${scheme.uriPrefix}${memoryId.slice(scheme.idPrefix.length)}` : kiUri(memoryId);
};

/** The memory id a `derived_from` reference cites, the reverse of {@link memoryUri}. */
export const memoryIdFromUri = (uri: string): string | undefined => {
  const scheme = SOURCE_URI_SCHEMES.find(({ uriPrefix }) => uri.startsWith(uriPrefix));
  return scheme ? `${scheme.idPrefix}${uri.slice(scheme.uriPrefix.length)}` : kiIdFromUri(uri);
};
