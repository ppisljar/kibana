import _ from 'lodash';
import React from 'react';
import { render, unmountComponentAtNode } from 'react-dom';
import { Visualization } from 'ui/visualize/visualization';


export const visualizationLoader = (element, vis, visData, uiState, params) => {
  const listenOnChange = _.get(params, 'listenOnChange', false);
  render(<Visualization vis={vis} visData={visData} uiState={uiState} listenOnChange={listenOnChange} />, element);
};

visualizationLoader.destroy = (element) => {
  if (element) unmountComponentAtNode(element);
};
