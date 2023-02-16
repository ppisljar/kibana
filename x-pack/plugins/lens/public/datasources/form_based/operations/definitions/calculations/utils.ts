/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';
import type { AstFunction } from '@kbn/interpreter';
import memoizeOne from 'memoize-one';
import { LayerTypes } from '@kbn/expression-xy-plugin/public';
import type { IndexPattern } from '../../../../../types';
import { LayerType } from '../../../../../../common';
import type { TimeScaleUnit } from '../../../../../../common/expressions';
import type { FormBasedLayer } from '../../../types';
import { adjustTimeScaleLabelSuffix } from '../../time_scale_utils';
import type { ReferenceBasedIndexPatternColumn } from '../column_types';
import { getManagedColumnsFrom, isColumnValidAsReference } from '../../layer_helpers';
import { operationDefinitionMap } from '..';
import { FieldBasedIndexPatternColumn } from '../../../types';
import {IndexPatternField} from "../../../../../types";

export const buildLabelFunction =
  (ofName: (name?: string) => string) =>
  (name?: string, timeScale?: TimeScaleUnit, timeShift?: string) => {
    const rawLabel = ofName(name);
    return adjustTimeScaleLabelSuffix(
      rawLabel,
      undefined,
      timeScale,
      undefined,
      timeShift,
      undefined,
      undefined
    );
  };

export function checkForDataLayerType(layerType: LayerType, name: string) {
  if (layerType === LayerTypes.REFERENCELINE) {
    return [
      i18n.translate('xpack.lens.indexPattern.calculations.layerDataType', {
        defaultMessage: '{name} is disabled for this type of layer.',
        values: {
          name,
        },
      }),
    ];
  }
}

/**
 * Checks whether the current layer includes a date histogram and returns an error otherwise
 */
export function checkForDateHistogram(layer: FormBasedLayer, name: string) {
  const buckets = layer.columnOrder.filter((colId) => layer.columns[colId].isBucketed);
  const hasDateHistogram = buckets.some(
    (colId) => layer.columns[colId].operationType === 'date_histogram'
  );
  if (hasDateHistogram) {
    return undefined;
  }
  return [
    i18n.translate('xpack.lens.indexPattern.calculations.dateHistogramErrorMessage', {
      defaultMessage:
        '{name} requires a date histogram to work. Add a date histogram or select a different function.',
      values: {
        name,
      },
    }),
  ];
}

const getFullyManagedColumnIds = memoizeOne((layer: FormBasedLayer) => {
  const managedColumnIds = new Set<string>();
  Object.entries(layer.columns).forEach(([id, column]) => {
    if (
      'references' in column &&
      operationDefinitionMap[column.operationType].input === 'managedReference'
    ) {
      managedColumnIds.add(id);
      const managedColumns = getManagedColumnsFrom(id, layer.columns);
      managedColumns.map(([managedId]) => {
        managedColumnIds.add(managedId);
      });
    }
  });
  return managedColumnIds;
});

export function checkReferences(layer: FormBasedLayer, columnId: string) {
  const column = layer.columns[columnId] as ReferenceBasedIndexPatternColumn;

  const errors: string[] = [];

  column.references.forEach((referenceId, index) => {
    if (!layer.columns[referenceId]) {
      errors.push(
        i18n.translate('xpack.lens.indexPattern.missingReferenceError', {
          defaultMessage: '"{dimensionLabel}" is not fully configured',
          values: {
            dimensionLabel: column.label,
          },
        })
      );
    } else {
      const referenceColumn = layer.columns[referenceId]!;
      const definition = operationDefinitionMap[column.operationType];
      if (definition.input !== 'fullReference') {
        throw new Error('inconsistent state - column is not a reference operation');
      }
      const requirements = definition.requiredReferences[index];
      const isValid = isColumnValidAsReference({
        validation: requirements,
        column: referenceColumn,
      });

      // do not enforce column validity if current column is part of managed subtree
      if (!isValid && !getFullyManagedColumnIds(layer).has(columnId)) {
        errors.push(
          i18n.translate('xpack.lens.indexPattern.invalidReferenceConfiguration', {
            defaultMessage: 'Dimension "{dimensionLabel}" is configured incorrectly',
            values: {
              dimensionLabel: column.label,
            },
          })
        );
      }
    }
  });
  return errors.length ? errors : undefined;
}

export function getErrorsForDateReference(layer: FormBasedLayer, columnId: string, name: string) {
  const dateErrors = checkForDateHistogram(layer, name) ?? [];
  const referenceErrors = checkReferences(layer, columnId) ?? [];
  if (dateErrors.length || referenceErrors.length) {
    return [...dateErrors, ...referenceErrors];
  }
  return;
}

export function hasDateField(indexPattern: IndexPattern) {
  return indexPattern.fields.some((field) => field.type === 'date');
}

/**
 * Creates an expression ast for a date based operation (cumulative sum, derivative, moving average, counter rate)
 */
export function dateBasedOperationToExpression(
  layer: FormBasedLayer,
  columnId: string,
  functionName: string,
  additionalArgs: Record<string, unknown[]> = {}
): AstFunction[] {
  const currentColumn = layer.columns[columnId] as unknown as ReferenceBasedIndexPatternColumn;
  const buckets = layer.columnOrder.filter((colId) => layer.columns[colId].isBucketed);
  const dateColumnIndex = buckets.findIndex(
    (colId) => layer.columns[colId].operationType === 'date_histogram'
  )!;
  buckets.splice(dateColumnIndex, 1);

  return [
    {
      type: 'function',
      function: functionName,
      arguments: {
        by: buckets,
        inputColumnId: [currentColumn.references[0]],
        outputColumnId: [columnId],
        outputColumnName: [currentColumn.label],
        ...additionalArgs,
      },
    },
  ];
}

/**
 * Creates an expression ast for a date based operation (cumulative sum, derivative, moving average, counter rate)
 */
export function optionallHistogramBasedOperationToExpression(
  layer: FormBasedLayer,
  columnId: string,
  functionName: string,
  additionalArgs: Record<string, unknown[]> = {}
): AstFunction[] {
  const currentColumn = layer.columns[columnId] as unknown as ReferenceBasedIndexPatternColumn;
  const buckets = layer.columnOrder.filter((colId) => layer.columns[colId].isBucketed);
  const nonHistogramColumns = buckets.filter(
    (colId) =>
      layer.columns[colId].operationType !== 'date_histogram' &&
      layer.columns[colId].operationType !== 'range'
  )!;

  return [
    {
      type: 'function',
      function: functionName,
      arguments: {
        by: nonHistogramColumns.length === buckets.length ? [] : nonHistogramColumns,
        inputColumnId: [currentColumn.references[0]],
        outputColumnId: [columnId],
        outputColumnName: [currentColumn.label],
        ...additionalArgs,
      },
    },
  ];
}

function isMetricCounterField(field?: IndexPatternField) {
  return field?.timeSeriesMetric === 'counter';
}

function checkReferencedColumnMetric(
  layer: FormBasedLayer,
  columnId: string,
  indexPattern: IndexPattern
) {
  const column = layer.columns[columnId] as ReferenceBasedIndexPatternColumn;
  return column.references
    .filter((referencedId) => 'sourceField' in layer.columns[referencedId])
    .map((referencedId) => {
      const fieldName = (layer.columns[referencedId] as FieldBasedIndexPatternColumn).sourceField;
      if (!isMetricCounterField(indexPattern.getFieldByName(fieldName))) {
        return i18n.translate('xpack.lens.indexPattern.invalidReferenceConfiguration', {
          defaultMessage: 'Dimension "{dimensionLabel}" is configured incorrectly',
          values: {
            dimensionLabel: layer.columns[referencedId].label,
          },
        });
      }
    });
}

export function getErrorForRateReference(
  layer: FormBasedLayer,
  columnId: string,
  name: string,
  indexPattern: IndexPattern
) {
  const dateErrors = checkForDateHistogram(layer, name) ?? [];
  const referenceErrors = checkReferences(layer, columnId) ?? [];
  const metricCounterErrors = checkReferencedColumnMetric(layer, columnId, indexPattern) ?? [];
  if (metricCounterErrors.length) {
    return metricCounterErrors.concat(referenceErrors);
  }
  if (dateErrors.length) {
    return dateErrors.concat(referenceErrors);
  }
}
