/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { CONTENT_TYPE_CSV, CSV_JOB_TYPE } from '../../../common/constants';
import { RunTaskFn, RunTaskFnFactory } from '../../types';
import { decryptJobHeaders } from '../common';
import { CsvGenerator } from './generate_csv/generate_csv';
import { TaskPayloadCSV } from './types';
import { getFieldFormats } from '../../services';

export const runTaskFnFactory: RunTaskFnFactory<RunTaskFn<TaskPayloadCSV>> = (
  reporting,
  parentLogger
) => {
  const config = reporting.getConfig();

  return async function runTask(jobId, job, cancellationToken) {
    const logger = parentLogger.clone([CSV_JOB_TYPE, 'execute-job', jobId]);

    const encryptionKey = config.get('encryptionKey');
    const headers = await decryptJobHeaders(encryptionKey, job.headers, logger);
    const fakeRequest = reporting.getFakeRequest({ headers }, job.spaceId, logger);
    const uiSettingsClient = await reporting.getUiSettingsClient(fakeRequest, logger);

    const searchService = await reporting.getSearchService();
    const searchSourceService = await searchService.searchSource.asScoped(fakeRequest);
    const fieldFormatsRegistry = await getFieldFormats().fieldFormatServiceFactory(
      uiSettingsClient
    );

    const esClient = (await reporting.getEsClient()).asScoped(fakeRequest);

    const csv = new CsvGenerator(
      job,
      config,
      esClient,
      uiSettingsClient,
      searchSourceService,
      fieldFormatsRegistry,
      cancellationToken,
      logger
    );

    const {
      content,
      maxSizeReached,
      size,
      csvContainsFormulas,
      warnings,
    } = await csv.generateData();

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
