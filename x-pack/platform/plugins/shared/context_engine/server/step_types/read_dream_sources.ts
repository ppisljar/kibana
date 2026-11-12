/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { FieldValue } from '@elastic/elasticsearch/lib/api/types';
import { createServerStepDefinition } from '@kbn/workflows-extensions/server';
import { ExecutionError } from '@kbn/workflows/server';
import {
  MAX_DREAM_SOURCE_READ_SIZE,
  readSessionMemoriesStepCommonDefinition,
  readTranscriptsStepCommonDefinition,
  type ReadDreamSourcesOutput,
} from '../../common/step_types/read_dream_sources';
import { AiIndexNotFoundError } from '../ai_indices/errors';
import {
  sessionMemoryToDreamSource,
  transcriptChunkToDreamSource,
} from '../dreaming/memory_sources';
import type { DreamingStepDependencies } from './helpers';

interface ReadParams {
  spaceId: string;
  aiIndexId: string;
  since: string;
  after?: FieldValue[];
  size: number;
}

/** The `after` input is the `resume_after` of an earlier read: its last sort values, as JSON. */
const parseCursor = (after: string | undefined): FieldValue[] | undefined => {
  if (after === undefined || after === '') {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(after);
  } catch {
    parsed = undefined;
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new ExecutionError({
      type: 'ValidationError',
      message: 'after must be the resume_after of an earlier read',
    });
  }
  return parsed as FieldValue[];
};

const resumeOutput = (
  resumeFrom: string | undefined,
  resumeAfter: FieldValue[] | undefined
): Pick<ReadDreamSourcesOutput, 'resume_from' | 'resume_after'> =>
  resumeFrom !== undefined && resumeAfter !== undefined
    ? { resume_from: resumeFrom, resume_after: JSON.stringify(resumeAfter) }
    : {};

/**
 * The checks both reads share: the run may read Context Engine in its space, Context Engine and
 * memory are on, and the AI index exists. The stores are read as the internal user, across
 * owners: what an owner wrote for an AI index is what that AI index dreams on.
 */
const createReadHandler =
  (
    {
      getAiIndexService,
      isContextEngineEnabled,
      isMemoryEnabled,
      checkReadPrivilege,
    }: DreamingStepDependencies,
    read: (params: ReadParams) => Promise<ReadDreamSourcesOutput>
  ) =>
  async (context: {
    input: { ai_index_id: string; since: string; after?: string; size?: number };
    contextManager: {
      getContext: () => { workflow: { spaceId: string } };
      getFakeRequest: () => Parameters<DreamingStepDependencies['checkReadPrivilege']>[0];
    };
  }): Promise<{ output: ReadDreamSourcesOutput }> => {
    const { spaceId } = context.contextManager.getContext().workflow;
    const {
      ai_index_id: aiIndexId,
      since,
      after: rawAfter,
      size = MAX_DREAM_SOURCE_READ_SIZE,
    } = context.input;
    const after = parseCursor(rawAfter);
    if (!(await checkReadPrivilege(context.contextManager.getFakeRequest(), spaceId))) {
      throw new ExecutionError({
        type: 'PermissionError',
        message: 'Insufficient privileges to read AI indices',
      });
    }
    if (!(await isContextEngineEnabled(spaceId)) || !(await isMemoryEnabled())) {
      return { output: { memories: [] } };
    }
    try {
      await getAiIndexService().get(aiIndexId, spaceId);
    } catch (error) {
      if (error instanceof AiIndexNotFoundError) {
        throw new ExecutionError({
          type: 'NotFoundError',
          message: `AI index '${aiIndexId}' not found`,
        });
      }
      throw error;
    }
    return {
      output: await read({ spaceId, aiIndexId, since, size, ...(after && { after }) }),
    };
  };

export const getReadSessionMemoriesStepDefinition = (deps: DreamingStepDependencies) =>
  createServerStepDefinition({
    ...readSessionMemoriesStepCommonDefinition,
    handler: createReadHandler(deps, async (params) => {
      const { memories, resumeFrom, resumeAfter } = await deps
        .getSessionMemoryService()
        .readForDreaming(params);
      return {
        memories: memories.map(({ documentId, memory }) =>
          sessionMemoryToDreamSource(documentId, memory)
        ),
        ...resumeOutput(resumeFrom, resumeAfter),
      };
    }),
  });

export const getReadTranscriptsStepDefinition = (deps: DreamingStepDependencies) =>
  createServerStepDefinition({
    ...readTranscriptsStepCommonDefinition,
    handler: createReadHandler(deps, async (params) => {
      const { chunks, resumeFrom, resumeAfter } = await deps
        .getTranscriptService()
        .readForDreaming(params);
      return {
        memories: chunks.map(({ documentId, chunk, title }) =>
          transcriptChunkToDreamSource(documentId, chunk, title)
        ),
        ...resumeOutput(resumeFrom, resumeAfter),
      };
    }),
  });
