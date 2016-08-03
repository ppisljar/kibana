import { noop, get } from 'lodash';
import AggTypesMetricsMetricAggTypeProvider from 'ui/agg_types/metrics/metric_agg_type';
import topTemplate from 'ui/agg_types/controls/top.html';

export default function AggTypeMetricTopProvider(Private) {
  let MetricAggType = Private(AggTypesMetricsMetricAggTypeProvider);

  return new MetricAggType({
    name: 'top_hits',
    title: 'Top',
    makeLabel: function (aggConfig) {
      const prefix = aggConfig.params.sortOrder.val === 'desc' ? 'Latest' : 'Earliest';
      return `${prefix} ${aggConfig.params.field.displayName}`;
    },
    params: [
      {
        name: 'field',
        write(agg, output) {
          output.params = {
            _source: agg.params.field.name
          };
        }
      },
      {
        name: 'sortField',
        type: 'field',
        editor: null,
        filterFieldTypes: ['number', 'date', 'ip',  'string'],
        default: function (agg) {
          return agg.vis.indexPattern.timeFieldName;
        },
        write: noop
      },
      {
        name: 'size',
        default: 1
      },
      {
        name: 'sortOrder',
        type: 'optioned',
        default: 'desc',
        editor: topTemplate,
        options: [
          { display: 'Descending', val: 'desc' },
          { display: 'Ascending', val: 'asc' }
        ],
        write: function (agg, output) {
          output.params.sort = {
            [agg.params.sortField.name]: {
              order: agg.params.sortOrder.val
            }
          };
        }
      }
    ],
    getValue(agg, bucket) {
      return get(bucket[agg.id].hits.hits[0]._source, agg.params.field.name);
    }
  });
};
