/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { z, lazySchema } from '@kbn/zod/v4';
import { StepCategory } from '@kbn/workflows';
import type { CommonStepDefinition } from '@kbn/workflows-extensions/common';
import { i18n } from '@kbn/i18n';
import { aiIndexIdSchema } from './ki';

export const READ_SESSION_MEMORIES_STEP_ID = 'context-engine.readSessionMemories' as const;
export const READ_TRANSCRIPTS_STEP_ID = 'context-engine.readTranscripts' as const;

/** The most memories or transcript excerpts one read returns. */
export const MAX_DREAM_SOURCE_READ_SIZE = 500;
const MAX_TIMESTAMP_LENGTH = 64;
const MAX_CURSOR_LENGTH = 4096;

export const readDreamSourcesInputSchema = lazySchema(() =>
  z.object({
    ai_index_id: aiIndexIdSchema,
    since: z
      .string()
      .max(MAX_TIMESTAMP_LENGTH)
      .refine((value) => !Number.isNaN(Date.parse(value)), { message: 'Must be an ISO 8601 date.' })
      .describe('Read what was written since this ISO 8601 time'),
    after: z
      .string()
      .max(MAX_CURSOR_LENGTH)
      .optional()
      .describe(
        'The resume_after of the read that stopped at since: continue after it. Empty or omitted: read from since.'
      ),
    size: z
      .number()
      .int()
      .min(1)
      .max(MAX_DREAM_SOURCE_READ_SIZE)
      .optional()
      .describe(`How many to read, oldest first. Defaults to ${MAX_DREAM_SOURCE_READ_SIZE}.`),
  })
);

/** A memory as dreaming reads it: the shape of the memories `applyDreamChanges` takes. */
export const dreamSourceMemorySchema = lazySchema(() =>
  z.object({
    id: z.string(),
    type: z.string(),
    title: z.string(),
    description: z.string().optional(),
    content: z.string(),
    updated_at: z.string(),
    attributes: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]))
      .optional(),
    permissions: z.object({
      kibana: z.object({ privileges: z.array(z.object({ space: z.string() })) }),
    }),
  })
);

export type DreamSourceMemory = z.infer<typeof dreamSourceMemorySchema>;

export const readDreamSourcesOutputSchema = lazySchema(() =>
  z.object({
    memories: z
      .array(dreamSourceMemorySchema)
      .describe('What was read, oldest first, shaped as the memories applyDreamChanges takes'),
    resume_from: z
      .string()
      .optional()
      .describe('Set when size cut the read: the time the next read starts from'),
    resume_after: z
      .string()
      .optional()
      .describe(
        'Set with resume_from: pass it as after, so the next read continues after the last one read'
      ),
  })
);

export type ReadDreamSourcesOutput = z.infer<typeof readDreamSourcesOutputSchema>;

type ReadDreamSourcesStepDefinition = CommonStepDefinition<
  typeof readDreamSourcesInputSchema,
  typeof readDreamSourcesOutputSchema
>;

export const readSessionMemoriesStepCommonDefinition: ReadDreamSourcesStepDefinition = {
  id: READ_SESSION_MEMORIES_STEP_ID,
  label: i18n.translate('xpack.contextEngine.workflows.steps.readSessionMemories.label', {
    defaultMessage: 'Read session memories',
  }),
  description: i18n.translate(
    'xpack.contextEngine.workflows.steps.readSessionMemories.description',
    {
      defaultMessage: 'Read the session memories written for an AI index, for dreaming.',
    }
  ),
  category: StepCategory.Kibana,
  stability: 'tech_preview',
  inputSchema: readDreamSourcesInputSchema,
  outputSchema: readDreamSourcesOutputSchema,
  documentation: {
    details: i18n.translate(
      'xpack.contextEngine.workflows.steps.readSessionMemories.documentation.details',
      {
        defaultMessage:
          'Returns the unexpired session memories of every user that were written for the AI ' +
          'index in this space and updated since the given time, oldest first. Each is shaped ' +
          'as a dreaming memory with an id that starts with session-memory:, and what is dreamed ' +
          'from it is visible only in this space.',
      }
    ),
  },
};

export const readTranscriptsStepCommonDefinition: ReadDreamSourcesStepDefinition = {
  id: READ_TRANSCRIPTS_STEP_ID,
  label: i18n.translate('xpack.contextEngine.workflows.steps.readTranscripts.label', {
    defaultMessage: 'Read transcripts',
  }),
  description: i18n.translate('xpack.contextEngine.workflows.steps.readTranscripts.description', {
    defaultMessage: 'Read the transcript excerpts stored for an AI index, for transcript dreaming.',
  }),
  category: StepCategory.Kibana,
  stability: 'tech_preview',
  inputSchema: readDreamSourcesInputSchema,
  outputSchema: readDreamSourcesOutputSchema,
  documentation: {
    details: i18n.translate(
      'xpack.contextEngine.workflows.steps.readTranscripts.documentation.details',
      {
        defaultMessage:
          'Returns the chunks of the transcripts of every user that were stored for the AI ' +
          'index in this space since the given time, oldest first. Each is shaped as a dreaming ' +
          'memory of type transcript.excerpt with an id that starts with transcript:, and what ' +
          'is dreamed from it is visible only in this space.',
      }
    ),
  },
};
