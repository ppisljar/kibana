/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { i18n } from '@kbn/i18n';
import { IUiSettingsClient } from 'src/core/server';
import { ReportingConfig } from '../../../';
import { CancellationToken } from '../../../../../../plugins/reporting/common';
import { CSV_BOM_CHARS } from '../../../../common/constants';
import { byteSizeValueToNumber } from '../../../../common/schema_utils';
import { LevelLogger } from '../../../lib';
import { JobParamsCSV, SavedSearchGeneratorResult } from '../types';
import { checkIfRowsHaveFormulas } from './check_cells_for_formulas';
import { createEscapeValue } from './escape_value';
import { getUiSettings } from './get_ui_settings';
import { MaxSizeStringBuilder } from './max_size_string_builder';
import {
  tabify,
  IFieldFormat,
  IFieldFormatsRegistry,
  EsQuerySearchAfter,
  ISearchStartSearchSource,
} from '../../../../../../../src/plugins/data/common';
import { Datatable } from '../../../../../../../src/plugins/expressions/common';

export function createGenerateCsv(logger: LevelLogger) {
  return async function generateCsv(
    job: JobParamsCSV,
    config: ReportingConfig,
    uiSettingsClient: IUiSettingsClient,
    searchSourceService: ISearchStartSearchSource,
    fieldFormatsRegistry: IFieldFormatsRegistry,
    cancellationToken: CancellationToken
  ): Promise<SavedSearchGeneratorResult> {
    const settings = await getUiSettings(job.browserTimezone, uiSettingsClient, config, logger);
    const escapeValue = createEscapeValue(settings.quoteValues, settings.escapeFormulaValues);
    const bom = config.get('csv', 'useByteOrderMarkEncoding') ? CSV_BOM_CHARS : '';
    const builder = new MaxSizeStringBuilder(byteSizeValueToNumber(settings.maxSizeBytes), bom);
    const searchSource = await searchSourceService.create(job.searchSource);
    const fields = searchSource.getField('fields');
    const recordsAtATime = settings.scroll.size;
    searchSource.setField('size', recordsAtATime);
    let currentRecord = -1;
    let totalRecords = 0;
    let first = true;
    let maxSizeReached = false;
    let csvContainsFormulas = false;
    let lastSortId: EsQuerySearchAfter | undefined;
    const warnings: string[] = [];
    const formatters: Record<string, IFieldFormat> = {};

    while (currentRecord < totalRecords) {
      if (lastSortId) {
        searchSource.setField('searchAfter', lastSortId);
      }
      const results = await searchSource.fetch();

      const table: Datatable = tabify(searchSource as any, results, {
        shallow: true,
      }) as Datatable;
      totalRecords = results.hits.total;

      if (totalRecords == null) {
        throw new Error('Expected total number of records in the search response');
      }

      currentRecord += table.rows.length;
      if (results.hits.hits.length) {
        lastSortId = results.hits.hits[results.hits.hits.length - 1].sort as EsQuerySearchAfter;
      }

      const columnNames = table.columns.map((c) => c.name);

      if (first) {
        const header = `${columnNames.map(escapeValue).join(settings.separator)}\n`;

        table.columns.map((c) => {
          const fieldFormat = fieldFormatsRegistry.deserialize(c.meta.params);
          formatters[c.id] = fieldFormat;
        });

        if (!builder.tryAppend(header)) {
          return {
            size: 0,
            content: '',
            maxSizeReached: true,
            warnings: [],
          };
        }
        first = false;
      }

      for (const hit of table.rows) {
        if (cancellationToken.isCancelled()) {
          break;
        }
        const rowsHaveFormulas =
          settings.checkForFormulas && checkIfRowsHaveFormulas(hit, fields as string[]);

        if (rowsHaveFormulas) {
          csvContainsFormulas = true;
        }

        const row = table.columns.map((c) => {
          return formatters[c.id].convert(hit[c.id]);
        });

        if (!builder.tryAppend(row.map(escapeValue).join(settings.separator) + '\n')) {
          logger.warn('max Size Reached');
          maxSizeReached = true;
          if (cancellationToken) {
            cancellationToken.cancel();
          }
          break;
        }
      }
    }

    const size = builder.getSizeInBytes();
    logger.debug(`finished generating, total size in bytes: ${size}`);

    if (csvContainsFormulas && settings.escapeFormulaValues) {
      warnings.push(
        i18n.translate('xpack.reporting.exportTypes.csv.generateCsv.escapedFormulaValues', {
          defaultMessage: 'CSV may contain formulas whose values have been escaped',
        })
      );
    }

    return {
      content: builder.getString(),
      csvContainsFormulas: csvContainsFormulas && !settings.escapeFormulaValues,
      maxSizeReached,
      size,
      warnings,
    };
  };
}
