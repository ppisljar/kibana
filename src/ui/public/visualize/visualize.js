/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import _ from 'lodash';
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { toastNotifications } from 'ui/notify';
import { VisRequestHandlersRegistryProvider } from '../registry/vis_request_handlers';
import { VisResponseHandlersRegistryProvider } from '../registry/vis_response_handlers';
import { Visualization } from './visualization';
import { VisualizationEditor } from './components/visualization_editor';
import { FilterBarQueryFilterProvider } from '../filter_bar/query_filter';
import { ResizeChecker } from '../resize_checker';
import { isTermSizeZeroError } from '../elasticsearch_errors';

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

    props.uiState.on('change', this._fetch);

    // auto reload will trigger this event
    // $scope.$on('courier:searchRefresh', reload);

    const requestHandlers = props.Private(VisRequestHandlersRegistryProvider);
    const responseHandlers = props.Private(VisResponseHandlersRegistryProvider);
    this.requestHandler = getHandler(requestHandlers, this.vis.type.requestHandler);
    this.responseHandler = getHandler(responseHandlers, this.vis.type.responseHandler);
  }

  _fetch = _.debounce(() => {
    // If destroyed == true the scope has already been destroyed, while this method
    // was still waiting for its debounce, in this case we don't want to start
    // fetching new data and rendering.
    if (!this.vis || this._destroy) return;

    this.vis.filters = { timeRange: this.props.timeRange };

    const handlerParams = {
      appState: this.props.appState,
      uiState: this.props.uiState,
      queryFilter: this.queryFilter,
      searchSource: this.props.savedObj.searchSource,
      aggs: this.vis.getAggConfig(),
      timeRange: this.props.timeRange,
      filters: this.props.filters,
      query: this.props.query,
      forceFetch: this._forceFetch,
    };

    // Reset forceFetch flag, since we are now executing our forceFetch in case it was true
    this._forceFetch = false;

    // searchSource is only there for courier request handler
    this.requestHandler(this.vis, handlerParams)
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
        this.props.savedObj.searchSource.cancelQueued();
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
    if (this.props.appState.vis) {
      this.props.appState.vis = this.vis.getState();
      this.props.appState.save();
    }

    this._fetch();
  };

  _reload = () => {
    this._forceFetch = true;
    this._fetch();
  };

  componentWillReceiveProps(props) {
    if (!props.savedObj) throw(`saved object was not provided to <visualize> component`);
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
    this.vis.removeListener('reload', this._reload);
    this.vis.removeListener('update', this._handleVisUpdate);
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
  timeRange: PropTypes.object,
  filters: PropTypes.object,
  query: PropTypes.object,
  editorMode: PropTypes.bool
};


