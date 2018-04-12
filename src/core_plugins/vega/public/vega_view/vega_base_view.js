import $ from 'jquery';
import moment from 'moment';
import * as vega from 'vega-lib';
import * as vegaLite from 'vega-lite';
import { areIndexPatternsProvided } from 'ui/filter_editor/lib/filter_editor_utils';
import { Utils } from '../data_model/utils';
import { VISUALIZATION_COLORS } from '@elastic/eui';
import { buildQueryFilter } from 'ui/filter_manager/lib';

vega.scheme('elastic', VISUALIZATION_COLORS);

// Vega's extension functions are global. When called,
// we forward execution to the instance-specific handler
function addGlobalVegaHandler(funcName, handlerName) {
  if (!vega.expressionFunction(funcName)) {
    vega.expressionFunction(
      funcName,
      function handlerFwd(...args) {
        const view = this.context.dataflow;
        const handler = view[handlerName];
        if (!handler) throw new Error(`${funcName}() is not defined for this graph`);
        view.runAfter(() => handler(...args));
      }
    );
  }
}

addGlobalVegaHandler('kibanaAddFilter', 'kibanaAddFilterHandler');
addGlobalVegaHandler('kibanaRemoveFilter', 'kibanaRemoveFilterHandler');
addGlobalVegaHandler('kibanaRemoveAllFilters', 'kibanaRemoveAllFiltersHandler');
addGlobalVegaHandler('kibanaSetTimeFilter', 'kibanaSetTimeFilterHandler');

const bypassToken = Symbol();

export function bypassExternalUrlCheck(url) {
  // processed in the  loader.sanitize  below
  return { url, bypassToken };
}

export class VegaBaseView {
  constructor(opts) {
    this._vegaConfig = opts.vegaConfig;
    this._editorMode = opts.editorMode;
    this._$parentEl = $(opts.parentEl);
    this._parser = opts.vegaParser;
    this._serviceSettings = opts.serviceSettings;
    this._queryfilter = opts.queryfilter;
    this._timefilter = opts.timefilter;
    this._indexPatterns = opts.indexPatterns;
    this._view = null;
    this._vegaViewConfig = null;
    this._$messages = null;
    this._destroyHandlers = [];
    this._initialized = false;
  }

  async init() {
    if (this._initialized) throw new Error();  // safety
    this._initialized = true;

    try {
      // Adapted from src/ui/public/filter_editor/filter_editor.js
      if (!areIndexPatternsProvided(this._indexPatterns)) {
        const defaultIndexPattern = await this._indexPatterns.getDefault();
        if (defaultIndexPattern) {
          this._indexPatterns = [defaultIndexPattern];
        }
      }

      this._$parentEl.empty()
        .addClass('vega-main')
        .css('flex-direction', this._parser.containerDir);

      // bypass the onWarn warning checks - in some cases warnings may still need to be shown despite being disabled
      for (const warn of this._parser.warnings) {
        this._addMessage('warn', warn);
      }

      if (this._parser.error) {
        this._addMessage('err', this._parser.error);
        return;
      }

      this._$container = $('<div class="vega-view-container">')
        .appendTo(this._$parentEl);
      this._$controls = $('<div class="vega-controls-container">')
        .css('flex-direction', this._parser.controlsDir)
        .appendTo(this._$parentEl);

      this._addDestroyHandler(() => {
        if (this._$container) {
          this._$container.remove();
          this._$container = null;
        }
        if (this._$controls) {
          this._$controls.remove();
          this._$controls = null;
        }
        if (this._$messages) {
          this._$messages.remove();
          this._$messages = null;
        }
      });

      this._vegaViewConfig = this.createViewConfig();

      // The derived class should create this method
      await this._initViewCustomizations();
    } catch (err) {
      this.onError(err);
    }
  }

  createViewConfig() {
    const config = {
      logLevel: vega.Warn,
      renderer: this._parser.renderer,
    };

    // Override URL sanitizer to prevent external data loading (if disabled)
    const loader = vega.loader();
    const originalSanitize = loader.sanitize.bind(loader);
    loader.sanitize = (uri, options) => {
      if (uri.bypassToken === bypassToken) {
        // If uri has a bypass token, the uri was encoded by bypassExternalUrlCheck() above.
        // because user can only supply pure JSON data structure.
        uri = uri.url;
      } else if (!this._vegaConfig.enableExternalUrls) {
        throw new Error('External URLs are not enabled. Add   vega.enableExternalUrls: true   to kibana.yml');
      }
      return originalSanitize(uri, options);
    };
    config.loader = loader;

    return config;
  }

  onError() {
    this._addMessage('err', Utils.formatErrorToStr(...arguments));
  }

  onWarn() {
    if (!this._parser || !this._parser.hideWarnings) {
      this._addMessage('warn', Utils.formatWarningToStr(...arguments));
    }
  }

  _addMessage(type, text) {
    if (!this._$messages) {
      this._$messages = $(`<ul class="vega-messages">`).appendTo(this._$parentEl);
    }
    this._$messages.append(
      $(`<li class="vega-message-${type}">`).append(
        $(`<pre>`).text(text)
      )
    );
  }

  resize() {
    if (this._parser.useResize && this._view && this.updateVegaSize(this._view)) {
      return this._view.runAsync();
    }
  }

  updateVegaSize(view) {
    // For some reason the object is slightly scrollable without the extra padding.
    // This might be due to https://github.com/jquery/jquery/issues/3808
    // Which is being fixed as part of jQuery 3.3.0
    const heightExtraPadding = 6;
    const width = Math.max(0, this._$container.width() - this._parser.paddingWidth);
    const height = Math.max(0, this._$container.height() - this._parser.paddingHeight) - heightExtraPadding;
    if (view.width() !== width || view.height() !== height) {
      view.width(width).height(height);
      return true;
    }
    return false;
  }

  setView(view) {
    this._view = view;
    if (view) {
      /**
       * @param {object} query Elastic Query DSL snippet, as used in the query DSL editor
       */
      view.kibanaAddFilterHandler = (query) => {
        const filter = buildQueryFilter(query, this._indexPatterns[0].id);
        this._queryfilter.addFilters(filter);
      };

      /**
       * @param {object} query Elastic Query DSL snippet, as used in the query DSL editor
       */
      view.kibanaRemoveFilterHandler = (query) => {
        const filter = buildQueryFilter(query, this._indexPatterns[0].id);
        this._queryfilter.removeFilter(filter);
      };

      view.kibanaRemoveAllFiltersHandler = () => {
        this._queryfilter.removeAll();
      };

      /**
       * @param {number|string|Date} start
       * @param {number|string|Date} end
       * @param {string} [mode]
       */
      view.kibanaSetTimeFilterHandler = (start, end, mode) => {
        const tf = this._timefilter;

        let from = moment(start);
        let to = moment(end);

        if (from.isValid() && to.isValid()) {
          if (from.isAfter(to)) {
            [from, to] = [to, from];
          }
        } else if (typeof start === 'string' && typeof end === 'string') {

          // TODO/FIXME:  should strings be allowed as is, or is there a parser?
          // Also, should the default mode be changed in this case?

          [from, to] = [start, end];
        }

        tf.time.from = from;
        tf.time.to = to;
        tf.time.mode = mode || 'absolute';
        tf.update();
      };
    }
  }

  /**
   * Set global debug variable to simplify vega debugging in console. Show info message first time
   */
  setDebugValues(view, spec, vlspec) {
    if (!this._editorMode) {
      // VEGA_DEBUG should only be enabled in the editor mode
      return;
    }

    if (window) {
      if (window.VEGA_DEBUG === undefined && console) {
        console.log('%cWelcome to Kibana Vega Plugin!', 'font-size: 16px; font-weight: bold;');
        console.log('You can access the Vega view with VEGA_DEBUG. ' +
          'Learn more at https://vega.github.io/vega/docs/api/debugging/.');
      }
      const debugObj = {};
      window.VEGA_DEBUG = debugObj;
      window.VEGA_DEBUG.VEGA_VERSION = vega.version;
      window.VEGA_DEBUG.VEGA_LITE_VERSION = vegaLite.version;
      window.VEGA_DEBUG.view = view;
      window.VEGA_DEBUG.vega_spec = spec;
      window.VEGA_DEBUG.vegalite_spec = vlspec;

      // On dispose, clean up, but don't use undefined to prevent repeated debug statements
      this._addDestroyHandler(() => {
        if (debugObj === window.VEGA_DEBUG) {
          window.VEGA_DEBUG = null;
        }
      });
    }
  }

  destroy() {
    // properly handle multiple destroy() calls by converting this._destroyHandlers
    // into the _ongoingDestroy promise, while handlers are being disposed
    if (this._destroyHandlers) {
      // If no destroy is yet running, execute all handlers and wait for all of them to resolve.
      this._ongoingDestroy = Promise.all(this._destroyHandlers.map(v => v()));
      this._destroyHandlers = null;
    }
    return this._ongoingDestroy;
  }

  _addDestroyHandler(handler) {
    // If disposing hasn't started yet, enqueue it, otherwise dispose right away
    // This creates a minor issue - if disposing has started but not yet finished,
    // and we dispose the new handler right away, the destroy() does not wait for it.
    // This behavior is no different from the case when disposing has already completed,
    // so it shouldn't create any issues.
    if (this._destroyHandlers) {
      this._destroyHandlers.push(handler);
    } else {
      handler();
    }
  }
}
