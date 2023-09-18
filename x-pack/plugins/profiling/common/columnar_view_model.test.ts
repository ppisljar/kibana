/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import {
  createBaseFlameGraph,
  createCalleeTree,
  createFlameGraph,
  decodeStackTraceResponse,
} from '@kbn/profiling-utils';
import { sum } from 'lodash';
import { createColumnarViewModel } from './columnar_view_model';
import { stackTraceFixtures } from './__fixtures__/stacktraces';

describe('Columnar view model operations', () => {
  stackTraceFixtures.forEach(({ response, seconds, upsampledBy }) => {
    const { events, stackTraces, stackFrames, executables, totalFrames, samplingRate } =
      decodeStackTraceResponse(response);
    const tree = createCalleeTree(
      events,
      stackTraces,
      stackFrames,
      executables,
      totalFrames,
      samplingRate
    );
    const graph = createFlameGraph(createBaseFlameGraph(tree, samplingRate, seconds));

    describe(`stacktraces from ${seconds} seconds and upsampled by ${upsampledBy}`, () => {
      describe('color values are generated by default', () => {
        const viewModel = createColumnarViewModel(graph);

        test('length of colors is equal to length of labels multipled by 4', () => {
          expect(viewModel.color.length).toEqual(viewModel.label.length * 4);
        });

        test('length of position0 is equal to length of labels multipled by 2', () => {
          expect(viewModel.position0.length).toEqual(viewModel.label.length * 2);
        });

        test('length of position1 is equal to length of labels multipled by 2', () => {
          expect(viewModel.position1.length).toEqual(viewModel.label.length * 2);
        });

        test('length of size0 is equal to length of labels', () => {
          expect(viewModel.size0.length).toEqual(viewModel.label.length);
        });

        test('length of size1 is equal to length of labels', () => {
          expect(viewModel.size1.length).toEqual(viewModel.label.length);
        });

        test('length of values is equal to length of labels', () => {
          expect(viewModel.value.length).toEqual(viewModel.label.length);
        });

        test('both position arrays are equal', () => {
          expect(viewModel.position0).toEqual(viewModel.position1);
        });

        test('both size arrays are equal', () => {
          expect(viewModel.size0).toEqual(viewModel.size1);
        });

        test('sum of colors is greater than zero', () => {
          expect(sum(viewModel.color)).toBeGreaterThan(0);
        });
      });

      describe('color values are not generated when disabled', () => {
        const viewModel = createColumnarViewModel(graph, false);

        test('length of colors is equal to length of labels multipled by 4', () => {
          expect(viewModel.color.length).toEqual(viewModel.label.length * 4);
        });

        test('length of position0 is equal to length of labels multipled by 2', () => {
          expect(viewModel.position0.length).toEqual(viewModel.label.length * 2);
        });

        test('length of position1 is equal to length of labels multipled by 2', () => {
          expect(viewModel.position1.length).toEqual(viewModel.label.length * 2);
        });

        test('length of size0 is equal to length of labels', () => {
          expect(viewModel.size0.length).toEqual(viewModel.label.length);
        });

        test('length of size1 is equal to length of labels', () => {
          expect(viewModel.size1.length).toEqual(viewModel.label.length);
        });

        test('length of values is equal to length of labels', () => {
          expect(viewModel.value.length).toEqual(viewModel.label.length);
        });

        test('both position arrays are equal', () => {
          expect(viewModel.position0).toEqual(viewModel.position1);
        });

        test('both size arrays are equal', () => {
          expect(viewModel.size0).toEqual(viewModel.size1);
        });

        test('sum of colors is equal to zero', () => {
          expect(sum(viewModel.color)).toEqual(0);
        });
      });
    });
  });
});
