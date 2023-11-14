/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { FormulaPublicApi, TypedLensByValueInput } from '@kbn/lens-plugin/public';
import { Filter, Query } from '@kbn/es-query';
import { DataViewsPublicPluginStart } from '@kbn/data-views-plugin/public';
import { Datatable } from '@kbn/expressions-plugin/common';

export type LensAttributes = TypedLensByValueInput['attributes'];
export const DEFAULT_LAYER_ID = 'layer_0';

type Identity<T> = T extends object
  ? {
      [P in keyof T]: T[P];
    }
  : T;

export type ChartType =
  | 'xy'
  | 'pie'
  | 'heatmap'
  | 'metric'
  | 'gauge'
  | 'donut'
  | 'mosaic'
  | 'regionmap'
  | 'table'
  | 'tagcloud'
  | 'treemap';

export interface TimeRange {
  from: string;
  to: string;
  type: 'relative' | 'absolute';
}

export type LensLayerQuery = string;
export interface LensDataviewDataset {
  index: string;
  timeFieldName?: string;
}

export type LensDatatableDataset = Datatable;

export interface LensESQLDataset {
  query: string;
}

export type LensDataset = LensDataviewDataset | LensDatatableDataset | LensESQLDataset;

export interface LensBaseConfig {
  title: string;
  /** default data view id or index pattern to use, it can be overriden on each query */
  dataset: LensDataset;
}

export interface LensBaseLayer {
  label: string;
  filter?: string;
  format?: 'bytes' | 'currency' | 'duration' | 'number' | 'percent' | 'string';
  randomSampling?: number;
  useGlobalFilter?: boolean;
  seriesColor?: string;
  dataset?: LensDataset;
  query: LensLayerQuery;
}

export type LensConfig = (
  | LensMetricConfig
  | LensGaugeConfig
  | LensPieConfig
  | LensHeatmapConfig
  | LensMosaicConfig
  | LensRegionMapConfig
  | LensTableConfig
  | LensTagCloudConfig
  | LensTreeMapConfig
  | LensXYConfig
) &
  LensBaseConfig;

export interface LensConfigOptions {
  /** if true the output will be embeddable input, else lens attributes */
  embeddable?: boolean;
  /** optional time range override */
  timeRange?: TimeRange;
  filters?: Filter[];
  query?: Query;
}

export interface LensLegendConfig {
  show?: boolean;
  position?: 'top' | 'left' | 'bottom' | 'right';
}

export interface LensBreakdownDateHistogramConfig {
  type: 'dateHistogram';
  field: string;
  minimumInterval?: string;
}

export interface LensBreakdownFiltersConfig {
  type: 'filters';
  filters: Array<{
    label?: string;
    filter: string;
  }>;
}

export interface LensBreakdownIntervalsConfig {
  type: 'intervals';
  field: string;
  granularity?: number;
}

export interface LensBreakdownTopValuesConfig {
  type: 'topValues';
  field: string;
  size?: number;
}

export type LensBreakdownConfig =
  | string
  | Identity<
      (
        | LensBreakdownTopValuesConfig
        | LensBreakdownIntervalsConfig
        | LensBreakdownFiltersConfig
        | LensBreakdownDateHistogramConfig
      ) & { colorPalette?: string }
    >;

export interface LensMetricConfig {
  chartType: 'metric';
  layers: [
    Identity<
      LensBaseLayer & {
        // must be a single layer!
        querySecondaryMetric?: LensLayerQuery;
        queryMaxValue?: LensLayerQuery;
        /** field name to apply breakdown based on field type or full breakdown configuration */
        breakdown?: LensBreakdownConfig;
        trendLine?: boolean;
      }
    >
  ];
}

export interface LensGaugeConfig {
  chartType: 'gauge';
  layers: [
    Identity<
      LensBaseLayer & {
        // must be a single layer!
        queryMinValue?: LensLayerQuery;
        queryMaxValue?: LensLayerQuery;
        queryGoalValue?: LensLayerQuery;
        shape?: 'arc' | 'circle' | 'horizontalBullet' | 'verticalBullet';
      }
    >
  ];
}

export interface LensPieConfig {
  chartType: 'pie' | 'donut';
  layers: [
    Identity<
      LensBaseLayer & {
        // must be a single layer!
        /** field name to apply breakdown based on field type or full breakdown configuration */
        breakdown: LensBreakdownConfig[];
      }
    >
  ];
  legend?: Identity<LensLegendConfig>;
}

export interface LensTreeMapConfig {
  chartType: 'treemap';
  layers: [
    Identity<
      LensBaseLayer & {
        // must be a single layer!
        /** field name to apply breakdown based on field type or full breakdown configuration */
        breakdown: LensBreakdownConfig[];
      }
    >
  ];
}

export interface LensTagCloudConfig {
  chartType: 'tagcloud';
  layers: [
    Identity<
      LensBaseLayer & {
        // must be a single layer!
        /** field name to apply breakdown based on field type or full breakdown configuration */
        breakdown: LensBreakdownConfig;
      }
    >
  ];
}

export interface LensRegionMapConfig {
  chartType: 'regionmap';
  layers: [
    Identity<
      LensBaseLayer & {
        // must be a single layer!
        /** field name to apply breakdown based on field type or full breakdown configuration */
        breakdown: LensBreakdownConfig;
      }
    >
  ];
}

export interface LensMosaicConfig {
  chartType: 'mosaic';
  layers: [
    Identity<
      LensBaseLayer & {
        // must be a single layer!
        /** field name to apply breakdown based on field type or full breakdown configuration */
        breakdown: LensBreakdownConfig;
        /** field name to apply breakdown based on field type or full breakdown configuration */
        xAxis: LensBreakdownConfig;
      }
    >
  ];
}

export interface LensTableConfig {
  chartType: 'table';
  /** *
   * single layer must be defined (layers: [{ ... }])
   */
  layers: [
    Identity<
      LensBaseLayer & {
        /** field name to breakdown based on field type or full breakdown configuration */
        splitBy?: LensBreakdownConfig[];
        /** field name to breakdown based on field type or full breakdown configuration */
        breakdown?: LensBreakdownConfig[];
      }
    >
  ];
}

export interface LensHeatmapConfig {
  chartType: 'heatmap';
  /** configure a single layer */
  layers: [
    Identity<
      LensBaseLayer & {
        // must be a single layer!
        /** field name to apply breakdown based on field type or full breakdown configuration */
        breakdown: LensBreakdownConfig;
        xAxis: LensBreakdownConfig;
      }
    >
  ];
  legend?: Identity<LensLegendConfig>;
}

export interface LensReferenceLineLayerBase {
  type: 'reference';
  lineThickness?: number;
  color?: string;
  fill?: 'none' | 'above' | 'below';
}

export type LensReferenceLineLayer = LensReferenceLineLayerBase & LensBaseLayer;

export interface LensAnnotationLayerBaseProps {
  name: string;
  color?: string;
  icon?: string;
}

export interface LensAnnotationLayer {
  type: 'annotation';
  index?: string;
  timeFieldName?: string;
  events: Array<
    | Identity<
        LensAnnotationLayerBaseProps & {
          datetime: string;
        }
      >
    | Identity<
        LensAnnotationLayerBaseProps & {
          field: string;
          filter: string;
        }
      >
  >;
}

export type LensSeriesLayer = Identity<
  LensBaseLayer & {
    type: 'series';
    breakdown?: LensBreakdownConfig;
    xAxis: LensBreakdownConfig;
    seriesType: 'line' | 'bar' | 'area';
  }
>;

export interface LensXYConfig {
  chartType: 'xy';
  layers: Array<LensSeriesLayer | LensAnnotationLayer | LensReferenceLineLayer>;
  legend?: Identity<LensLegendConfig>;
}
export interface BuildDependencies {
  dataViewsAPI: DataViewsPublicPluginStart;
  formulaAPI: FormulaPublicApi;
}
