import _ from 'lodash';
import $ from 'jquery';
import angular from 'angular';
import uiModules from 'ui/modules';
const module = uiModules.get('kibana');

module.directive('fixHead', ($window, $compile) => {
  return {
    restrict: 'A',
    compile: (tElement) => {
      const table = {
        clone: tElement.parent().clone().empty(),
        original: tElement.parent()
      };

      const header = {
        clone: tElement.clone(),
        original: tElement
      };

      const isHead = tElement[0].nodeName === 'THEAD';
      // prevent recursive compilation
      header.clone.removeAttr('fix-head').removeAttr('ng-if');
      table.clone.css('display', 'block').addClass('clone');
      header.clone.css('display', 'block');
      header.original.css('visibility', 'hidden');

      return function postLink(scope) {
        const scrollContainer = table.original.parent();

        // insert the element so when it is compiled it will link
        // with the correct scope and controllers
        header.original.after(header.clone);

        $compile(table.clone)(scope);
        $compile(header.clone)(scope);

        if (isHead) {
          scrollContainer.parent()[0].insertBefore(table.clone.append(header.clone)[0], scrollContainer[0]);
        } else {
          scrollContainer.parent()[0].insertBefore(table.clone.append(header.clone)[0], scrollContainer[0].nextSibling);
        }


        scrollContainer.on('scroll', function () {
          // use CSS transforms to move the cloned header when the table is scrolled horizontally
          header.clone.css('transform', 'translate3d(' + -(scrollContainer.prop('scrollLeft')) + 'px, 0, 0)');
        });

        function cells() {
          return header.clone.find('th').length;
        }

        function getCells(node) {
          return Array.prototype.map.call(node.find('th'), function (cell) {
            return $(cell);
          });
        }

        function height() {
          return header.original.prop('clientHeight');
        }

        function marginTop(height) {
          table.original.css('marginTop', '-' + height + 'px');
        }

        function marginBottom(height) {
          table.original.css('marginBottom', '-' + height + 'px');
        }

        function updateCells() {
          const cells = {
            clone: getCells(header.clone),
            original: getCells(header.original)
          };

          cells.clone.forEach(function (clone, index) {
            if(clone.data('isClone')) {
              return;
            }

            // prevent duplicating watch listeners
            clone.data('isClone', true);

            const cell = cells.original[index];
            const style = $window.getComputedStyle(cell[0]);

            const getWidth = function () {
              return style.width;
            };

            const setWidth = function () {
              isHead ? marginTop(height()) : marginBottom(height());
              clone.css({ minWidth: style.width, maxWidth: style.width });
            };

            const listener = scope.$watch(getWidth, setWidth);

            $window.addEventListener('resize', setWidth);

            clone.on('$destroy', function () {
              listener();
              $window.removeEventListener('resize', setWidth);
            });

            cell.on('$destroy', function () {
              clone.remove();
            });
          });
        }

        scope.$watch(cells, updateCells);

        header.original.on('$destroy', function () {
          header.clone.remove();
        });
      };
    }
  };
});
