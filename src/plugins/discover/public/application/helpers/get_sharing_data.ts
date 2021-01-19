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
import { IUiSettingsClient } from 'kibana/public';
import { SORT_DEFAULT_ORDER_SETTING } from '../../../common';
import { getSortForSearchSource } from '../angular/doc_table';
import { SearchSource } from '../../../../data/common';
import { AppState } from '../angular/discover_state';
import { SortOrder } from '../../saved_searches/types';

/**
 * Preparing data to share the current state as link or CSV/Report
 */
export async function getSharingData(
  currentSearchSource: SearchSource,
  state: AppState,
  config: IUiSettingsClient
) {
  const searchSource = currentSearchSource.createCopy();
  const index = searchSource.getField('index')!;

  searchSource.setField(
    'sort',
    getSortForSearchSource(state.sort as SortOrder[], index, config.get(SORT_DEFAULT_ORDER_SETTING))
  );
  searchSource.removeField('highlight');
  searchSource.removeField('highlightAll');
  searchSource.removeField('aggs');
  searchSource.removeField('size');

  return {
    searchSource: searchSource.getSerializedFields(true),
  };
}
