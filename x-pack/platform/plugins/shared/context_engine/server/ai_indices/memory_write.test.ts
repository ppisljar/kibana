/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { ElasticsearchClient } from '@kbn/core/server';
import type { AiIndexHttpItem } from '../../common/http_api/ai_indices';
import { KiValidationError } from './errors';
import { writeMemories } from './memory_write';
import { putKiRevision } from './ki_revision';

jest.mock('./ki_revision', () => ({ putKiRevision: jest.fn() }));

const putKiRevisionMock = putKiRevision as jest.MockedFunction<typeof putKiRevision>;

const buildAiIndex = (overrides: Partial<AiIndexHttpItem> = {}): AiIndexHttpItem =>
  ({
    id: 'my-index',
    dest: { type: 'index', value: 'ctx-my-index' },
    dreaming: { enabled: true },
    managed: false,
    date_created: '2026-01-01T00:00:00.000Z',
    date_modified: '2026-01-01T00:00:00.000Z',
    traces: [],
    ...overrides,
  } as unknown as AiIndexHttpItem);

const buildEsClient = () =>
  ({ indices: { refresh: jest.fn().mockResolvedValue({}) } } as unknown as ElasticsearchClient);

describe('writeMemories', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    putKiRevisionMock.mockResolvedValue(undefined as never);
  });

  it('writes each memory as a revision and returns ids in request order', async () => {
    const esClient = buildEsClient();
    const ids = await writeMemories({
      esClient,
      aiIndex: buildAiIndex(),
      spaceId: 'default',
      memories: [
        { id: 'fixed-1', type: 'memory.session', title: 'A', content: 'first' },
        { type: 'memory.session', title: 'B', content: 'second', references: [{ uri: 'eval-session://s2' }] },
      ],
    });

    expect(ids[0]).toBe('fixed-1');
    expect(ids).toHaveLength(2);
    expect(putKiRevisionMock).toHaveBeenCalledTimes(2);
    expect(putKiRevisionMock.mock.calls[0]![0]).toMatchObject({
      aiIndexId: 'my-index',
      kiId: 'fixed-1',
      failIfExists: true,
      document: {
        id: 'fixed-1',
        type: 'memory.session',
        content: 'first',
        governance: { lifecycle: { status: 'active' } },
      },
    });
    expect(putKiRevisionMock.mock.calls[1]![0].document).toMatchObject({
      references: [{ uri: 'eval-session://s2' }],
    });
    expect(esClient.indices.refresh).toHaveBeenCalledWith({ index: 'ctx-my-index' });
  });

  it('records the writer in governance provenance', async () => {
    await writeMemories({
      esClient: buildEsClient(),
      aiIndex: buildAiIndex(),
      spaceId: 'space-a',
      memories: [{ type: 'memory.session', title: 'A', content: 'x' }],
    });
    const document = putKiRevisionMock.mock.calls[0]![0].document as {
      governance: { provenance: { created_by: { uri: string; metadata: unknown } } };
    };
    expect(document.governance.provenance.created_by).toEqual({
      uri: 'api://context_engine.memory.write',
      metadata: { space_id: 'space-a' },
    });
  });

  it('refuses when dreaming is not set up', async () => {
    await expect(
      writeMemories({
        esClient: buildEsClient(),
        aiIndex: buildAiIndex({ dreaming: undefined }),
        spaceId: 'default',
        memories: [{ type: 'memory.session', title: 'A', content: 'x' }],
      })
    ).rejects.toBeInstanceOf(KiValidationError);
    expect(putKiRevisionMock).not.toHaveBeenCalled();
  });

  it('refuses index patterns', async () => {
    await expect(
      writeMemories({
        esClient: buildEsClient(),
        aiIndex: buildAiIndex({ dest: { type: 'index', value: 'ctx-*' } }),
        spaceId: 'default',
        memories: [{ type: 'memory.session', title: 'A', content: 'x' }],
      })
    ).rejects.toBeInstanceOf(KiValidationError);
  });
});
