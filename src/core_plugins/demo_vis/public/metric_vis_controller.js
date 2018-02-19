import React, { Component } from 'react';

export class MetricVisComponent extends Component {

  _processTableGroups(tableGroups) {
    const metrics = [];

    tableGroups.tables.forEach((table) => {
      let bucketAgg;

      table.columns.forEach((column, i) => {
        const aggConfig = column.aggConfig;

        if (aggConfig && aggConfig.schema.group === 'buckets') {
          bucketAgg = aggConfig;
          return;
        }

        table.rows.forEach(row => {

          let title = column.title;
          let value = row[i];

          if (aggConfig) {
            value = aggConfig.fieldFormatter('text')(value);
            if (bucketAgg) {
              const bucketValue = bucketAgg.fieldFormatter('text')(row[0]);
              title = `${bucketValue} - ${aggConfig.makeLabel()}`;
            } else {
              title = aggConfig.makeLabel();
            }
          }

          metrics.push({
            label: title,
            value: value,
            raw: row[i],
            createFilter: () => {
              if (!bucketAgg) return;
              const filter = bucketAgg.createFilter(row[0]);
              this.props.vis.API.queryFilter.addFilters(filter);
            },
          });
        });
      });
    });

    return metrics;
  }

  _renderMetric = (metric, index) => {
    const metricValueStyle = {
      fontSize: `${this.props.vis.params.fontSize}pt`,
    };

    return (
      <div
        key={index}
        className="metric-container"
        onClick={metric.createFilter}
      >
        <div
          className="metric-value"
          style={metricValueStyle}
          dangerouslySetInnerHTML={{ __html: metric.value }}
        />
        <div>{metric.label}</div>
      </div>
    );
  };

  render() {
    let metricsHtml;
    if (this.props.visData) {
      const metrics = this._processTableGroups(this.props.visData);
      metricsHtml = metrics.map(this._renderMetric);
    }
    return (<div className="metric-vis">{metricsHtml}</div>);
  }

  componentDidMount() {
    this.props.renderComplete();
  }

  componentDidUpdate() {
    this.props.renderComplete();
  }
}
