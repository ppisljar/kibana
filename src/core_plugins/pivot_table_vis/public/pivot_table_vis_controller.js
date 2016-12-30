import AggResponseTabifyTabifyProvider from 'ui/agg_response/tabify/tabify';
import uiModules from 'ui/modules';
import _ from 'lodash';
import $ from 'jquery';
import AggConfigResult from 'ui/vis/agg_config_result';
import FilterBarFilterBarClickHandlerProvider from 'ui/filter_bar/filter_bar_click_handler';
import BuildDataProvider from './build_data';
import 'ui/directives/infinite_scroll';
import 'ui/directives/fix_head';
// get the kibana/table_vis module, and make sure that it requires the "kibana" module if it
// didn't already
const module = uiModules.get('kibana/table_vis', ['kibana']);

// add a controller to tha module, which will transform the esResponse into a
// tabular format that we can pass to the table directive
module.controller('KbnPivotTableVisController', function ($scope, $element, Private, $filter, getAppState) {
  const filterBarClickHandler = Private(FilterBarFilterBarClickHandlerProvider);
  const clickHandler = filterBarClickHandler(getAppState());
  const uiStateSort = ($scope.uiState) ? $scope.uiState.get('vis.params.sort') : {};
  _.assign($scope.vis.params.sort, uiStateSort);
  $scope.hasSomeRows = true;

  $scope.sort = $scope.vis.params.sort;
  $scope.$watchCollection('sort', function (newSort) {
    $scope.uiState.set('vis.params.sort', newSort);
  });

  $scope.addRows = function () {
    $scope.limit += 10;
  };

  $scope.clickCell = function (rowIndex, colIndex, cell, header) {
    const agg = header ? Object.values($scope.rawData.columns)[rowIndex].agg : $scope.columns[colIndex].agg;
    const value = cell.value.value || cell.value;
    const aggConfigResult = new AggConfigResult(agg, false, value, value);
    clickHandler({ point: { aggConfigResult: aggConfigResult } });
  };

  $scope.showCellValue = function (cell) {
    const value = cell.value || cell;
    return isNaN(value) ? value : $filter('number')(value);
  };

  const buildData = Private(BuildDataProvider);

  const buildHeaders = (data) => {
    const getColSpan = (rowIndex, colIndex) => {
      const rows = Object.values(data.rows);
      if (colIndex < rows.length) return 1;
      const lastRowCells = _.filter($scope.columns, (column, i) => rows.length <= i && column.show).length;
      const currentRowCells = data.header[rowIndex].length - rows.length;
      return lastRowCells / currentRowCells;
    };

    const isHeaderSortable = (rowIndex) => {
      const cols = Object.values(data.columns);
      if (rowIndex !== cols.length - 1) return false;
      return true;
    };

    const isHeaderFilterable = (rowIndex, colIndex) => {
      const rows = Object.values(data.rows);
      const cols = Object.values(data.columns);
      if (rowIndex === cols.length - 1) return false;
      if (colIndex < rows.length) return false;
      return true;
    };

    const shouldShow = (rowIndex, colIndex) => {
      const rows = Object.values(data.rows);
      if (rows.length < colIndex && rowIndex !== data.header.length - 1) return true;
      return $scope.columns[colIndex].show;
    };

    return data.header.map((rows, i) => {
      return {
        cells: rows.map((cell, j) => {
          return {
            value: cell,
            show: shouldShow(i, j),
            span: getColSpan(i, j),
            isSortable: isHeaderSortable(i),
            isFilterable: isHeaderFilterable(i, j),
          };
        })
      };
    });
  };

  const buildValues = (data) => {
    const getCellValue = (colIndex, cell) => {
      if (_.isNumeric(cell)) return cell;
      if (cell instanceof AggConfigResult) {
        if (cell.type === 'bucket' && cell.aggConfig.getField() && cell.aggConfig.getField().filterable) {
          //cell = createAggConfigResultCell(cell);
        }
        return cell.toString('html');
      }

      const rows = Object.values(data.rows);
      if (colIndex < rows.length) return `<b>${cell}</b>`;
      return cell;
    };

    return data.data.map((row, i) => {
      return {
        cells: row.map((cell, j) => {
          return {
            value: getCellValue(j, cell)
          };
        })
      };
    });
  };

  const getValue = (rowIndex, colIndex) => {
    const row = $scope.sortedRows[rowIndex];
    if (!row) return;
    const cell = row.cells[colIndex];
    const value = typeof cell.value.value === 'undefined' ? cell.value : cell.value.value;
    return value;
  };

  $scope.getRowSpan = (rowIndex, colIndex) => {
    let i = 1;
    if ($scope.showRowCell(rowIndex, colIndex)) {
      const rowVal = getValue(rowIndex, colIndex);
      while (getValue(rowIndex + i, colIndex) === rowVal && i < 50) i++;
    }
    return i;
  };

  $scope.showRowCell = (rowIndex, colIndex) => {
    if (!$scope.columns[colIndex].show) return false;
    const prevRow = $scope.sortedRows[rowIndex - 1];
    if (!prevRow) return true;
    const prevRowVal = getValue(rowIndex - 1, colIndex);
    const rowVal = getValue(rowIndex, colIndex);
    return rowVal !== prevRowVal;
  };

  const orderBy = $filter('orderBy');
  const self = $scope;
  self.sort = {
    columnIndex: null,
    direction: null
  };

  self.sortColumn = function (colIndex, sortDirection = 'asc') {
    if (self.sort.columnIndex === colIndex) {
      const directions = {
        null: 'asc',
        'asc': 'desc',
        'desc': null
      };
      sortDirection = directions[self.sort.direction];
    }

    self.sort.columnIndex = colIndex;
    self.sort.direction = sortDirection;
    if ($scope.sort) {
      _.assign($scope.sort, self.sort);
    }
  };

  function valueGetter(row) {
    let value = row.cells[self.sort.columnIndex];
    if (value && value.value != null) value = value.value;
    if (typeof value === 'boolean') value = value ? 0 : 1;
    return value;
  }

  // Set the sort state if it is set
  if ($scope.sort && $scope.sort.columnIndex !== null) {
    self.sortColumn($scope.sort.columnIndex, $scope.sort.direction);
  }
  function resortRows() {
    const newSort = $scope.sort;
    if (newSort && !_.isEqual(newSort, self.sort)) {
      self.sortColumn(newSort.columnIndex, newSort.direction);
    }

    if (!$scope.data) {
      $scope.sortedRows = false;
      return;
    }

    const sort = self.sort;
    if (sort.direction == null) {
      $scope.sortedRows = $scope.data.slice(0);
    } else {
      $scope.sortedRows = orderBy($scope.data, valueGetter, sort.direction === 'desc');
    }
  }

  const prepareTotals = () => {
    return $scope.columns.map((column, i) => {
      const field = $scope.data[0].cells[i].value;
      const value = typeof field.value === 'undefined' ? field : field.value;
      const isFieldNumeric = !isNaN(value);
      let total = '';

      function sum(tableRows) {
        return _.reduce(tableRows, function (prev, curr) {
          const field = curr.cells[i].value;
          const value = typeof field.value === 'undefined' ? field : field.value;
          return prev + value;
        }, 0);
      }

      switch (column.totalFunc) {
        case 'sum':
          total = sum($scope.data);
          break;
        case 'avg':
          total = sum($scope.data) / $scope.data.length;
          break;
        case 'min':
          total = _.chain($scope.data).map(row => row.cells[i]).map('value.value').min().value();
          break;
        case 'max':
          total = _.chain($scope.data).map(row => row.cells[i]).map('value.value').max().value();
          break;
        case 'count':
          total = $scope.data.length;
          break;
        default:
          total = i === 0 ? 'Totals' : '';
          break;
      }

      return total;
    });
  };

  const matchColumns = (data) => {
    const columns = data.header[data.header.length - 1];
    const rows = Object.values(data.rows);
    const metrics = Object.values(data.metrics);
    return columns.map((column, i) => {
      const agg = i < rows.length ? rows[i].agg : metrics[(i - rows.length) % metrics.length];
      const aggId = agg.parentId || agg.id;
      const col = $scope.vis.params.columns.find(paramColumn => paramColumn.id === aggId);
      col.agg = agg;
      return col;
    });
  };

  // update the sortedRows result
  $scope.$watchMulti([
    '[]sort',
  ], resortRows);
  /**
   * Recreate the entire table when:
   * - the underlying data changes (esResponse)
   * - one of the view options changes (vis.params)
   */
  $scope.$watchMulti(['esResponse', 'vis.params'], function ([resp]) {
    if (resp) {
      let time = window.performance.now();
      const vis = $scope.vis;
      if (!vis.params.columns.length) return;
      const data = $scope.rawData = buildData(vis, resp);
      console.log('building data took ' + (window.performance.now() - time));
      $scope.columns = matchColumns(data);
      console.log('building columns took ' + (window.performance.now() - time));
      $scope.headerRows = buildHeaders(data);
      console.log('building headers took ' + (window.performance.now() - time));
      $scope.data = buildValues(data);
      console.log('building values took ' + (window.performance.now() - time));
      $scope.columnTotals = prepareTotals();
      $scope.limit = $scope.vis.params.perPage;
      $scope.showTotal = $scope.vis.params.showTotal;
      console.log('building totals took ' + (window.performance.now() - time));
      time = window.performance.now();
      resortRows();
      console.log('sorting took ' + (window.performance.now() - time));
      window.time = window.performance.now();

      $element.trigger('renderComplete');
    }

  });
});

