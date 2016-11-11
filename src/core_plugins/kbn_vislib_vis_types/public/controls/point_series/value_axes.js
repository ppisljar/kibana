import _ from 'lodash';
import uiModules from 'ui/modules';
import vislibValueAxesTemplate from 'plugins/kbn_vislib_vis_types/controls/point_series/value_axes.html';
const module = uiModules.get('kibana');

module.directive('vislibValueAxes', function ($parse, $compile) {
  return {
    restrict: 'E',
    template: vislibValueAxesTemplate,
    replace: true,
    link: function ($scope) {
      let isCategoryAxisHorizontal = true;
      $scope.$watch('vis.params.categoryAxes[0].position', position => {
        isCategoryAxisHorizontal = ['top', 'bottom'].includes(position);
      });

      $scope.isPositionDisabled = function (position) {
        if (isCategoryAxisHorizontal) {
          return ['top', 'bottom'].includes(position);
        }
        return ['left', 'right'].includes(position);
      };

      $scope.addValueAxis = function () {
        const newAxis = _.cloneDeep($scope.vis.params.valueAxes[0]);
        newAxis.id = 'ValueAxis-' + $scope.vis.params.valueAxes.reduce((value, axis) => {
          if (axis.id.substr(0, 10) === 'ValueAxis-') {
            const num = parseInt(axis.id.substr(10));
            if (num >= value) value = num + 1;
          }
          return value;
        }, 1);

        $scope.vis.params.valueAxes.push(newAxis);
      };

      $scope.removeValueAxis = function (axis) {
        _.remove($scope.vis.params.valueAxes, function (valAxis) {
          return valAxis.id === axis.id;
        });
      };
    }
  };
});
