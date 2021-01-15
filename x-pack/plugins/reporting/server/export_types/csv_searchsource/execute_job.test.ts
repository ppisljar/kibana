/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import nodeCrypto from '@elastic/node-crypto';
import { IUiSettingsClient } from 'kibana/server';
import moment from 'moment';
// @ts-ignore
import Puid from 'puid';
import sinon from 'sinon';
import { DataPluginStart } from 'src/plugins/data/server/plugin';
import { ReportingConfig, ReportingCore } from '../../';
import {
  CSV_QUOTE_VALUES_SETTING,
  CSV_SEPARATOR_SETTING,
} from '../../../../../../src/plugins/share/server';
import { CancellationToken } from '../../../common';
import { CSV_BOM_CHARS } from '../../../common/constants';
import { LevelLogger } from '../../lib';
import { createMockReportingCore } from '../../test_helpers';
import {
  createMockReportingSetup,
  createMockReportingStart,
} from '../../test_helpers/create_mock_reportingplugin';
import { runTaskFnFactory } from './execute_job';
import { TaskPayloadCSV } from './types';

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(() => resolve(), ms));

const puid = new Puid();
const getRandomScrollId = () => {
  return puid.generate();
};

const getBasePayload = (baseObj: any) => baseObj as TaskPayloadCSV;

describe('CSV Execute Job', function () {
  const encryptionKey = 'testEncryptionKey';
  const headers = {
    sid: 'test',
  };
  const mockLogger = new LevelLogger({
    get: () =>
      ({
        debug: sinon.stub(),
        warn: sinon.stub(),
        error: sinon.stub(),
      } as any),
  });
  let defaultElasticsearchResponse: any;
  let encryptedHeaders: any;

  let scopedFetchStub = { fetch() {} };
  let fetchStub: sinon.SinonStub;
  let searchSourceCreateStub: any;
  let createStub: sinon.SinonStub;
  let searchSourceAsScopedStub = { asScoped() {} };
  let asScopedStub: sinon.SinonStub;
  let configGetStub: any;
  let mockReportingConfig: ReportingConfig;
  let mockReportingCore: ReportingCore;
  let searchSourceStub: any;
  let cancellationToken: any;

  const mockUiSettingsClient = {
    get: sinon.stub(),
  };

  beforeAll(async function () {
    const crypto = nodeCrypto({ encryptionKey });
    encryptedHeaders = await crypto.encrypt(headers);
  });

  beforeEach(async function () {
    configGetStub = sinon.stub();
    configGetStub.withArgs('queue', 'timeout').returns(moment.duration('2m'));
    configGetStub.withArgs('index').returns('.reporting-foo-test');
    configGetStub.withArgs('encryptionKey').returns(encryptionKey);
    configGetStub.withArgs('csv', 'maxSizeBytes').returns(1024 * 1000); // 1mB
    configGetStub.withArgs('csv', 'scroll').returns({});
    mockReportingConfig = { get: configGetStub, kbnConfig: { get: configGetStub } };

    defaultElasticsearchResponse = {
      hits: { hits: [], total: 0 },
      _scroll_id: 'defaultScrollId',
    };
    scopedFetchStub = { fetch() {} };
    fetchStub = sinon.stub(scopedFetchStub, 'fetch').resolves(defaultElasticsearchResponse);
    searchSourceCreateStub = { create() {} };
    createStub = sinon.stub(searchSourceCreateStub, 'create').resolves(
      Promise.resolve({
        getField: sinon.stub().callsFake((getKey: string) => {
          if (getKey === 'fields') {
            return ['one', 'two'];
          }
        }),
        setField: sinon.stub(),
        fetch: fetchStub,
      })
    );

    searchSourceAsScopedStub = { asScoped() {} };
    asScopedStub = sinon.stub(searchSourceAsScopedStub, 'asScoped').resolves({
      create: createStub,
    });
    searchSourceStub = {
      asScopedToClient: sinon.stub(),
      searchSource: {
        asScoped: asScopedStub,
      },
    };

    mockReportingCore = await createMockReportingCore(
      mockReportingConfig,
      createMockReportingSetup({}),
      createMockReportingStart(undefined, {
        data: { search: searchSourceStub } as DataPluginStart,
      })
    );
    mockReportingCore.getUiSettingsServiceFactory = () =>
      Promise.resolve((mockUiSettingsClient as unknown) as IUiSettingsClient);
    mockReportingCore.setConfig(mockReportingConfig);

    cancellationToken = new CancellationToken();

    mockUiSettingsClient.get.withArgs(CSV_SEPARATOR_SETTING).returns(',');
    mockUiSettingsClient.get.withArgs(CSV_QUOTE_VALUES_SETTING).returns(true);
  });

  describe('basic Elasticsearch call behavior', function () {
    it.skip('should decrypt encrypted headers and pass to searchSource.asScoped', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      await runTask(
        'job456',
        getBasePayload({
          headers: encryptedHeaders,
          searchSource: { hello: 'world' },
        }),
        cancellationToken
      );

      const req = asScopedStub.getCall(0).args[0];
      expect(req.headers).toMatchInlineSnapshot(`
        Object {
          "sid": "test",
        }
      `);

      const searchSource = createStub.getCall(0).args;
      expect(searchSource).toMatchInlineSnapshot(`
        Array [
          Object {
            "hello": "world",
          },
        ]
      `);

      expect(fetchStub.called).toBe(true);
    });

    it.skip('should pass the scrollId from the initial search to the subsequent scroll', async function () {
      const scrollId = getRandomScrollId();
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: scrollId,
      });
      fetchStub.onSecondCall().resolves(defaultElasticsearchResponse);
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      await runTask(
        'job456',
        getBasePayload({
          headers: encryptedHeaders,
          fields: [],
          searchRequest: { index: null, body: null },
        }),
        cancellationToken
      );

      const scrollCall = fetchStub.secondCall;

      expect(scrollCall.args[0]).toBe('scroll');
      expect(scrollCall.args[1].scrollId).toBe(scrollId);
    });

    it.skip('should not execute scroll if there are no hits from the search', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      await runTask(
        'job456',
        getBasePayload({
          headers: encryptedHeaders,
          fields: [],
          searchRequest: { index: null, body: null },
        }),
        cancellationToken
      );

      expect(fetchStub.callCount).toBe(2);

      const searchCall = fetchStub.firstCall;
      expect(searchCall.args[0]).toBe('search');

      const clearScrollCall = fetchStub.secondCall;
      expect(clearScrollCall.args[0]).toBe('clearScroll');
    });

    it.skip('should stop executing scroll if there are no hits', async function () {
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: 'scrollId',
      });
      fetchStub.onSecondCall().resolves({
        hits: {
          hits: [],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      await runTask(
        'job456',
        getBasePayload({
          headers: encryptedHeaders,
          fields: [],
          searchRequest: { index: null, body: null },
        }),
        cancellationToken
      );

      expect(fetchStub.callCount).toBe(3);

      const searchCall = fetchStub.firstCall;
      expect(searchCall.args[0]).toBe('search');

      const scrollCall = fetchStub.secondCall;
      expect(scrollCall.args[0]).toBe('scroll');

      const clearScroll = fetchStub.thirdCall;
      expect(clearScroll.args[0]).toBe('clearScroll');
    });

    it.skip('should call clearScroll with scrollId when there are no more hits', async function () {
      const lastScrollId = getRandomScrollId();
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: 'scrollId',
      });

      fetchStub.onSecondCall().resolves({
        hits: {
          hits: [],
        },
        _scroll_id: lastScrollId,
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      await runTask(
        'job456',
        getBasePayload({
          headers: encryptedHeaders,
          fields: [],
          searchRequest: { index: null, body: null },
        }),
        cancellationToken
      );

      const lastCall = fetchStub.getCall(fetchStub.callCount - 1);
      expect(lastCall.args[0]).toBe('clearScroll');
      expect(lastCall.args[1].scrollId).toEqual([lastScrollId]);
    });

    it.skip('calls clearScroll when there is an error iterating the hits', async function () {
      const lastScrollId = getRandomScrollId();
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [
            {
              _source: {
                one: 'foo',
                two: 'bar',
              },
            },
          ],
        },
        _scroll_id: lastScrollId,
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      await expect(runTask('job123', jobParams, cancellationToken)).rejects.toMatchInlineSnapshot(
        `[TypeError: Cannot read property 'indexOf' of undefined]`
      );

      const lastCall = fetchStub.getCall(fetchStub.callCount - 1);
      expect(lastCall.args[0]).toBe('clearScroll');
      expect(lastCall.args[1].scrollId).toEqual([lastScrollId]);
    });
  });

  describe('Warning when cells have formulas', () => {
    const FORMULA_DATA = '=SUM(A1:A2)';

    it('returns `csv_contains_formulas` when cells contain formulas', async function () {
      configGetStub.withArgs('csv', 'checkForFormulas').returns(true);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { one: FORMULA_DATA, two: 'bar' } }],
          total: 1,
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
      });
      const { csv_contains_formulas: csvContainsFormulas } = await runTask(
        'job123',
        jobParams,
        cancellationToken
      );

      expect(csvContainsFormulas).toEqual(true);
    });

    it('returns warnings when headings contain formulas', async function () {
      createStub.resolves({
        getField: sinon.stub().callsFake((getKey: string) => {
          if (getKey === 'fields') {
            return [FORMULA_DATA, 'two'];
          }
        }),
        setField: sinon.stub(),
        fetch: fetchStub,
      });
      configGetStub.withArgs('csv', 'checkForFormulas').returns(true);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { [FORMULA_DATA]: 'foo', two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { csv_contains_formulas: csvContainsFormulas } = await runTask(
        'job123',
        jobParams,
        cancellationToken
      );

      expect(csvContainsFormulas).toEqual(true);
    });

    it('returns no warnings when cells have no formulas', async function () {
      configGetStub.withArgs('csv', 'checkForFormulas').returns(true);
      configGetStub.withArgs('csv', 'escapeFormulaValues').returns(false);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { one: 'foo', two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { csv_contains_formulas: csvContainsFormulas } = await runTask(
        'job123',
        jobParams,
        cancellationToken
      );

      expect(csvContainsFormulas).toEqual(false);
    });

    it('returns no warnings when cells have formulas but are escaped', async function () {
      createStub.resolves({
        getField: sinon.stub().callsFake((getKey: string) => {
          if (getKey === 'fields') {
            return [FORMULA_DATA, 'two'];
          }
        }),
        setField: sinon.stub(),
        fetch: fetchStub,
      });
      configGetStub.withArgs('csv', 'checkForFormulas').returns(true);
      configGetStub.withArgs('csv', 'escapeFormulaValues').returns(true);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { [FORMULA_DATA]: 'foo', two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });

      const { csv_contains_formulas: csvContainsFormulas } = await runTask(
        'job123',
        jobParams,
        cancellationToken
      );

      expect(csvContainsFormulas).toEqual(false);
    });

    it('returns no warnings when configured not to', async () => {
      configGetStub.withArgs('csv', 'checkForFormulas').returns(false);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { one: FORMULA_DATA, two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { csv_contains_formulas: csvContainsFormulas } = await runTask(
        'job123',
        jobParams,
        cancellationToken
      );

      expect(csvContainsFormulas).toEqual(false);
    });
  });

  describe('Byte order mark encoding', () => {
    it('encodes CSVs with BOM', async () => {
      configGetStub.withArgs('csv', 'useByteOrderMarkEncoding').returns(true);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { one: 'one', two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);

      expect(content).toEqual(`${CSV_BOM_CHARS}one,two\none,bar\n`);
    });

    it.skip('encodes CSVs without BOM', async () => {
      configGetStub.withArgs('csv', 'useByteOrderMarkEncoding').returns(false);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { one: 'one', two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);

      expect(content).toEqual('one,two\none,bar\n');
    });
  });

  describe('Escaping cells with formulas', () => {
    it.skip('escapes values with formulas', async () => {
      configGetStub.withArgs('csv', 'escapeFormulaValues').returns(true);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { one: `=cmd|' /C calc'!A0`, two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);

      expect(content).toEqual("one,two\n\"'=cmd|' /C calc'!A0\",bar\n");
    });

    it.skip('does not escapes values with formulas', async () => {
      configGetStub.withArgs('csv', 'escapeFormulaValues').returns(false);
      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{ _source: { one: `=cmd|' /C calc'!A0`, two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);

      expect(content).toEqual('one,two\n"=cmd|\' /C calc\'!A0",bar\n');
    });
  });

  describe('Elasticsearch call errors', function () {
    it.skip('should reject Promise if search call errors out', async function () {
      fetchStub.rejects(new Error());
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: [],
        searchRequest: { index: null, body: null },
      });
      await expect(runTask('job123', jobParams, cancellationToken)).rejects.toMatchInlineSnapshot(
        `[Error]`
      );
    });

    it.skip('should reject Promise if scroll call errors out', async function () {
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: 'scrollId',
      });
      fetchStub.onSecondCall().rejects(new Error());
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: [],
        searchRequest: { index: null, body: null },
      });
      await expect(runTask('job123', jobParams, cancellationToken)).rejects.toMatchInlineSnapshot(
        `[Error]`
      );
    });
  });

  describe('invalid responses', function () {
    it.skip('should reject Promise if search returns hits but no _scroll_id', async function () {
      fetchStub.resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: undefined,
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: [],
        searchRequest: { index: null, body: null },
      });
      await expect(runTask('job123', jobParams, cancellationToken)).rejects.toMatchInlineSnapshot(
        `[Error: Expected _scroll_id in the following Elasticsearch response: {"hits":{"hits":[{}]}}]`
      );
    });

    it.skip('should reject Promise if search returns no hits and no _scroll_id', async function () {
      fetchStub.resolves({
        hits: {
          hits: [],
        },
        _scroll_id: undefined,
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: [],
        searchRequest: { index: null, body: null },
      });
      await expect(runTask('job123', jobParams, cancellationToken)).rejects.toMatchInlineSnapshot(
        `[Error: Expected _scroll_id in the following Elasticsearch response: {"hits":{"hits":[]}}]`
      );
    });

    it.skip('should reject Promise if scroll returns hits but no _scroll_id', async function () {
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: 'scrollId',
      });

      fetchStub.onSecondCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: undefined,
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: [],
        searchRequest: { index: null, body: null },
      });
      await expect(runTask('job123', jobParams, cancellationToken)).rejects.toMatchInlineSnapshot(
        `[Error: Expected _scroll_id in the following Elasticsearch response: {"hits":{"hits":[{}]}}]`
      );
    });

    it.skip('should reject Promise if scroll returns no hits and no _scroll_id', async function () {
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: 'scrollId',
      });

      fetchStub.onSecondCall().resolves({
        hits: {
          hits: [],
        },
        _scroll_id: undefined,
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: [],
        searchRequest: { index: null, body: null },
      });
      await expect(runTask('job123', jobParams, cancellationToken)).rejects.toMatchInlineSnapshot(
        `[Error: Expected _scroll_id in the following Elasticsearch response: {"hits":{"hits":[]}}]`
      );
    });
  });

  describe('cancellation', function () {
    const scrollId = getRandomScrollId();

    beforeEach(function () {
      fetchStub.restore();
      fetchStub = sinon.stub(scopedFetchStub, 'fetch').callsFake(async function () {
        await delay(1);
        return {
          hits: {
            hits: [{}],
          },
          _scroll_id: scrollId,
        };
      });
    });

    it.skip('should stop calling Elasticsearch when cancellationToken.cancel is called', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      runTask(
        'job345',
        getBasePayload({
          headers: encryptedHeaders,
          fields: [],
          searchRequest: { index: null, body: null },
        }),
        cancellationToken
      );

      await delay(250);
      const callCount = fetchStub.callCount;
      cancellationToken.cancel();
      await delay(250);
      expect(fetchStub.callCount).toBe(callCount + 1); // last call is to clear the scroll
    });

    it.skip(`shouldn't call clearScroll if it never got a scrollId`, async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      runTask(
        'job345',
        getBasePayload({
          headers: encryptedHeaders,
          fields: [],
          searchRequest: { index: null, body: null },
        }),
        cancellationToken
      );
      cancellationToken.cancel();

      for (let i = 0; i < fetchStub.callCount; ++i) {
        expect(fetchStub.getCall(i).args[1]).not.toBe('clearScroll'); // dead code?
      }
    });

    it.skip('should call clearScroll if it got a scrollId', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      runTask(
        'job345',
        getBasePayload({
          headers: encryptedHeaders,
          fields: [],
          searchRequest: { index: null, body: null },
        }),
        cancellationToken
      );
      await delay(100);
      cancellationToken.cancel();
      await delay(100);

      const lastCall = fetchStub.getCall(fetchStub.callCount - 1);
      expect(lastCall.args[0]).toBe('clearScroll');
      expect(lastCall.args[1].scrollId).toEqual([scrollId]);
    });
  });

  describe('csv content', function () {
    it.skip('should write column headers to output, even if there are no results', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: ['one', 'two'],
        searchRequest: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);
      expect(content).toBe(`one,two\n`);
    });

    it.skip('should use custom uiSettings csv:separator for header', async function () {
      mockUiSettingsClient.get.withArgs(CSV_SEPARATOR_SETTING).returns(';');
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: ['one', 'two'],
        searchRequest: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);
      expect(content).toBe(`one;two\n`);
    });

    it.skip('should escape column headers if uiSettings csv:quoteValues is true', async function () {
      mockUiSettingsClient.get.withArgs(CSV_QUOTE_VALUES_SETTING).returns(true);
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: ['one and a half', 'two', 'three-and-four', 'five & six'],
        searchRequest: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);
      expect(content).toBe(`"one and a half",two,"three-and-four","five & six"\n`);
    });

    it.skip(`shouldn't escape column headers if uiSettings csv:quoteValues is false`, async function () {
      mockUiSettingsClient.get.withArgs(CSV_QUOTE_VALUES_SETTING).returns(false);
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: ['one and a half', 'two', 'three-and-four', 'five & six'],
        searchRequest: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);
      expect(content).toBe(`one and a half,two,three-and-four,five & six\n`);
    });

    it.skip('should write column headers to output, when there are results', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{ one: '1', two: '2' }],
        },
        _scroll_id: 'scrollId',
      });

      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        fields: ['one', 'two'],
        searchRequest: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);
      expect(content).not.toBe(null);
      const lines = content!.split('\n');
      const headerLine = lines[0];
      expect(headerLine).toBe('one,two');
    });

    it.skip('should use comma separated values of non-nested fields from _source', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{ _source: { one: 'foo', two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);
      expect(content).not.toBe(null);
      const lines = content!.split('\n');
      const valuesLine = lines[1];
      expect(valuesLine).toBe('foo,bar');
    });

    it.skip('should concatenate the hits from multiple responses', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{ _source: { one: 'foo', two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });
      fetchStub.onSecondCall().resolves({
        hits: {
          hits: [{ _source: { one: 'baz', two: 'qux' } }],
        },
        _scroll_id: 'scrollId',
      });

      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);
      expect(content).not.toBe(null);
      const lines = content!.split('\n');

      expect(lines[1]).toBe('foo,bar');
      expect(lines[2]).toBe('baz,qux');
    });

    it.skip('should use field formatters to format fields', async function () {
      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{ _source: { one: 'foo', two: 'bar' } }],
        },
        _scroll_id: 'scrollId',
      });

      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
        indexPatternSavedObject: {
          id: 'logstash-*',
          type: 'index-pattern',
          attributes: {
            title: 'logstash-*',
            fields: '[{"name":"one","type":"string"}, {"name":"two","type":"string"}]',
            fieldFormatMap: '{"one":{"id":"string","params":{"transform": "upper"}}}',
          },
        },
      });
      const { content } = await runTask('job123', jobParams, cancellationToken);
      expect(content).not.toBe(null);
      const lines = content!.split('\n');

      expect(lines[1]).toBe('FOO,bar');
    });
  });

  describe('maxSizeBytes', function () {
    // The following tests use explicitly specified lengths. UTF-8 uses between one and four 8-bit bytes for each
    // code-point. However, any character that can be represented by ASCII requires one-byte, so a majority of the
    // tests use these 'simple' characters to make the math easier

    describe('when only the headers exceed the maxSizeBytes', function () {
      let content: string | null;
      let maxSizeReached: boolean | undefined;

      beforeEach(async function () {
        configGetStub.withArgs('csv', 'maxSizeBytes').returns(1);

        const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
        const jobParams = getBasePayload({
          headers: encryptedHeaders,
          fields: ['one', 'two'],
          searchRequest: { index: null, body: null },
        });

        ({ content, max_size_reached: maxSizeReached } = await runTask(
          'job123',
          jobParams,
          cancellationToken
        ));
      });

      it.skip('should return max_size_reached', function () {
        expect(maxSizeReached).toBe(true);
      });

      it.skip('should return empty content', function () {
        expect(content).toBe('');
      });
    });

    describe('when headers are equal to maxSizeBytes', function () {
      let content: string | null;
      let maxSizeReached: boolean | undefined;

      beforeEach(async function () {
        configGetStub.withArgs('csv', 'maxSizeBytes').returns(9);

        const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
        const jobParams = getBasePayload({
          headers: encryptedHeaders,
          fields: ['one', 'two'],
          searchRequest: { index: null, body: null },
        });

        ({ content, max_size_reached: maxSizeReached } = await runTask(
          'job123',
          jobParams,
          cancellationToken
        ));
      });

      it.skip(`shouldn't return max_size_reached`, function () {
        expect(maxSizeReached).toBe(false);
      });

      it.skip(`should return content`, function () {
        expect(content).toBe('one,two\n');
      });
    });

    describe('when the data exceeds the maxSizeBytes', function () {
      let content: string | null;
      let maxSizeReached: boolean | undefined;

      beforeEach(async function () {
        configGetStub.withArgs('csv', 'maxSizeBytes').returns(9);

        fetchStub.onFirstCall().returns({
          hits: {
            hits: [{ _source: { one: 'foo', two: 'bar' } }],
          },
          _scroll_id: 'scrollId',
        });

        const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
        const jobParams = getBasePayload({
          headers: encryptedHeaders,
          searchSource: { index: null, body: null },
        });

        ({ content, max_size_reached: maxSizeReached } = await runTask(
          'job123',
          jobParams,
          cancellationToken
        ));
      });

      it.skip(`should return max_size_reached`, function () {
        expect(maxSizeReached).toBe(true);
      });

      it.skip(`should return the headers in the content`, function () {
        expect(content).toBe('one,two\n');
      });
    });

    describe('when headers and data equal the maxSizeBytes', function () {
      let content: string | null;
      let maxSizeReached: boolean | undefined;

      beforeEach(async function () {
        mockReportingCore.getUiSettingsServiceFactory = () =>
          Promise.resolve((mockUiSettingsClient as unknown) as IUiSettingsClient);
        configGetStub.withArgs('csv', 'maxSizeBytes').returns(18);

        fetchStub.onFirstCall().returns({
          hits: {
            hits: [{ _source: { one: 'foo', two: 'bar' } }],
          },
          _scroll_id: 'scrollId',
        });

        const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
        const jobParams = getBasePayload({
          headers: encryptedHeaders,
          searchSource: { index: null, body: null },
        });

        ({ content, max_size_reached: maxSizeReached } = await runTask(
          'job123',
          jobParams,
          cancellationToken
        ));
      });

      it.skip(`shouldn't return max_size_reached`, async function () {
        expect(maxSizeReached).toBe(false);
      });

      it.skip('should return headers and data in content', function () {
        expect(content).toBe('one,two\nfoo,bar\n');
      });
    });
  });

  describe('scroll settings', function () {
    it.skip('passes scroll duration to initial search call', async function () {
      const scrollDuration = 'test';
      configGetStub.withArgs('csv', 'scroll').returns({ duration: scrollDuration });

      fetchStub.onFirstCall().returns({
        hits: {
          hits: [{}],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });

      await runTask('job123', jobParams, cancellationToken);

      const searchCall = fetchStub.firstCall;
      expect(searchCall.args[0]).toBe('search');
      expect(searchCall.args[1].scroll).toBe(scrollDuration);
    });

    it.skip('passes scroll size to initial search call', async function () {
      const scrollSize = 100;
      configGetStub.withArgs('csv', 'scroll').returns({ size: scrollSize });

      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });

      await runTask('job123', jobParams, cancellationToken);

      const searchCall = fetchStub.firstCall;
      expect(searchCall.args[0]).toBe('search');
      expect(searchCall.args[1].size).toBe(scrollSize);
    });

    it.skip('passes scroll duration to subsequent scroll call', async function () {
      const scrollDuration = 'test';
      configGetStub.withArgs('csv', 'scroll').returns({ duration: scrollDuration });

      fetchStub.onFirstCall().resolves({
        hits: {
          hits: [{}],
        },
        _scroll_id: 'scrollId',
      });

      const runTask = runTaskFnFactory(mockReportingCore, mockLogger);
      const jobParams = getBasePayload({
        headers: encryptedHeaders,
        searchSource: { index: null, body: null },
      });

      await runTask('job123', jobParams, cancellationToken);

      const scrollCall = fetchStub.secondCall;
      expect(scrollCall.args[0]).toBe('scroll');
      expect(scrollCall.args[1].scroll).toBe(scrollDuration);
    });
  });
});
