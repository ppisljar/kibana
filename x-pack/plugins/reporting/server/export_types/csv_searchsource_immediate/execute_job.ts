/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { KibanaRequest } from 'src/core/server';
import { ISearchStart } from '../../../../../../src/plugins/data/server';
import { CancellationToken } from '../../../common';
import { CONTENT_TYPE_CSV, CSV_SEARCHSOURCE_IMMEDIATE_TYPE } from '../../../common/constants';
import { TaskRunResult } from '../../lib/tasks';
import { getFieldFormats } from '../../services';
import { ReportingRequestHandlerContext, RunTaskFnFactory } from '../../types';
import { CsvGenerator } from '../csv_searchsource/generate_csv/generate_csv';
import { JobParamsDownloadCSV } from './types';

/*
 * ImmediateExecuteFn receives the job doc payload because the payload was
 * generated in the ScheduleFn
 */
export type ImmediateExecuteFn = (
  jobId: null,
  job: JobParamsDownloadCSV,
  context: ReportingRequestHandlerContext,
  req: KibanaRequest
) => Promise<TaskRunResult>;

export const runTaskFnFactory: RunTaskFnFactory<ImmediateExecuteFn> = function executeJobFactoryFn(
  reporting,
  parentLogger
) {
  const config = reporting.getConfig();
  const logger = parentLogger.clone([CSV_SEARCHSOURCE_IMMEDIATE_TYPE, 'execute-job']);

  return async function runTask(jobId, immediateJobParams, context, req) {
    const savedObjectsClient = context.core.savedObjects.client;
    const uiSettingsClient = await reporting.getUiSettingsServiceFactory(savedObjectsClient);
    const searchService: ISearchStart = await reporting.getSearchService();
    const searchSourceService = await searchService.searchSource.asScoped(req);
    const fieldFormatsRegistry = await getFieldFormats().fieldFormatServiceFactory(
      uiSettingsClient
    );

    const job = {
      objectType: 'immediate-search',
      ...immediateJobParams,
    };

    const csv = new CsvGenerator(
      job,
      config,
      uiSettingsClient,
      searchSourceService,
      fieldFormatsRegistry,
      new CancellationToken(),
      logger
    );

    const {
      content,
      maxSizeReached,
      size,
      csvContainsFormulas,
      warnings,
    } = await csv.generateData();

    if (csvContainsFormulas) {
      logger.warn(`CSV may contain formulas whose values have been escaped`);
    }

    if (maxSizeReached) {
      logger.warn(`Max size reached: CSV output truncated to ${size} bytes`);
    }

    return {
      content_type: CONTENT_TYPE_CSV,
      content,
      max_size_reached: maxSizeReached,
      size,
      csv_contains_formulas: csvContainsFormulas,
      warnings,
    };
  };
};
