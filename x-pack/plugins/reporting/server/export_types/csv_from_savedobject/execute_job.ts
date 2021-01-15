/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { KibanaRequest, RequestHandlerContext } from 'src/core/server';
import { CancellationToken } from '../../../common';
import { CONTENT_TYPE_CSV, CSV_FROM_SAVEDOBJECT_JOB_TYPE } from '../../../common/constants';
import { TaskRunResult } from '../../lib/tasks';
import { RunTaskFnFactory } from '../../types';
import { createGenerateCsv } from '../csv_searchsource/generate_csv';
import { JobParamsDownloadCSV } from './types';
import { ISearchStart } from '../../../../../../src/plugins/data/server';

/*
 * ImmediateExecuteFn receives the job doc payload because the payload was
 * generated in the ScheduleFn
 */
export type ImmediateExecuteFn = (
  jobId: null,
  job: JobParamsDownloadCSV,
  context: RequestHandlerContext,
  req: KibanaRequest
) => Promise<TaskRunResult>;

export const runTaskFnFactory: RunTaskFnFactory<ImmediateExecuteFn> = function executeJobFactoryFn(
  reporting,
  parentLogger
) {
  const config = reporting.getConfig();
  const logger = parentLogger.clone([CSV_FROM_SAVEDOBJECT_JOB_TYPE, 'execute-job']);

  return async function runTask(jobId, immediateJobParams, context, req) {
    const generateCsv = createGenerateCsv(logger);

    const savedObjectsClient = context.core.savedObjects.client;
    const uiSettingsClient = await reporting.getUiSettingsServiceFactory(savedObjectsClient);
    const searchService: ISearchStart = await reporting.getSearchService();
    const searchSourceService = await searchService.searchSource.asScoped(req);

    const job = {
      objectType: 'immediate-search',
      ...immediateJobParams,
    };

    const { content, maxSizeReached, size, csvContainsFormulas, warnings } = await generateCsv(
      job,
      config,
      uiSettingsClient,
      searchSourceService,
      new CancellationToken() // can not be cancelled
    );

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
