import VislibVisTypeVislibVisTypeProvider from 'ui/vislib_vis_type/vislib_vis_type';
import VisSchemasProvider from 'ui/vis/schemas';
import pointSeriesTemplate from 'plugins/kbn_vislib_vis_types/editors/point_series.html';

export default function PointSeriesVisType(Private) {
  const VislibVisType = Private(VislibVisTypeVislibVisTypeProvider);
  const Schemas = Private(VisSchemasProvider);

  return new VislibVisType({
    name: 'point_series',
    title: 'Horizontal bar chart',
    icon: 'fa-bars',
    description: 'Like histogram chart but with horizontal bars.',
    params: {
      defaults: {
        grid: {
          show: false,
          categoryLines: true,
          color: '#eee'
        },
        categoryAxes: [
          {
            id: 'CategoryAxis-1',
            type: 'category',
            position: 'left',
            show: true,
            style: {
            },
            scale: {
              type: 'linear'
            },
            labels: {
              show: true,
              rotate: 0,
              filter: false,
              truncate: 200
            },
            title: {}
          }
        ],
        valueAxes: [
          {
            id: 'ValueAxis-1',
            type: 'value',
            position: 'bottom',
            show: true,
            style: {
            },
            scale: {
              type: 'linear',
              mode: 'normal'
            },
            labels: {
              show: true,
              rotate: 75,
              filter: false,
              truncate: 100
            },
            title: {}
          }
        ],
        seriesParams: [{
          show: true,
          type: 'histogram',
          mode: 'normal',
          data: {
            label: 'Count'
          }
        }],
        addTooltip: true,
        addLegend: true,
        legendPosition: 'right',
        showCircles: true,
        smoothLines: false,
        interpolate: 'linear',
        scale: 'linear',
        drawLinesBetweenPoints: true,
        radiusRatio: 9,
        times: [],
        addTimeMarker: false,
        defaultYExtents: false,
        setYExtents: false
      },
      positions: ['top', 'left', 'right', 'bottom'],
      chartTypes: ['line', 'area', 'histogram'],
      axisModes: ['normal', 'percentage', 'wiggle', 'silhouette'],
      scaleTypes: ['linear', 'log', 'square root'],
      chartModes: ['normal', 'stacked'],
      editor: pointSeriesTemplate
    },
    schemas: new Schemas([
      {
        group: 'metrics',
        name: 'metric',
        title: 'X-Axis',
        min: 1,
        defaults: [
          { schema: 'metric', type: 'count' }
        ]
      },
      {
        group: 'metrics',
        name: 'radius',
        title: 'Dot Size',
        min: 0,
        max: 1,
        aggFilter: ['count', 'avg', 'sum', 'min', 'max', 'cardinality']
      },
      {
        group: 'buckets',
        name: 'segment',
        title: 'Y-Axis',
        min: 0,
        max: 1,
        aggFilter: '!geohash_grid'
      },
      {
        group: 'buckets',
        name: 'group',
        title: 'Split Series',
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
