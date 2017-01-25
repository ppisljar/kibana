import React, { Component, PropTypes } from 'react';
import Select from 'react-select';
import DataFormatPicker from '../../data_format_picker';
import createSelectHandler from '../../lib/create_select_handler';
import YesNo from '../../yes_no';
import createTextHandler from '../../lib/create_text_handler';
import IndexPattern from '../../index_pattern';

class TimeseriesConfig extends Component {
  render() {
    const { fields, model } = this.props;
    const handleSelectChange = createSelectHandler(this.props.onChange);
    const handleTextChange = createTextHandler(this.props.onChange, this.refs);

    const stackedOptions = [
      { label: 'None', value: 'none' },
      { label: 'Stacked', value: 'stacked' },
      { label: 'Percent', value: 'percent' }
    ];

    const positionOptions = [
      { label: 'Right', value: 'right' },
      { label: 'Left', value: 'left' }
    ];

    const chartTypeOptions = [
      { label: 'Bar', value: 'bar' },
      { label: 'Line', value: 'line' }
    ];

    let type;
    if (model.chart_type === 'line') {
      type = (
        <div className="vis_editor__series_config-row">
          <div className="vis_editor__label">Chart Type</div>
          <div className="vis_editor__item">
            <Select
              clearable={false}
              options={chartTypeOptions}
              value={model.chart_type}
              onChange={handleSelectChange('chart_type')}/>
          </div>
          <div className="vis_editor__label">Stacked</div>
          <div className="vis_editor__item">
            <Select
              clearable={false}
              options={stackedOptions}
              value={model.stacked}
              onChange={handleSelectChange('stacked')}/>
          </div>
          <div className="vis_editor__label">Fill (0 to 1)</div>
          <input
            className="vis_editor__input-grows"
            type="text"
            ref="fill"
            onChange={handleTextChange('fill')}
            defaultValue={model.fill}/>
          <div className="vis_editor__label">Line Width</div>
          <input
            className="vis_editor__input-grows"
            type="text"
            ref="line_width"
            onChange={handleTextChange('line_width')}
            defaultValue={model.line_width}/>
          <div className="vis_editor__label">Point Size</div>
          <input
            className="vis_editor__input-grows"
            type="text"
            ref="point_size"
            onChange={handleTextChange('point_size')}
            defaultValue={model.point_size != null ? model.point_size : model.line_width}/>
        </div>
      );
    }
    if (model.chart_type === 'bar') {
      type = (
        <div className="vis_editor__series_config-row">
          <div className="vis_editor__label">Chart Type</div>
          <div className="vis_editor__item">
            <Select
              clearable={false}
              options={chartTypeOptions}
              value={model.chart_type}
              onChange={handleSelectChange('chart_type')}/>
          </div>
          <div className="vis_editor__label">Stacked</div>
          <YesNo
            value={model.stacked}
            name="stacked"
            onChange={this.props.onChange}/>
          <div className="vis_editor__label">Fill (0 to 1)</div>
          <input
            className="vis_editor__input-grows"
            type="text"
            ref="fill"
            onChange={handleTextChange('fill')}
            defaultValue={model.fill}/>
          <div className="vis_editor__label">Line Width</div>
          <input
            className="vis_editor__input-grows"
            type="text"
            ref="line_width"
            onChange={handleTextChange('line_width')}
            defaultValue={model.line_width}/>
        </div>
      );
    }

    const disableSeperateYaxis = model.seperate_axis ? false : true;

    return (
      <div>
        <div className="vis_editor__series_config-container">
          <div className="vis_editor__series_config-row">
            <DataFormatPicker
              onChange={handleSelectChange('formatter')}
              value={model.formatter}/>
            <div className="vis_editor__label">Template (eg.<code>{'{{value}}/s'}</code>)</div>
            <input
              className="vis_editor__input-grows"
              onChange={handleTextChange('value_template')}
              ref="value_template"
              defaultValue={model.value_template}/>
          </div>
          { type }
          <div className="vis_editor__series_config-row">
              <div className="vis_editor__label">Offset series time by (1m, 1h, 1w, 1d)</div>
              <input
                className="vis_editor__input-grows"
                type="text"
                ref="offset_time"
                onChange={handleTextChange('offset_time')}
                defaultValue={model.offset_time}/>
              <div className="vis_editor__label">Hide in Legend</div>
              <YesNo
                value={model.hide_in_legend}
                name="hide_in_legend"
                onChange={this.props.onChange}/>
          </div>
          <div className="vis_editor__series_config-row">
              <div className="vis_editor__label">Separate Axis</div>
              <YesNo
                value={model.seperate_axis}
                name="seperate_axis"
                onChange={this.props.onChange}/>
              <div className="vis_editor__label" style={{ marginLeft: 10 }}>Axis Min</div>
              <input
                className="vis_editor__input-grows"
                type="text"
                ref="axis_min"
                disabled={disableSeperateYaxis}
                onChange={handleTextChange('axis_min')}
                defaultValue={model.axis_min}/>
              <div className="vis_editor__label">Axis Max</div>
              <input
                className="vis_editor__input-grows"
                type="text"
                disabled={disableSeperateYaxis}
                ref="axis_max"
                onChange={handleTextChange('axis_max')}
                defaultValue={model.axis_max}/>
              <div className="vis_editor__label">Axis Position</div>
              <div className="vis_editor__row_item">
                <Select
                  clearable={false}
                  disabled={disableSeperateYaxis}
                  options={positionOptions}
                  value={model.axis_position}
                  onChange={handleSelectChange('axis_position')}/>
              </div>
          </div>
          <div className="vis_editor__series_config-row">
            <div className="vis_editor__label">Override Index Pattern</div>
            <YesNo
              value={model.override_index_pattern}
              name="override_index_pattern"
              onChange={this.props.onChange}/>
            <IndexPattern
              {...this.props}
              prefix="series_"
              className="vis_editor__row_item vis_editor__row"
              disabled={!model.override_index_pattern}
              with-interval={true} />
          </div>
        </div>
      </div>
    );
  }
}

TimeseriesConfig.propTypes = {
  fields   : PropTypes.object,
  model    : PropTypes.object,
  onChange : PropTypes.func
};

export default TimeseriesConfig;
