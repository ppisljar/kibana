import $ from 'jquery';

export function VisualizeLoaderProvider($compile, $rootScope, savedVisualizations) {
  const renderVis = (el, savedObj, params) => {
    const scope = $rootScope.$new();
    scope.savedObj = savedObj;
    scope.appState = params.appState;
    scope.uiState = params.uiState;
    scope.timeRange = params.timeRange;
    scope.showSpyPanel = params.showSpyPanel;
    scope.editorMode = params.editorMode;
    scope.$on('ready:vis', $event => {
      $event.stopPropagation();
    });

    const container = el instanceof $ ? el : $(el);

    container.html('');
    const visEl = $('<visualize saved-obj="savedObj" app-state="appState" ui-state="uiState" ' +
      'time-range="timeRange" editor-mode="editorMode" show-spy-panel="showSpyPanel"></visualize>');
    const visHtml = $compile(visEl)(scope);
    container.html(visHtml);

    const handler = { destroy: scope.$destroy };

    return new Promise((resolve) => {
      visEl.on('renderComplete', () => {
        resolve(handler);
      });
    });

  };

  return {
    embedVisualizationWithId: async (el, savedVisualizationId, params) => {
      return new Promise((resolve) => {
        savedVisualizations.get(savedVisualizationId).then(savedObj => {
          renderVis(el, savedObj, params).then(handler => {
            resolve(handler);
          });
        });
      });
    },
    embedVisualizationWithSavedObject: (el, savedObj, params) => {
      return renderVis(el, savedObj, params);
    }
  };
}
