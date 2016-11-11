import uiModules from 'ui/modules';
import heatmapRangeOptionTemplate from 'plugins/kbn_vislib_vis_types/controls/heatmap_range_option.html';
import colorFunc from 'ui/vislib/components/color/heatmap_color';
const module = uiModules.get('kibana');

module.directive('heatmapRangeOption', function ($parse, $compile) {
  return {
    restrict: 'E',
    template: heatmapRangeOptionTemplate,
    replace: true,
    link: function ($scope) {
      $scope.isColorRangeOpen = false;

      $scope.getColor = function (index) {
        if ($scope.vis.params.setColorRange && $scope.vis.params.colorsRange[index].color) {
          return $scope.vis.params.colorsRange[index].color;
        }
        const colorNumber = index * Math.floor(10 / $scope.vis.params.colorsNumber);
        return colorFunc(colorNumber, $scope.vis.params.colorSchema);
      };

      function fillColorsRange() {
        $scope.vis.params.colorsRange.length = $scope.vis.params.colorsNumber;
        for (let i = 0; i < $scope.vis.params.colorsNumber; i++) {
          if (!$scope.vis.params.colorsRange[i]) {
            $scope.vis.params.colorsRange[i] = {
              color: undefined,
              value: undefined,
            };
          }
        }
      }

      fillColorsRange();
      $scope.$watch('vis.params.colorsNumber', newVal => {
        if (newVal) {
          fillColorsRange();
        }
      });
    }
  };
});
