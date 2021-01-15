/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

jest.mock('../routes');
jest.mock('../usage');
jest.mock('../browsers');
jest.mock('../lib/create_queue');

import _ from 'lodash';
import * as Rx from 'rxjs';
import { ReportingConfig, ReportingCore } from '../';
import { featuresPluginMock } from '../../../features/server/mocks';
import {
  chromium,
  HeadlessChromiumDriverFactory,
  initializeBrowserDriverFactory,
} from '../browsers';
import { ReportingConfigType } from '../config';
import { ReportingInternalSetup, ReportingInternalStart } from '../core';
import { ReportingStore } from '../lib';
import { ReportingStartDeps } from '../types';
import { createMockLevelLogger } from './create_mock_levellogger';

(initializeBrowserDriverFactory as jest.Mock<
  Promise<HeadlessChromiumDriverFactory>
>).mockImplementation(() => Promise.resolve({} as HeadlessChromiumDriverFactory));

(chromium as any).createDriverFactory.mockImplementation(() => ({}));

export const createMockReportingSetup = (setupMock?: any): ReportingInternalSetup => {
  return {
    features: featuresPluginMock.createSetup(),
    elasticsearch: setupMock.elasticsearch || { legacy: { client: {} } },
    basePath: { set: jest.fn() },
    router: setupMock.router,
    security: setupMock.security,
    licensing: { license$: Rx.of({ isAvailable: true, isActive: true, type: 'basic' }) } as any,
  };
};

const logger = createMockLevelLogger();

const createMockReportingStore = () => ({} as ReportingStore);

export const createMockReportingStart = (
  mockReportingCore: ReportingCore | undefined,
  startMock?: any
): ReportingInternalStart => {
  const store = mockReportingCore
    ? new ReportingStore(mockReportingCore, logger)
    : createMockReportingStore();

  return {
    browserDriverFactory: startMock.browserDriverFactory,
    esqueue: startMock.esqueue,
    savedObjects: startMock.savedObjects || { getScopedClient: jest.fn() },
    uiSettings: startMock.uiSettings || { asScopedToClient: () => ({ get: jest.fn() }) },
    data: startMock.data || {
      search: {
        asScopedToClient: jest.fn(),
        searchSource: {
          asScoped: jest.fn().mockImplementation(() => ({
            create: jest.fn().mockImplementation(() => ({
              getField: jest.fn(),
              setField: jest.fn(),
              fetch: jest.fn().mockImplementation(async () => ({ hits: { hits: [] } })),
            })),
          })),
        },
      },
    },
    store,
  };
};

interface ReportingConfigTestType {
  index: string;
  encryptionKey: string;
  queue: Partial<ReportingConfigType['queue']>;
  kibanaServer: Partial<ReportingConfigType['kibanaServer']>;
  csv: Partial<ReportingConfigType['csv']>;
  capture: any;
  server?: any;
}

export const createMockConfigSchema = (
  overrides: Partial<ReportingConfigTestType> = {}
): ReportingConfigTestType => {
  // deeply merge the defaults and the provided partial schema
  return {
    index: '.reporting',
    encryptionKey: 'cool-encryption-key-where-did-you-find-it',
    ...overrides,
    kibanaServer: {
      hostname: 'localhost',
      port: 80,
      ...overrides.kibanaServer,
    },
    capture: {
      browser: {
        chromium: {
          disableSandbox: true,
        },
      },
      ...overrides.capture,
    },
    queue: {
      timeout: 120000,
      ...overrides.queue,
    },
    csv: {
      ...overrides.csv,
    },
  };
};

export const createMockConfig = (
  reportingConfig: Partial<ReportingConfigTestType>
): ReportingConfig => {
  const mockConfigGet = jest.fn().mockImplementation((...keys: string[]) => {
    return _.get(reportingConfig, keys.join('.'));
  });
  return {
    get: mockConfigGet,
    kbnConfig: { get: mockConfigGet },
  };
};

export const createMockStartDeps = (startMock?: any): ReportingStartDeps => ({
  data: startMock.data,
});

export const createMockReportingCore = async (
  config: ReportingConfig,
  setupDepsMock: ReportingInternalSetup | undefined = undefined,
  startDepsMock: ReportingInternalStart | undefined = undefined
) => {
  const mockReportingCore = ({
    getConfig: () => config,
    getElasticsearchService: () => setupDepsMock?.elasticsearch,
    getSearchService: () => startDepsMock?.data?.search,
  } as unknown) as ReportingCore;

  if (!setupDepsMock) {
    setupDepsMock = createMockReportingSetup({});
  }
  if (!startDepsMock) {
    startDepsMock = createMockReportingStart(mockReportingCore, {});
  }

  config = config || {};
  const core = new ReportingCore(logger);

  core.pluginSetup(setupDepsMock);
  core.setConfig(config);
  await core.pluginSetsUp();

  core.pluginStart(startDepsMock);
  await core.pluginStartsUp();

  return core;
};
