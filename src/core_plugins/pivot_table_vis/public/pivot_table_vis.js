import 'plugins/pivot_table_vis/pivot_table_vis.less';
import 'plugins/pivot_table_vis/pivot_table_vis_controller';
import 'plugins/pivot_table_vis/pivot_table_vis_params';
import 'ui/agg_table';
import 'ui/agg_table/agg_table_group';
import TemplateVisTypeTemplateVisTypeProvider from 'ui/template_vis_type/template_vis_type';
import VisSchemasProvider from 'ui/vis/schemas';
import pivotTableVisTemplate from 'plugins/pivot_table_vis/pivot_table_vis.html';
import visTypes from 'ui/registry/vis_types';

visTypes.register(function PivotTableVisTypeProvider(Private) {
  const TemplateVisType = Private(TemplateVisTypeTemplateVisTypeProvider);
  const Schemas = Private(VisSchemasProvider);

  return new TemplateVisType({
    name: 'pivot_table',
    title: 'Pivot Table',
    icon: 'fa-table',
    description: 'The data table provides a detailed breakdown, in tabular format, of the results of a composed ' +
      'aggregation. Tip, a data table is available from many other charts by clicking the grey bar at the bottom of the chart.',
    template: pivotTableVisTemplate,
    params: {
      defaults: {
        addTooltip: false,
        perPage: 50,
        sort: {
          columnIndex: null,
          direction: null
        },
        columns: [],
        showTotal: false,
        totalFunc: 'sum',
        fontSize: 1,
        enableHover: true,
      },
      editor: '<pivot-table-vis-params></pivot-table-vis-params>'
    },
    implementsRenderComplete: true,
    hierarchicalData: true,
    schemas: new Schemas([
      {
        group: 'metrics',
        name: 'metric',
        title: 'Metric',
        min: 1,
        defaults: [
          { type: 'count', schema: 'metric' }
        ]
      },
      {
        group: 'buckets',
        name: 'rows',
        title: 'Split Rows'
      },
      {
        group: 'buckets',
        name: 'columns',
        title: 'Split Columns'
      },
      {
        group: 'buckets',
        name: 'split',
        title: 'Split Table'
      }
    ])
  });
});
