import { Notifier } from 'ui/notify';
import { VegaView } from './vega_view/vega_view';
import { VegaMapView } from './vega_view/vega_map_view';
import { FilterBarQueryFilterProvider } from 'ui/filter_bar/query_filter';

export function VegaVisualizationProvider(Private, vegaConfig, serviceSettings, indexPatterns, timefilter) {

  const notify = new Notifier({ location: 'Vega' });
  const queryfilter = Private(FilterBarQueryFilterProvider);

  return class VegaVisualization {
    constructor(el, vis) {
      this._el = el;
      this._vis = vis;
    }

    /**
     *
     * @param {VegaParser} visData
     * @param {*} status
     * @returns {Promise<void>}
     */
    async render(visData, status) {
      if (!visData && !this._vegaView) {
        notify.warning('Unable to render without data');
        return;
      }

      try {

        await this._render(visData, status);

      } catch (error) {
        if (this._vegaView) {
          this._vegaView.onError(error);
        } else {
          notify.error(error);
        }
      }
    }

    async _render(vegaParser, status) {
      if (vegaParser && (status.data || !this._vegaView)) {

        // New data received, rebuild the graph
        if (this._vegaView) {
          await this._vegaView.destroy();
          this._vegaView = null;
        }

        const vegaViewParams = {
          vegaConfig,
          editorMode: this._vis.editorMode,
          parentEl: this._el,
          vegaParser,
          serviceSettings,
          queryfilter,
          timefilter,
          indexPatterns
        };

        if (vegaParser.useMap) {
          this._vegaView = new VegaMapView(vegaViewParams);
        } else {
          this._vegaView = new VegaView(vegaViewParams);
        }
        await this._vegaView.init();

      } else if (status.resize) {

        // the graph has been resized
        await this._vegaView.resize();

      }
    }

    destroy() {
      return this._vegaView && this._vegaView.destroy();
    }
  };
}
