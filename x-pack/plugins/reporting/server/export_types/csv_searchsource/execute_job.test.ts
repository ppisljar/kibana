/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import nodeCrypto from '@elastic/node-crypto';
import { savedObjectsClientMock, uiSettingsServiceMock } from 'src/core/server/mocks';
import { fieldFormats } from 'src/plugins/data/server';
import { ReportingCore } from '../../';

import { CancellationToken } from '../../../common';
import { setFieldFormats } from '../../services';
import {
  createMockConfig,
  createMockConfigSchema,
  createMockLevelLogger,
  createMockReportingCore,
} from '../../test_helpers';
import { runTaskFnFactory } from './execute_job';

const logger = createMockLevelLogger();
const encryptionKey = 'tetkey';
const headers = { sid: 'cooltestheaders' };
let encryptedHeaders: string;
let reportingCore: ReportingCore;

beforeAll(async () => {
  const crypto = nodeCrypto({ encryptionKey });
  const config = createMockConfig(
    createMockConfigSchema({
      encryptionKey,
      csv: {
        checkForFormulas: true,
        escapeFormulaValues: true,
        maxSizeBytes: 180000,
        scroll: { size: 500, duration: '30s' },
      },
    })
  );

  encryptedHeaders = await crypto.encrypt(headers);

  const uiSettingsClient = uiSettingsServiceMock
    .createStartContract()
    .asScopedToClient(savedObjectsClientMock.create());

  reportingCore = await createMockReportingCore(config);
  reportingCore.getUiSettingsClient = jest.fn().mockResolvedValue(uiSettingsClient);

  setFieldFormats({
    fieldFormatServiceFactory() {
      const fieldFormatsRegistry = new fieldFormats.FieldFormatsRegistry();
      return Promise.resolve(fieldFormatsRegistry);
    },
  });
});

test('decorates job parameters', async () => {
  const runTask = runTaskFnFactory(reportingCore, logger);

  const payload = await runTask(
    'cool-job-id',
    {
      headers: encryptedHeaders,
      browserTimezone: 'US/Alaska',
      searchSource: {},
      objectType: 'search',
      title: 'Test Search',
    },
    new CancellationToken()
  );

  expect(payload).toMatchInlineSnapshot(`Promise {}`);
});
