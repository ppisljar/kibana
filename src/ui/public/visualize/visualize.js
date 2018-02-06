import _ from 'lodash';
import { stateMonitorFactory } from 'ui/state_management/state_monitor_factory';
import { VisRequestHandlersRegistryProvider } from 'ui/registry/vis_request_handlers';
import { VisResponseHandlersRegistryProvider } from 'ui/registry/vis_response_handlers';
import { FilterBarQueryFilterProvider } from 'ui/filter_bar/query_filter';
import { ResizeChecker } from 'ui/resize_checker';
import { isTermSizeZeroError } from '../elasticsearch_errors';
import { toastNotifications } from 'ui/notify';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Visualization } from './visualization';
import { VisualizationEditor } from './components/visualization_editor';

function getHandler(from, name) {
  if (typeof name === 'function') return name;
  return from.find(handler => handler.name === name).handler;
}

export class Visualize extends Component {
  constructor(props) {
    super(props);

    this.vis = props.savedObj.vis;
    this.vis.description = props.savedObj.description;
    this.vis.editorMode = props.editorMode || false;
    this.vis._setUiState(props.uiState);
    this.vis.on('update', this._handleVisUpdate);
    this.vis.on('reload', this._reload);

    this.queryFilter = props.Private(FilterBarQueryFilterProvider);

    this.queryFilter.on('update', this._fetch);
    props.uiState.on('change', this._fetch);
    props.timeFilter.on('change', this._fetch);

    const requestHandlers = props.Private(VisRequestHandlersRegistryProvider);
    const responseHandlers = props.Private(VisResponseHandlersRegistryProvider);
    this.requestHandler = getHandler(requestHandlers, this.vis.type.requestHandler);
    this.responseHandler = getHandler(responseHandlers, this.vis.type.responseHandler);
  }

  _fetch = _.debounce(() => {
    // If destroyed == true the scope has already been destroyed, while this method
    // was still waiting for its debounce, in this case we don't want to start
    // fetching new data and rendering.
    if (!this.vis.initialized || this._destroyed) return;
    // searchSource is only there for courier request handler
    this.requestHandler(this.vis, this.props.appState, this.props.uiState, this.queryFilter, this.props.savedObj.searchSource)
      .then(requestHandlerResponse => {

        //No need to call the response handler when there have been no data nor has been there changes
        //in the vis-state (response handler does not depend on uiStat
        const canSkipResponseHandler = (
          this.previousRequestHandlerResponse && this.previousRequestHandlerResponse === requestHandlerResponse &&
          this.previousVisState && _.isEqual(this.previousVisState, this.vis.getState())
        );

        this.previousVisState = this.vis.getState();
        this.previousRequestHandlerResponse = requestHandlerResponse;
        return canSkipResponseHandler ? this.visData : Promise.resolve(this.responseHandler(this.vis, requestHandlerResponse));
      }, e => {
        this.savedObj.searchSource.cancelQueued();
        this.vis.requestError = e;
        if (isTermSizeZeroError(e)) {
          return toastNotifications.addDanger(
            `Your visualization ('${this.vis.title}') has an error: it has a term ` +
            `aggregation with a size of 0. Please set it to a number greater than 0 to resolve ` +
            `the error.`
          );
        }
        toastNotifications.addDanger(e);
      })
      .then(resp => {
        this.visData = resp;
        this.forceUpdate();
      });
  }, 100);

  _handleVisUpdate = () => {
    if (this.vis.editorMode) {
      this.props.appState.vis = this.vis.getState();
      this.props.appState.save();
    } else {
      this._fetch();
    }
  };

  _reload = () => {
    this.vis.reload = true;
    this._fetch();
  };

  componentWillReceiveProps(props) {
    if (!props.savedObj) throw(`saved object was not provided to <visualize> component`);
    if (props.timeRange) {
      this.vis.getTimeRange = () => props.timeRange;

      const searchSource = props.savedObj.searchSource;
      searchSource.filter(() => {
        return props.timefilter.get(searchSource.index(), props.timeRange);
      });

      // we're only adding one range filter against the timeFieldName to ensure
      // that our filter is the only one applied and override the global filters.
      // this does rely on the "implementation detail" that filters are added first
      // on the leaf SearchSource and subsequently on the parents
      searchSource.addFilterPredicate((filter, state) => {
        if (!filter.range) {
          return true;
        }

        const timeFieldName = searchSource.index().timeFieldName;
        if (!timeFieldName) {
          return true;
        }

        return !(state.filters || []).find(f => f.range && f.range[timeFieldName]);
      });
    }

    if (props.appState) {
      this._stateMonitor = stateMonitorFactory.create(props.appState);
      this._stateMonitor.onChange((status, type, keys) => {
        if (keys[0] === 'vis') {
          if (props.appState.vis) this.vis.setState(props.appState.vis);
          this._fetch();
        }
        if (this.vis.type.requiresSearch && ['query', 'filters'].includes(keys[0])) {
          this._fetch();
        }
      });
    }
  }

  render() {
    return (this.vis.editorMode ?
      (<VisualizationEditor
        vis={this.vis}
        visData={this.visData}
        uiState={this.props.uiState}
        Private={this.props.Private}
      />) :
      (<Visualization vis={this.vis} visData={this.visData} uiState={this.props.uiState}/>)
    );
  }

  componentDidMount() {
    this.resizeChecker = new ResizeChecker(this.props.container);
    this.resizeChecker.on('resize', this._fetch);

    this._fetch();
  }

  componentWillUnmount() {
    this._destroy = true;
    this.vis.removeListener('update', this._handleVisUpdate);
    this.props.queryFilter.off('update', this._fetch);
    this.props.uiState.off('change', this._fetch);
    this.resizeChecker.destroy();

    if (this._stateMonitor) this._stateMonitor.destroy();
  }
}

Visualize.propTypes = {
  savedObj: PropTypes.object,
  uiState: PropTypes.object,
  appState: PropTypes.object,
  Private: PropTypes.func,
  timefilter: PropTypes.object,
  editorMode: PropTypes.bool
};


/*
        // auto reload will trigger this event
        $scope.$on('courier:searchRefresh', reload);
        // dashboard will fire fetch event when it wants to refresh
        $scope.$on('fetch', reload);

        if ($scope.editorMode) {
          $scope.$watch('vis.initialized', $scope.fetch);
        } else {
          $scope.vis.initialized = true;
        }
*/
