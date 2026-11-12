/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { DreamSourceMemory } from '../../common/step_types/read_dream_sources';
import type { StoredSessionMemory, StoredTranscriptChunk } from '../memory_stores/storage';
import { SESSION_MEMORY_ID_PREFIX, TRANSCRIPT_CHUNK_ID_PREFIX } from './ids';

/** The memory type of a transcript excerpt, as the dreaming model and the apply step see it. */
export const TRANSCRIPT_EXCERPT_TYPE = 'transcript.excerpt';

/**
 * The permissions a source outside the AI index gives what is dreamed from it: visible in the
 * space it was written in, where the stores scope it, and nowhere else.
 */
const spaceOnly = (spaceId: string): DreamSourceMemory['permissions'] => ({
  kibana: { privileges: [{ space: spaceId }] },
});

/** A session memory as a dreaming memory. Owner fields stay out of what the model reads. */
export const sessionMemoryToDreamSource = (
  documentId: string,
  {
    space,
    type,
    title,
    description,
    content,
    updated_at: updatedAt,
    session_id: sessionId,
    agent_id: agentId,
    tags,
    attributes,
  }: StoredSessionMemory
): DreamSourceMemory => ({
  id: `${SESSION_MEMORY_ID_PREFIX}${documentId}`,
  type,
  title,
  ...(description ? { description } : {}),
  content,
  updated_at: updatedAt,
  attributes: {
    ...attributes,
    'memory.session_id': sessionId,
    ...(agentId !== undefined && { 'memory.agent_id': agentId }),
    ...(tags?.length ? { 'memory.tags': tags } : {}),
  },
  permissions: spaceOnly(space),
});

/**
 * A transcript chunk as a dreaming memory. `updated_at` is when its turns happened, which is what
 * the facts drawn from it were last seen at.
 */
export const transcriptChunkToDreamSource = (
  documentId: string,
  {
    space,
    session_id: sessionId,
    agent_id: agentId,
    source,
    turn_start: turnStart,
    turn_end: turnEnd,
    content,
    timestamp,
  }: StoredTranscriptChunk,
  sessionTitle?: string
): DreamSourceMemory => ({
  id: `${TRANSCRIPT_CHUNK_ID_PREFIX}${documentId}`,
  type: TRANSCRIPT_EXCERPT_TYPE,
  title: `${sessionTitle ?? `Session ${sessionId}`}, turns ${turnStart + 1}-${turnEnd + 1}`,
  content,
  updated_at: timestamp,
  attributes: {
    'transcript.session_id': sessionId,
    'transcript.source': source,
    'transcript.turn_start': turnStart,
    'transcript.turn_end': turnEnd,
    ...(agentId !== undefined && { 'transcript.agent_id': agentId }),
  },
  permissions: spaceOnly(space),
});
