/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { Capabilities } from 'kibana/public';
import { uiSettingsServiceMock } from 'src/core/public/mocks';
import { createSearchSourceMock } from '../../../../data/common/search/search_source/mocks';
import { indexPatternMock } from '../../__mocks__/index_pattern';
import { getSharingData, showPublicUrlSwitch } from './get_sharing_data';

describe('getSharingData', () => {
  const uiSettings = uiSettingsServiceMock.createStartContract();
  test('returns valid data for sharing', async () => {
    const searchSourceMock = createSearchSourceMock({ index: indexPatternMock });
    const result = getSharingData({ searchSource: searchSourceMock } as any, uiSettings);
    expect(result).toMatchInlineSnapshot(`
      Object {
        "searchSource": Object {
          "fields": Array [
            "*",
          ],
          "index": "the-index-pattern-id",
        },
      }
    `);
  });

  test('searchSource fields come from savedSearch columns', () => {
    const searchSourceMock = createSearchSourceMock({ index: indexPatternMock });
    const result = getSharingData(
      {
        searchSource: searchSourceMock,
        columns: ['alpha', 'beta', 'cigna'],
      } as any,
      uiSettings
    );
    expect(result).toMatchInlineSnapshot(`
      Object {
        "searchSource": Object {
          "fields": Array [
            "alpha",
            "beta",
            "cigna",
          ],
          "index": "the-index-pattern-id",
        },
      }
    `);
  });

  test('searchSource fields default to `all`', () => {
    const searchSourceMock = createSearchSourceMock({ index: indexPatternMock });
    const result = getSharingData(
      {
        searchSource: searchSourceMock,
        columns: [],
      } as any,
      uiSettings
    );
    expect(result).toMatchInlineSnapshot(`
      Object {
        "searchSource": Object {
          "fields": Array [
            "*",
          ],
          "index": "the-index-pattern-id",
        },
      }
    `);
  });

  test('searchSource fields default to `all`, with [_source]', () => {
    const searchSourceMock = createSearchSourceMock({ index: indexPatternMock });
    const result = getSharingData(
      {
        searchSource: searchSourceMock,
        columns: ['_source'],
      } as any,
      uiSettings
    );
    expect(result).toMatchInlineSnapshot(`
      Object {
        "searchSource": Object {
          "fields": Array [
            "*",
          ],
          "index": "the-index-pattern-id",
        },
      }
    `);
  });
});

describe('showPublicUrlSwitch', () => {
  test('returns false if "discover" app is not available', () => {
    const anonymousUserCapabilities: Capabilities = {
      catalogue: {},
      management: {},
      navLinks: {},
    };
    const result = showPublicUrlSwitch(anonymousUserCapabilities);

    expect(result).toBe(false);
  });

  test('returns false if "discover" app is not accessible', () => {
    const anonymousUserCapabilities: Capabilities = {
      catalogue: {},
      management: {},
      navLinks: {},
      discover: {
        show: false,
      },
    };
    const result = showPublicUrlSwitch(anonymousUserCapabilities);

    expect(result).toBe(false);
  });

  test('returns true if "discover" app is not available an accessible', () => {
    const anonymousUserCapabilities: Capabilities = {
      catalogue: {},
      management: {},
      navLinks: {},
      discover: {
        show: true,
      },
    };
    const result = showPublicUrlSwitch(anonymousUserCapabilities);

    expect(result).toBe(true);
  });
});
