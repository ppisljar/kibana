/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the "Elastic License
 * 2.0", the "GNU Affero General Public License v3.0 only", and the "Server Side
 * Public License v 1"; you may not use this file except in compliance with, at
 * your election, the "Elastic License 2.0", the "GNU Affero General Public
 * License v3.0 only", or the "Server Side Public License, v 1".
 */

import { parse } from 'yaml';
import type { ContextEngineTranscriptDreamingWorkflowTemplateValues } from '.';
import { CONTEXT_ENGINE_DREAMING_WORKFLOW, CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW } from '.';
import { createWorkflowLiquidEngine } from '../../../common/utils/create_workflow_liquid_engine/create_workflow_liquid_engine';

interface Step {
  name: string;
  type: string;
  condition?: string;
  foreach?: string;
  steps?: Step[];
  with?: Record<string, unknown>;
}

const findStep = (steps: Step[], name: string): Step => {
  const step = steps.find((candidate) => candidate.name === name);
  if (!step) {
    throw new Error(`No step named '${name}'`);
  }
  return step;
};

const values: ContextEngineTranscriptDreamingWorkflowTemplateValues = {
  aiIndexId: 'support-cases',
  instanceKey: 'support-cases-0123456789abcdef',
  memoriesIndex: 'ai-index-idx-support-cases',
  intervalMinutes: 360,
  connectorId: 'my-connector',
  instructions: 'Remember what customers "prefer".\nSkip {{ small talk }}.',
  factTypes: [{ type: 'preference', description: 'Something a customer likes.' }],
  entityTypes: [{ type: 'customer', attributes: ['tier'] }, { type: 'city' }],
  relationshipTypes: [{ type: 'lives_in', description: 'A customer lives in a city.' }],
};

const render = () => parse(CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW.yamlTemplate(values));
const batches = () => findStep(findStep(render().steps, 'dream').steps ?? [], 'batches');
const batchSteps = () => batches().steps ?? [];

describe('CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW', () => {
  it('is its own workflow, named and keyed apart from dreaming', () => {
    const workflow = render();
    const dreaming = parse(CONTEXT_ENGINE_DREAMING_WORKFLOW.yamlTemplate(values));

    expect(CONTEXT_ENGINE_TRANSCRIPT_DREAMING_WORKFLOW.id).not.toBe(
      CONTEXT_ENGINE_DREAMING_WORKFLOW.id
    );
    expect(workflow.name).toBe('Transcript dreaming: support-cases');
    expect(workflow.settings.concurrency.key).toBe(
      'context-engine-transcript-dreaming-support-cases-0123456789abcdef'
    );
    expect(workflow.settings.concurrency.key).not.toBe(dreaming.settings.concurrency.key);
  });

  it('writes the dreaming config into the consts exactly as given', () => {
    expect(render().consts).toEqual({
      ai_index_id: 'support-cases',
      memories_index: 'ai-index-idx-support-cases',
      connector_id: 'my-connector',
      instructions: values.instructions,
      fact_types: values.factTypes,
      entity_types: values.entityTypes,
      relationship_types: values.relationshipTypes,
    });
  });

  it('runs on its own schedule and on demand, and starts disabled', () => {
    const workflow = render();

    expect(workflow.enabled).toBe(false);
    expect(workflow.triggers).toEqual([
      { type: 'scheduled', with: { every: '360m' } },
      expect.objectContaining({ type: 'manual' }),
    ]);
  });

  it('checks transcript dreaming is on before reading transcripts or calling a model', () => {
    const { steps } = render();

    expect(steps.map(({ name }: Step) => name)).toEqual([
      'status',
      'paused',
      'last_run',
      'resume',
      'read_transcripts',
      'active',
      'dream',
      'dry_run_result',
      'output_result',
    ]);
    expect(steps[0]).toEqual(
      expect.objectContaining({
        type: 'context-engine.getDreamingStatus',
        with: { ai_index_id: '{{ consts.ai_index_id }}', source: 'transcripts' },
      })
    );
  });

  it('reads the transcripts since the given time, else where the last run stopped, else since the last run', () => {
    const read = findStep(render().steps, 'read_transcripts');
    const engine = createWorkflowLiquidEngine();
    const since = String(read.with?.since);
    const lastRun = { output: { since: '2026-11-01T00:00:00.000Z' } };
    const lastOutput = {
      output: { context: { output: { resume_from: '2026-11-03T00:00:00Z', resume_after: '[1]' } } },
    };

    expect(read.type).toBe('context-engine.readTranscripts');
    expect(engine.parseAndRenderSync(since, { inputs: {}, steps: { last_run: lastRun } })).toBe(
      '2026-11-01T00:00:00.000Z'
    );
    expect(
      engine.parseAndRenderSync(since, {
        inputs: {},
        steps: { last_run: lastRun, last_output: lastOutput },
      })
    ).toBe('2026-11-03T00:00:00Z');
    expect(
      engine.parseAndRenderSync(since, {
        inputs: { since: '2026-10-01T00:00:00Z' },
        steps: { last_run: lastRun, last_output: lastOutput },
      })
    ).toBe('2026-10-01T00:00:00Z');
  });

  it('continues after the last excerpt of a read that stopped, unless given a time', () => {
    const { steps } = render();
    const active = findStep(steps, 'active');
    const after = String(findStep(steps, 'read_transcripts').with?.after);
    const engine = createWorkflowLiquidEngine();
    const lastOutput = {
      output: { context: { output: { resume_from: '2026-11-05T00:00:00Z', resume_after: '[1]' } } },
    };
    const readOutput = {
      steps: {
        read_transcripts: {
          output: { memories: [], resume_from: '2026-11-05T00:00:00Z', resume_after: '[1]' },
        },
      },
    };

    expect(engine.parseAndRenderSync(String(active.with?.resume_from), readOutput)).toBe(
      '2026-11-05T00:00:00Z'
    );
    expect(engine.parseAndRenderSync(String(active.with?.resume_after), readOutput)).toBe('[1]');
    expect(
      engine.parseAndRenderSync(String(active.with?.resume_after), {
        steps: { read_transcripts: { output: { memories: [] } } },
      })
    ).toBe('');
    expect(
      engine.parseAndRenderSync(after, { inputs: {}, steps: { last_output: lastOutput } })
    ).toBe('[1]');
    expect(
      engine.parseAndRenderSync(after, {
        inputs: { since: '2026-10-01T00:00:00Z' },
        steps: { last_output: lastOutput },
      })
    ).toBe('');
  });

  it('extracts from batches of 10 excerpts that share permissions, and applies the changes citing them', () => {
    const extract = findStep(batchSteps(), 'extract');
    const apply = findStep(batchSteps(), 'apply_changes');
    const excerpt = (id: string, space: string) => ({
      id,
      permissions: { kibana: { privileges: [{ space }] } },
    });
    const items = [
      ...Array.from({ length: 12 }, (_, i) => excerpt(`a-${i}`, 'team-a')),
      excerpt('b-0', 'team-b'),
    ];

    const rendered = JSON.parse(
      createWorkflowLiquidEngine().parseAndRenderSync(String(batches().foreach), {
        variables: { memories: items },
      })
    ) as Array<Array<{ id: string }>>;

    expect(rendered.map((batch) => batch.length)).toEqual([10, 2, 1]);
    expect(rendered[2].map(({ id }) => id)).toEqual(['b-0']);
    expect(batchSteps().map(({ name }) => name)).toEqual([
      'read_existing',
      'extract',
      'apply_changes',
      'tally',
      'relationships',
    ]);
    expect(extract.type).toBe('ai.prompt');
    expect(apply).toEqual(
      expect.objectContaining({
        type: 'context-engine.applyDreamChanges',
        with: {
          ai_index_id: '{{ consts.ai_index_id }}',
          memories: '${{ foreach.item }}',
          changes: '${{ steps.extract.output.content }}',
          dry_run: '${{ inputs.dry_run == true }}',
        },
      })
    );
  });

  it('links what each batch writes with the same relationships step as dreaming', () => {
    const dreamingBatches = findStep(
      findStep(parse(CONTEXT_ENGINE_DREAMING_WORKFLOW.yamlTemplate(values)).steps, 'dream').steps ??
        [],
      'batches'
    );

    expect(findStep(batchSteps(), 'relationships')).toEqual(
      findStep(dreamingBatches.steps ?? [], 'relationships')
    );
  });

  it('shows the model each excerpt and the configured types, and no relationships', () => {
    const prompt = String(findStep(batchSteps(), 'extract').with?.prompt);
    const excerpt = {
      id: 'transcript:abc',
      type: 'transcript.excerpt',
      title: 'Trip, turns 1-2',
      content: 'User: I prefer aisle seats.',
      permissions: { kibana: { privileges: [{ space: 'default' }] } },
    };

    const rendered = createWorkflowLiquidEngine().parseAndRenderSync(prompt, {
      consts: render().consts,
      foreach: { item: [excerpt] },
      steps: { read_existing: { output: { hits: { hits: [] } } } },
    });

    expect(rendered).toContain('You extract long-term memory from conversation transcripts');
    expect(rendered).toContain(JSON.stringify(excerpt));
    expect(rendered).toContain('- preference: Something a customer likes.');
    expect(rendered).toContain('- customer (attributes: tier)');
    expect(rendered).not.toMatch(/relationship|relates_to/i);
    expect(rendered).toContain(values.instructions);
  });

  it('reports the excerpts it read and where to resume, and ends a dry run cancelled', () => {
    const { steps, outputs } = render();
    const [dryRunOutput] = findStep(steps, 'dry_run_result').steps ?? [];

    expect(outputs.map(({ name }: { name: string }) => name)).toEqual([
      'excerpts',
      'created',
      'updated',
      'deleted',
      'rejected',
      'relationships_created',
      'relationships_updated',
      'relationships_deleted',
      'relationships_rejected',
      'resume_from',
      'resume_after',
    ]);
    expect(findStep(steps, 'output_result').with).toEqual(
      expect.objectContaining({
        excerpts: '${{ variables.memories | size | default: 0 }}',
        resume_from: '{{ variables.resume_from }}',
        resume_after: '{{ variables.resume_after }}',
      })
    );
    expect(dryRunOutput).toEqual(
      expect.objectContaining({ type: 'workflow.output', status: 'cancelled' })
    );
  });
});
