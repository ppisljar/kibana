import { VisFactoryProvider } from 'ui/vis/vis_factory';
import { CATEGORY } from 'ui/vis/vis_category';
import { VisSchemasProvider } from 'ui/vis/editors/default/schemas';
import { VisTypesRegistryProvider } from 'ui/registry/vis_types';
import { MetricVisComponent } from './metric_vis_controller';
import { MetricOptionsComponent } from './metric_vis_params';
import image from './images/icon_number.svg';
import './metric_vis.less';
// we need to load the css ourselves

// we also need to load the controller and used by the template

// register the provider with the visTypes registry
VisTypesRegistryProvider.register(MetricVisProvider);

function MetricVisProvider(Private) {
  const Schemas = Private(VisSchemasProvider);
  const VisFactory = Private(VisFactoryProvider);

  // return the visType object, which kibana will use to display and configure new
  // Vis object of this type.
  return VisFactory.createReactVisualization({
    name: 'demo',
    title: 'Demo',
    image,
    description: 'Display a calculation as a single number',
    category: CATEGORY.DATA,
    visConfig: {
      component: MetricVisComponent,
      defaults: {
        fontSize: 60,
      }
    },
    editorConfig: {
      optionsTemplate: MetricOptionsComponent,
      schemas: new Schemas([
        {
          group: 'metrics',
          name: 'metric',
          title: 'Metric',
          min: 1,
          aggFilter: [
            '!std_dev', '!geo_centroid', '!percentiles', '!percentile_ranks',
            '!derivative', '!serial_diff', '!moving_avg', '!cumulative_sum', '!geo_bounds'],
          defaults: [
            { type: 'count', schema: 'metric' }
          ]
        }, {
          group: 'buckets',
          name: 'group',
          title: 'Split Group',
          min: 0,
          max: 1,
          aggFilter: ['!geohash_grid', '!filter']
        }
      ])
    },
  });
}

// export the provider so that the visType can be required with Private()
export default MetricVisProvider;
