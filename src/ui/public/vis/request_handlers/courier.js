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
import { SearchSourceProvider } from '../../courier/data_source/search_source';
import { VisRequestHandlersRegistryProvider } from '../../registry/vis_request_handlers';
import { calculateObjectHash } from '../lib/calculate_object_hash';
import { getRequestInspectorStats, getResponseInspectorStats } from '../../courier/utils/courier_inspector_utils';
import { tabifyAggResponse } from '../../agg_response/tabify/tabify';

import { FormattedData } from '../../inspector/adapters';

const CourierRequestHandlerProvider = function (Private, courier, timefilter) {
  const SearchSource = Private(SearchSourceProvider);

  /**
   * This function builds tabular data from the response and attaches it to the
   * inspector. It will only be called when the data view in the inspector is opened.
   */
  async function buildTabularInspectorData(vis, searchSource) {
    const table = tabifyAggResponse(vis.getAggConfig().getResponseAggs(), searchSource.finalResponse, {
      canSplit: false,
      asAggConfigResults: false,
      partialRows: true,
      isHierarchical: vis.isHierarchical(),
    });
    const columns = table.columns.map((col, index) => {
      const field = col.aggConfig.getField();
      const isCellContentFilterable =
        col.aggConfig.isFilterable()
        && (!field || field.filterable);
      return ({
        name: col.title,
        field: `col${index}`,
        filter: isCellContentFilterable && ((value) => {
          const filter = col.aggConfig.createFilter(value.raw);
          vis.API.queryFilter.addFilters(filter);
        }),
        filterOut: isCellContentFilterable && ((value) => {
          const filter = col.aggConfig.createFilter(value.raw);
          filter.meta = filter.meta || {};
          filter.meta.negate = true;
          vis.API.queryFilter.addFilters(filter);
        }),
      });
    });
    const rows = table.rows.map(row => {
      return row.reduce((prev, cur, index) => {
        const fieldFormatter = table.columns[index].aggConfig.fieldFormatter('text');
        prev[`col${index}`] = new FormattedData(cur, fieldFormatter(cur));
        return prev;
      }, {});
    });

    // TODO: Remove delay before merging
    return await new Promise(resolve => {
      setTimeout(() => resolve({ columns, rows }), 1000);
    });

    return { columns, rows };
  }

  /**
   * TODO: This code can be removed as soon as we got rid of inheritance in the
   * searchsource and pass down every filter explicitly.
   * We are filtering out the global timefilter by the meta key set by the root
   * search source on that filter.
   */
  function removeSearchSourceParentTimefilter(searchSource) {
    searchSource.addFilterPredicate((filter) => {
      return !_.get(filter, 'meta._globalTimefilter', false);
    });
  }

  return {
    name: 'courier',
    handler: function (vis, { appState, queryFilter, searchSource, timeRange, forceFetch }) {

      // Create a new search source that inherits the original search source
      // but has the propriate timeRange applied via a filter.
      // This is a temporary solution until we properly pass down all required
      // information for the request to the request handler (https://github.com/elastic/kibana/issues/16641).
      // Using callParentStartHandlers: true we make sure, that the parent searchSource
      // onSearchRequestStart will be called properly even though we use an inherited
      // search source.
      const requestSearchSource = new SearchSource().inherits(searchSource, { callParentStartHandlers: true });

      // For now we need to mirror the history of the passed search source, since
      // the spy panel wouldn't work otherwise.
      Object.defineProperty(requestSearchSource, 'history', {
        get() {
          return requestSearchSource._parent.history;
        },
        set(history) {
          return requestSearchSource._parent.history = history;
        }
      });

      requestSearchSource.aggs(function () {
        return vis.getAggConfig().toDsl();
      });

      requestSearchSource.onRequestStart((searchSource, searchRequest) => {
        return vis.onSearchRequestStart(searchSource, searchRequest);
      });

      // Add the explicit passed timeRange as a filter to the requestSearchSource.
      requestSearchSource.filter(() => {
        return timefilter.get(searchSource.get('index'), timeRange);
      });

      removeSearchSourceParentTimefilter(requestSearchSource);

      if (queryFilter && vis.editorMode) {
        searchSource.set('filter', queryFilter.getFilters());
        searchSource.set('query', appState.query);
      }

      const shouldQuery = () => {
        if (!searchSource.lastQuery || forceFetch) return true;
        if (!_.isEqual(_.cloneDeep(searchSource.get('filter')), searchSource.lastQuery.filter)) return true;
        if (!_.isEqual(_.cloneDeep(searchSource.get('query')), searchSource.lastQuery.query)) return true;
        if (!_.isEqual(calculateObjectHash(vis.getAggConfig()), searchSource.lastQuery.aggs)) return true;
        if (!_.isEqual(_.cloneDeep(timeRange), searchSource.lastQuery.timeRange)) return true;

        return false;
      };

      return new Promise((resolve, reject) => {
        if (shouldQuery()) {
          vis.API.inspectorAdapters.requests.reset();
          const request = vis.API.inspectorAdapters.requests.start('Data', {
            description: `This request will be executed against your Elasticsearch cluster from
              the Kibana server to fetch the data for this visualization.`,
          });
          request.stats(getRequestInspectorStats(requestSearchSource));

          requestSearchSource.onResults().then(resp => {
            searchSource.lastQuery = {
              filter: _.cloneDeep(searchSource.get('filter')),
              query: _.cloneDeep(searchSource.get('query')),
              aggs: calculateObjectHash(vis.getAggConfig()),
              timeRange: _.cloneDeep(timeRange)
            };

            setTimeout(() => {
              request
                .stats(getResponseInspectorStats(searchSource, resp))
                .ok({ json: resp });
            }, 4000);

            searchSource.rawResponse = resp;

            return _.cloneDeep(resp);
          }).then(async resp => {
            for (const agg of vis.getAggConfig()) {
              if (_.has(agg, 'type.postFlightRequest')) {
                const nestedSearchSource = new SearchSource().inherits(requestSearchSource);
                resp = await agg.type.postFlightRequest(resp, vis.aggs, agg, nestedSearchSource);
              }
            }

            searchSource.finalResponse = resp;

            vis.API.inspectorAdapters.data.setTabularLoader(
              () => buildTabularInspectorData(vis, searchSource),
              { returnsFormattedValues: true }
            );

            resolve(resp);
          }).catch(e => reject(e));

          requestSearchSource.getSearchRequestBody().then(req => {
            request.json(req);
          });

          courier.fetch();
        } else {
          resolve(searchSource.finalResponse);
        }
      });
    }
  };
};

VisRequestHandlersRegistryProvider.register(CourierRequestHandlerProvider);

export { CourierRequestHandlerProvider };
