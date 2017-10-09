import _ from 'lodash';
import $ from 'jquery';

export function EmbeddedTooltipFormatterProvider($rootScope, $compile, Private, savedVisualizations) {
  const tooltipTemplate = require('ui/agg_response/_embedded_tooltip.html');

  return function (parentVis) {
    let tooltipMsg = 'Initializing Tooltip...';
    let $tooltipScope;
    let $visEl;
    const destroyEmbedded = () => {
      if ($tooltipScope) {
        $tooltipScope.$destroy();
      }
      if ($visEl) {
        $visEl.remove();
      }
    };
    let savedObject;
    let fetchTimestamp;
    savedVisualizations.get(parentVis.params.tooltip.vis).then((resp) => {
      savedObject = resp;
      savedObject.vis.params.addTooltip = false; // disable tooltips for embedded visualization
    }, e => {
      tooltipMsg = _.get(e, 'message', 'Error initializing tooltip');
    });

    function getWidth() {
      return window.innerWidth * 0.4;
    }
    function getHeight() {
      return window.innerHeight * 0.4;
    }

    const formatter = function (event) {
      const executionId = `embedded-${Date.now()}`;

      if (savedObject) {
        tooltipMsg = 'Loading Data...';

        const localFetchTimestamp = Date.now();
        fetchTimestamp = localFetchTimestamp;

        const aggFilters = [];
        let timeRange;
        let aggResult = event.datum.aggConfigResult;
        while(aggResult) {
          if (aggResult.type === 'bucket') {
            const filter = aggResult.aggConfig.createFilter(aggResult.key);
            aggFilters.push(filter);
            if (aggResult.aggConfig.getField().type === 'date') {
              timeRange = {
                min: filter.range[aggResult.aggConfig.getField().name].gte,
                max: filter.range[aggResult.aggConfig.getField().name].lt
              };
            }
          }
          aggResult = aggResult.$parent;
        }

        destroyEmbedded();
        savedObject.searchSource.set('filter', aggFilters);
        $tooltipScope = $rootScope.$new();
        $tooltipScope.savedObject = savedObject;
        $tooltipScope.timeRange = timeRange;
        $tooltipScope.dimensions = {};
        /*$tooltipScope.dimensions = {
          width: getWidth(),
          height: getHeight()
        }*/
        $visEl = $compile(tooltipTemplate)($tooltipScope);
        $visEl.css({
          width: getWidth(),
          height: getHeight()
        });
        $visEl.on('renderComplete', () => {
          const $popup = $(`#${executionId}`);
          // Only update popup contents if results are for calling fetch
          if (localFetchTimestamp === fetchTimestamp && $popup && $popup.length > 0) {
            $popup.css({
              width: getWidth(),
              height: getHeight()
            });
            const $visContainer = $visEl.find('.vis-container');
        $visContainer.css({
          width: getWidth(),
          height: getHeight()
        });
            $popup.empty();
            $popup.append($visEl);
          }
        })
      }

      return `<div id="${executionId}" class="tab-dashboard theme-dark"
        style="height: ${getHeight()}px; width: ${getWidth()}px;">${tooltipMsg}</div>`;
    };
    formatter.cleanUp = () => {
      fetchTimestamp = 'expired';
      destroyEmbedded();
    };
    return formatter;

  };

}
