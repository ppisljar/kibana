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
    this.editor.render(
      props.visData,
      props.searchSource,
      getUpdateStatus(props.vis.type.requiresUpdateStatus, this, props),
      props.uiState
    );
  }

  render() {
    return (<div ref={c => this.editorDiv = c} className="visualize-editor" />);
  }

  componentDidMount() {
    this._createEditor(this.props);
    this.editor.render(
      this.props.visData,
      this.props.searchSource,
      getUpdateStatus(this.props.vis.type.requiresUpdateStatus, this, this.props),
      this.props.uiState
    );
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
