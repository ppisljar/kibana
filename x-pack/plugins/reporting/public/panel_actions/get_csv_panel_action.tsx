/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';
import moment from 'moment-timezone';
import { CoreSetup } from 'src/core/public';
import { SearchSource } from 'src/plugins/data/public';
import {
  ISearchEmbeddable,
  SavedSearch,
  SEARCH_EMBEDDABLE_TYPE,
} from '../../../../../src/plugins/discover/public';
import { IEmbeddable, ViewMode } from '../../../../../src/plugins/embeddable/public';
import {
  IncompatibleActionError,
  UiActionsActionDefinition as ActionDefinition,
} from '../../../../../src/plugins/ui_actions/public';
import { LicensingPluginSetup } from '../../../licensing/public';
import { API_GENERATE_IMMEDIATE, CSV_REPORTING_ACTION } from '../../common/constants';
import { JobParamsDownloadCSV } from '../../server/export_types/csv_searchsource_immediate/types';
import { checkLicense } from '../lib/license_check';

function isSavedSearchEmbeddable(
  embeddable: IEmbeddable | ISearchEmbeddable
): embeddable is ISearchEmbeddable {
  return embeddable.type === SEARCH_EMBEDDABLE_TYPE;
}

interface ActionContext {
  embeddable: ISearchEmbeddable;
}

const UI_SETTINGS_DOCTABLE_HIDETIME = 'doc_table:hideTimeColumn';

export class GetCsvReportPanelAction implements ActionDefinition<ActionContext> {
  private isDownloading: boolean;
  public readonly type = '';
  public readonly id = CSV_REPORTING_ACTION;
  private canDownloadCSV: boolean = false;
  private core: CoreSetup;

  constructor(core: CoreSetup, license$: LicensingPluginSetup['license$']) {
    this.isDownloading = false;
    this.core = core;

    license$.subscribe((license) => {
      const results = license.check('reporting', 'basic');
      const { showLinks } = checkLicense(results);
      this.canDownloadCSV = showLinks;
    });
  }

  public getIconType() {
    return 'document';
  }

  public getDisplayName() {
    return i18n.translate('xpack.reporting.dashboard.downloadCsvPanelTitle', {
      defaultMessage: 'Download CSV',
    });
  }

  // FIXME: code is duplicated with plugins/discover/.../get_sharing_data
  public getSearchSource(savedSearch: SavedSearch, embeddable: ISearchEmbeddable) {
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
      const hideTimeColumn = this.core.uiSettings.get(UI_SETTINGS_DOCTABLE_HIDETIME);
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

    // Dashboard query bar and filters from embeddable.filtersSearchSource
    const { filtersSearchSource } = (embeddable as unknown) as {
      filtersSearchSource: SearchSource;
    };
    if (filtersSearchSource) {
      searchSource.setParent(filtersSearchSource);
    }

    return searchSource.getSerializedFields(true);
  }
  public isCompatible = async (context: ActionContext) => {
    if (!this.canDownloadCSV) {
      return false;
    }

    const { embeddable } = context;

    return embeddable.getInput().viewMode !== ViewMode.EDIT && embeddable.type === 'search';
  };

  public execute = async (context: ActionContext) => {
    const { embeddable } = context;

    if (!isSavedSearchEmbeddable(embeddable)) {
      throw new IncompatibleActionError();
    }

    if (this.isDownloading) {
      return;
    }

    const savedSearch = embeddable.getSavedSearch();
    const searchSource = this.getSearchSource(savedSearch, embeddable);

    const kibanaTimezone = this.core.uiSettings.get('dateFormat:tz');
    const browserTimezone = kibanaTimezone === 'Browser' ? moment.tz.guess() : kibanaTimezone;
    const immediateJobParams: JobParamsDownloadCSV = {
      searchSource,
      browserTimezone,
      title: savedSearch.title,
    };

    const body = JSON.stringify(immediateJobParams);

    this.isDownloading = true;

    this.core.notifications.toasts.addSuccess({
      title: i18n.translate('xpack.reporting.dashboard.csvDownloadStartedTitle', {
        defaultMessage: `CSV Download Started`,
      }),
      text: i18n.translate('xpack.reporting.dashboard.csvDownloadStartedMessage', {
        defaultMessage: `Your CSV will download momentarily.`,
      }),
      'data-test-subj': 'csvDownloadStarted',
    });

    await this.core.http
      .post(`${API_GENERATE_IMMEDIATE}`, { body })
      .then((rawResponse: string) => {
        this.isDownloading = false;

        const download = `${savedSearch.title}.csv`;
        const blob = new Blob([rawResponse], { type: 'text/csv;charset=utf-8;' });

        // Hack for IE11 Support
        if (window.navigator.msSaveOrOpenBlob) {
          return window.navigator.msSaveOrOpenBlob(blob, download);
        }

        const a = window.document.createElement('a');
        const downloadObject = window.URL.createObjectURL(blob);

        a.href = downloadObject;
        a.download = download;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(downloadObject);
        document.body.removeChild(a);
      })
      .catch(this.onGenerationFail.bind(this));
  };

  private onGenerationFail(error: Error) {
    this.isDownloading = false;
    this.core.notifications.toasts.addDanger({
      title: i18n.translate('xpack.reporting.dashboard.failedCsvDownloadTitle', {
        defaultMessage: `CSV download failed`,
      }),
      text: i18n.translate('xpack.reporting.dashboard.failedCsvDownloadMessage', {
        defaultMessage: `We couldn't generate your CSV at this time.`,
      }),
      'data-test-subj': 'downloadCsvFail',
    });
  }
}
