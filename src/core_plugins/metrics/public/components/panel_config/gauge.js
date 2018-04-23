import PropTypes from 'prop-types';
import React, { Component } from 'react';
import SeriesEditor from '../series_editor';
import Select from 'react-select';
import createSelectHandler from '../lib/create_select_handler';
import createTextHandler from '../lib/create_text_handler';
import ColorRules from '../color_rules';
import ColorPicker from '../color_picker';
import uuid from 'uuid';
import YesNo from '../yes_no';
import { htmlIdGenerator } from '@elastic/eui';

class GaugePanelConfig extends Component {

  constructor(props) {
    super(props);
    this.state = { selectedTab: 'data' };
  }

  componentWillMount() {
    const { model } = this.props;
    const parts = {};
    if (!model.gauge_color_rules ||
      (model.gauge_color_rules && model.gauge_color_rules.length === 0)) {
      parts.gauge_color_rules = [{ id: uuid.v1() }];
    }
    if (model.gauge_width == null) parts.gauge_width = 10;
    if (model.gauge_inner_width == null) parts.gauge_inner_width = 10;
    if (model.gauge_style == null) parts.gauge_style = 'half';
    this.props.onChange(parts);
  }

  switchTab(selectedTab) {
    this.setState({ selectedTab });
  }

  render() {
    const { selectedTab } = this.state;
    const defaults = {
      gauge_max: '',
      filter: '',
      gauge_style: 'circle',
      gauge_inner_width: '',
      gauge_width: ''
    };
    const model = { ...defaults, ...this.props.model };
    const handleSelectChange = createSelectHandler(this.props.onChange);
    const handleTextChange = createTextHandler(this.props.onChange);
    const styleOptions = [
      { label: 'Circle', value: 'circle' },
      { label: 'Half Circle', value: 'half' }
    ];
    const htmlId = htmlIdGenerator();
    let view;
    if (selectedTab === 'data') {
      view = (
        <SeriesEditor
          colorPicker={true}
          fields={this.props.fields}
          limit={1}
          model={this.props.model}
          name={this.props.name}
          onChange={this.props.onChange}
        />
      );
    } else {
      view = (
        <div className="vis_editor__container">
          <div className="vis_editor__vis_config-row">
            <label className="vis_editor__label" htmlFor={htmlId('panelFilter')}>
              Panel Filter
            </label>
            <input
              id={htmlId('panelFilter')}
              className="vis_editor__input-grows"
              type="text"
              onChange={handleTextChange('filter')}
              value={model.filter}
            />
            <div className="vis_editor__label">Ignore Global Filter</div>
            <YesNo
              value={model.ignore_global_filter}
              name="ignore_global_filter"
              onChange={this.props.onChange}
            />
            <div className="vis_editor__label">Drop Partial Bucket</div>
            <YesNo
              value={model.drop_last_bucket}
              name="drop_last_bucket"
              onChange={this.props.onChange}
            />
          </div>
          <div className="vis_editor__vis_config-row">
            <div className="vis_editor__label">Background Color</div>
            <ColorPicker
              onChange={this.props.onChange}
              name="background_color"
              value={model.background_color}
            />
            <label className="vis_editor__label" htmlFor={htmlId('gaugeMax')}>
              Gauge Max (empty for auto)
            </label>
            <input
              id={htmlId('gaugeMax')}
              className="vis_editor__input-grows"
              type="number"
              onChange={handleTextChange('gauge_max')}
              value={model.gauge_max}
            />
            <label className="vis_editor__label" htmlFor={htmlId('gaugeStyle')}>
              Gauge Style
            </label>
            <Select
              inputProps={{ id: htmlId('gaugeStyle') }}
              autosize={false}
              clearable={false}
              options={styleOptions}
              value={model.gauge_style}
              onChange={handleSelectChange('gauge_style')}
            />

          </div>
          <div className="vis_editor__vis_config-row">
            <div className="vis_editor__label">Inner Color</div>
            <ColorPicker
              onChange={this.props.onChange}
              name="gauge_inner_color"
              value={model.gauge_inner_color}
            />
            <label className="vis_editor__label" htmlFor={htmlId('innerLine')}>
              Inner Line Width
            </label>
            <input
              id={htmlId('innerLine')}
              className="vis_editor__input-grows"
              type="number"
              onChange={handleTextChange('gauge_inner_width')}
              value={model.gauge_inner_width}
            />
            <label className="vis_editor__label" htmlFor={htmlId('gaugeLine')}>
              Gauge Line Width
            </label>
            <input
              id={htmlId('gaugeLine')}
              className="vis_editor__input-grows"
              type="number"
              onChange={handleTextChange('gauge_width')}
              value={model.gauge_width}
            />
          </div>
          <div>
            <div className="vis_editor__label">Color Rules</div>
          </div>
          <div className="vis_editor__vis_config-row">
            <ColorRules
              primaryName="gauge color"
              primaryVarName="gauge"
              secondaryName="text color"
              secondaryVarName="text"
              model={model}
              onChange={this.props.onChange}
              name="gauge_color_rules"
            />
          </div>
        </div>
      );
    }
    return (
      <div>
        <div className="kbnTabs" role="tablist">
          <button
            role="tab"
            aria-selected={selectedTab === 'data'}
            className={`kbnTabs__tab${selectedTab === 'data' && '-active' || ''}`}
            onClick={() => this.switchTab('data')}
          >Data
          </button>
          <button
            role="tab"
            aria-selected={selectedTab === 'options'}
            className={`kbnTabs__tab${selectedTab === 'options' && '-active' || ''}`}
            onClick={() => this.switchTab('options')}
          >Panel Options
          </button>
        </div>
        {view}
      </div>
    );
  }

}

GaugePanelConfig.propTypes = {
  fields: PropTypes.object,
  model: PropTypes.object,
  onChange: PropTypes.func,
  visData: PropTypes.object,
};

export default GaugePanelConfig;
