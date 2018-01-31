import _ from 'lodash';
import './agg_group';
import './vis_options';
import { uiModules } from '../../../modules';
import sidebarTemplate from './sidebar.html';
import { VisAggConfigsProvider } from 'ui/vis/agg_configs';

import { createAst } from 'ui/visualize/render_pipeline';

uiModules
  .get('app/visualize')
  .directive('visEditorSidebar', function (Private) {
    const AggConfigs = Private(VisAggConfigsProvider);

    return {
      restrict: 'E',
      template: sidebarTemplate,
      scope: true,
      controllerAs: 'sidebar',
      controller: function ($scope) {

        $scope.$watch('vis.pipelineExpression', () => {
          $scope.vis.dirty = true;
          const ast = createAst($scope.vis.pipelineExpression);
          ast.chain.forEach(c => {
            if (c.function === 'visualization') {
              const visConfig = JSON.parse(c.arguments.visConfig);
              $scope.vis.params = visConfig;
            } else if (c.function === 'aggregate') {
              const aggConfig = JSON.parse(c.arguments.aggConfig);
              $scope.vis.aggs = new AggConfigs($scope.vis, aggConfig);
            }
          });
        });

        $scope.$watch('vis.type', (visType) => {
          if (visType) {
            this.showData = visType.schemas.buckets || visType.schemas.metrics;
            if (_.has(visType, 'editorConfig.optionTabs')) {
              const activeTabs = visType.editorConfig.optionTabs.filter((tab) => {
                return _.get(tab, 'active', false);
              });
              if (activeTabs.length > 0) {
                this.section = activeTabs[0].name;
              }
            }
            this.section = this.section || (this.showData ? 'data' : _.get(visType, 'editorConfig.optionTabs[0].name'));
          }
        });
      }
    };
  });
