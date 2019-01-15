/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import _ from 'lodash';

export function getPoint(table, x, series, yScale, row, rowIndex, y, z) {
  const zRow = z && row[z.accessor];
  const xRow = x.accessor === -1 ? '_all' : row[x.accessor];
  const yRow = row[y.accessor];

  const point = {
    x: xRow,
    y: yRow,
    z: zRow,
    extraMetrics: _.compact([zRow]),
    yScale: yScale,
    seriesRaw: series && {
      table,
      column: series[0].column,
      row: rowIndex,
      value: row[series[0].accessor],
    },
    xRaw: {
      table,
      column: x.column,
      row: rowIndex,
      value: xRow,
    },
    yRaw: {
      table,
      column: y.column,
      row: rowIndex,
      value: yRow,
    },
    zRaw: z && {
      table,
      column: z.column,
      row: rowIndex,
      value: zRow,
    },
    tableRaw: table.$parent && {
      table: table.$parent.table,
      column: table.$parent.column,
      row: table.$parent.row,
      value: table.$parent.key,
      title: table.$parent.name,

    },
    parent: series[0],
  };

  if (point.y === 'NaN') {
    // filter out NaN from stats
    // from metrics that are not based at zero
    return;
  }

  if (series) {
    const seriesArray = series.length ? series : [ series ];
    point.series = seriesArray.map(s => s.fieldFormatter(row[s.accessor])).join(' - ');
  } else if (y) {
    // If the data is not split up with a series aspect, then
    // each point's "series" becomes the y-agg that produced it
    //point.aggConfig = y.aggConfig;
    point.series = y.title;
  }

  if (yScale) {
    point.y *= yScale;
  }

  return point;
}
