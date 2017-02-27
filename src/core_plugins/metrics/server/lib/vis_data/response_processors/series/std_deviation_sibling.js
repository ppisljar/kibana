import _ from 'lodash';
import getDefaultDecoration from '../../get_default_decoration';
import getSplits from '../../get_splits';
import getLastMetric from '../../get_last_metric';
import getSiblingAggValue from '../../get_sibling_agg_value';
export default function stdDeviationSibling(resp, panel, series) {
  return next => results => {
    const metric = getLastMetric(series);
    if (metric.mode === 'band' && metric.type === 'std_deviation_bucket') {
      const decoration = getDefaultDecoration(series);
      getSplits(resp, series).forEach((split) => {

        const mapBucketByMode = (mode) => {
          return bucket => {
            return [bucket.key, getSiblingAggValue(split, _.assign({}, metric, { mode }))];
          };
        };

        const upperData = split.timeseries.buckets
          .map(mapBucketByMode('upper'));
        const lowerData = split.timeseries.buckets
          .map(mapBucketByMode('lower'));

        results.push({
          id: `${split.id}:lower`,
          lines: { show: true, fill: false, lineWidth: 0 },
          points: { show: false },
          color: split.color,
          data: lowerData
        });
        results.push({
          id: `${split.id}:upper`,
          label: split.label,
          color: split.color,
          lines: { show: true, fill: 0.5, lineWidth: 0 },
          points: { show: false },
          fillBetween: `${split.id}:lower`,
          data: upperData
        });

      });
    }

    return next(results);
  };



}

