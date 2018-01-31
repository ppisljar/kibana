import 'ui/visualize/visualize.less';
import _ from 'lodash';
import React, { Component } from 'react';
import { VisualizationNoResults, VisualizationChart } from './components';

export class Visualization extends Component {
  constructor(props) {
    super(props);
    props.vis.initialized = true;

    props.vis._setUiState(props.uiState);
    if (props.listenOnChange) {
      props.uiState.on('change', this._onChangeListener);
    }

    this.state = {
      showNoResultsMessage: this._showNoResultsMessage(props.vis, props.visData)
    };
  }

  _showNoResultsMessage = (vis, visData) => {
    const requiresSearch = _.get(vis, 'type.requiresSearch');
    const isZeroHits = _.get(visData, 'hits.total') === 0;
    const shouldShowMessage = !_.get(vis, 'params.handleNoResults');

    return Boolean(requiresSearch && isZeroHits && shouldShowMessage);
  };

  render() {
    return (
      <div className="visualization">
        {this.state.showNoResultsMessage ? (<VisualizationNoResults />) :
          (<VisualizationChart
            vis={this.props.vis}
            visData={this.props.visData}
            listenOnChange={this.props.listenOnChange}
          />)
        }
      </div>
    );
  }

  _onChangeListener = () => {
    this.forceUpdate();
  };

  componentWillReceiveProps(props) {
    const listenOnChangeChanged = props.listenOnChange !== this.props.listenOnChange;
    const uiStateChanged = props.uiState !== this.props.uiState;
    if (listenOnChangeChanged || uiStateChanged) {
      throw new Error('Changing listenOnChange or uiState props is not allowed!');
    }

    const showNoResultsMessage = this._showNoResultsMessage(props.vis, props.visData);
    if (this.state.showNoResultsMessage !== showNoResultsMessage) {
      this.setState({ showNoResultsMessage });
    }
  }

  componentWillUnmount() {
    this.props.uiState.off('change', this._onChangeListener);
  }
}
