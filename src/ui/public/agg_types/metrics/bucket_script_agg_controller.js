import { safeMakeLabel } from './lib/safe_make_label';
import { VisAggConfigProvider } from 'ui/vis/agg_config';
import { VisSchemasProvider } from 'ui/vis/editors/default/schemas';

const BcuketScriptAggControllerProvider = (Private) => {
  const AggConfig = Private(VisAggConfigProvider);
  const Schemas = Private(VisSchemasProvider);

  const metricAggFilter = ['!top_hits', '!percentiles', '!percentile_ranks', '!median', '!std_dev'];
  const metricAggSchema = (new Schemas([
    {
      group: 'none',
      name: 'metricAgg',
      title: 'Metric Agg',
      hideCustomLabel: true,
      aggFilter: metricAggFilter
    }
  ])).all[0];

  return function ($scope) {

    let i = 0;

    const makeAgg = (state) => {
      state = state || { type: 'count' };
      state.schema = metricAggSchema;
      const metricAgg = new AggConfig($scope.vis, state);
      return metricAgg;
    };

    const makeSubAgg = () => {
      i++;
      return {
        editorOpen: true,
        agg: 'custom',
        customMetric: makeAgg(),
        label: `parameter${i}`
      };
    };

    $scope.safeMakeLabel = safeMakeLabel;
    $scope.subAggs = [makeSubAgg()];

    $scope.addParameter = () => {
      $scope.subAggs.push(makeSubAgg());
    };

    $scope.removeParameter = (index) => {
      $scope.subAggs.splice(index, 1);
    };
  };
};

export { BcuketScriptAggControllerProvider };
