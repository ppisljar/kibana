import { VisVisTypeProvider } from 'ui/vis/vis_type';
import { VislibVisTypeVislibVisTypeProvider } from 'ui/vislib_vis_type/vislib_vis_type';
import { VisSchemasProvider } from 'ui/vis/schemas';
import gaugeTemplate from 'plugins/kbn_vislib_vis_types/editors/gauge.html';
import { vislibColorMaps } from 'ui/vislib/components/color/colormaps';
import image from './images/icon-goal.svg';

export default function GoalVisType(Private) {
  const VisType = Private(VisVisTypeProvider);
  const VislibVisType = Private(VislibVisTypeVislibVisTypeProvider);
  const Schemas = Private(VisSchemasProvider);

  return new VislibVisType({
    name: 'goal',
    title: 'Goal',
    image,
    description: 'A goal chart indicates how close you are to your final goal.',
    category: VisType.CATEGORY.DATA,
    params: {
      defaults: {
        addTooltip: true,
        addLegend: false,
        type: 'gauge',
        gauge: {
          verticalSplit: false,
          autoExtend: false,
          percentageMode: false,
          gaugeType: 'Meter',
          gaugeStyle: 'Full',
          backStyle: 'Full',
          orientation: 'vertical',
          useRanges: false,
          colorSchema: 'Green to Red',
          colorsRange: [
            { from: 0, to: 100 }
          ],
          invertColors: false,
          labels: {
            show: true,
            color: 'black'
          },
          scale: {
            show: false,
            labels: false,
            color: '#333',
            width: 2
          },
          type: 'meter',
          style: {
            bgWidth: 0.9,
            width: 0.9,
            mask: false,
            bgMask: false,
            maskBars: 50,
            bgFill: '#eee',
            bgColor: true,
            subText: '',
            fontSize: 60,
          }
        }
      },
      gaugeTypes: ['Meter', 'Circle', 'Metric'],
      scales: ['linear', 'log', 'square root'],
      colorSchemas: Object.keys(vislibColorMaps),
      editor: gaugeTemplate
    },
    implementsRenderComplete: true,
    schemas: new Schemas([
      {
        group: 'metrics',
        name: 'metric',
        title: 'Metric',
        min: 1,
        aggFilter: ['!std_dev, !geo_centroid'],
        defaults: [
          { schema: 'metric', type: 'count' }
        ]
      },
      {
        group: 'buckets',
        name: 'group',
        title: 'Split Group',
        min: 0,
        max: 1,
        aggFilter: '!geohash_grid'
      }
    ])
  });
}
