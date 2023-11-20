/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { SavedObjectReference } from '@kbn/core-saved-objects-common/src/server_types';
import { DataViewSpec, DataView, DataViewsPublicPluginStart } from '@kbn/data-views-plugin/public';
import { v4 as uuidv4 } from 'uuid';
import { GenericIndexPatternColumn, PersistedIndexPatternLayer } from '@kbn/lens-plugin/public';
import {
  TextBasedLayerColumn,
  TextBasedPersistedState,
} from '@kbn/lens-plugin/public/datasources/text_based/types';
import { AggregateQuery } from '@kbn/es-query';
import {
  LensAnnotationLayer,
  LensAttributes,
  LensBaseConfig,
  LensBaseLayer,
  LensDataset,
  LensDatatableDataset,
  LensESQLDataset,
} from './types';

export const getDefaultReferences = (
  index: string,
  dataLayerId: string
): SavedObjectReference[] => {
  return [
    {
      type: 'index-pattern',
      id: index,
      name: `indexpattern-datasource-layer-${dataLayerId}`,
    },
  ];
};

export function buildReferences(dataviews: Record<string, DataView>) {
  const references = [];
  for (const layerid in dataviews) {
    if (dataviews[layerid]) {
      references.push(...getDefaultReferences(dataviews[layerid].id!, layerid));
    }
  }
  return references.flat();
}

const getAdhocDataView = (dataView: DataView): Record<string, DataViewSpec> => {
  return {
    [dataView.id ?? uuidv4()]: {
      ...dataView.toSpec(),
    },
  };
};

export const getAdhocDataviews = (dataviews: Record<string, DataView>) => {
  let adHocDataViews = {};
  [...new Set(Object.values(dataviews))].forEach((d) => {
    adHocDataViews = {
      ...adHocDataViews,
      ...getAdhocDataView(d),
    };
  });

  return adHocDataViews;
};

export function isFormulaDataset(dataset?: LensDataset) {
  if (dataset && 'index' in dataset) {
    return true;
  }
  return false;
}

/**
 * it loads dataview by id or creates an ad-hoc dataview if index pattern is provided
 * @param index
 * @param dataViewsAPI
 * @param timeField
 */
export async function getDataView(
  index: string,
  dataViewsAPI: DataViewsPublicPluginStart,
  timeField?: string
) {
  let dataView: DataView;

  try {
    dataView = await dataViewsAPI.get(index, false);
  } catch {
    dataView = await dataViewsAPI.create({
      title: index,
      timeFieldName: timeField || '@timestamp',
    });
  }

  return dataView;
}

export function getDatasetIndex(dataset?: LensDataset) {
  if (!dataset) return undefined;

  let index: string;
  let timeFieldName: string = '@timestamp';

  if ('index' in dataset) {
    index = dataset.index;
    timeFieldName = dataset.timeFieldName || '@timestamp';
  } else if ('esql' in dataset) {
    index = 'kibana_sample_data_e*'; // parseIndexFromQuery(config.dataset.query);
  } else {
    return undefined;
  }

  return { index, timeFieldName };
}

function buildDatasourceStatesLayer(
  layer: LensBaseLayer,
  i: number,
  dataset: LensDataset,
  dataView: DataView | undefined,
  buildFormulaLayers: (
    config: unknown,
    i: number,
    dataView: DataView
  ) => PersistedIndexPatternLayer | undefined,
  getValueColumns: (config: unknown, i: number) => TextBasedLayerColumn[] // ValueBasedLayerColumn[]
): [
  'textBased' | 'formBased',
  PersistedIndexPatternLayer | TextBasedPersistedState['layers'][0] | undefined
] {
  function buildValueLayer(config: LensBaseLayer): TextBasedPersistedState['layers'][0] {
    const table = dataset as LensDatatableDataset;
    const newLayer = {
      table,
      columns: getValueColumns(layer, i),
      allColumns: table.columns.map(
        (column) =>
          ({
            fieldName: column.name,
            columnId: column.id,
            meta: column.meta,
          } as TextBasedLayerColumn)
      ),
      index: '',
      query: undefined,
    };

    return newLayer;
  }

  function buildESQLLayer(config: LensBaseLayer): TextBasedPersistedState['layers'][0] {
    const columns = getValueColumns(layer, i);

    const newLayer = {
      index: dataView!.id!,
      query: { esql: (config.dataset as LensESQLDataset).esql } as AggregateQuery,
      columns,
      allColumns: columns,
    };

    return newLayer;
  }

  if ('esql' in dataset) {
    return ['textBased', buildESQLLayer(layer)];
  } else if ('type' in dataset) {
    return ['textBased', buildValueLayer(layer)];
  }
  return ['formBased', buildFormulaLayers(layer, i, dataView!)];
}
export const buildDatasourceStates = async (
  config: LensBaseConfig & { layers: LensBaseLayer[] },
  dataviews: Record<string, DataView>,
  buildFormulaLayers: (
    config: unknown,
    i: number,
    dataView: DataView
  ) => PersistedIndexPatternLayer | undefined,
  getValueColumns: (config: any, i: number) => TextBasedLayerColumn[],
  dataViewsAPI: DataViewsPublicPluginStart
) => {
  const layers: LensAttributes['state']['datasourceStates'] = {
    textBased: { layers: {} },
    formBased: { layers: {} },
  };

  const mainDataset = config.dataset;
  for (let i = 0; i < config.layers.length; i++) {
    const layer = config.layers[i];
    const layerId = `layer_${i}`;
    const dataset = layer.dataset || mainDataset;

    if (!dataset && 'type' in layer && (layer as LensAnnotationLayer).type !== 'annotation') {
      throw Error('dataset must be defined');
    }

    const index = getDatasetIndex(dataset);
    const dataView = index
      ? await getDataView(index.index, dataViewsAPI, index.timeFieldName)
      : undefined;

    if (dataView) {
      dataviews[layerId] = dataView;
    }

    if (dataset) {
      const [type, layerConfig] = buildDatasourceStatesLayer(
        layer,
        i,
        dataset,
        dataView,
        buildFormulaLayers,
        getValueColumns
      );
      if (layerConfig) {
        layers[type]!.layers[layerId] = layerConfig;
      }
    }
  }

  return layers;
};
export const addLayerColumn = (
  layer: PersistedIndexPatternLayer,
  columnName: string,
  config: GenericIndexPatternColumn,
  first = false
) => {
  layer.columns = {
    ...layer.columns,
    [columnName]: config,
  };
  if (first) {
    layer.columnOrder.unshift(columnName);
  } else {
    layer.columnOrder.push(columnName);
  }
};

export const addLayerFormulaColumns = (
  layer: PersistedIndexPatternLayer,
  columns: PersistedIndexPatternLayer,
  postfix = ''
) => {
  const altObj = Object.fromEntries(
    Object.entries(columns.columns).map(([key, value]) =>
      // Modify key here
      [`${key}${postfix}`, value]
    )
  );

  layer.columns = {
    ...layer.columns,
    ...altObj,
  };
  layer.columnOrder.push(...columns.columnOrder.map((c) => `${c}${postfix}`));
};
