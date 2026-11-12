/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { StoredSessionMemory, StoredTranscriptChunk } from '../memory_stores/storage';
import { sessionMemoryToDreamSource, transcriptChunkToDreamSource } from './memory_sources';
import { isVisibleInSpace } from './permissions';

const owner = { owner_id: 'u_profile', owner_username: 'jdoe' };

describe('sessionMemoryToDreamSource', () => {
  const memory: StoredSessionMemory = {
    ...owner,
    id: 'm1',
    space: 'team-a',
    session_id: 's-1',
    agent_id: 'agent-a',
    ai_index_id: 'support',
    type: 'memory.session_fact',
    title: 'Safari crash',
    description: 'On billing',
    content: 'Safari crashes on the billing page.',
    tags: ['billing'],
    attributes: { severity: 'high' },
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-02T00:00:00.000Z',
  };

  it('ids the memory by its document, keeps what the model needs and leaves the owner out', () => {
    const source = sessionMemoryToDreamSource('doc-hash', memory);

    expect(source).toEqual({
      id: 'session-memory:doc-hash',
      type: 'memory.session_fact',
      title: 'Safari crash',
      description: 'On billing',
      content: 'Safari crashes on the billing page.',
      updated_at: '2026-11-02T00:00:00.000Z',
      attributes: {
        severity: 'high',
        'memory.session_id': 's-1',
        'memory.agent_id': 'agent-a',
        'memory.tags': ['billing'],
      },
      permissions: { kibana: { privileges: [{ space: 'team-a' }] } },
    });
    expect(JSON.stringify(source)).not.toContain('jdoe');
    expect(JSON.stringify(source)).not.toContain('u_profile');
  });

  it('keeps what is dreamed from it in the space it was written in', () => {
    const { permissions } = sessionMemoryToDreamSource('doc-hash', memory);

    expect(isVisibleInSpace(permissions, 'team-a')).toBe(true);
    expect(isVisibleInSpace(permissions, 'team-b')).toBe(false);
  });
});

describe('transcriptChunkToDreamSource', () => {
  const chunk: StoredTranscriptChunk = {
    ...owner,
    kind: 'chunk',
    space: 'team-a',
    session_id: 'sess-1',
    source: 'agent_builder',
    chunk_index: 2,
    turn_start: 4,
    turn_end: 6,
    roles: ['user', 'assistant'],
    content: 'User: I prefer aisle seats.\nAssistant: Noted.',
    turns: [],
    timestamp: '2026-10-01T09:00:00.000Z',
    created_at: '2026-11-01T00:00:00.000Z',
  };

  it('names the session and the turns, and dates the excerpt by when the turns happened', () => {
    expect(transcriptChunkToDreamSource('doc-hash', chunk, 'Trip planning')).toEqual({
      id: 'transcript:doc-hash',
      type: 'transcript.excerpt',
      title: 'Trip planning, turns 5-7',
      content: 'User: I prefer aisle seats.\nAssistant: Noted.',
      updated_at: '2026-10-01T09:00:00.000Z',
      attributes: {
        'transcript.session_id': 'sess-1',
        'transcript.source': 'agent_builder',
        'transcript.turn_start': 4,
        'transcript.turn_end': 6,
      },
      permissions: { kibana: { privileges: [{ space: 'team-a' }] } },
    });
  });

  it('falls back to the session id without a title', () => {
    expect(transcriptChunkToDreamSource('doc-hash', chunk).title).toBe('Session sess-1, turns 5-7');
  });
});
