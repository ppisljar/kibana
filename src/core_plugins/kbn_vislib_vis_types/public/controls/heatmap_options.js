import uiModules from 'ui/modules';
import heatmapOptionsTemplate from 'plugins/kbn_vislib_vis_types/controls/heatmap_options.html';
import colorFunc from 'ui/vislib/components/color/heatmap_color';
const module = uiModules.get('kibana');

module.directive('heatmapOptions', function ($parse, $compile, getAppState) {
  return {
    restrict: 'E',
    template: heatmapOptionsTemplate,
    replace: true,
    link: function ($scope) {
      $scope.isColorRangeOpen = true;
      $scope.customColors = false;
      $scope.options = {
        labels: false
      };

      $scope.$watch('options.labels', rotate => {
        $scope.vis.params.valueAxes[0].labels.rotate = rotate ? 270 : 0;
      });

      $scope.resetColors = () => {
        $scope.uiState.set('vis.colors', null);
        $scope.customColors = false;
      };

      $scope.getGreaterThan = function (index) {
        if (index === 0) return -1;
        return $scope.vis.params.colorsRange[index - 1].value;
      };

      $scope.getColor = function (index) {
        const colors = $scope.uiState.get('vis.colors');
        return colors ? Object.values(colors)[index] : 'transparent';
      };

      function fillColorsRange() {
        for (let i = $scope.vis.params.colorsRange.length; i < $scope.vis.params.colorsNumber; i++) {
          $scope.vis.params.colorsRange.push({ value: 0 });
        }
        $scope.vis.params.colorsRange.length = $scope.vis.params.colorsNumber;
      }

      fillColorsRange();
      $scope.$watch('vis.params.colorsNumber', newVal => {
        if (newVal) {
          fillColorsRange();
        }
      });

      $scope.uiState.on('colorChanged', () => {
        $scope.customColors = true;
      });
    }
  };
});
