/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { AiIndexNotFoundError } from '../ai_indices/errors';
import type { AiIndexService } from '../ai_indices/service';
import type { SessionMemoryService } from '../memory_stores/session_memory_service';
import type { TranscriptService } from '../memory_stores/transcript_service';
import type { DreamingStepDependencies } from './helpers';
import {
  getReadSessionMemoriesStepDefinition,
  getReadTranscriptsStepDefinition,
} from './read_dream_sources';
import { createMockStepContext } from './test_utils';

const owner = { owner_id: 'u_profile', owner_username: 'jdoe' };
const input = { ai_index_id: 'support', since: '2026-11-01T00:00:00.000Z' };

describe('dream source read steps', () => {
  let readSessionMemories: jest.Mock;
  let readTranscripts: jest.Mock;
  let get: jest.Mock;
  let canRead: boolean;
  let contextEngineEnabled: boolean;
  let memoryEnabled: boolean;

  const deps = (): DreamingStepDependencies => ({
    getAiIndexService: () => ({ get } as unknown as AiIndexService),
    isContextEngineEnabled: async () => contextEngineEnabled,
    isMemoryEnabled: async () => memoryEnabled,
    checkReadPrivilege: async () => canRead,
    getSessionMemoryService: () =>
      ({ readForDreaming: readSessionMemories } as unknown as SessionMemoryService),
    getTranscriptService: () =>
      ({ readForDreaming: readTranscripts } as unknown as TranscriptService),
  });

  beforeEach(() => {
    canRead = true;
    contextEngineEnabled = true;
    memoryEnabled = true;
    get = jest.fn().mockResolvedValue({ id: 'support' });
    readSessionMemories = jest.fn().mockResolvedValue({
      memories: [
        {
          documentId: 'doc-1',
          memory: {
            ...owner,
            id: 'm1',
            space: 'team-a',
            session_id: 's-1',
            ai_index_id: 'support',
            type: 'memory.session',
            title: 'Summary',
            content: 'What happened.',
            created_at: 'x',
            updated_at: '2026-11-02T00:00:00.000Z',
          },
        },
      ],
      resumeFrom: '2026-11-02T00:00:00.000Z',
      resumeAfter: [1762041600000, 'u_profile', 'm1'],
    });
    readTranscripts = jest.fn().mockResolvedValue({
      chunks: [
        {
          documentId: 'doc-2',
          title: 'Trip',
          chunk: {
            ...owner,
            kind: 'chunk',
            space: 'team-a',
            session_id: 'sess-1',
            source: 'scout',
            chunk_index: 0,
            turn_start: 0,
            turn_end: 1,
            roles: ['user'],
            content: 'User: hi',
            turns: [],
            timestamp: '2026-10-01T00:00:00.000Z',
            created_at: '2026-11-03T00:00:00.000Z',
          },
        },
      ],
    });
  });

  it('reads the session memories of the AI index in the run space, as dreaming memories', async () => {
    const { output } = await getReadSessionMemoriesStepDefinition(deps()).handler(
      createMockStepContext({ input: { ...input, size: 50 }, esClient: {}, spaceId: 'team-a' })
    );

    expect(readSessionMemories).toHaveBeenCalledWith({
      spaceId: 'team-a',
      aiIndexId: 'support',
      since: '2026-11-01T00:00:00.000Z',
      size: 50,
    });
    expect(output).toEqual({
      memories: [expect.objectContaining({ id: 'session-memory:doc-1', type: 'memory.session' })],
      resume_from: '2026-11-02T00:00:00.000Z',
      resume_after: '[1762041600000,"u_profile","m1"]',
    });
  });

  it('continues after the resume_after of an earlier read, and rejects anything else', async () => {
    await getReadSessionMemoriesStepDefinition(deps()).handler(
      createMockStepContext({
        input: { ...input, after: '[1762041600000,"u_profile","m1"]' },
        esClient: {},
      })
    );
    expect(readSessionMemories).toHaveBeenCalledWith(
      expect.objectContaining({ after: [1762041600000, 'u_profile', 'm1'] })
    );

    await getReadSessionMemoriesStepDefinition(deps()).handler(
      createMockStepContext({ input: { ...input, after: '' }, esClient: {} })
    );
    expect(readSessionMemories).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ after: expect.anything() })
    );

    await expect(
      getReadTranscriptsStepDefinition(deps()).handler(
        createMockStepContext({ input: { ...input, after: 'not json' }, esClient: {} })
      )
    ).rejects.toThrow('after must be the resume_after of an earlier read');
  });

  it('reads the transcript excerpts of the AI index, 500 at most by default', async () => {
    const { output } = await getReadTranscriptsStepDefinition(deps()).handler(
      createMockStepContext({ input, esClient: {} })
    );

    expect(readTranscripts).toHaveBeenCalledWith(expect.objectContaining({ size: 500 }));
    expect(output).toEqual({
      memories: [
        expect.objectContaining({
          id: 'transcript:doc-2',
          type: 'transcript.excerpt',
          title: 'Trip, turns 1-2',
        }),
      ],
    });
  });

  it('fails without reading when the workflow user cannot read Context Engine', async () => {
    canRead = false;
    await expect(
      getReadSessionMemoriesStepDefinition(deps()).handler(
        createMockStepContext({ input, esClient: {} })
      )
    ).rejects.toThrow('Insufficient privileges to read AI indices');
    expect(readSessionMemories).not.toHaveBeenCalled();
  });

  it('reads nothing while Context Engine or memory is off', async () => {
    memoryEnabled = false;
    await expect(
      getReadTranscriptsStepDefinition(deps()).handler(
        createMockStepContext({ input, esClient: {} })
      )
    ).resolves.toEqual({ output: { memories: [] } });
    memoryEnabled = true;
    contextEngineEnabled = false;
    await expect(
      getReadSessionMemoriesStepDefinition(deps()).handler(
        createMockStepContext({ input, esClient: {} })
      )
    ).resolves.toEqual({ output: { memories: [] } });
    expect(readTranscripts).not.toHaveBeenCalled();
    expect(readSessionMemories).not.toHaveBeenCalled();
  });

  it('fails for an AI index that does not exist', async () => {
    get.mockRejectedValue(new AiIndexNotFoundError('support'));
    await expect(
      getReadTranscriptsStepDefinition(deps()).handler(
        createMockStepContext({ input, esClient: {} })
      )
    ).rejects.toThrow("AI index 'support' not found");
  });
});
