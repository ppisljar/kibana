/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */
import dateMath from '@elastic/datemath';
import { i18n } from '@kbn/i18n';
import moment from 'moment-timezone';
import { CoreSetup } from 'src/core/public';
import {
  ISearchEmbeddable,
  SEARCH_EMBEDDABLE_TYPE,
} from '../../../../../src/plugins/discover/public';
import { IEmbeddable, ViewMode } from '../../../../../src/plugins/embeddable/public';
import {
  IncompatibleActionError,
  UiActionsActionDefinition as ActionDefinition,
} from '../../../../../src/plugins/ui_actions/public';
import { LicensingPluginSetup } from '../../../licensing/public';
import { API_GENERATE_IMMEDIATE, CSV_REPORTING_ACTION } from '../../common/constants';
import { JobParamsDownloadCSV } from '../../server/export_types/csv_from_savedobject/types';
import { checkLicense } from '../lib/license_check';

function isSavedSearchEmbeddable(
  embeddable: IEmbeddable | ISearchEmbeddable
): embeddable is ISearchEmbeddable {
  return embeddable.type === SEARCH_EMBEDDABLE_TYPE;
}

interface ActionContext {
  embeddable: ISearchEmbeddable;
}

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

    const {
      timeRange: { to, from },
    } = embeddable.getInput();

    const kibanaTimezone = this.core.uiSettings.get('dateFormat:tz');

    const timezone = kibanaTimezone === 'Browser' ? moment.tz.guess() : kibanaTimezone;
    const fromTime = dateMath.parse(from);
    const toTime = dateMath.parse(to, { roundUp: true });
    if (!fromTime || !toTime) {
      return this.onGenerationFail(
        new Error(`Invalid time range: From: ${fromTime}, To: ${toTime}`)
      );
    }

    const { searchSource } = embeddable.getSavedSearch();

    const immediateJobParams: JobParamsDownloadCSV = {
      searchSource: searchSource.getSerializedFields(),
      timerange: {
        min: fromTime.format(),
        max: toTime.format(),
        timezone,
      },
      title: embeddable.getSavedSearch().title,
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

        const download = `${embeddable.getSavedSearch().title}.csv`;
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
