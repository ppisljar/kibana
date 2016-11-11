import VislibVisTypeVislibVisTypeProvider from 'ui/vislib_vis_type/vislib_vis_type';
import VisSchemasProvider from 'ui/vis/schemas';
import heatmapTemplate from 'plugins/kbn_vislib_vis_types/editors/heatmap.html';

export default function HeatmapVisType(Private) {
  const VislibVisType = Private(VislibVisTypeVislibVisTypeProvider);
  const Schemas = Private(VisSchemasProvider);

  return new VislibVisType({
    name: 'heatmap',
    title: 'Heatmap chart',
    icon: 'fa-bar-chart',
    description: 'The goto chart for oh-so-many needs. Great for time and non-time data. Stacked or grouped, ' +
    'exact numbers or percentages. If you are not sure which chart you need, you could do worse than to start here.',
    params: {
      defaults: {
        addTooltip: true,
        addLegend: true,
        legendPosition: 'right',
        scale: 'linear',
        times: [],
        addTimeMarker: false,
        defaultYExtents: false,
        setYExtents: false,
        colorsNumber: 4,
        colorSchema: 'yellow to red',
      },
      scales: ['linear', 'log', 'square root'],
      colorSchemas: ['yellow to red', 'reds', 'greens', 'blues'],
      editor: heatmapTemplate
    },
    schemas: new Schemas([
      {
        group: 'metrics',
        name: 'metric',
        title: 'Y-Axis',
        min: 1,
        aggFilter: '!std_dev',
        defaults: [
          { schema: 'metric', type: 'count' }
        ]
      },
      {
        group: 'buckets',
        name: 'segment',
        title: 'X-Axis',
        min: 0,
        max: 1,
        aggFilter: '!geohash_grid'
      },
      {
        group: 'buckets',
        name: 'group',
        title: 'Split Bars',
        min: 0,
        max: 1,
        aggFilter: '!geohash_grid'
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
};
