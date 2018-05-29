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

import React, { Component } from 'react';

import {
  EuiButton,
  EuiContextMenuItem,
  EuiContextMenuPanel,
  EuiPopover,
} from '@elastic/eui';

import { exportAsCsv } from './lib/export_csv';

class DataDownloadOptions extends Component {

  state = {
    isPopoverOpen: false,
  };

  onTogglePopover = () => {
    this.setState(state => ({
      isPopoverOpen: !state.isPopoverOpen,
    }));
  };

  closePopover = () => {
    this.setState({
      isPopoverOpen: false,
    });
  };

  exportAsCsv = () => {
    exportAsCsv(`${this.props.title}.csv`, this.props.columns, this.props.rows);
  };

  exportAsRawCsv = () => {
    exportAsCsv(`${this.props.title}.csv`, this.props.columns, this.props.rawData);
  };

  render() {
    const button = (
      <EuiButton
        iconType="arrowDown"
        iconSide="right"
        onClick={this.onTogglePopover}
      >
        Download data
      </EuiButton>
    );
    const items = [
      (
        <EuiContextMenuItem
          key="csv"
          onClick={this.exportAsCsv}
          toolTipContent="Downloads the data as shown in the table."
          toolTipPosition="left"
        >
          Formatted CSV
        </EuiContextMenuItem>
      )
    ];
    if (this.props.rawData) {
      items.push(
        <EuiContextMenuItem
          key="rawCsv"
          onClick={this.exportAsRawCsv}
          toolTipContent={`Downloads the raw data i.e. dates as timestamps,
            numeric values without thousand separators, etc.`}
          toolTipPosition="left"
        >
          Raw CSV
        </EuiContextMenuItem>
      );
    }
    return (
      <EuiPopover
        id="inspectorDownloadData"
        button={button}
        isOpen={this.state.isPopoverOpen}
        closePopover={this.closePopover}
        panelPaddingSize="none"
        anchorPosition="downLeft"
      >
        <EuiContextMenuPanel
          items={items}
        />
      </EuiPopover>
    );
  }
}

export { DataDownloadOptions };
