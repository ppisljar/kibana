import _ from 'lodash';
import uiModules from 'ui/modules';
import TagCloud from 'plugins/tagcloud/tag_cloud';
import AggConfigResult from 'ui/vis/agg_config_result';
import FilterBarFilterBarClickHandlerProvider from 'ui/filter_bar/filter_bar_click_handler';

const module = uiModules.get('kibana/tagcloud', ['kibana']);


module.controller('KbnCloudController', function ($scope, $element, Private, getAppState) {

  const containerNode = $element[0];
  const filterBarClickHandler = Private(FilterBarFilterBarClickHandlerProvider);

  const tagCloud = new TagCloud(containerNode);
  tagCloud.on('select', (event) => {
    const appState = getAppState();
    const clickHandler = filterBarClickHandler(appState);
    const aggs = $scope.vis.aggs.getResponseAggs();
    const aggConfigResult = new AggConfigResult(aggs[0], false, event, event);
    clickHandler({point: {aggConfigResult: aggConfigResult}});
  });

  $scope.$watch('esResponse', async function (response) {

    if (!response) {
      return;
    }

    const tagsAggId = _.first(_.pluck($scope.vis.aggs.bySchemaName.segment, 'id'));
    if (!tagsAggId || !response.aggregations) {
      return;
    }

    const metricsAgg = _.first($scope.vis.aggs.bySchemaName.metric);
    const buckets = response.aggregations[tagsAggId].buckets;
    const tags = buckets.map((bucket) => {
      return {
        text: bucket.key,
        size: metricsAgg.getValue(bucket) || metricsAgg.getValue
      };
    });

    tagCloud.setData(tags);
    await tagCloud.whenRendered();
    updateState();
  });


  $scope.$watch('vis.params', async function (options) {
    tagCloud.setOptions(options);
    await tagCloud.whenRendered();
    updateState();
  });

  $scope.$watch(getContainerSize, _.debounce(async function () {
    tagCloud.resize();
    await tagCloud.whenRendered();
    updateState();
  }, 1000, {trailing: true}), true);


  function getContainerSize() {
    return {width: $element.width(), height: $element.height()};
  }

  function updateState() {

    const bucketName = containerNode.querySelector('.tagcloud-custom-label');
    bucketName.innerHTML = $scope.vis.aggs[1].makeLabel();

    const incompleteMessage = containerNode.querySelector('.tagcloud-incomplete-message');
    if (TagCloud.STATUS.COMPLETE === tagCloud.getStatus()) {
      incompleteMessage.style.display = 'none';
    } else if (TagCloud.STATUS.INCOMPLETE === tagCloud.getStatus()) {
      incompleteMessage.style.display = 'block';
    }

    if (typeof $scope.vis.emit === 'function') {
      $scope.vis.emit('renderComplete');
    }

  }

});
