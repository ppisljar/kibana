import _ from 'lodash';
import { AggType } from 'ui/agg_types/agg_type';

_.class(BucketAggType).inherits(AggType);
function BucketAggType(config) {
  BucketAggType.Super.call(this, config);

  if (_.isFunction(config.getKey)) {
    this.getKey = config.getKey;
  }
}

BucketAggType.prototype.getKey = function (bucket, key) {
  return key || bucket.key;
};

export { BucketAggType };
