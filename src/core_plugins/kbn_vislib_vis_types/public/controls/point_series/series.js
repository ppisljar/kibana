import _ from 'lodash';
import uiModules from 'ui/modules';
import vislibSeriesTemplate from 'plugins/kbn_vislib_vis_types/controls/point_series/series.html';
const module = uiModules.get('kibana');

module.directive('vislibSeries', function ($parse, $compile) {
  return {
    restrict: 'E',
    template: vislibSeriesTemplate,
    replace: true,
    link: function ($scope) {
      function makeSerie(label) {
        return {
          show: true,
          mode: 'normal',
          type: 'line',
          drawLinesBetweenPoints: true,
          showCircles: true,
          smoothLines: false,
          data: {
            label: label
          },
          valueAxis: ''
        };
      }

      $scope.series = $scope.vis.params.seriesParams;
      $scope.$watch(() => {
        return $scope.vis.aggs.map(agg => agg.makeLabel()).join();
      }, () => {
        let serieCount = 0;
        $scope.vis.aggs.forEach(agg => {
          if (!agg.type) return;
          if (agg.schema.title !== 'Y-Axis') return;
          if (agg.type.type !== 'metrics') return;
          if ($scope.series[serieCount]) {
            $scope.series[serieCount].data.label = agg.makeLabel();
          } else {
            const serie = makeSerie(agg.makeLabel());
            $scope.series.push(serie);
          }
          serieCount++;
        });
        $scope.series.length = serieCount;
      });
    }
  };
});
