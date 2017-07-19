import _ from 'lodash';
import { VisResponseHandlersRegistryProvider } from 'ui/registry/vis_response_handlers';

const SeriesResponseHandlerProvider = function () {
  /***
   * Prepares series out of esResponse.
   * each combination of metric, segment bucket and group bucket will add a series
   * each split bucket will create multiple charts
   *
   * @param vis
   * @param esResponse
   */
  return {
    name: 'series_data',
    handler: (vis, esResponse) => {

      const metrics = vis.aggs.filter(agg => agg.schema.group === 'metrics');
      const buckets = vis.aggs.filter(agg => agg.schema.group === 'buckets');
      const lastBucket = _.last(buckets);

      const charts = {};
      const getSeries = (data, chart, seri, category, done) => {
        if (done) {
          _.map(metrics, metric => {
            const name = seri + metric.makeLabel();
            const value = (metric.type.name === 'count') ? data.doc_count : data[metric.id].value;
            if (!charts[chart]) charts[chart] = { title: '', series: {} };
            if (!charts[chart].series[name]) {
              charts[chart].series[name] = {
                aggId: metric.id,
                label: name,
                type: metric.type.name,
                params: metric._opts.params,
                formatter: metric.fieldFormatter('text'),
                values: []
              };
            }
            charts[chart].series[name].values.push({
              x: category,
              y: value
            });
          });
          return;
        }

        _.map(data, (agg, id) => {
          if (!_.isObject(agg)) return;
          const aggConfig = vis.aggs.find(agg => agg.id === id);
          if (!aggConfig) throw 'undefined aggregation while converting series data';

          if (aggConfig.schema.name === 'split') {
            agg.buckets.forEach(bucket => {
              if (!charts[bucket.key]) {
                charts[bucket.key] = {
                  title: bucket.key + ': ' + aggConfig.makeLabel(bucket.key),
                  series: {}
                };
              }
              chart = bucket.key;
              return getSeries(bucket, chart, seri, category, id === lastBucket.id);
            });
          } else if (aggConfig.schema.name === 'segment') {
            agg.buckets.forEach(bucket => {
              return getSeries(bucket, chart, seri, bucket.key, id === lastBucket.id);
            });

          } else if (aggConfig.schema.group === 'buckets') {
            agg.buckets.forEach(bucket => {
              return getSeries(bucket, chart, seri + bucket.key + ': ', category, id === lastBucket.id);
            });
          }

        });
      };

      let result;
      if (buckets.length === 0) {
        if (metrics.length > 1 || metrics[0].type.name !== 'count') {
          esResponse.aggregations.doc_count = esResponse.hits.total;
          getSeries(esResponse.aggregations, 0, '');
          result = { charts: charts };
        } else {
          result = {
            charts: {
              label: '',
              series: {
                label: 'Count',
                values: [ esResponse.hits.total ]
              }
            }
          };
        }
      } else {
        getSeries(esResponse.aggregations, 0, '');
        result = {
          charts: _.map(charts, chart => {
            chart.series = _.values(chart.series);
            return chart;
          })
        };
      }

      result.hits = esResponse.hits.total;

      return Promise.resolve(result);
    }
  };
};

VisResponseHandlersRegistryProvider.register(SeriesResponseHandlerProvider);

export { SeriesResponseHandlerProvider };
