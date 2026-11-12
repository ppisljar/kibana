/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { KibanaRequest, Logger } from '@kbn/core/server';
import pRetry from 'p-retry';
import {
  CONTEXT_ENGINE_DREAMING_WORKFLOW_ID,
  CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID,
  CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID,
} from '@kbn/workflows/managed';
import type { ContextEngineDreamingWorkflowTemplateValues } from '@kbn/workflows/managed';
import type { PluginScopedManagedWorkflowsApi } from '@kbn/workflows/server/types';
import {
  DEFAULT_DREAMING_INTERVAL,
  MIN_DREAMING_INTERVAL_MINUTES,
  dreamingBuildsAnything,
  dreamingTypesOf,
  transcriptDreamingIntervalOf,
  type AiIndexDreamingConfig,
} from '../../common/dreaming';
import type { AiIndexHttpItem } from '../../common/http_api/ai_indices';
import { parseIntervalMinutes } from '../../common/validation';
import type { AiIndexService } from '../ai_indices/service';
import type { WorkflowEnablementApi } from '../feedback_analysis/schedule';
import { managedWorkflowIdSuffixFor } from '../utils/managed_workflow_suffix';

/** The workflows management API dreaming uses. */
export interface DreamingWorkflowsApi extends WorkflowEnablementApi {
  cancelAllActiveWorkflowExecutions(
    workflowId: string,
    spaceId: string,
    request: KibanaRequest
  ): Promise<void>;
}

const CANCELLED_RUN_RETRIES = 5;
const CANCELLED_RUN_RETRY_MS = 1000;

const isRunInProgressError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes('running executions');

export interface DreamingScheduleService {
  /**
   * Installs and enables the dreaming, trace dreaming and transcript dreaming workflows of an AI
   * index that has them turned on, and removes the ones it does not.
   */
  reconcile(params: {
    aiIndex: AiIndexHttpItem;
    spaceId: string;
    request: KibanaRequest;
  }): Promise<void>;
  /** Removes both dreaming workflows of an AI index. */
  remove(params: { aiIndexId: string; spaceId: string; request: KibanaRequest }): Promise<void>;
}

/** The id of the dreaming workflow of an AI index. */
export const dreamingWorkflowIdFor = (aiIndexId: string, spaceId: string): string =>
  `${CONTEXT_ENGINE_DREAMING_WORKFLOW_ID}-${managedWorkflowIdSuffixFor(aiIndexId, spaceId)}`;

/** The id of the trace dreaming workflow of an AI index. */
export const traceDreamingWorkflowIdFor = (aiIndexId: string, spaceId: string): string =>
  `${CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID}-${managedWorkflowIdSuffixFor(aiIndexId, spaceId)}`;

/** The id of the transcript dreaming workflow of an AI index. */
export const transcriptDreamingWorkflowIdFor = (aiIndexId: string, spaceId: string): string =>
  `${CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID}-${managedWorkflowIdSuffixFor(
    aiIndexId,
    spaceId
  )}`;

/** Whether an AI index has dreaming on and configured to build something. */
export const shouldDream = ({ dreaming }: { dreaming?: AiIndexDreamingConfig }): boolean =>
  dreaming?.enabled === true && dreamingBuildsAnything(dreaming);

/**
 * Whether an AI index has transcript dreaming on and types to build. It does not need memory
 * dreaming on: the two run on their own schedules.
 */
export const shouldDreamTranscripts = ({
  dreaming,
}: {
  dreaming?: AiIndexDreamingConfig;
}): boolean => dreaming?.transcripts?.enabled === true && dreamingBuildsAnything(dreaming);

const intervalMinutesOf = (interval: string): number =>
  parseIntervalMinutes(interval) ?? MIN_DREAMING_INTERVAL_MINUTES;

/** The dreaming workflow template values for an AI index. */
export const dreamingTemplateValuesFor = (
  aiIndex: AiIndexHttpItem,
  dreaming: AiIndexDreamingConfig,
  spaceId: string,
  interval: string = dreaming.schedule?.interval ?? DEFAULT_DREAMING_INTERVAL
): ContextEngineDreamingWorkflowTemplateValues => {
  const { facts, entities, relationships } = dreamingTypesOf(dreaming);
  return {
    aiIndexId: aiIndex.id,
    instanceKey: managedWorkflowIdSuffixFor(aiIndex.id, spaceId),
    memoriesIndex: aiIndex.dest.value,
    intervalMinutes: intervalMinutesOf(interval),
    connectorId: dreaming.connector_id ?? '',
    instructions: dreaming.instructions ?? '',
    factTypes: facts,
    entityTypes: entities,
    relationshipTypes: relationships,
  };
};

/** One of the dreaming workflows of an AI index. */
interface DreamingWorkflow {
  definitionId:
    | typeof CONTEXT_ENGINE_DREAMING_WORKFLOW_ID
    | typeof CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID
    | typeof CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID;
  label: string;
  workflowIdFor: (aiIndexId: string, spaceId: string) => string;
  isOn: (aiIndex: AiIndexHttpItem) => boolean;
  intervalOf: (dreaming: AiIndexDreamingConfig) => string;
}

/**
 * The dreaming workflows of an AI index. Trace dreaming has no switch of its own: it runs with
 * dreaming, and each run skips itself while the AI index has no trace sources.
 */
const DREAMING_WORKFLOWS: readonly DreamingWorkflow[] = [
  {
    definitionId: CONTEXT_ENGINE_DREAMING_WORKFLOW_ID,
    label: 'dreaming',
    workflowIdFor: dreamingWorkflowIdFor,
    isOn: shouldDream,
    intervalOf: ({ schedule }) => schedule?.interval ?? DEFAULT_DREAMING_INTERVAL,
  },
  {
    definitionId: CONTEXT_ENGINE_TRACE_DREAMING_WORKFLOW_ID,
    label: 'trace dreaming',
    workflowIdFor: traceDreamingWorkflowIdFor,
    isOn: shouldDream,
    intervalOf: ({ schedule }) => schedule?.interval ?? DEFAULT_DREAMING_INTERVAL,
  },
  {
    definitionId: CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW_ID,
    label: 'transcript dreaming',
    workflowIdFor: transcriptDreamingWorkflowIdFor,
    isOn: shouldDreamTranscripts,
    intervalOf: transcriptDreamingIntervalOf,
  },
];

export const createDreamingScheduleService = ({
  logger,
  getManagedWorkflowsClient,
  getWorkflowsManagement,
  getAiIndexService,
}: {
  logger: Logger;
  getManagedWorkflowsClient: () => Promise<PluginScopedManagedWorkflowsApi>;
  /** Resolves to `undefined` without workflows management. */
  getWorkflowsManagement: () => Promise<DreamingWorkflowsApi | undefined>;
  getAiIndexService: () => AiIndexService;
}): DreamingScheduleService => {
  const log = logger.get('dreaming_schedule');

  const uninstall = async (
    workflow: DreamingWorkflow,
    aiIndexId: string,
    spaceId: string,
    request: KibanaRequest
  ) => {
    const client = await getManagedWorkflowsClient();
    const run = () =>
      client.uninstall(workflow.definitionId, {
        spaceId,
        workflowIdSuffix: managedWorkflowIdSuffixFor(aiIndexId, spaceId),
      });
    try {
      await run();
      return;
    } catch (error) {
      const workflowsManagement = await getWorkflowsManagement();
      if (!isRunInProgressError(error) || !workflowsManagement) {
        throw error;
      }
      await workflowsManagement.cancelAllActiveWorkflowExecutions(
        workflow.workflowIdFor(aiIndexId, spaceId),
        spaceId,
        request
      );
    }
    await pRetry(run, {
      retries: CANCELLED_RUN_RETRIES,
      minTimeout: CANCELLED_RUN_RETRY_MS,
      factor: 1,
      onFailedAttempt: (error) => {
        if (!isRunInProgressError(error)) {
          throw error;
        }
      },
    });
  };

  const automationFor = (workflow: DreamingWorkflow, aiIndexId: string, spaceId: string) =>
    ({ type: 'workflow', value: workflow.workflowIdFor(aiIndexId, spaceId) } as const);

  const turnOff = async (
    workflow: DreamingWorkflow,
    aiIndex: AiIndexHttpItem,
    spaceId: string,
    request: KibanaRequest
  ) => {
    await uninstall(workflow, aiIndex.id, spaceId, request);
    if (!aiIndex.managed) {
      await getAiIndexService().removeAutomation(
        aiIndex.id,
        spaceId,
        automationFor(workflow, aiIndex.id, spaceId)
      );
    }
    log.debug(() => `Removed ${workflow.label} for AI index '${aiIndex.id}' in space '${spaceId}'`);
  };

  const turnOn = async (
    workflow: DreamingWorkflow,
    aiIndex: AiIndexHttpItem,
    dreaming: AiIndexDreamingConfig,
    workflowsManagement: DreamingWorkflowsApi,
    spaceId: string,
    request: KibanaRequest
  ) => {
    const values = dreamingTemplateValuesFor(
      aiIndex,
      dreaming,
      spaceId,
      workflow.intervalOf(dreaming)
    );
    const client = await getManagedWorkflowsClient();
    await client.install(workflow.definitionId, {
      spaceId,
      workflowIdSuffix: managedWorkflowIdSuffixFor(aiIndex.id, spaceId),
      values,
    });

    const workflowId = workflow.workflowIdFor(aiIndex.id, spaceId);
    await workflowsManagement.updateWorkflow(workflowId, { enabled: true }, spaceId, request);

    if (!aiIndex.managed) {
      await getAiIndexService().addAutomation(
        aiIndex.id,
        spaceId,
        automationFor(workflow, aiIndex.id, spaceId)
      );
    }

    log.info(
      `Scheduled ${workflow.label} for AI index '${aiIndex.id}' in space '${spaceId}' every ${values.intervalMinutes}m, running as the user who saved its config`
    );
  };

  return {
    async reconcile({ aiIndex, spaceId, request }) {
      const { dreaming } = aiIndex;
      const on = DREAMING_WORKFLOWS.filter((workflow) => dreaming && workflow.isOn(aiIndex));
      const workflowsManagement = on.length > 0 ? await getWorkflowsManagement() : undefined;
      if (on.length > 0 && !workflowsManagement) {
        throw new Error(
          `Cannot schedule dreaming for AI index '${aiIndex.id}': the workflows management plugin is not available to enable the workflow, and installing it alone would leave it unscheduled.`
        );
      }

      for (const workflow of DREAMING_WORKFLOWS) {
        if (dreaming && workflowsManagement && on.includes(workflow)) {
          await turnOn(workflow, aiIndex, dreaming, workflowsManagement, spaceId, request);
        } else {
          await turnOff(workflow, aiIndex, spaceId, request);
        }
      }
    },

    async remove({ aiIndexId, spaceId, request }) {
      for (const workflow of DREAMING_WORKFLOWS) {
        await uninstall(workflow, aiIndexId, spaceId, request);
      }
      log.debug(() => `Removed dreaming for deleted AI index '${aiIndexId}' in space '${spaceId}'`);
    },
  };
};
