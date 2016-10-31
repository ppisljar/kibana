import _ from 'lodash';
import uiModules from 'ui/modules';
import vislibValueAxesTemplate from 'plugins/kbn_vislib_vis_types/controls/point_series/category_axis.html';
const module = uiModules.get('kibana');

module.directive('vislibCategoryAxis', function ($parse, $compile) {
  return {
    restrict: 'E',
    template: vislibValueAxesTemplate,
    replace: true,
    link: function ($scope) {

    }
  };
});
