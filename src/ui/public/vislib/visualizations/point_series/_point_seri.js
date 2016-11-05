import _ from 'lodash';
import errors from 'ui/errors';

export default function PointSeriProvider(Private) {

  class PointSeri {
    constructor(handler, seriesEl, seriesData, seriesConfig) {
      this.handler = handler;
      this.baseChart = handler.pointSeries;
      this.chartEl = seriesEl;
      this.chartData = seriesData;
      this.seriesConfig = seriesConfig;

      //this.validateDataCompliesWithScalingMethod(this.chartData);
    }

    validateDataCompliesWithScalingMethod(data) {
      function valuesSmallerThanOne(d) {
        return d.values && d.values.some(e => e.y < 1);
      }

      const invalidLogScale = data.series && data.series.some(valuesSmallerThanOne);
      if (this.seriesConfig.scale === 'log' && invalidLogScale) {
        throw new errors.InvalidLogScaleValues();
      }
    };

    getStackedCount() {
      return this.baseChart.chartConfig.series.reduce(function (sum, seri) {
        return seri.mode === 'stacked' ? sum + 1 : sum;
      }, 0);
    };

    getGroupedCount() {
      return this.baseChart.chartConfig.series.reduce(function (sum, seri) {
        return seri.mode === 'stacked' ? sum : sum + 1;
      }, 0);
    };

    getStackedNum(data) {
      let i = 0;
      for (const seri of this.baseChart.chartConfig.series) {
        if (seri.data === data) return i;
        if (seri.mode === 'stacked') i++;
      }
      return 0;
    };

    getGroupedNum(data) {
      let i = 0;
      for (const seri of this.baseChart.chartConfig.series) {
        if (seri.data === data) return i;
        if (seri.mode !== 'stacked') i++;
      }
      return 0;
    };

    getValueAxis() {
      return _.find(this.handler.valueAxes, axis => {
        return axis.axisConfig.get('id') === this.seriesConfig.valueAxis;
      }) || this.handler.valueAxes[0];
    };

    getCategoryAxis() {
      return _.find(this.handler.categoryAxes, axis => {
        return axis.axisConfig.get('id') === this.seriesConfig.categoryAxis;
      }) || this.handler.categoryAxes[0];
    };

    addCircleEvents(element) {
      const events = this.events;
      const hover = events.addHoverEvent();
      const mouseout = events.addMouseoutEvent();
      const click = events.addClickEvent();
      return element.call(hover).call(mouseout).call(click);
    };

    checkIfEnoughData() {
      const message = 'Point series charts require more than one data point. Try adding ' +
        'an X-Axis Aggregation';

      const notEnoughData = this.chartData.values.length < 2;

      if (notEnoughData) {
        throw new errors.NotEnoughData(message);
      }
    };
  }

  return PointSeri;
};
