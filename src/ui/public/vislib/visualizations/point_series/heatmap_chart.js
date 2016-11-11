import _ from 'lodash';
import moment from 'moment';
import errors from 'ui/errors';
import VislibVisualizationsPointSeriProvider from 'ui/vislib/visualizations/point_series/_point_seri';
import colorFunc from 'ui/vislib/components/color/heatmap_color';

export default function HeatmapChartFactory(Private) {

  const PointSeri = Private(VislibVisualizationsPointSeriProvider);

  const defaults = {
    color: undefined, // todo
    fillColor: undefined // todo
  };
  /**
   * Line Chart Visualization
   *
   * @class HeatmapChart
   * @constructor
   * @extends Chart
   * @param handler {Object} Reference to the Handler Class Constructor
   * @param el {HTMLElement} HTML element to which the chart will be appended
   * @param chartData {Object} Elasticsearch query results for this specific chart
   */
  class HeatmapChart extends PointSeri {
    constructor(handler, chartEl, chartData, seriesConfigArgs) {
      super(handler, chartEl, chartData, seriesConfigArgs);
      this.seriesConfig = _.defaults(seriesConfigArgs || {}, defaults);
    }

    addSquares(svg, data) {
      const xScale = this.getCategoryAxis().getScale();
      const yScale = this.handler.categoryAxes[1].getScale();
      const zScale = this.getValueAxis().getScale();
      const ordered = this.handler.data.get('ordered');
      const tooltip = this.baseChart.tooltip;
      const isTooltip = this.handler.visConfig.get('tooltip.show');
      const isHorizontal = this.getCategoryAxis().axisConfig.isHorizontal();
      const colorsNumber = this.handler.visConfig.get('colorsNumber');
      const colorSchema = this.handler.visConfig.get('colorSchema');

      const layer = svg.append('g')
        .attr('class', 'points line');

      const squares = layer
        .selectAll('rect')
        .data(data.values);

      squares
        .exit()
        .remove();

      let barWidth;
      if (this.getCategoryAxis().axisConfig.isTimeDomain()) {
        const { min, interval } = this.handler.data.get('ordered');
        const start = min;
        const end = moment(min).add(interval).valueOf();

        barWidth = xScale(end) - xScale(start);
        if (!isHorizontal) barWidth *= -1;
        barWidth = barWidth - Math.min(barWidth * 0.25, 15);
      }

      function x(d) {
        return xScale(d.x);
      }

      function y(d) {
        return yScale(d.series);
      }

      const max = zScale.domain()[1];
      function z(d) {
        //return color based on the value
        let val = d.y / max; /* get val from 0 - 1 */
        val = parseInt(val * 100 / (100 / colorsNumber)) * (100 / colorsNumber);
        val = parseInt(val / 10);
        return colorFunc(val, colorSchema);
      }

      function widthFunc() {
        return barWidth || xScale.rangeBand();
      }

      function heightFunc() {
        return yScale.rangeBand();
      }

      squares
        .enter()
        .append('rect')
        .attr('x', isHorizontal ? x : y)
        .attr('width', isHorizontal ? widthFunc : heightFunc)
        .attr('y', isHorizontal ? y : x)
        .attr('height', isHorizontal ? heightFunc : widthFunc)
        .attr('fill', z);

      if (isTooltip) {
        squares.call(tooltip.render());
      }

      return squares;
    };

    /**
     * Renders d3 visualization
     *
     * @method draw
     * @returns {Function} Creates the line chart
     */
    draw() {
      const self = this;

      return function (selection) {
        selection.each(function () {

          const svg = self.chartEl.append('g');
          svg.data([self.chartData]);

          const squares = self.addSquares(svg, self.chartData);
          self.addCircleEvents(squares);

          self.events.emit('rendered', {
            chart: self.chartData
          });

          return svg;
        });
      };
    };
  }

  return HeatmapChart;
};
