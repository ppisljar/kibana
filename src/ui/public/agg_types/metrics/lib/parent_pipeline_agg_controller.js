const aggFilter = ['!top_hits', '!percentiles', '!percentile_ranks', '!median', '!std_dev'];

const parentPipelineAggController = function ($scope) {

  $scope.safeMakeLabel = function (agg) {
    try {
      return agg.makeLabel();
    } catch (e) {
      return '- agg not valid -';
    }
  };

  $scope.$watch('responseValueAggs', updateOrderAgg);
  $scope.$watch('agg.params.metricAgg', updateOrderAgg);

  $scope.$on('$destroy', function () {
    if ($scope.aggForm && $scope.aggForm.agg) {
      $scope.aggForm.agg.$setValidity('bucket', true);
    }
  });

  // Returns true if the agg is not compatible with the terms bucket
  $scope.rejectAgg = function (agg) {
    // aggFilter elements all starts with a '!'
    // so the index of agg.type.name in a filter is 1 if it is included
    return Boolean(aggFilter.find((filter) => filter.indexOf(agg.type.name) === 1));
  };

  function checkBuckets() {
    const buckets = $scope.vis.aggs.filter(agg => agg.schema.group === 'buckets');
    const bucketHasType = buckets.length && buckets[0].type;
    const bucketIsHistogram = bucketHasType && ['date_histogram', 'histogram'].includes(buckets[0].type.name);
    const canUseAggregation = buckets.length === 1 && bucketIsHistogram;
    if ($scope.aggForm.agg) $scope.aggForm.agg.$setValidity('bucket', canUseAggregation);
    if (canUseAggregation) {
      if (buckets[0].type.name === 'histogram') {
        buckets[0].params.min_doc_count = 1;
      }
      else {
        buckets[0].params.min_doc_count = 0;
      }
    }
  }

  function updateOrderAgg() {
    const agg = $scope.agg;
    const params = agg.params;
    const metricAgg = params.metricAgg;
    const paramDef = agg.type.params.byName.customMetric;

    checkBuckets();

    // we aren't creating a custom aggConfig
    if (metricAgg !== 'custom') {
      params.customMetric = null;
      return;
    }

    params.customMetric = params.customMetric || paramDef.makeAgg(agg);
  }
};

export { parentPipelineAggController };
