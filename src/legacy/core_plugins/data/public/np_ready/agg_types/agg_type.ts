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

import _ from 'lodash';
import { i18n } from '@kbn/i18n';
import { AggParam, initParams } from './agg_params';
// @ts-ignore
import { fieldFormats } from '../../../../../ui/public/registry/field_formats';
// @ts-ignore
import { AggConfig } from '../agg_configs/agg_config';

export interface AggTypeConfig {
  name: string;
  title: string;
  dslName?: string;
  makeLabel?: () => string;
  ordered?: any;
  hasNoDsl?: boolean;
  createFilter: (aggConfig: AggConfig, key: any) => any;
  params?: [AggParam];
  getRequestAggs?: () => [AggConfig];
  getResponseAggs?: () => [AggConfig];
  customLabels?: boolean;
  decorateAggConfig?: any;
  postFlightRequest?: any;
  getFormat?: (agg: AggConfig) => any;
}

const getFormat = (agg: AggConfig) => {
  const field = agg.getField();
  return field ? field.format : fieldFormats.getDefaultInstance('string');
};

export class AggType {
  /**
   * the unique, unchanging, name that we have assigned this aggType
   *
   * @property name
   * @type {string}
   */
  name: string;
  /**
   * the name of the elasticsearch aggregation that this aggType represents. Usually just this.name
   *
   * @property name
   * @type {string}
   */
  dslName: string;
  /**
   * the user friendly name that will be shown in the ui for this aggType
   *
   * @property title
   * @type {string}
   */
  title: string;
  /**
   * a function that will be called when this aggType is assigned to
   * an aggConfig, and that aggConfig is being rendered (in a form, chart, etc.).
   *
   * @method makeLabel
   * @param {AggConfig} aggConfig - an agg config of this type
   * @returns {string} - label that can be used in the ui to describe the aggConfig
   */
  makeLabel: () => string;
  /**
   * Describes if this aggType creates data that is ordered, and if that ordered data
   * is some sort of time series.
   *
   * If the aggType does not create ordered data, set this to something "falsy".
   *
   * If this does create orderedData, then the value should be an object.
   *
   * If the orderdata is some sort of time series, `this.ordered` should be an object
   * with the property `date: true`
   *
   * @property ordered
   * @type {object|undefined}
   */
  ordered: any;
  /**
   * Flag that prevents this aggregation from being included in the dsl. This is only
   * used by the count aggregation (currently) since it doesn't really exist and it's output
   * is available on every bucket.
   *
   * @type {Boolean}
   */
  hasNoDsl: boolean;
  /**
   * The method to create a filter representation of the bucket
   * @param {object} aggConfig The instance of the aggConfig
   * @param {mixed} key The key for the bucket
   * @returns {object} The filter
   */
  createFilter: (aggConfig: AggConfig, key: any) => any;
  /**
   * An instance of {{#crossLink "AggParams"}}{{/crossLink}}.
   *
   * @property params
   * @type {AggParams}
   */
  params: [AggParam];
  /**
   * Designed for multi-value metric aggs, this method can return a
   * set of AggConfigs that should replace this aggConfig in requests
   *
   * @method getRequestAggs
   * @returns {array[AggConfig]|undefined} - an array of aggConfig objects
   *                                         that should replace this one,
   *                                         or undefined
   */
  getRequestAggs: () => [AggConfig] | any;
  /**
   * Designed for multi-value metric aggs, this method can return a
   * set of AggConfigs that should replace this aggConfig in result sets
   * that walk the AggConfig set.
   *
   * @method getResponseAggs
   * @returns {array[AggConfig]|undefined} - an array of aggConfig objects
   *                                         that should replace this one,
   *                                         or undefined
   */
  getResponseAggs: () => [AggConfig] | any;
  /**
   * A function that will be called each time an aggConfig of this type
   * is created, giving the agg type a chance to modify the agg config
   */
  decorateAggConfig: any;
  /**
   * A function that needs to be called after the main request has been made
   * and should return an updated response
   * @param aggConfigs - agg config array used to produce main request
   * @param aggConfig - AggConfig that requested the post flight request
   * @param searchSourceAggs - SearchSource aggregation configuration
   * @param resp - Response to the main request
   * @param nestedSearchSource - the new SearchSource that will be used to make post flight request
   * @return {Promise}
   */
  postFlightRequest: any;
  /**
   * Pick a format for the values produced by this agg type,
   * overridden by several metrics that always output a simple
   * number
   *
   * @param  {agg} agg - the agg to pick a format for
   * @return {FieldFormat}
   */
  getFormat: any;

  /**
   * Generic AggType Constructor
   *
   * Used to create the values exposed by the agg_types module.
   *
   * @class AggType
   * @private
   * @param {object} config - used to set the properties of the AggType
   */
  constructor(config: AggTypeConfig) {
    this.name = config.name;
    this.dslName = config.dslName || config.name;
    this.title = config.title;
    this.makeLabel = config.makeLabel || _.constant(this.name);
    this.ordered = config.ordered;
    this.hasNoDsl = !!config.hasNoDsl;
    this.createFilter = config.createFilter;

    // @ts-ignore
    if (config.params && config.params[0] instanceof AggParam) {
      this.params = config.params;
    } else {
      // always append the raw JSON param
      const params = [];
      params.push({
        name: 'json',
        type: 'json',
        advanced: true,
      });
      // always append custom label

      if (config.customLabels !== false) {
        params.push({
          name: 'customLabel',
          displayName: i18n.translate('common.ui.aggTypes.string.customLabel', {
            defaultMessage: 'Custom label',
          }),
          type: 'string',
          write: _.noop,
        });
      }

      this.params = initParams(params as any);
    }

    this.getRequestAggs = config.getRequestAggs || _.noop;
    this.getResponseAggs = config.getResponseAggs || _.noop;
    this.decorateAggConfig = config.decorateAggConfig || null;
    this.postFlightRequest = config.postFlightRequest || _.identity;
    this.getFormat = config.getFormat || getFormat;
  }
}
