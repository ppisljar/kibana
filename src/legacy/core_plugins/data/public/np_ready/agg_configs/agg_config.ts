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

/**
 * @name AggConfig
 *
 * @description This class represents an aggregation, which is displayed in the left-hand nav of
 * the Visualize app.
 */

import _ from 'lodash';
// @ts-ignore
import { fieldFormats } from '../../../../../ui/public/registry/field_formats';
import { i18n } from '@kbn/i18n';
import { writeParams } from '../agg_types/agg_params';
import { AggConfigs } from './agg_configs';

export interface AggConfigOptions {
  id: string;
  enabled: boolean;
  type: string;
  schema: string;
  params: any;
}

export class AggConfig {

  /**
   * Ensure that all of the objects in the list have ids, the objects
   * and list are modified by reference.
   *
   * @param  {array[object]} list - a list of objects, objects can be anything really
   * @return {array} - the list that was passed in
   */
  static ensureIds(list: [any]) {
    const have = [] as any;
    const haveNot = [] as any;
    list.forEach(function (obj) {
      (obj.id ? have : haveNot).push(obj);
    });

    let nextId = AggConfig.nextId(have);
    haveNot.forEach(function (obj: any) {
      obj.id = String(nextId++);
    });

    return list;
  }

  /**
   * Calculate the next id based on the ids in this list
   *
   * @return {array} list - a list of objects with id properties
   */
  static nextId(list: [any]) {
    return 1 + list.reduce(function (max, obj) {
      return Math.max(max, +obj.id || 0);
    }, 0);
  }

  public aggConfigs: AggConfigs;
  public id: string;
  public enabled: boolean;
  public params: any;
  public parent: any;

  private __schema: any;
  private __type: any;
  private __typeDecorations: any;
  private subAggs: any;

  constructor(aggConfigs: AggConfigs, opts: AggConfigOptions) {
    this.aggConfigs = aggConfigs;
    this.id = String(opts.id || AggConfig.nextId(aggConfigs.getRequestAggs() as any));
    this.enabled = typeof opts.enabled === 'boolean' ? opts.enabled : true;

    // start with empty params so that checks in type/schema setters don't freak
    // because this.params is undefined
    this.params = {};

    // setters
    this.type = opts.type;
    this.schema = opts.schema;

    // set the params to the values from opts, or just to the defaults
    this.setParams(opts.params || {});
  }

  /**
   * Write the current values to this.params, filling in the defaults as we go
   *
   * @param  {object} [from] - optional object to read values from,
   *                         used when initializing
   * @return {undefined}
   */
  setParams(from: any) {
    from = from || this.params || {};
    const to = this.params = {} as any;

    this.getAggParams().forEach(aggParam => {
      let val = from[aggParam.name];

      if (val == null) {
        if (aggParam.default == null) return;

        if (!_.isFunction(aggParam.default)) {
          val = aggParam.default;
        } else {
          val = aggParam.default(this);
          if (val == null) return;
        }
      }

      if (aggParam.deserialize) {
        const isTyped = _.isFunction(aggParam.type);

        const isType = isTyped && (val instanceof aggParam.type);
        const isObject = !isTyped && _.isObject(val);
        const isDeserialized = (isType || isObject);

        if (!isDeserialized) {
          val = aggParam.deserialize(val, this);
        }

        to[aggParam.name] = val;
        return;
      }

      to[aggParam.name] = _.cloneDeep(val);
    });
  }

  write(aggs: AggConfigs) {
    return writeParams(this.type.params, this, aggs);
  }

  isFilterable() {
    return _.isFunction(this.type.createFilter);
  }

  createFilter(key: string, params = {}) {
    if (!this.isFilterable()) {
      throw new TypeError(`The "${this.type.title}" aggregation does not support filtering.`);
    }

    const field = this.getField();
    const label = this.getFieldDisplayName();
    if (field && !field.filterable) {
      let message = `The "${label}" field can not be used for filtering.`;
      if (field.scripted) {
        message = `The "${label}" field is scripted and can not be used for filtering.`;
      }
      throw new TypeError(message);
    }

    return this.type.createFilter(this, key, params);
  }

  /**
   *  Hook for pre-flight logic, see AggType#onSearchRequestStart
   *  @param {Courier.SearchSource} searchSource
   *  @param {Courier.SearchRequest} searchRequest
   *  @return {Promise<undefined>}
   */
  onSearchRequestStart(searchSource: any, searchRequest: any) {
    if (!this.type) {
      return Promise.resolve();
    }

    return Promise.all(
      this.type.params.map((param: any) => param.modifyAggConfigOnSearchRequestStart(this, searchSource, searchRequest))
    );
  }

  /**
   * Convert this aggConfig to its dsl syntax.
   *
   * Adds params and adhoc subaggs to a pojo, then returns it
   *
   * @param  {AggConfigs} aggConfigs - the config object to convert
   * @return {void|Object} - if the config has a dsl representation, it is
   *                         returned, else undefined is returned
   */
  toDsl(aggConfigs: AggConfigs) {
    if (this.type.hasNoDsl) return;
    const output = this.write(aggConfigs) as any;

    const configDsl = {} as any;
    configDsl[this.type.dslName || this.type.name] = output.params;

    // if the config requires subAggs, write them to the dsl as well
    if (this.subAggs && !output.subAggs) output.subAggs = this.subAggs;
    if (output.subAggs) {
      const subDslLvl = configDsl.aggs || (configDsl.aggs = {});
      output.subAggs.forEach(function nestAdhocSubAggs(subAggConfig: any) {
        subDslLvl[subAggConfig.id] = subAggConfig.toDsl(aggConfigs);
      });
    }

    if (output.parentAggs) {
      const subDslLvl = configDsl.parentAggs || (configDsl.parentAggs = {});
      output.parentAggs.forEach(function nestAdhocSubAggs(subAggConfig: any) {
        subDslLvl[subAggConfig.id] = subAggConfig.toDsl(aggConfigs);
      });
    }

    return configDsl;
  }

  toJSON() {
    const params = this.params;

    const outParams = _.transform(this.getAggParams(), (out, aggParam) => {
      let val = params[aggParam.name];

      // don't serialize undefined/null values
      if (val == null) return;
      if (aggParam.serialize) val = aggParam.serialize(val, this);
      if (val == null) return;

      // to prevent accidental leaking, we will clone all complex values
      out[aggParam.name] = _.cloneDeep(val);
    }, {});

    return {
      id: this.id,
      enabled: this.enabled,
      type: this.type && this.type.name,
      schema: this.schema && this.schema.name,
      params: outParams
    };
  }

  getAggParams() {
    return [
      ...((this.type) ? this.type.params.raw : []),
      ...((_.has(this, 'schema.params')) ? this.schema.params.raw : []),
    ];
  }

  getRequestAggs() {
    if (!this.type) return;
    return this.type.getRequestAggs(this) || [this];
  }

  getResponseAggs() {
    if (!this.type) return;
    return this.type.getResponseAggs(this) || [this];
  }

  getValue(bucket: any) {
    return this.type.getValue(this, bucket);
  }

  getKey(bucket: any, key: string) {
    return this.type.getKey(bucket, key, this);
  }

  getFieldDisplayName() {
    const field = this.getField();
    return field ? (field.displayName || this.fieldName()) : '';
  }

  getField() {
    return this.params.field;
  }

  makeLabel(percentageMode = false) {
    if (this.params.customLabel) {
      return this.params.customLabel;
    }

    if (!this.type) return '';
    return percentageMode ?
      i18n.translate('data.aggConfig.percentageOfLabel', {
        defaultMessage: 'Percentage of {label}',
        values: { label: this.type.makeLabel(this) },
      }) : `${this.type.makeLabel(this)}`;
  }

  getIndexPattern() {
    return _.get(this.aggConfigs, 'indexPattern', null);
  }

  getTimeRange() {
    return _.get(this.aggConfigs, 'timeRange', null);
  }

  fieldFormatter(contentType: string, defaultFormat: any) {
    const format = this.type && this.type.getFormat(this);
    if (format) return format.getConverterFor(contentType);
    return this.fieldOwnFormatter(contentType, defaultFormat);
  }

  fieldOwnFormatter(contentType: string, defaultFormat: any) {
    const field = this.getField();
    let format = field && field.format;
    if (!format) format = defaultFormat;
    if (!format) format = fieldFormats.getDefaultInstance('string');
    return format.getConverterFor(contentType);
  }

  fieldName() {
    const field = this.getField();
    return field ? field.name : '';
  }

  fieldIsTimeField() {
    const indexPattern = this.getIndexPattern();
    if (!indexPattern) return false;
    // @ts-ignore
    const timeFieldName = indexPattern.timeFieldName;
    return timeFieldName && this.fieldName() === timeFieldName;
  }

  get type() {
    return this.__type;
  }

  set type(type) {
    if (this.__typeDecorations) {
      _.forOwn(this.__typeDecorations,  (prop: any, name: any) => {
        delete this.__typeDecorations[name as string];
      }, this);
    }

    if (_.isString(type)) {
      // We need to inline require here, since we're having a cyclic dependency
      // from somewhere inside agg_types back to AggConfig.
      type = require('../agg_types').aggTypes.byName[type];
    }

    if (type && _.isFunction(type.decorateAggConfig)) {
      this.__typeDecorations = type.decorateAggConfig();
      Object.defineProperties(this, this.__typeDecorations);
    }

    this.__type = type;

    const fieldParam = _.get(this, 'type.params.byName.field') as any;
    // @ts-ignore
    const availableFields = fieldParam ? fieldParam.getAvailableFields(this.getIndexPattern().fields) : [];
    // clear out the previous params except for a few special ones
    this.setParams({
      // split row/columns is "outside" of the agg, so don't reset it
      row: this.params.row,

      // almost every agg has fields, so we try to persist that when type changes
      field: _.get(availableFields, ['byName', this.getField()])
    });
  }

  get schema() {
    return this.__schema;
  }

  set schema(schema) {
    if (_.isString(schema) && this.aggConfigs.schemas) {
      schema = this.aggConfigs.schemas.byName[schema];
    }

    this.__schema = schema;
  }
}
