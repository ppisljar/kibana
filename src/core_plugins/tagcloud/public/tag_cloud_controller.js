import { uiModules } from 'ui/modules';
import TagCloud from 'plugins/tagcloud/tag_cloud';
import AggConfigResult from 'ui/vis/agg_config_result';
import { FilterBarClickHandlerProvider } from 'ui/filter_bar/filter_bar_click_handler';

const module = uiModules.get('kibana/tagcloud', ['kibana']);
module.controller('KbnTagCloudController', function ($scope, $element, Private, getAppState) {

  const containerNode = $element[0];
  const filterBarClickHandler = Private(FilterBarClickHandlerProvider);
  const maxTagCount = 200;
  let truncated = false;

  const tagCloud = new TagCloud(containerNode);
  tagCloud.on('select', (event) => {
    const appState = getAppState();
    const clickHandler = filterBarClickHandler(appState);
    const aggs = $scope.vis.aggs.getResponseAggs();
    const aggConfigResult = new AggConfigResult(aggs[0], false, event, event);
    clickHandler({ point: { aggConfigResult: aggConfigResult } });
  });

  tagCloud.on('renderComplete', () => {

    const truncatedMessage = containerNode.querySelector('.tagcloud-truncated-message');
    const incompleteMessage = containerNode.querySelector('.tagcloud-incomplete-message');

    if (!$scope.vis.aggs[0] || !$scope.vis.aggs[1]) {
      incompleteMessage.style.display = 'none';
      truncatedMessage.style.display = 'none';
      return;
    }

    const bucketName = containerNode.querySelector('.tagcloud-custom-label');
    bucketName.innerHTML = `${$scope.vis.aggs[0].makeLabel()} - ${$scope.vis.aggs[1].makeLabel()}`;
    truncatedMessage.style.display = truncated ? 'block' : 'none';

    const status = tagCloud.getStatus();
    if (TagCloud.STATUS.COMPLETE === status) {
      incompleteMessage.style.display = 'none';
    } else if (TagCloud.STATUS.INCOMPLETE === status) {
      incompleteMessage.style.display = 'block';
    }


    $scope.renderComplete();
  });

  $scope.$watch('esResponse', async function (response) {

    if (!response) {
      tagCloud.setData([]);
      return;
    }

    const tags = response.map((bucket) => {
      return {
        text: bucket.key,
        value: bucket.values[0]
      };
    });


    if (tags.length > maxTagCount) {
      tags.length = maxTagCount;
      truncated = true;
    } else {
      truncated = false;
    }

    tagCloud.setData(tags);
  });


  $scope.$watch('vis.params', (options) => tagCloud.setOptions(options));

  $scope.$watch('resize', () => {
    tagCloud.resize();
  });


});
