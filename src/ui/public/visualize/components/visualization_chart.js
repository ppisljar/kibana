import $ from 'jquery';
import React, { Component } from 'react';
import { ResizeChecker } from 'ui/resize_checker';
import { getUpdateStatus } from 'ui/vis/update_status';
import { dispatchRenderComplete, dispatchRenderStart } from 'ui/render_complete';

export class VisualizationChart extends Component {
  render() {
    return (
      <div className="vis-container" tabIndex="0" ref={c => this.containerDiv = c}>
        <span className="kuiScreenReaderOnly">
          {this.props.vis.type.title} visualization, not yet accessible
        </span>
        <div
          aria-hidden={!this.props.vis.type.isAccessible}
          className="visualize-chart"
          ref={c => this.chartDiv = c}
        />
      </div>
    );
  }

  _renderVisualization = () => {
    dispatchRenderStart(this.chartDiv);
    this.props.vis.size = [$(this.containerDiv).width(), $(this.containerDiv).height()];
    const status = getUpdateStatus(this, this.props);
    this.visualization.render(this.props.visData, status).then(() => {
      dispatchRenderComplete(this.chartDiv);
    });
  };

  componentDidMount() {
    const Visualization = this.props.vis.type.visualization;
    this.visualization = new Visualization(this.chartDiv, this.props.vis);

    if (this.props.listenOnChange) {
      this.resizeChecker = new ResizeChecker(this.containerDiv);
      this.resizeChecker.on('resize', this._renderVisualization);
    }

    this._renderVisualization();
  }

  componentDidUpdate() {
    this._renderVisualization();
  }

  componentWillUnmount() {
    if (this.resizeChecker) this.resizeChecker.destroy();
    if (this.visualization) this.visualization.destroy();
  }
}
