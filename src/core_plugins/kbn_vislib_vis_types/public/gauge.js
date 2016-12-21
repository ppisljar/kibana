import VislibVisTypeVislibVisTypeProvider from 'ui/vislib_vis_type/vislib_vis_type';
import VisSchemasProvider from 'ui/vis/schemas';
import gaugeTemplate from 'plugins/kbn_vislib_vis_types/editors/gauge.html';

export default function GaugeVisType(Private) {
  const VislibVisType = Private(VislibVisTypeVislibVisTypeProvider);
  const Schemas = Private(VisSchemasProvider);

  return new VislibVisType({
    name: 'gauge',
    title: 'Gauge chart',
    icon: 'fa-tachometer',
    description: 'A gauge chart shows much more than one value. It gives the minimum, the maximum, ' +
    'the current value and how far from the maximum you are ',
    params: {
      defaults: {
        addTooltip: true,
        addLegend: false,
        gauge: {
          percentageMode: true,
          gaugeType: 'Meter',
          gaugeStyle: 'Full',
          extents: [0, 100],
          orientation: 'vertical',
          labels: {
            show: true,
            color: 'black'
          },
          scale: {
            show: true,
            labels: false,
            color: '#333'
          },
          type: 'meter',
          style: {
            bgWidth: 0.9,
            width: 0.9,
            mask: false,
            bgMask: false,
            maskBars: 50,
            bgFill: '#eee',
          }
        }
      },
      gaugeTypes: ['Meter', 'Circle'],
      gaugeStyles: ['Full', 'Bars', 'Lines'],
      editor: gaugeTemplate
    },
    implementsRenderComplete: true,
    schemas: new Schemas([
      {
        group: 'metrics',
        name: 'metric',
        title: 'Metric',
        min: 1,
        aggFilter: '!std_dev',
        defaults: [
          { schema: 'metric', type: 'count' }
        ]
      },
      {
        group: 'buckets',
        name: 'split',
        title: 'Split Chart',
        min: 0,
        max: 1,
        aggFilter: '!geohash_grid'
      }
    ])
  });
}
