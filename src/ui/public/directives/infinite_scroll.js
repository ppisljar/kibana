import $ from 'jquery';
import uiModules from 'ui/modules';
const module = uiModules.get('kibana');

module.directive('kbnInfiniteScroll', function () {
  return {
    restrict: 'E',
    scope: {
      more: '=',
      element: '='
    },
    link: function ($scope, $element, attrs) {
      const getElement = (element) => {
        if (!element) return $(window);
        if (element === 'parent') return $element.parent();
        const el = $(element);
        return el.length ? el : $(window);
      };
      const $scrollElement = getElement(attrs.element);

      let checkTimer;

      function onScroll() {
        if (!$scope.more) return;

        const winHeight = $scrollElement.height();
        const winBottom = winHeight + $scrollElement.scrollTop();
        const elTop = $element.offset().top;
        const scrollHeight = $scrollElement[0].scrollHeight;
        const remaining = attrs.element ? scrollHeight - winBottom : elTop - winBottom;

        if (remaining <= winHeight * 0.50) {
          $scope[$scope.$$phase ? '$eval' : '$apply'](function () {
            const more = $scope.more();
          });
        }
      }

      function scheduleCheck() {
        if (checkTimer) return;
        checkTimer = setTimeout(function () {
          checkTimer = null;
          onScroll();
        }, 50);
      }

      $scrollElement.on('scroll', scheduleCheck);
      $scope.$on('$destroy', function () {
        clearTimeout(checkTimer);
        $scrollElement.off('scroll', scheduleCheck);
      });
      scheduleCheck();
    }
  };
});
