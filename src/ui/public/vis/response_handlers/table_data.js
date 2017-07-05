import _ from 'lodash';
import { VisResponseHandlersRegistryProvider } from 'ui/registry/vis_response_handlers';

const TableResponseHandlerProvider = function () {

  /***
   * Prepares table out of esResponse.
   * each metric will add a column, each bucket will add a row, nested buckets will produce multiple tables
   *
   * @param vis
   * @param esResponse
   */
  return {
    name: 'table_data',
    handler: (vis, esResponse) => {
      const metrics = vis.aggs.filter(agg => agg.schema.group === 'metrics');
      const buckets = vis.aggs.filter(agg => agg.schema.group === 'buckets');

      const getValues = (data) => {
        return _.map(metrics, metric => {
          if (metric.type.name === 'count') {
            return data.doc_count;
          } else {
            return data[metric.id].value;
          }
        });
      };

      const buildTable = (data) => {
        if (buckets.length === 0) {
          return [{ key: null, values: getValues(data) }];
        } else {
          return _.map(data.buckets, bucket => {
            return { key: bucket.key, values: getValues(bucket) };
          });
        }
      };

      const buildTableWrapper = (data) => {
        const result = buildTable(data);
        const lastBucket = _.last(buckets);

        if (lastBucket) {
          result.row = {
            name: lastBucket.makeLabel(),
            type: lastBucket.type.name,
            params: lastBucket._opts.params,
            formatter: lastBucket.fieldFormatter('text'),
            agg: lastBucket
          };
        }

        result.cells = metrics.map(metric => {
          return {
            name: metric.makeLabel(),
            type: metric.type.name,
            params: metric._opts.params,
            formatter: metric.fieldFormatter('text'),
            agg: metric
          };
        });

        return result;
      };

      let response;
      if (buckets.length > 2) {
        Promise.reject('only two bucket aggs are supported for table_data response converter');
      } else if (buckets.length === 2) {
        response = _.map(esResponse.aggregations[buckets[0].id].buckets, bucket => {
          return buildTableWrapper(bucket);
        });
      } else if (buckets.length === 1) {
        response = buildTableWrapper(esResponse.aggregations[buckets[0].id]);
      } else {
        if (metrics.length > 1 || metrics[0].type.name !== 'count') {
          esResponse.aggregations.doc_count = esResponse.hits.total;
          response = buildTableWrapper(esResponse.aggregations);
        } else {
          esResponse.doc_count = esResponse.hits.total;
          response = buildTableWrapper(esResponse);
        }
      }

      response.hits = esResponse.hits.total;

      return Promise.resolve(response);

    }
  };
};

VisResponseHandlersRegistryProvider.register(TableResponseHandlerProvider);

export { TableResponseHandlerProvider };
