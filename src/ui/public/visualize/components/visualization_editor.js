import 'ui/visualize/spy';
import 'ui/visualize/visualize.less';
import 'ui/visualize/visualize_legend';
import { VisEditorTypesRegistryProvider } from 'ui/registry/vis_editor_types';
import { getUpdateStatus } from 'ui/vis/update_status';

import React, { Component } from 'react';
import PropTypes from 'prop-types';

export class VisualizationEditor extends Component {
  constructor(props) {
    super(props);

    this.editorTypes = props.Private(VisEditorTypesRegistryProvider);
  }

  _createEditor(props) {
    const Editor = typeof props.vis.type.editor === 'function' ? props.vis.type.editor :
      this.editorTypes.find(editor => editor.key === props.vis.type.editor);
    this.editor = new Editor(this.editorDiv, props.vis, props.showSpyPanel);
  }

  componentWillReceiveProps(props) {
    if (this.props.vis.type.editor !== props.vis.type.editor) {
      this._createEditor(props);
    }
    this.editor.render(props.visData, props.searchSource, getUpdateStatus(this, props), props.uiState);
  }

  render() {
    return (<div ref={c => this.editorDiv = c} className="visualize-editor" />);
  }

  componentDidMount() {
    this._createEditor(this.props);
    this.editor.render(this.props.visData, this.props.searchSource, getUpdateStatus(this, this.props), this.props.uiState);
  }

  componentWillUnmount() {
    this.editor.destroy();
  }
}

VisualizationEditor.propTypes = {
  vis: PropTypes.object,
  visData: PropTypes.object,
  uiState: PropTypes.object,
  showSpyPanel: PropTypes.bool,
  Private: PropTypes.func,
  searchSource: PropTypes.object,
};
