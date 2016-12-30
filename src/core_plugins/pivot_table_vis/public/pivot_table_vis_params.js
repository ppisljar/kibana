import _ from 'lodash';
import uiModules from 'ui/modules';
import pivotTableVisParamsTemplate from 'plugins/pivot_table_vis/pivot_table_vis_params.html';

uiModules.get('kibana/table_vis')
.directive('pivotTableVisParams', function () {
  return {
    restrict: 'E',
    template: pivotTableVisParamsTemplate,
    link: function ($scope) {
      $scope.totalAggregations = [' ', 'sum', 'avg', 'min', 'max', 'count'];
      $scope.showStyles = false;

      $scope.$watch(() => {
        return $scope.vis.aggs.map(agg => {
          return agg.params.field ? agg.makeLabel() : '';
        }).join();
      }, () => {
        let columnCount = 0;
        const oldColumns = _.clone($scope.vis.params.columns);
        $scope.vis.params.columns = [];
        $scope.vis.aggs.forEach(agg => {
          if (!agg.type) return;
          if (agg.type.type !== 'metrics' && agg.schema.name !== 'rows') return;


          if (oldColumns.find(column => column.id === agg.id)) {
            const column = oldColumns.find(column => column.id === agg.id);
            column.label = agg.makeLabel();
            $scope.vis.params.columns.push(column);
          } else {
            const column = {
              id: agg.id,
              label: agg.makeLabel(),
              show: true,
              totalFunc: 'sum'
            };
            $scope.vis.params.columns.push(column);
          }
          columnCount++;
        });
        $scope.vis.params.columns = $scope.vis.params.columns.slice(0, columnCount);
      });
    }
  };
});
