import _ from 'lodash';
import PropTypes from 'prop-types';
import React, { Component } from 'react';

import {
  EuiForm,
  EuiFormRow,
  EuiRange,
} from '@elastic/eui';

export class MetricOptionsComponent extends Component {

  setVisParam = (paramName, paramValue) => {
    const params = _.cloneDeep(this.props.scope.vis.params);
    params[paramName] = paramValue;
    this.props.stageEditorParams(params);
  }

  handleUpdateFontSizeChange = (evt) => {
    this.setVisParam('fontSize', evt.target.value);
  }

  render() {
    return (
      <EuiForm>
        <EuiFormRow
          label="Font Size"
          helpText="Set the metric font size"
        >
          <EuiRange
            name="fontSize"
            value={this.props.scope.vis.params.fontSize}
            min={12}
            max={120}
            onChange={this.handleUpdateFontSizeChange}
          />
        </EuiFormRow>
      </EuiForm>
    );
  }
}

MetricOptionsComponent.propTypes = {
  scope: PropTypes.object.isRequired,
  stageEditorParams: PropTypes.func.isRequired
};
