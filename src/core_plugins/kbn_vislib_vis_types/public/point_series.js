import VislibVisTypeVislibVisTypeProvider from 'ui/vislib_vis_type/vislib_vis_type';
import VisSchemasProvider from 'ui/vis/schemas';
import pointSeriesTemplate from 'plugins/kbn_vislib_vis_types/editors/point_series.html';

export default function PointSeriesVisType(Private) {
  const VislibVisType = Private(VislibVisTypeVislibVisTypeProvider);
  const Schemas = Private(VisSchemasProvider);

  return new VislibVisType({
    name: 'line',
    title: 'Point series chart',
    icon: 'fa-line-chart',
    description: 'Often the best chart for high density time series. Great for comparing one series to another. ' +
      'Be careful with sparse sets as the connection between points can be misleading.',
    params: {
      defaults: {
        categoryAxes: [
          {
            id: 'CategoryAxis-1',
            type: 'category',
            position: 'bottom',
            style: {
              color: '#ddd',
              lineWidth: '1px',
              opacity: 1,
              tickColor: '#ddd',
              tickWidth: '1px',
              tickLength: '6px'
            },
            scale: {

            },
            labels: {
              show: true,
              rotate: 0,
              rotateAnchor: 'end',
              filter: true,
              color: '#ddd',
              font: '"Open Sans", "Lato", "Helvetica Neue", Helvetica, Arial, sans-serif', // TODO
              fontSize: '8pt',
              truncate: 100
            },
            title: {

            }
          }
        ],
        valueAxes: [
          {
            id: 'ValueAxis-1',
            type: 'value',
            position: 'left',
            style: {
              color: '#ddd',
              lineWidth: '1px',
              opacity: 1,
              tickColor: '#ddd',
              tickWidth: '1px',
              tickLength: '6px'
            },
            scale: {

            },
            labels: {
              show: true,
              rotate: 0,
              rotateAnchor: 'center',
              filter: false,
              color: '#ddd',
              font: '"Open Sans", "Lato", "Helvetica Neue", Helvetica, Arial, sans-serif', // TODO
              fontSize: '8pt',
              truncate: 100
            },
            title: {

            }
          }
        ],
        trendLines: [],
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
      scales: ['linear', 'log', 'square root'],
      positions: ['top', 'left', 'right', 'bottom'],
      chartTypes: ['line', 'area', 'histogram'],
      rotateAnchor: ['start', 'center', 'end'],
      axisModes: ['normal', 'percentage', 'wiggle', 'silluete'],
      chartModes: ['normal', 'stacked'],
      editor: pointSeriesTemplate
    },
    schemas: new Schemas([
      {
        group: 'metrics',
        name: 'metric',
        title: 'Y-Axis',
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
        title: 'X-Axis',
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
