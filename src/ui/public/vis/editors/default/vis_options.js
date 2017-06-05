import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import { uiModules } from 'ui/modules';
import visOptionsTemplate from './vis_options.html';

/**
 * This directive sort of "transcludes" in whatever template you pass in via the `editor` attribute.
 * This lets you specify a full-screen UI for editing a vis type, instead of using the regular
 * sidebar.
 */

uiModules
.get('app/visualize')
.directive('visEditorVisOptions', function (Private, $timeout, $compile) {
  return {
    restrict: 'E',
    template: visOptionsTemplate,
    scope: {
      vis: '=',
      visData: '=',
      uiState: '=',
      editor: '=',
      visualizeEditor: '='
    },
    link: function ($scope, $el) {
      const $optionContainer = $el.find('[data-visualization-options]');

      const reactOptionsComponent = typeof $scope.editor !== 'string';
      const renderReactComponent = () => {
        const Component = $scope.editor;
        render(<Component scope={$scope} />, $el);
      };
      // Bind the `editor` template with the scope.
      if (reactOptionsComponent) {
        renderReactComponent();
      } else {
        const $editor = $compile($scope.editor)($scope);
        $optionContainer.append($editor);
      }

      $scope.$watchGroup(['visData', 'visualizeEditor'], () => {
        if (reactOptionsComponent) {
          renderReactComponent();
        }
      });

      $scope.$watch('vis.type.schemas.all.length', function (len) {
        $scope.alwaysShowOptions = len === 0;
      });

      $el.on('$destroy', () => {
        if (reactOptionsComponent) {
          unmountComponentAtNode($el);
        }
      });
    }
  };
});
