/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { ByteSizeValue } from '@kbn/config-schema';
import { i18n } from '@kbn/i18n';
import { IUiSettingsClient } from 'kibana/server';
import { ReportingConfig } from '../../../';
import {
  CSV_BOM_CHARS,
  UI_SETTINGS_CSV_QUOTE_VALUES,
  UI_SETTINGS_CSV_SEPARATOR,
} from '../../../../common/constants';
import { LevelLogger } from '../../../lib';
import { createEscapeValue } from './escape_value';

export interface CsvExportSettings {
  timezone: string;
  scrollSize: number;
  bom: string;
  separator: string;
  maxSizeBytes: number | ByteSizeValue;
  checkForFormulas: boolean;
  escapeFormulaValues: boolean;
  escapeValue: (value: string) => string;
}

export const getExportSettings = async (
  timezone: string | undefined,
  client: IUiSettingsClient,
  config: ReportingConfig,
  logger: LevelLogger
): Promise<CsvExportSettings> => {
  // Timezone
  let setTimezone: string;
  // timezone in job params?
  if (timezone) {
    setTimezone = timezone;
  } else {
    // timezone in settings?
    setTimezone = await client.get('dateFormat:tz');
    if (setTimezone === 'Browser') {
      // if `Browser`, hardcode it to 'UTC' so the export has data that makes sense
      logger.warn(
        i18n.translate('xpack.reporting.exportTypes.csv.executeJob.dateFormateSetting', {
          defaultMessage:
            'Kibana Advanced Setting "{dateFormatTimezone}" is set to "Browser". Dates will be formatted as UTC to avoid ambiguity.',
          values: { dateFormatTimezone: 'dateFormat:tz' },
        })
      );
      setTimezone = 'UTC';
    }
  }

  // Separator, QuoteValues
  const [separator, quoteValues] = await Promise.all([
    client.get(UI_SETTINGS_CSV_SEPARATOR),
    client.get(UI_SETTINGS_CSV_QUOTE_VALUES),
  ]);

  const escapeFormulaValues = config.get('csv', 'escapeFormulaValues');
  const escapeValue = createEscapeValue(quoteValues, escapeFormulaValues);
  const bom = config.get('csv', 'useByteOrderMarkEncoding') ? CSV_BOM_CHARS : '';

  return {
    timezone: setTimezone,
    scrollSize: config.get('csv', 'scroll', 'size'),
    bom,
    separator,
    maxSizeBytes: config.get('csv', 'maxSizeBytes'),
    checkForFormulas: config.get('csv', 'checkForFormulas'),
    escapeFormulaValues,
    escapeValue,
  };
};
