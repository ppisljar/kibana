import _ from 'lodash';
import VisAggConfigProvider from 'ui/vis/agg_config';
import AggConfigResult from 'ui/vis/agg_config_result';

export default function GetColumnsProvider(Private) {
  const AggConfig = Private(VisAggConfigProvider);

  return (vis, esResponse) => {
    const rowSplits = {};
    const columnSplits = {};
    const metrics = {};
    const rowData = {};
    const aggs = vis.aggs.getResponseAggs();

    const builRowsAndColumns = () => {
      _.each(aggs, agg => {
        if (agg.schema.name === 'metric') metrics[agg.id] = agg;
        else if (agg.schema.name === 'rows') {
          rowSplits[agg.id] = {
            agg: agg,
            values: []
          };
        }
        else if (agg.schema.name === 'columns') {
          columnSplits[agg.id] = {
            agg: agg,
            values: []
          };
        }
      });
    };

    const getBucketValues = (data, path = '') => {
      _.each(data, (aggResult, key) => {
        const agg = _.find(aggs, agg => key === agg.id);
        const parentAgg = _.filter(aggs, agg => key === agg.parentId);
        if (!agg && !parentAgg.length) {
          if (data.doc_count) {
            rowData[path + '/Count'] = new AggConfigResult(new AggConfig(vis, {
              type: 'count',
              schema: vis.type.schemas.metrics[0].name
            }), null, data.doc_count, data.doc_count);
          }
          return;
        }
        if (aggResult.buckets) {
          aggResult.buckets.forEach(bucket => {
            if (agg.schema.title === 'Split Rows' && !rowSplits[agg.id].values.includes(bucket.key)) {
              rowSplits[agg.id].values.push(bucket.key);
            }
            if (agg.schema.title === 'Split Columns' && !columnSplits[agg.id].values.includes(bucket.key)) {
              columnSplits[agg.id].values.push(bucket.key);
            }
            getBucketValues(bucket, path + '/' + bucket.key);
          });
        } else {
          if (data.doc_count) {
            rowData[path + '/Count'] = new AggConfigResult(new AggConfig(vis, {
              type: 'count',
              schema: vis.type.schemas.metrics[0].name
            }), null, data.doc_count, data.doc_count);
          }
          if (parentAgg.length) {
            parentAgg.forEach(agg => {
              rowData[path + '/' + agg.makeLabel()] = new AggConfigResult(
                agg,
                vis.aggs.find(requestAgg => requestAgg.id === agg.parentId),
                agg.getValue(data),
                agg.getValue(data)
              );
            });
          } else {
            rowData[path + '/' + agg.makeLabel()] = new AggConfigResult(
              agg,
              null,
              aggResult.value,
              aggResult.value
            );
          }
        }
      });
    };

    builRowsAndColumns();
    if (esResponse.aggregations) {
      getBucketValues(esResponse.aggregations);
    } else {
      rowData['/Count'] = new AggConfigResult(new AggConfig(vis, {
        type: 'count',
        schema: vis.type.schemas.metrics[0].name
      }), null, esResponse.hits.total, esResponse.hits.total);
    }

    const getRows = (i, cb, values = []) => {
      const row = Object.values(rowSplits)[i];
      if (!row) return cb([]);
      const agg = row.agg;
      if (!row) cb([]);
      _.each(row.values, rowVal => {
        const newValues = _.clone(values);
        newValues.push(new AggConfigResult(agg, null, rowVal, rowVal));
        if (Object.values(rowSplits).length > i + 1) {
          getRows(i + 1, cb, newValues);
        } else cb(newValues);
      });
    };

    const getCols = (i, cb, values = []) => {
      const col = Object.values(columnSplits)[i];
      const agg = col.agg;
      _.each(col.values, colVal => {
        const newValues = _.clone(values);
        newValues.push(agg ? new AggConfigResult(agg, null, colVal, colVal) : colVal);
        if (Object.values(columnSplits).length > i + 1) {
          getCols(i + 1, cb, newValues);
        } else cb(newValues);
      });
    };

    // getMetrics should produce either columns or rows
    if (true) {
      columnSplits['99'] = {
        values: _.map(metrics, metric => {
          return metric.makeLabel();
        })
      };
    }

    const data = [];
    getRows(0, (row) => {
      const fData = [].concat(row);
      getCols(0, (column) => {
        const keys = row.concat(column);
        keys.sort((a, b) => {
          if (!b.aggConfig) return -1;
          return aggs.indexOf(a.aggConfig) > aggs.indexOf(b.aggConfig);
        });
        const val = '/' + _.map(keys, key => key.value || key).join('/');
        fData.push(rowData[val] || 0);
      });
      data.push(fData);
    });

    const headerdata = [];
    let lastRow = 1;
    _.each(columnSplits, (column, n) => {
      let row = _.map(rowSplits, rowSplit => {
        if (n !== '99') return '';
        return rowSplit.agg.makeLabel();
      });
      for (let i = 0; i < lastRow; i++) {
        row = row.concat(column.values);
      }
      lastRow *= column.values.length;
      headerdata.push(row);
    });

    return {
      header: headerdata,
      data: data,
      columns: columnSplits,
      rows: rowSplits,
      metrics: metrics,
      rowData: rowData
    };
  };
}
