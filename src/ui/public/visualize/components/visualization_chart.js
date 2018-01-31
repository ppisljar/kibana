import $ from 'jquery';
import React, { Component } from 'react';
import { Observable } from 'rxjs/Rx';
import { ResizeChecker } from 'ui/resize_checker';
import { getUpdateStatus } from 'ui/vis/update_status';
import { dispatchRenderComplete, dispatchRenderStart } from 'ui/render_complete';

export class VisualizationChart extends Component {
  constructor(props) {
    super(props);

    this._renderVisualization = new Observable(observer => {
      this._observer = observer;
    });

    this._renderVisualization
      .do(() => {
        dispatchRenderStart(this.chartDiv);
      })
      .filter(({ vis, visData, container }) => vis && vis.initialized && container && (!vis.type.requiresSearch || visData))
      .debounceTime(100)
      .switchMap(async ({ vis, visData, container }) => {
        vis.size = [container.width(), container.height()];
        const status = getUpdateStatus(vis.type.requiresUpdateStatus, this, this.props);
        const renderPromise = this.visualization.render(visData, status);
        return renderPromise;
      }).subscribe(() => {
        dispatchRenderComplete(this.chartDiv);
      });

  }

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

  _startRenderVisualization = () => {
    this._observer.next({
      vis: this.props.vis,
      visData: this.props.visData,
      container: $(this.containerDiv)
    });
  };

  // componentWillReceiveProps(props) {
  //   if (props.vis !== this.props.vis) {
  //     const Visualization = props.vis.type.visualization;
  //     this.visualization = new Visualization(this.chartDiv, props.vis);
  //   }
  // }

  componentDidMount() {
    const Visualization = this.props.vis.type.visualization;
    this.visualization = new Visualization(this.chartDiv, this.props.vis);

    if (this.props.listenOnChange) {
      this.resizeChecker = new ResizeChecker(this.containerDiv);
      this.resizeChecker.on('resize', this._startRenderVisualization);
    }

    this._startRenderVisualization();
  }

  componentDidUpdate() {
    this._startRenderVisualization();
  }

  componentWillUnmount() {
    if (this.resizeChecker) this.resizeChecker.destroy();
    if (this.visualization) this.visualization.destroy();
  }
}
