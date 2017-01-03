import _ from 'lodash';
import $ from 'jquery';
import angular from 'angular';
import uiModules from 'ui/modules';
const module = uiModules.get('kibana');

module.directive('stopScroll', ($window, $compile) => {
  return {
    restrict: 'A',
    compile: (tElement) => {
      $(tElement).on('mousewheel DOMMouseScroll', function (e) {
        const d = e.originalEvent.wheelDelta || -e.originalEvent.detail;
        const dir = d > 0 ? 'up' : 'down';
        const stop = (dir === 'up' && this.scrollTop === 0) ||
            (dir === 'down' && this.scrollTop === this.scrollHeight - this.offsetHeight);
        if (stop) e.preventDefault();
      });
    }
  };
});
