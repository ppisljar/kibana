import offsetTime from '../../offset_time';
import getIntervalAndTimefield from '../../get_interval_and_timefield';
import getBucketSize from '../../helpers/get_bucket_size';
import { metricTypes } from '../../../../../common/metric_types';
import { hasSiblingAggs } from '../../helpers/has_sibling_aggs';

export default function query(req, panel, series) {
  return next => doc => {
    const { timeField, interval } = getIntervalAndTimefield(panel, series);
    const { bucketSize } = getBucketSize(req, interval);
    const { from, to } = offsetTime(req, series.offset_time);

    const boundsMin = metricTypes.includes(panel.type) && !hasSiblingAggs(series) ?
      to.clone().subtract(5 * bucketSize, 's') :
      from;

    doc.size = 0;
    doc.query = {
      bool: {
        must: []
      }
    };

    const timerange = {
      range: {
        [timeField]: {
          gte: panel.timerange_mode === 'all' ? from.valueOf() : boundsMin.valueOf(),
          lte: to.valueOf(),
          format: 'epoch_millis',
        }
      }
    };
    doc.query.bool.must.push(timerange);

    const globalFilters = req.payload.filters;
    if (globalFilters && !panel.ignore_global_filter) {
      doc.query.bool.must = doc.query.bool.must.concat(globalFilters);
    }

    if (panel.filter) {
      doc.query.bool.must.push({
        query_string: {
          query: panel.filter,
          analyze_wildcard: true
        }
      });
    }

    if (series.filter) {
      doc.query.bool.must.push({
        query_string: {
          query: series.filter,
          analyze_wildcard: true
        }
      });
    }

    return next(doc);

  };
}
