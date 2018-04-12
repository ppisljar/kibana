import { MetricAggType } from 'ui/agg_types/metrics/metric_agg_type';

export const avgMetricAgg = new MetricAggType({
  name: 'avg',
  title: 'Average',
  makeLabel: function (aggConfig) {
    return 'Average ' + aggConfig.getFieldDisplayName();
  },
  params: [
    {
      name: 'field',
      filterFieldTypes: 'number'
    }
  ]
});
