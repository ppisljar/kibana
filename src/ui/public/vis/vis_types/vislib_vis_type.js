import 'plugins/kbn_vislib_vis_types/controls/vislib_basic_options';
import 'plugins/kbn_vislib_vis_types/controls/point_series_options';
import 'plugins/kbn_vislib_vis_types/controls/line_interpolation_option';
import 'plugins/kbn_vislib_vis_types/controls/heatmap_options';
import 'plugins/kbn_vislib_vis_types/controls/gauge_options';
import 'plugins/kbn_vislib_vis_types/controls/point_series';
import 'ui/visualize/visualize_legend';
import { VisTypeProvider } from './base_vis_type';
import { AggResponsePointSeriesProvider } from 'ui/agg_response/point_series/point_series';
import VislibProvider from 'ui/vislib';
import $ from 'jquery';

export function VislibVisTypeProvider(Private, $rootScope, $timeout, $compile) {
  const VisType = Private(VisTypeProvider);
  const pointSeries = Private(AggResponsePointSeriesProvider);
  const vislib = Private(VislibProvider);

  class VislibVisController {
    constructor(el, vis) {
      this.el = el;
      this.vis = vis;

      this.chartEl = document.createElement('div');
      this.chartEl.className = 'visualize-chart';
      this.el.appendChild(this.chartEl);

      this.el.className = 'vis-container';
    }

    render(esResponse) {
      this._response = esResponse;
      if (this.vis.vislibVis) {
        this.destroy();
      }

      return new Promise(async (resolve, reject) => {
        if (this.el.clientWidth === 0 || this.el.clientHeight === 0) {
          return resolve();
        }

        let $scope;
        if (this.vis.params.addLegend) {
          const legendPositionToVisContainerClassMap = {
            top: 'vis-container--legend-top',
            bottom: 'vis-container--legend-bottom',
            left: 'vis-container--legend-left',
            right: 'vis-container--legend-right',
          };

          const getVisContainerClasses = () => {
            return legendPositionToVisContainerClassMap[this.vis.params.legendPosition];
          };

          // update the legend class on the parent element
          $(this.el).attr('class', (i, cls) => {
            return cls.replace(/vis-container--legend-\S+/g, '');
          }).addClass(getVisContainerClasses());

          $scope = $rootScope.$new();
          $scope.refreshLegend = 0;
          $scope.vis = this.vis;
          $scope.visData = esResponse;
          $scope.uiState = $scope.vis.getUiState();
          const legendHtml = $compile('<visualize-legend></visualize-legend>')($scope);
          this.el.appendChild(legendHtml[0]);
          $scope.$digest();
          // We need to wait one digest cycle for the legend to render, before
          // we want to render the chart, so it know about the legend size.
          await new Promise(resolve => $timeout(resolve));
        }

        this.vis.vislibVis = new vislib.Vis(this.chartEl, this.vis.params);
        this.vis.vislibVis.on('brush', this.vis.API.events.brush);
        this.vis.vislibVis.on('click', this.vis.API.events.filter);
        this.vis.vislibVis.on('renderComplete', resolve);
        this.vis.vislibVis.render(esResponse, this.vis.getUiState());

        if (this.vis.params.addLegend) {
          $scope.refreshLegend++;
          $scope.$digest();
        }
      });
    }

    destroy() {
      if (this.vis.vislibVis) {
        this.vis.vislibVis.off('brush', this.vis.API.events.brush);
        this.vis.vislibVis.off('click', this.vis.API.events.filter);
        this.vis.vislibVis.destroy();
        delete this.vis.vislibVis;
      }
      $(this.el).find('visualize-legend').remove();
    }
  }

  class VislibVisType extends VisType {
    constructor(opts) {
      if (!opts.responseHandler) {
        opts.responseHandler = 'basic';
      }
      if (!opts.responseConverter) {
        opts.responseConverter = pointSeries;
      }
      opts.visualization = VislibVisController;
      super(opts);
      this.refreshLegend = 0;
    }
  }

  return VislibVisType;
}
