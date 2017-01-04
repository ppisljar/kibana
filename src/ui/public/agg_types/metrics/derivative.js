import AggTypesMetricsMetricAggTypeProvider from 'ui/agg_types/metrics/metric_agg_type';
import metricEditor from 'ui/agg_types/controls/metric.html';
import _ from 'lodash';

export default function AggTypeMetricDerivativeProvider(Private) {
  const DerivativeAggType = Private(AggTypesMetricsMetricAggTypeProvider);

  return new DerivativeAggType({
    name: 'derivative',
    title: 'Derivative',
    makeLabel: function (aggConfig) {
      return 'Derivative of ' + aggConfig.getFieldDisplayName();
    },
    params: [
      {
        name: 'buckets_path',
        filterMetricTypes: 'number',
        editor: metricEditor,
        controller: function ($scope) {

          $scope.safeMakeLabel = function (agg) {
            try {
              return agg.makeLabel();
            } catch (e) {
              return '- agg not valid -';
            }
          };

          function updateOrderAgg() {
            const agg = $scope.agg;
            const aggs = agg.vis.aggs;
            const allowedAggs = _.filter(aggs, agg => {
              return agg.schema.name === 'metric';
            });
          }

          $scope.$watch('responseValueAggs', updateOrderAgg);
        },
        write(agg, output) {
          const metricId = agg.params.buckets_path;
          const metric = agg.vis.aggs.find(agg => agg.id === metricId);
          output.params = {};

          if (metric.type.name === 'count') {
            output.params.buckets_path = '_count';
          } else {
            output.params.buckets_path = metric.id;
          }
        }

      },
      {
        name: 'unit',
        label: 'Unit',
        write: _.noop
      }
    ]
  });
}
