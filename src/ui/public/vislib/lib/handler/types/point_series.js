import d3 from 'd3';
import _ from 'lodash';
import VislibComponentsZeroInjectionInjectZerosProvider from 'ui/vislib/components/zero_injection/inject_zeros';
import VislibLibHandlerHandlerProvider from 'ui/vislib/lib/handler/handler';
import VislibLibDataProvider from 'ui/vislib/lib/data';
import VislibLibXAxisProvider from 'ui/vislib/lib/x_axis';
import VislibLibChartTitleProvider from 'ui/vislib/lib/chart_title';
import VislibLibAlertsProvider from 'ui/vislib/lib/alerts';
import VislibAxis from 'ui/vislib/lib/axis';

export default function ColumnHandler(Private) {
  let injectZeros = Private(VislibComponentsZeroInjectionInjectZerosProvider);
  let Handler = Private(VislibLibHandlerHandlerProvider);
  let Data = Private(VislibLibDataProvider);
  let XAxis = Private(VislibLibXAxisProvider);
  let ChartTitle = Private(VislibLibChartTitleProvider);
  let Alerts = Private(VislibLibAlertsProvider);
  const Axis = Private(VislibAxis);

  /*
   * Create handlers for Area, Column, and Line charts which
   * are all nearly the same minus a few details
   */
  function create(opts) {
    opts = opts || {};

    return function (vis) {
      const isUserDefinedYAxis = vis._attr.setYExtents;
      let data;

      if (opts.zeroFill) {
        data = new Data(injectZeros(vis.data), vis._attr, vis.uiState);
      } else {
        data = new Data(vis.data, vis._attr, vis.uiState);
      }

      return new Handler(vis, {
        data: data,
        chartTitle: new ChartTitle(vis.el),
        categoryAxes: {
          'CategoryAxis-1': new Axis({
            id: 'CategoryAxis-1',
            type: 'category',
            vis: vis,
            data: data,
            values: data.xValues(),
            ordered: data.get('ordered'),
            axisFormatter: data.get('xAxisFormatter'),
            expandLastBucket: opts.expandLastBucket,
            axisTitle: {
              title: data.get('xAxisLabel')
            }
          })
        },
        alerts: new Alerts(vis, data, opts.alerts),
        valueAxes:  {
          'ValueAxis-1': new Axis({
            id: 'ValueAxis-1',
            type: 'value',
            vis: vis,
            data: data,
            min : isUserDefinedYAxis ? vis._attr.yAxis.min : 0,
            max : isUserDefinedYAxis ? vis._attr.yAxis.max : 0,
            axisFormatter: data.get('yAxisFormatter'),
            axisTitle: {
              title: data.get('yAxisLabel')
            }
          })
        }
      });

    };
  }

  return {
    line: create(),

    column: create({
      zeroFill: true,
      expandLastBucket: true
    }),

    area: create({
      zeroFill: true,
      alerts: [
        {
          type: 'warning',
          msg: 'Positive and negative values are not accurately represented by stacked ' +
               'area charts. Either changing the chart mode to "overlap" or using a ' +
               'bar chart is recommended.',
          test: function (vis, data) {
            if (!data.shouldBeStacked() || data.maxNumberOfSeries() < 2) return;

            let hasPos = data.getYMax(data._getY) > 0;
            let hasNeg = data.getYMin(data._getY) < 0;
            return (hasPos && hasNeg);
          }
        },
        {
          type: 'warning',
          msg: 'Parts of or the entire area chart might not be displayed due to null ' +
          'values in the data. A line chart is recommended when displaying data ' +
          'with null values.',
          test: function (vis, data) {
            return data.hasNullValues();
          }
        }
      ]
    })
  };
};
