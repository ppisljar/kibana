/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { Capabilities, IUiSettingsClient } from 'kibana/public';
import { SavedSearch } from '../../';

const UI_SETTINGS_DOCTABLE_HIDETIME = 'doc_table:hideTimeColumn';

/**
 * Preparing data to share the current state as link or CSV/Report
 */
// FIXME: code is duplicated with plugins/reporting/public/panel.../get_csv_panel_action
export function getSharingData(savedSearch: SavedSearch, uiSettings: IUiSettingsClient) {
  const searchSource = savedSearch.searchSource.createCopy();
  searchSource.removeField('highlight');
  searchSource.removeField('highlightAll');
  searchSource.removeField('aggs');
  searchSource.removeField('size');

  searchSource.removeField('fields');
  searchSource.removeField('fieldsFromSource');

  const { columns } = savedSearch;

  // sanitize columns: can't be [_source]
  if (/^_source$/.test(columns.join())) {
    columns.length = 0;
  }

  if (columns && columns.length > 0) {
    searchSource.setField('fields', columns);
    // If time column should _not_ be hidden in doc tables, then add the time field to the searchSource fields
    const hideTimeColumn = uiSettings.get(UI_SETTINGS_DOCTABLE_HIDETIME);
    const index = searchSource.getField('index');
    if (!hideTimeColumn && index) {
      const { timeFieldName } = index;
      if (timeFieldName) {
        searchSource.setField('fields', [timeFieldName, ...columns]);
      }
    }
  } else {
    searchSource.setField('fields', ['*']);
  }

  return {
    searchSource: searchSource.getSerializedFields(true),
  };
}

export interface DiscoverCapabilities {
  createShortUrl?: boolean;
  save?: boolean;
  saveQuery?: boolean;
  show?: boolean;
  storeSearchSession?: boolean;
}

export const showPublicUrlSwitch = (anonymousUserCapabilities: Capabilities) => {
  if (!anonymousUserCapabilities.discover) return false;

  const discover = (anonymousUserCapabilities.discover as unknown) as DiscoverCapabilities;

  return !!discover.show;
};
