/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { identity, range } from 'lodash';
import { IUiSettingsClient } from 'src/core/server';
import { savedObjectsClientMock, uiSettingsServiceMock } from 'src/core/server/mocks';
import {
  FieldFormatsRegistry,
  ISearchSource,
  ISearchStartSearchSource,
} from 'src/plugins/data/common';
import { ReportingConfig } from '../../../';
import { CancellationToken } from '../../../../common';
import {
  UI_SETTINGS_CSV_QUOTE_VALUES,
  UI_SETTINGS_CSV_SEPARATOR,
  UI_SETTINGS_DATEFORMAT_TZ,
} from '../../../../common/constants';
import {
  createMockConfig,
  createMockConfigSchema,
  createMockLevelLogger,
} from '../../../test_helpers';
import { JobParamsCSV } from '../types';
import { CsvGenerator } from './generate_csv';

const createMockJob = (baseObj: any = {}): JobParamsCSV => ({
  ...baseObj,
});

let mockConfig: ReportingConfig;

let uiSettingsClient: IUiSettingsClient;

const mockSearchSourceFetch = jest.fn();
const mockSearchSourceGetField = jest.fn();
const getMockSearchSource = () =>
  (({
    mock: true,
    getField: mockSearchSourceGetField,
    setField: jest.fn(),
    fetch: mockSearchSourceFetch,
  } as unknown) as ISearchSource);

const mockSearchSourceService = ({
  create: jest.fn().mockImplementation(getMockSearchSource),
} as unknown) as ISearchStartSearchSource;

const mockFieldFormatsRegistry = ({
  deserialize: jest
    .fn()
    .mockImplementation(() => ({ id: 'string', convert: jest.fn().mockImplementation(identity) })),
} as unknown) as FieldFormatsRegistry;

beforeEach(async () => {
  uiSettingsClient = uiSettingsServiceMock
    .createStartContract()
    .asScopedToClient(savedObjectsClientMock.create());
  uiSettingsClient.get = jest.fn().mockImplementation((key): any => {
    switch (key) {
      case UI_SETTINGS_CSV_QUOTE_VALUES:
        return true;
      case UI_SETTINGS_CSV_SEPARATOR:
        return ',';
      case UI_SETTINGS_DATEFORMAT_TZ:
        return 'Browser';
    }
  });

  mockConfig = createMockConfig(
    createMockConfigSchema({
      csv: {
        checkForFormulas: true,
        escapeFormulaValues: true,
        maxSizeBytes: 180000,
        scroll: { size: 500, duration: '30s' },
      },
    })
  );

  mockSearchSourceFetch.mockResolvedValue({
    hits: {
      hits: [],
      total: 0,
    },
  });

  mockSearchSourceGetField.mockImplementation((key: string) => {
    if (key === 'fields') {
      return ['date', 'ip', 'message'];
    }
    if (key === 'index') {
      return { fields: { getByName: jest.fn() } };
    }
  });
});

const logger = createMockLevelLogger();

it('formats an empty search result to CSV content', async () => {
  const generateCsv = new CsvGenerator(
    createMockJob({}),
    mockConfig,
    uiSettingsClient,
    mockSearchSourceService,
    mockFieldFormatsRegistry,
    new CancellationToken(),
    logger
  );
  const csvResult = await generateCsv.generateData();
  expect(csvResult.content).toMatchInlineSnapshot(`""`);
  expect(csvResult.csvContainsFormulas).toBe(false);
});

it('formats a search result to CSV content', async () => {
  mockSearchSourceFetch.mockResolvedValueOnce({
    hits: {
      hits: [
        {
          fields: {
            date: ['2020-12-31T00:14:28.000Z'],
            ip: ['110.135.176.89'],
            message: [`This is a great message!`],
          },
        },
      ],
      total: 1,
    },
  });
  const generateCsv = new CsvGenerator(
    createMockJob({}),
    mockConfig,
    uiSettingsClient,
    mockSearchSourceService,
    mockFieldFormatsRegistry,
    new CancellationToken(),
    logger
  );
  const csvResult = await generateCsv.generateData();
  expect(csvResult.content).toMatchInlineSnapshot(`
    "date,ip,message
    \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"This is a great message!\\"
    "
  `);
  expect(csvResult.csvContainsFormulas).toBe(false);
});

it('formats a search result to CSV content, with serialized data', async () => {
  mockSearchSourceFetch.mockResolvedValueOnce({
    hits: {
      hits: [
        {
          fields: {
            date: `["2020-12-31T00:14:28.000Z"]`,
            ip: `["110.135.176.89"]`,
            message: `["This is a great message!"]`,
          },
        },
      ],
      total: 1,
    },
  });
  const generateCsv = new CsvGenerator(
    createMockJob({}),
    mockConfig,
    uiSettingsClient,
    mockSearchSourceService,
    mockFieldFormatsRegistry,
    new CancellationToken(),
    logger
  );
  const csvResult = await generateCsv.generateData();
  expect(csvResult.content).toMatchInlineSnapshot(`
    "date,ip,message
    \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"This is a great message!\\"
    "
  `);
  expect(csvResult.csvContainsFormulas).toBe(false);
});

const TEST_NUM_TOTAL = 100;

it('calculates the bytes of the content', async () => {
  mockSearchSourceGetField.mockImplementation((key: string) => {
    if (key === 'fields') {
      return ['message'];
    }
    if (key === 'index') {
      return { fields: { getByName: jest.fn() } };
    }
  });
  mockSearchSourceFetch.mockResolvedValueOnce({
    hits: {
      hits: range(0, TEST_NUM_TOTAL).map(() => ({
        fields: {
          message: ['this is a great message'],
        },
      })),
      total: TEST_NUM_TOTAL,
    },
  });

  const generateCsv = new CsvGenerator(
    createMockJob({}),
    mockConfig,
    uiSettingsClient,
    mockSearchSourceService,
    mockFieldFormatsRegistry,
    new CancellationToken(),
    logger
  );
  const csvResult = await generateCsv.generateData();
  expect(csvResult.size).toBe(2608);
  expect(csvResult.maxSizeReached).toBe(false);
  expect(csvResult.warnings).toEqual([]);
});

it('warns if max size was reached', async () => {
  const TEST_MAX_SIZE = 500;

  mockConfig = createMockConfig(
    createMockConfigSchema({
      csv: {
        checkForFormulas: true,
        escapeFormulaValues: true,
        maxSizeBytes: TEST_MAX_SIZE,
        scroll: { size: 500, duration: '30s' },
      },
    })
  );

  mockSearchSourceFetch.mockResolvedValueOnce({
    hits: {
      hits: range(0, TEST_NUM_TOTAL).map(() => ({
        fields: {
          date: ['2020-12-31T00:14:28.000Z'],
          ip: ['110.135.176.89'],
          message: ['super cali fragile istic XPLA docious'],
        },
      })),
      total: TEST_NUM_TOTAL,
    },
  });

  const generateCsv = new CsvGenerator(
    createMockJob({}),
    mockConfig,
    uiSettingsClient,
    mockSearchSourceService,
    mockFieldFormatsRegistry,
    new CancellationToken(),
    logger
  );
  const csvResult = await generateCsv.generateData();
  expect(csvResult.maxSizeReached).toBe(true);
  expect(csvResult.warnings).toEqual([]);
  expect(csvResult.content).toMatchInlineSnapshot(`
    "date,ip,message
    \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"super cali fragile istic XPLA docious\\"
    \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"super cali fragile istic XPLA docious\\"
    \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"super cali fragile istic XPLA docious\\"
    \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"super cali fragile istic XPLA docious\\"
    \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"super cali fragile istic XPLA docious\\"
    "
  `);
});

describe('fields', () => {
  it('provides top-level underscored fields as columns', async () => {
    mockSearchSourceGetField.mockImplementation((key: string) => {
      if (key === 'fields') {
        return ['_id', '_index', 'date', 'message'];
      }
      if (key === 'index') {
        return { fields: { getByName: jest.fn() } };
      }
    });
    mockSearchSourceFetch.mockResolvedValueOnce({
      hits: {
        hits: [
          {
            _id: 'my-cool-id',
            _index: 'my-cool-index',
            _version: 4,
            fields: {
              date: ['2020-12-31T00:14:28.000Z'],
              message: [`it's nice to see you`],
            },
          },
        ],
        total: 1,
      },
    });

    const generateCsv = new CsvGenerator(
      createMockJob({
        searchSource: {
          query: { query: '', language: 'kuery' },
          sort: [{ '@date': 'desc' }],
          index: '93f4bc50-6662-11eb-98bc-f550e2308366',
          fields: ['_id', '_index', '@date', 'message'],
          filter: [],
        },
      }),
      mockConfig,
      uiSettingsClient,
      mockSearchSourceService,
      mockFieldFormatsRegistry,
      new CancellationToken(),
      logger
    );

    const csvResult = await generateCsv.generateData();

    expect(csvResult.content).toMatchInlineSnapshot(`
      "\\"_id\\",\\"_index\\",date,message
      \\"my-cool-id\\",\\"my-cool-index\\",\\"2020-12-31T00:14:28.000Z\\",\\"it's nice to see you\\"
      "
    `);
    expect(csvResult.csvContainsFormulas).toBe(false);
  });
});

describe('formulas', () => {
  const TEST_FORMULA = '=SUM(A1:A2)';

  it(`escapes formula values in a cell, doesn't warn the csv contains formulas`, async () => {
    mockSearchSourceFetch.mockResolvedValueOnce({
      hits: {
        hits: [
          {
            fields: {
              date: ['2020-12-31T00:14:28.000Z'],
              ip: ['110.135.176.89'],
              message: [TEST_FORMULA],
            },
          },
        ],
        total: 1,
      },
    });

    const generateCsv = new CsvGenerator(
      createMockJob({}),
      mockConfig,
      uiSettingsClient,
      mockSearchSourceService,
      mockFieldFormatsRegistry,
      new CancellationToken(),
      logger
    );

    const csvResult = await generateCsv.generateData();

    expect(csvResult.content).toMatchInlineSnapshot(`
      "date,ip,message
      \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"'=SUM(A1:A2)\\"
      "
    `);
    expect(csvResult.csvContainsFormulas).toBe(false);
  });

  it(`escapes formula values in a header, doesn't warn the csv contains formulas`, async () => {
    mockSearchSourceFetch.mockResolvedValueOnce({
      hits: {
        hits: [
          {
            fields: {
              date: ['2020-12-31T00:14:28.000Z'],
              ip: ['110.135.176.89'],
              [TEST_FORMULA]: 'This is great data',
            },
          },
        ],
        total: 1,
      },
    });

    mockSearchSourceGetField.mockImplementation((key: string) => {
      if (key === 'fields') {
        return ['date', 'ip', TEST_FORMULA];
      }
      if (key === 'index') {
        return { fields: { getByName: jest.fn() } };
      }
    });

    const generateCsv = new CsvGenerator(
      createMockJob({}),
      mockConfig,
      uiSettingsClient,
      mockSearchSourceService,
      mockFieldFormatsRegistry,
      new CancellationToken(),
      logger
    );

    const csvResult = await generateCsv.generateData();

    expect(csvResult.content).toMatchInlineSnapshot(`
      "date,ip,\\"'=SUM(A1:A2)\\"
      \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"This is great data\\"
      "
    `);
    expect(csvResult.csvContainsFormulas).toBe(false);
  });

  it('can check for formulas, without escaping them', async () => {
    mockConfig = createMockConfig(
      createMockConfigSchema({
        csv: {
          checkForFormulas: true,
          escapeFormulaValues: false,
          maxSizeBytes: 180000,
          scroll: { size: 500, duration: '30s' },
        },
      })
    );
    mockSearchSourceFetch.mockResolvedValueOnce({
      hits: {
        hits: [
          {
            fields: {
              date: ['2020-12-31T00:14:28.000Z'],
              ip: ['110.135.176.89'],
              message: [TEST_FORMULA],
            },
          },
        ],
        total: 1,
      },
    });

    const generateCsv = new CsvGenerator(
      createMockJob({}),
      mockConfig,
      uiSettingsClient,
      mockSearchSourceService,
      mockFieldFormatsRegistry,
      new CancellationToken(),
      logger
    );

    const csvResult = await generateCsv.generateData();

    expect(csvResult.content).toMatchInlineSnapshot(`
      "date,ip,message
      \\"2020-12-31T00:14:28.000Z\\",\\"110.135.176.89\\",\\"=SUM(A1:A2)\\"
      "
    `);
    expect(csvResult.csvContainsFormulas).toBe(true);
  });
});
