/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'crypto';
import type { KibanaRequest } from '@kbn/core/server';
import { httpServerMock, loggingSystemMock } from '@kbn/core/server/mocks';
import {
  CONTEXT_ENGINE_DREAMING_WORKFLOW_ID,
  CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID,
  CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID,
} from '@kbn/workflows/managed';
import type { PluginScopedManagedWorkflowsApi } from '@kbn/workflows/server/types';
import type { AiIndexHttpItem } from '../../common/http_api/ai_indices';
import type { AiIndexService } from '../ai_indices/service';
import type { DreamingWorkflowsApi } from './schedule';
import {
  createDreamingScheduleService,
  dreamingWorkflowIdFor,
  shouldDream,
  shouldDreamTranscripts,
  traceDreamingWorkflowIdFor,
  transcriptDreamingWorkflowIdFor,
} from './schedule';

const SPACE = 'marketing';
const suffix = `support-${createHash('sha256').update(SPACE).digest('hex').slice(0, 16)}`;
const WORKFLOW_ID = `${CONTEXT_ENGINE_DREAMING_WORKFLOW_ID}-${suffix}`;

const dreaming = {
  enabled: true,
  schedule: { interval: '6h' },
  instructions: 'Remember what customers prefer.',
  facts: [{ type: 'preference', description: 'Something a customer wants.' }],
  entities: { nodes: [{ type: 'customer', attributes: ['tier'] }, { type: 'city' }] },
  relationships: [{ type: 'lives_in', description: 'A customer lives in a city.' }],
};

const aiIndex = (overrides: Partial<AiIndexHttpItem> = {}): AiIndexHttpItem => ({
  id: 'support',
  managed: false,
  dest: { type: 'index', value: 'ai-index-idx-support' },
  automations: [],
  sources: [],
  traces: [],
  date_created: '2026-11-01T00:00:00.000Z',
  date_modified: '2026-11-01T00:00:00.000Z',
  dreaming,
  ...overrides,
});

describe('shouldDream', () => {
  it('dreams only with dreaming on and a type to build', () => {
    expect(shouldDream(aiIndex())).toBe(true);
    expect(shouldDream(aiIndex({ dreaming: { ...dreaming, enabled: false } }))).toBe(false);
    expect(shouldDream(aiIndex({ dreaming: { enabled: true } }))).toBe(false);
    expect(shouldDream(aiIndex({ dreaming: undefined }))).toBe(false);
  });
});

describe('shouldDreamTranscripts', () => {
  it('dreams on transcripts only with transcript dreaming on and a type to build', () => {
    expect(
      shouldDreamTranscripts(aiIndex({ dreaming: { ...dreaming, transcripts: { enabled: true } } }))
    ).toBe(true);
    expect(
      shouldDreamTranscripts(
        aiIndex({ dreaming: { ...dreaming, enabled: false, transcripts: { enabled: true } } })
      )
    ).toBe(true);
    expect(shouldDreamTranscripts(aiIndex())).toBe(false);
    expect(
      shouldDreamTranscripts(
        aiIndex({ dreaming: { enabled: true, transcripts: { enabled: true } } })
      )
    ).toBe(false);
  });
});

describe('createDreamingScheduleService', () => {
  let client: jest.Mocked<Pick<PluginScopedManagedWorkflowsApi, 'install' | 'uninstall'>>;
  let workflowsManagement: {
    updateWorkflow: jest.Mock;
    cancelAllActiveWorkflowExecutions: jest.Mock;
  };
  let aiIndexService: jest.Mocked<Pick<AiIndexService, 'addAutomation' | 'removeAutomation'>>;
  let request: KibanaRequest;

  const createService = (management: typeof workflowsManagement | undefined) =>
    createDreamingScheduleService({
      logger: loggingSystemMock.createLogger(),
      getManagedWorkflowsClient: async () => client as unknown as PluginScopedManagedWorkflowsApi,
      getWorkflowsManagement: async () => management as unknown as DreamingWorkflowsApi | undefined,
      getAiIndexService: () => aiIndexService as unknown as AiIndexService,
    });

  beforeEach(() => {
    client = {
      install: jest.fn().mockResolvedValue(undefined),
      uninstall: jest.fn().mockResolvedValue(undefined),
    };
    workflowsManagement = {
      updateWorkflow: jest.fn().mockResolvedValue(undefined),
      cancelAllActiveWorkflowExecutions: jest.fn().mockResolvedValue(undefined),
    };
    aiIndexService = {
      addAutomation: jest.fn().mockResolvedValue('attached'),
      removeAutomation: jest.fn().mockResolvedValue('removed'),
    };
    request = httpServerMock.createKibanaRequest();
  });

  it('names the workflow per AI index and space', () => {
    expect(dreamingWorkflowIdFor('support', SPACE)).toBe(WORKFLOW_ID);
    expect(dreamingWorkflowIdFor('support', 'default')).not.toBe(WORKFLOW_ID);
  });

  it('installs the workflow with the saved config as its values', async () => {
    await createService(workflowsManagement).reconcile({
      aiIndex: aiIndex(),
      spaceId: SPACE,
      request,
    });

    expect(client.install).toHaveBeenCalledWith(CONTEXT_ENGINE_DREAMING_WORKFLOW_ID, {
      spaceId: SPACE,
      workflowIdSuffix: suffix,
      values: {
        aiIndexId: 'support',
        instanceKey: suffix,
        memoriesIndex: 'ai-index-idx-support',
        intervalMinutes: 360,
        connectorId: '',
        instructions: 'Remember what customers prefer.',
        factTypes: dreaming.facts,
        entityTypes: dreaming.entities.nodes,
        relationshipTypes: dreaming.relationships,
      },
    });
  });

  it('defaults the schedule and passes the configured model', async () => {
    await createService(workflowsManagement).reconcile({
      aiIndex: aiIndex({
        dreaming: { enabled: true, connector_id: 'my-connector', facts: [{ type: 'note' }] },
      }),
      spaceId: SPACE,
      request,
    });

    expect(client.install.mock.calls[0][1].values).toEqual(
      expect.objectContaining({
        intervalMinutes: 1440,
        connectorId: 'my-connector',
        instructions: '',
        entityTypes: [],
        relationshipTypes: [],
      })
    );
  });

  it('enables the workflow as the caller, and attaches it to the AI index', async () => {
    await createService(workflowsManagement).reconcile({
      aiIndex: aiIndex(),
      spaceId: SPACE,
      request,
    });

    expect(workflowsManagement.updateWorkflow).toHaveBeenCalledWith(
      WORKFLOW_ID,
      { enabled: true },
      SPACE,
      request
    );
    expect(aiIndexService.addAutomation).toHaveBeenCalledWith('support', SPACE, {
      type: 'workflow',
      value: WORKFLOW_ID,
    });
  });

  it('does not attach the workflow to a managed AI index, which takes no automations', async () => {
    await createService(workflowsManagement).reconcile({
      aiIndex: aiIndex({ managed: true }),
      spaceId: SPACE,
      request,
    });

    expect(client.install).toHaveBeenCalled();
    expect(aiIndexService.addAutomation).not.toHaveBeenCalled();
  });

  it.each([
    ['dreaming is off', { dreaming: { ...dreaming, enabled: false } }],
    ['dreaming was never configured', { dreaming: undefined }],
  ])('removes the workflow and detaches it when %s', async (_, overrides) => {
    await createService(workflowsManagement).reconcile({
      aiIndex: aiIndex(overrides),
      spaceId: SPACE,
      request,
    });

    expect(client.install).not.toHaveBeenCalled();
    expect(client.uninstall).toHaveBeenCalledWith(CONTEXT_ENGINE_DREAMING_WORKFLOW_ID, {
      spaceId: SPACE,
      workflowIdSuffix: suffix,
    });
    expect(aiIndexService.removeAutomation).toHaveBeenCalledWith('support', SPACE, {
      type: 'workflow',
      value: WORKFLOW_ID,
    });
  });

  describe('trace dreaming', () => {
    const traceWorkflowId = `${CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID}-${suffix}`;

    it('installs, enables and attaches its workflow with dreaming, on the same config', async () => {
      await createService(workflowsManagement).reconcile({
        aiIndex: aiIndex(),
        spaceId: SPACE,
        request,
      });

      expect(traceDreamingWorkflowIdFor('support', SPACE)).toBe(traceWorkflowId);
      const [[dreamingId, dreamingInstall], [traceId, traceInstall]] = client.install.mock.calls;
      expect([dreamingId, traceId]).toEqual([
        CONTEXT_ENGINE_DREAMING_WORKFLOW_ID,
        CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID,
      ]);
      expect(traceInstall).toEqual(dreamingInstall);
      expect(workflowsManagement.updateWorkflow).toHaveBeenCalledWith(
        traceWorkflowId,
        { enabled: true },
        SPACE,
        request
      );
      expect(aiIndexService.addAutomation).toHaveBeenCalledWith('support', SPACE, {
        type: 'workflow',
        value: traceWorkflowId,
      });
    });

    it('is installed whether or not the AI index has trace sources yet', async () => {
      await createService(workflowsManagement).reconcile({
        aiIndex: aiIndex({ traces: [] }),
        spaceId: SPACE,
        request,
      });

      expect(client.install).toHaveBeenCalledWith(
        CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID,
        expect.anything()
      );
    });

    it('is removed and detached with dreaming, and with the AI index', async () => {
      const service = createService(workflowsManagement);
      await service.reconcile({
        aiIndex: aiIndex({ dreaming: { ...dreaming, enabled: false } }),
        spaceId: SPACE,
        request,
      });
      expect(client.uninstall).toHaveBeenCalledWith(CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID, {
        spaceId: SPACE,
        workflowIdSuffix: suffix,
      });
      expect(aiIndexService.removeAutomation).toHaveBeenCalledWith('support', SPACE, {
        type: 'workflow',
        value: traceWorkflowId,
      });

      client.uninstall.mockClear();
      await service.remove({ aiIndexId: 'support', spaceId: SPACE, request });
      expect(client.uninstall).toHaveBeenCalledWith(CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID, {
        spaceId: SPACE,
        workflowIdSuffix: suffix,
      });
    });
  });

  describe('transcript dreaming', () => {
    const transcriptWorkflowId = `${CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID}-${suffix}`;

    it('installs, enables and attaches its own workflow, on its own interval', async () => {
      await createService(workflowsManagement).reconcile({
        aiIndex: aiIndex({
          dreaming: { ...dreaming, transcripts: { enabled: true, schedule: { interval: '2h' } } },
        }),
        spaceId: SPACE,
        request,
      });

      expect(transcriptDreamingWorkflowIdFor('support', SPACE)).toBe(transcriptWorkflowId);
      expect(client.install).toHaveBeenCalledWith(CONTEXT_ENGINE_DREAMING_WORKFLOW_ID, {
        spaceId: SPACE,
        workflowIdSuffix: suffix,
        values: expect.objectContaining({ intervalMinutes: 360 }),
      });
      expect(client.install).toHaveBeenCalledWith(CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID, {
        spaceId: SPACE,
        workflowIdSuffix: suffix,
        values: expect.objectContaining({
          aiIndexId: 'support',
          intervalMinutes: 120,
          factTypes: dreaming.facts,
        }),
      });
      expect(workflowsManagement.updateWorkflow).toHaveBeenCalledWith(
        transcriptWorkflowId,
        { enabled: true },
        SPACE,
        request
      );
      expect(aiIndexService.addAutomation).toHaveBeenCalledWith('support', SPACE, {
        type: 'workflow',
        value: transcriptWorkflowId,
      });
    });

    it('runs on the dreaming interval without one of its own, and without memory dreaming on', async () => {
      await createService(workflowsManagement).reconcile({
        aiIndex: aiIndex({
          dreaming: { ...dreaming, enabled: false, transcripts: { enabled: true } },
        }),
        spaceId: SPACE,
        request,
      });

      expect(client.install).toHaveBeenCalledTimes(1);
      expect(client.install).toHaveBeenCalledWith(
        CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID,
        expect.objectContaining({ values: expect.objectContaining({ intervalMinutes: 360 }) })
      );
      expect(client.uninstall).toHaveBeenCalledWith(CONTEXT_ENGINE_DREAMING_WORKFLOW_ID, {
        spaceId: SPACE,
        workflowIdSuffix: suffix,
      });
    });

    it.each([
      ['transcript dreaming is off', { ...dreaming, transcripts: { enabled: false } }],
      ['transcript dreaming was never configured', dreaming],
      ['there is nothing to build', { enabled: true, transcripts: { enabled: true } }],
    ])('removes and detaches its workflow when %s', async (_, config) => {
      await createService(workflowsManagement).reconcile({
        aiIndex: aiIndex({ dreaming: config }),
        spaceId: SPACE,
        request,
      });

      expect(client.install).not.toHaveBeenCalledWith(
        CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID,
        expect.anything()
      );
      expect(client.uninstall).toHaveBeenCalledWith(
        CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID,
        {
          spaceId: SPACE,
          workflowIdSuffix: suffix,
        }
      );
      expect(aiIndexService.removeAutomation).toHaveBeenCalledWith('support', SPACE, {
        type: 'workflow',
        value: transcriptWorkflowId,
      });
    });

    it('removes its workflow with the AI index', async () => {
      await createService(workflowsManagement).remove({
        aiIndexId: 'support',
        spaceId: SPACE,
        request,
      });

      expect(client.uninstall).toHaveBeenCalledWith(
        CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID,
        {
          spaceId: SPACE,
          workflowIdSuffix: suffix,
        }
      );
    });
  });

  it('refuses to install a workflow it could not enable', async () => {
    await expect(
      createService(undefined).reconcile({ aiIndex: aiIndex(), spaceId: SPACE, request })
    ).rejects.toThrow('the workflows management plugin is not available');
    expect(client.install).not.toHaveBeenCalled();
  });

  it('removes the workflow of a deleted AI index', async () => {
    await createService(workflowsManagement).remove({
      aiIndexId: 'support',
      spaceId: SPACE,
      request,
    });

    expect(client.uninstall).toHaveBeenCalledWith(CONTEXT_ENGINE_DREAMING_WORKFLOW_ID, {
      spaceId: SPACE,
      workflowIdSuffix: suffix,
    });
    expect(aiIndexService.removeAutomation).not.toHaveBeenCalled();
  });

  it('cancels a run in progress, which blocks the uninstall, then uninstalls', async () => {
    client.uninstall
      .mockRejectedValueOnce(
        new Error(`Cannot force-delete workflow with running executions: ${WORKFLOW_ID}`)
      )
      .mockRejectedValueOnce(
        new Error(`Cannot force-delete workflow with running executions: ${WORKFLOW_ID}`)
      )
      .mockResolvedValue(undefined);

    await createService(workflowsManagement).remove({
      aiIndexId: 'support',
      spaceId: SPACE,
      request,
    });

    expect(workflowsManagement.cancelAllActiveWorkflowExecutions).toHaveBeenCalledWith(
      WORKFLOW_ID,
      SPACE,
      request
    );
    // Three attempts for dreaming, then one each for trace and transcript dreaming.
    expect(client.uninstall).toHaveBeenCalledTimes(5);
  });

  it('does not cancel runs when the uninstall fails for another reason', async () => {
    client.uninstall.mockRejectedValue(new Error('cluster unavailable'));

    await expect(
      createService(workflowsManagement).remove({ aiIndexId: 'support', spaceId: SPACE, request })
    ).rejects.toThrow('cluster unavailable');
    expect(workflowsManagement.cancelAllActiveWorkflowExecutions).not.toHaveBeenCalled();
  });
});
