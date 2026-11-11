/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { errors } from '@elastic/elasticsearch';
import type { SecurityServiceStart } from '@kbn/core-security-server';
import { httpServerMock } from '@kbn/core/server/mocks';
import { elasticsearchClientMock } from '@kbn/core-elasticsearch-client-server-mocks';
import { resolveMemoryOwner, scopedDocumentId } from './owner';

const securityWith = ({
  user,
  principal = null,
}: {
  user: Record<string, unknown> | null;
  principal?: Record<string, unknown> | null;
}) =>
  ({
    authc: {
      getCurrentUser: jest.fn().mockReturnValue(user),
      getPrincipal: jest.fn().mockReturnValue(principal),
    },
  } as unknown as SecurityServiceStart);

describe('resolveMemoryOwner', () => {
  const esClient = elasticsearchClientMock.createScopedClusterClient().asCurrentUser;

  beforeEach(() => jest.clearAllMocks());

  it('uses the user profile uid', async () => {
    const owner = await resolveMemoryOwner({
      request: httpServerMock.createKibanaRequest(),
      security: securityWith({ user: { username: 'jdoe', profile_uid: 'u_profile' } }),
      esClient,
    });
    expect(owner).toEqual({ id: 'u_profile', username: 'jdoe' });
  });

  it("uses an API key creator's profile uid", async () => {
    esClient.security.getApiKey.mockResolvedValue({
      api_keys: [{ id: 'key-id', profile_uid: 'u_creator' }],
    } as never);
    const owner = await resolveMemoryOwner({
      request: httpServerMock.createKibanaRequest({
        headers: { authorization: `ApiKey ${Buffer.from('key-id:secret').toString('base64')}` },
      }),
      security: securityWith({ user: { username: 'jdoe', authentication_type: 'api_key' } }),
      esClient,
    });
    expect(esClient.security.getApiKey).toHaveBeenCalledWith({
      id: 'key-id',
      with_profile_uid: true,
    });
    expect(owner).toEqual({ id: 'u_creator', username: 'jdoe' });
  });

  it('falls back to the realm-qualified username when the key lookup is forbidden', async () => {
    esClient.security.getApiKey.mockRejectedValue(
      new errors.ResponseError({
        statusCode: 403,
        body: {},
        headers: {},
        meta: {} as never,
        warnings: [],
      })
    );
    const owner = await resolveMemoryOwner({
      request: httpServerMock.createKibanaRequest({
        headers: { authorization: `ApiKey ${Buffer.from('key-id:secret').toString('base64')}` },
      }),
      security: securityWith({
        user: {
          username: 'jdoe',
          authentication_type: 'api_key',
          authentication_realm: { type: '_es_api_key', name: '_es_api_key' },
        },
      }),
      esClient,
    });
    expect(owner).toEqual({ id: 'realm:["_es_api_key","_es_api_key","jdoe"]', username: 'jdoe' });
  });

  it('keeps users of different realms apart', async () => {
    const native = await resolveMemoryOwner({
      request: httpServerMock.createKibanaRequest(),
      security: securityWith({
        user: { username: 'jdoe', authentication_realm: { type: 'native', name: 'native1' } },
      }),
      esClient,
    });
    const file = await resolveMemoryOwner({
      request: httpServerMock.createKibanaRequest(),
      security: securityWith({
        user: { username: 'jdoe', authentication_realm: { type: 'file', name: 'file1' } },
      }),
      esClient,
    });
    expect(native.id).not.toBe(file.id);
  });

  it('identifies service accounts by account', async () => {
    const owner = await resolveMemoryOwner({
      request: httpServerMock.createKibanaRequest(),
      security: securityWith({
        user: { username: 'elastic/kibana' },
        principal: { type: 'service_account', serviceAccountId: 'elastic/kibana' },
      }),
      esClient,
    });
    expect(owner.username).toBe('elastic/kibana');
    expect(owner.id).toContain('elastic/kibana');
  });
});

describe('scopedDocumentId', () => {
  const owner = { id: 'u1', username: 'jdoe' };

  it('is stable for the same space, owner and keys', () => {
    expect(scopedDocumentId('default', owner, 'm1')).toBe(scopedDocumentId('default', owner, 'm1'));
  });

  it('differs across owners, spaces and keys', () => {
    const ids = new Set([
      scopedDocumentId('default', owner, 'm1'),
      scopedDocumentId('default', { id: 'u2', username: 'jdoe' }, 'm1'),
      scopedDocumentId('other', owner, 'm1'),
      scopedDocumentId('default', owner, 'm2'),
      scopedDocumentId('default', owner, 'm', '1'),
    ]);
    expect(ids.size).toBe(5);
  });
});
