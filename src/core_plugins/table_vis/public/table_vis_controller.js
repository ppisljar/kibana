import AggResponseTabifyTabifyProvider from 'ui/agg_response/tabify/tabify';
import uiModules from 'ui/modules';
import _ from 'lodash';
import AggConfigResult from 'ui/vis/agg_config_result';
// get the kibana/table_vis module, and make sure that it requires the "kibana" module if it
// didn't already
const module = uiModules.get('kibana/table_vis', ['kibana']);

// add a controller to tha module, which will transform the esResponse into a
// tabular format that we can pass to the table directive
module.controller('KbnTableVisController', function ($scope, $element, Private, $filter) {
  const tabifyAggResponse = Private(AggResponseTabifyTabifyProvider);

  var uiStateSort = ($scope.uiState) ? $scope.uiState.get('vis.params.sort') : {};
  _.assign($scope.vis.params.sort, uiStateSort);

  $scope.sort = $scope.vis.params.sort;
  $scope.$watchCollection('sort', function (newSort) {
    $scope.uiState.set('vis.params.sort', newSort);
  });

  const buildData = (vis, esResponse) => {
    const rows = $scope.rows = {};
    const columns = $scope.columns = {};
    const metrics = $scope.metrics = {};
    const rowData = {};

    const builRowsAndColumns = () => {
      _.each(vis.aggs, agg => {
        if (agg.schema.name === 'metric') metrics[agg.id] = [];
        if (agg.schema.name === 'rows') rows[agg.id] = [];
        else if (agg.schema.name === 'columns') columns[agg.id] = [];
      });
    };

    const getBucketValues = (data, path = '') => {
      _.each(data, (aggResult, key) => {
        const agg = _.find(vis.aggs, agg => key === agg.id);
        if (!agg) return;
        if (aggResult.buckets) {
          aggResult.buckets.forEach(bucket => {
            if (agg.schema.title === 'Split Rows' && !rows[agg.id].includes(bucket.key)) {
              rows[agg.id].push(bucket.key);
            }
            if (agg.schema.title === 'Split Columns' && !columns[agg.id].includes(bucket.key)) {
              columns[agg.id].push(bucket.key);
            }
            getBucketValues(bucket, path + '/' + bucket.key);
          });
        } else {
          rowData[path + '/' + agg.makeLabel()] = new AggConfigResult(
            agg,
            null,
            aggResult.value,
            aggResult.value
          );
        }
      });
    };

    builRowsAndColumns();
    getBucketValues(esResponse.aggregations);

    const getRows = (i, cb, values = []) => {
      const row = Object.values(rows)[i];
      const agg =  vis.aggs.find(agg => agg.id === Object.keys(rows)[i]);
      if (!row) cb([]);
      _.each(row, rowVal => {
        const newValues = _.clone(values);
        newValues.push(new AggConfigResult(agg, null, rowVal, rowVal));
        if (Object.values(rows).length > i + 1) {
          getRows(i + 1, cb, newValues);
        } else cb(newValues);
      });
    };

    const getCols = (i, cb, values = []) => {
      const col = Object.values(columns)[i];
      _.each(col, colVal => {
        const newValues = _.clone(values);
        newValues.push(colVal);
        if (Object.values(columns).length > i + 1) {
          getCols(i + 1, cb, newValues);
        } else cb(newValues);
      });
    };

    // getMetrics should produce either columns or rows
    if (true) {
      columns['99'] = _.map(metrics, (metric, key) => {
        return vis.aggs.find(agg => agg.id === key).makeLabel();
      });
    }

    const data = [];
    getRows(0, (row) => {
      const fData = [].concat(row);
      getCols(0, (column) => {
        const val = '/' + _.map(row, 'value').join('/') + '/' + column.join('/');
        fData.push(rowData[val] || 0);
      });
      data.push(fData);
    });

    const headerdata = [];
    let lastRow = 1;
    _.each(columns, (column, index) => {
      let row = [];
      row.length = Object.keys(rows).length;
      for (let i = 0; i < lastRow; i++) {
        row = row.concat(column);
      }
      lastRow *= column.length;
      headerdata.push(row);
    });

    return {
      header: headerdata,
      data: data
    };
  };

  $scope.getColSpan = (rowIndex, colIndex) => {
    const rows = Object.values($scope.rows);
    if (colIndex < rows.length) return 1;
    const lastRowCells = _.last($scope.data.header).length - rows.length;
    const currentRowCells = $scope.data.header[rowIndex].length - rows.length;
    return lastRowCells / currentRowCells;
  };

  $scope.getRowSpan = (rowIndex, colIndex) => {
    const rows = Object.values($scope.rows);
    if (colIndex >= rows.length) return 1;
    const lastRowCells = _.reduce(rows, (result, row, i) => {
      if (i === 0) return result;
      return result * row.length;
    }, 1);
    const currentRowCells = _.reduce(rows, (result, row, i) => {
      if (i > 0 && i < colIndex + 1) return result * row.length;
      return result;
    }, 1);
    return lastRowCells / currentRowCells;
  };

  $scope.displayRowCell = (rowIndex, colIndex) => {
    const rows = Object.values($scope.rows);
    if (colIndex + 1 >= rows.length) return true;
    const span = $scope.getRowSpan(rowIndex, colIndex);
    if (rowIndex % span === 0) return true;
    return false;
  };

  $scope.getHeaderValue = (rowIndex, colIndex, cell) => {
    if (rowIndex === Object.keys($scope.columns).length - 1 && colIndex < Object.keys($scope.rows).length) {
      return _.find($scope.vis.aggs, agg => agg.id === Object.keys($scope.rows)[colIndex]).makeLabel();
    }
    else return cell;
  };

  $scope.getCellValue = (colIndex, cell) => {
    if (_.isNumeric(cell)) return cell;
    if (cell instanceof AggConfigResult) {
      if (cell.type === 'bucket' && cell.aggConfig.getField() && cell.aggConfig.getField().filterable) {
        //cell = createAggConfigResultCell(cell);
      }
      return cell.toString('html');
    }

    const rows = Object.values($scope.rows);
    if (colIndex < rows.length) return `<b>${cell}</b>`;
    return cell;
  };

  $scope.isHeaderSortable = (rowIndex, colIndex) => {
    const rows = Object.values($scope.rows);
    const cols = Object.values($scope.columns);
    if (rowIndex !== cols.length - 1) return false;
    return true;
  };

  $scope.isHeaderFilterable = (rowIndex, colIndex) => {
    const rows = Object.values($scope.rows);
    const cols = Object.values($scope.columns);
    if (rowIndex !== cols.length - 1) return false;
    if (colIndex < rows.length) return true;
    return false;
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
    let value = row[self.sort.columnIndex];
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

    if (!$scope.rows || !$scope.columns) {
      $scope.sortedRows = false;
      return;
    }

    const sort = self.sort;
    if (sort.direction == null) {
      $scope.sortedRows = $scope.data.data.slice(0);
    } else {
      $scope.sortedRows = orderBy($scope.data.data, valueGetter, sort.direction === 'desc');
    }
  }

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

    let tableGroups = $scope.tableGroups = null;
    let hasSomeRows = $scope.hasSomeRows = null;

    if (resp) {
      const vis = $scope.vis;
      const params = vis.params;

      $scope.data = buildData(vis, resp);
      resortRows();

      tableGroups = tabifyAggResponse(vis, resp, {
        partialRows: params.showPartialRows,
        minimalColumns: vis.isHierarchical() && !params.showMeticsAtAllLevels,
        asAggConfigResults: true
      });

      hasSomeRows = tableGroups.tables.some(function haveRows(table) {
        if (table.tables) return table.tables.some(haveRows);
        return table.rows.length > 0;
      });

      $element.trigger('renderComplete');
    }

    $scope.hasSomeRows = hasSomeRows;
    if (hasSomeRows) {
      $scope.tableGroups = tableGroups;
    }
  });
});

