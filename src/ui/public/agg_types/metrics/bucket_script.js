import _ from 'lodash';
import { AggTypesMetricsMetricAggTypeProvider } from 'ui/agg_types/metrics/metric_agg_type';
import { ParentPipelineAggHelperProvider } from './lib/parent_pipeline_agg_helper';
import { makeNestedLabel } from './lib/make_nested_label';
import { BcuketScriptAggControllerProvider } from './bucket_script_agg_controller';
import { bucketScriptAggWritter } from './bucket_script_agg_writter';
import bucketScriptAggTemplate from 'ui/agg_types/controls/bucket_script.html';

export function AggTypesMetricsBucketScriptProvider(Private) {
  const MetricAggType = Private(AggTypesMetricsMetricAggTypeProvider);
  const parentPipelineAggHelper = Private(ParentPipelineAggHelperProvider);
  const bucketScriptAggController = Private(BcuketScriptAggControllerProvider);

  return new MetricAggType({
    name: 'bucket_script',
    title: 'Bucket Script',
    subtype: parentPipelineAggHelper.subtype,
    makeLabel: agg => makeNestedLabel(agg, 'bucket script'),
    params: [
      {
        name: 'customMetrics',
        write: _.noop
      },
      {
        name: 'buckets_path',
        write: _.noop
      },
      {
        name: 'metricAggs',
        editor: bucketScriptAggTemplate,
        controller: bucketScriptAggController,
        write: bucketScriptAggWritter,
      }
    ],
    getFormat: parentPipelineAggHelper.getFormat
  });
}
