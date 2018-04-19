import { AggConfig } from 'ui/vis/agg_config';
import { uiModules } from 'ui/modules';
import aggAddTemplate from './agg_add.html';

uiModules
  .get('kibana')
  .directive('visEditorAggAdd', function () {

    return {
      restrict: 'E',
      template: aggAddTemplate,
      controllerAs: 'add',
      controller: function ($scope) {
        const self = this;

        self.form = false;
        self.submit = function (schema) {
          self.form = false;

          const aggConfig = new AggConfig({
            schema: schema
          }, $scope.vis.indexPattern, $scope.vis.type.schemas.all);
          aggConfig.brandNew = true;

          $scope.vis.aggs.push(aggConfig);
        };
      }
    };
  });
