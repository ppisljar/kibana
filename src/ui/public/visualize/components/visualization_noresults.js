import React from 'react';

export function VisualizationNoResults() {
  return (
    <div className="text-center visualize-error visualize-chart">
      <div className="item top" />
      <div className="item">
        <h2 aria-hidden="true"><i aria-hidden="true" className="fa fa-meh-o" /></h2>
        <h4>No results found</h4>
      </div>
      <div className="item bottom" />
    </div>
  );
}
