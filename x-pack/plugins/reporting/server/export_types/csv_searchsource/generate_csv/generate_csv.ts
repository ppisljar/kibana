/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { i18n } from '@kbn/i18n';
import { IScopedClusterClient, IUiSettingsClient } from 'src/core/server';
import { Datatable } from 'src/plugins/expressions/server';
import { ReportingConfig } from '../../..';
import {
  EsQuerySearchAfter,
  FieldFormat,
  IFieldFormatsRegistry,
  ISearchStartSearchSource,
  SearchFieldValue,
  tabifyDocs,
} from '../../../../../../../src/plugins/data/common';
import { CancellationToken } from '../../../../common';
import { byteSizeValueToNumber } from '../../../../common/schema_utils';
import { LevelLogger } from '../../../lib';
import { JobParamsCSV, SavedSearchGeneratorResult } from '../types';
import { cellHasFormulas } from './cell_has_formula';
import { CsvExportSettings, getExportSettings } from './get_export_settings';
import { MaxSizeStringBuilder } from './max_size_string_builder';

export class CsvGenerator {
  private _columnMap: number[] | null = null;
  private _formatters: Record<string, FieldFormat> | null = null;
  private csvContainsFormulas = false;
  private maxSizeReached = false;
  private csvRowCount = 0;

  constructor(
    private job: JobParamsCSV,
    private config: ReportingConfig,
    private esClient: IScopedClusterClient,
    private uiSettingsClient: IUiSettingsClient,
    private searchSourceService: ISearchStartSearchSource,
    private fieldFormatsRegistry: IFieldFormatsRegistry,
    private cancellationToken: CancellationToken,
    private logger: LevelLogger
  ) {}

  private getColumnMap(fields: SearchFieldValue[] | undefined, table: Datatable) {
    if (this._columnMap) {
      return this._columnMap;
    }

    // if there are selected fields, re-initialize columnMap with field order is set in searchSource fields
    if (fields && fields[0] !== '*') {
      this._columnMap = fields.map((field) =>
        table.columns.findIndex((column) => column.id === field)
      );
    }

    // initialize default columnMap, works if fields are asterisk and order doesn't matter
    if (!this._columnMap) {
      this._columnMap = table.columns.map((c, columnIndex) => columnIndex);
    }

    return this._columnMap;
  }

  private getFormatters(table: Datatable) {
    if (this._formatters) {
      return this._formatters;
    }

    // initialize field formats
    const formatters: Record<string, FieldFormat> = {};
    table.columns.forEach((c) => {
      const fieldFormat = this.fieldFormatsRegistry.deserialize(c.meta.params);
      formatters[c.id] = fieldFormat;
    });

    this._formatters = formatters;
    return this._formatters;
  }

  private generateHeader(
    fields: SearchFieldValue[] | undefined,
    table: Datatable,
    builder: MaxSizeStringBuilder,
    settings: CsvExportSettings
  ) {
    const { checkForFormulas, escapeValue, separator } = settings;
    const columnMap = this.getColumnMap(fields, table);

    this.logger.debug(`Building CSV header row...`);
    const header =
      columnMap
        .map((columnIndex, position) => {
          let value: string;
          if (columnIndex > -1) {
            value = table.columns[columnIndex].name;
          } else {
            value = fields && fields[position] ? (fields[position] as string) : 'unknown';
          }

          if (checkForFormulas && cellHasFormulas(value)) {
            this.csvContainsFormulas = true; // set warning if heading value has a formula
          }

          return escapeValue(value);
        })
        .join(separator) + `\n`;

    if (!builder.tryAppend(header)) {
      return {
        size: 0,
        content: '',
        maxSizeReached: true,
        warnings: [],
      };
    }
  }

  private generateRows(
    fields: SearchFieldValue[] | undefined,
    table: Datatable,
    builder: MaxSizeStringBuilder,
    formatters: Record<string, FieldFormat>,
    settings: CsvExportSettings
  ) {
    // write the rows
    this.logger.debug(`Building ${table.rows.length} CSV data rows...`);
    const { checkForFormulas, escapeValue, separator } = settings;

    for (const dataTableRow of table.rows) {
      if (this.cancellationToken.isCancelled()) {
        break;
      }

      const columnMap = this.getColumnMap(fields, table);
      const row =
        columnMap
          .map((columnIndex, position) => {
            const tableColumn = table.columns[columnIndex];
            let cell = '-';

            if (tableColumn != null) {
              cell = formatters[tableColumn.id].convert(dataTableRow[tableColumn.id]);

              try {
                // expected values are a string of JSON where the value(s) is in an array
                cell = JSON.parse(cell);
              } catch (e) {
                // value is not stringified in some unit tests
              }

              // We have to strip singular array values out of their array wrapper,
              // So that the value appears the visually the same as seen in Discover
              if (Array.isArray(cell) && cell.length === 1) {
                cell = cell[0];
              }
            } else {
              this.logger.warn(`Unrecognized field: ${(fields && fields[position]) || 'unknown'}`);
            }

            return cell;
          })
          .map((value) => {
            if (checkForFormulas && cellHasFormulas(value)) {
              this.csvContainsFormulas = true; // set warning if cell value has a formula
            }
            // Escape the values in Data
            return escapeValue(value);
          })
          .join(separator) + '\n';

      if (!builder.tryAppend(row)) {
        this.logger.warn('max Size Reached');
        this.maxSizeReached = true;
        if (this.cancellationToken) {
          this.cancellationToken.cancel();
        }
        break;
      }

      this.csvRowCount++;
    }
  }

  public async generateData(): Promise<SavedSearchGeneratorResult> {
    const [settings, searchSource] = await Promise.all([
      getExportSettings(this.uiSettingsClient, this.config, this.job.browserTimezone, this.logger),
      this.searchSourceService.create(this.job.searchSource),
    ]);

    const index = searchSource.getField('index');
    const fields = searchSource.getField('fields');

    const { maxSizeBytes, bom, escapeFormulaValues } = settings;
    const recordsAtATime = settings.scrollSize;
    searchSource.setField('size', recordsAtATime);

    const builder = new MaxSizeStringBuilder(byteSizeValueToNumber(maxSizeBytes), bom);

    let currentRecord = -1;
    let totalRecords = 0;
    let first = true;
    let lastSortId: EsQuerySearchAfter | undefined;
    const warnings: string[] = [];

    // use _pit API
    this.logger.debug('Opening PIT');
    const { body, statusCode } = await this.esClient.asCurrentUser.openPointInTime({
      index: index!.title,
      keep_alive: '2m',
    });
    if (statusCode === 404) {
      this.logger.error('we need an error message');
    }
    const pitId = body.id;
    searchSource.setField('pit', { id: pitId, keep_alive: '2m' });
    searchSource.removeField('index');

    while (currentRecord < totalRecords) {
      if (lastSortId) {
        searchSource.setField('searchAfter', lastSortId);
      }

      const results = await searchSource.fetch(); // ignores the selected fields option

      totalRecords = results.hits.total;
      if (totalRecords == null) {
        throw new Error('Expected total number of records in the search response');
      }
      if (results.hits.hits.length > 0) {
        lastSortId = results.hits.hits[results.hits.hits.length - 1].sort as EsQuerySearchAfter; // BUG
      }

      const table = tabifyDocs(
        results,
        index,
        { shallow: true, meta: true },
        { timezone: settings.timezone }
      );
      if (table.columns.length < 1) {
        break;
      }

      currentRecord += table.rows.length;

      // write the header and initialize formatters / column orderer
      if (first) {
        first = false;
        this.logger.debug(`Search results: ${results.hits.total}`);
        this.generateHeader(fields, table, builder, settings);
      }

      if (table.rows.length < 1) {
        break;
      }

      const formatters = this.getFormatters(table);
      this.generateRows(fields, table, builder, formatters, settings);
    }

    const size = builder.getSizeInBytes();
    this.logger.debug(
      `Finished generating. Total size in bytes: ${size}. Row count: ${this.csvRowCount}.`
    );

    if (this.csvContainsFormulas && escapeFormulaValues) {
      warnings.push(
        i18n.translate('xpack.reporting.exportTypes.csv.generateCsv.escapedFormulaValues', {
          defaultMessage: 'CSV may contain formulas whose values have been escaped',
        })
      );
    }

    // clean PIT
    this.logger.debug(`Closing PIT`);
    await this.esClient.asCurrentUser.closePointInTime({ body: { id: pitId } });

    return {
      content: builder.getString(),
      csvContainsFormulas: this.csvContainsFormulas && !escapeFormulaValues,
      maxSizeReached: this.maxSizeReached,
      csvRowCount: this.csvRowCount,
      size,
      warnings,
    };
  }
}
