import $ from 'jquery';
import uiModules from 'ui/modules';

uiModules
.get('app/visualize')
.directive('draggableItem', function () {
  return {
    restrict: 'A',
    require: '^draggableContainer',
    scope: true,
    bindToController: true,
    controllerAs: 'draggableItemCtrl',
    controller($scope, $attrs, $parse) {
      const dragHandles = $();

      this.getItem = () => $parse($attrs.draggableItem)($scope);
      this.registerHandle = $el => {
        dragHandles.push(...$el);
      };
      this.moves = handle => {
        if (dragHandles.length === 0) {
          return true;
        }
        const $handle = $(handle);
        const $anywhereInParentChain = $handle.parents().addBack();
        const movable = dragHandles.is($anywhereInParentChain);
        return movable;
      };
    }
  };
});
