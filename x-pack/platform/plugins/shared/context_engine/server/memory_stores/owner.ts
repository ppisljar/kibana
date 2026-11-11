/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { createHash } from 'node:crypto';
import { errors } from '@elastic/elasticsearch';
import type { ElasticsearchClient, KibanaRequest } from '@kbn/core/server';
import {
  extractApiKeyIdFromAuthzHeader,
  type SecurityServiceStart,
} from '@kbn/core-security-server';
import { REALM_USER_ID_PREFIX, serviceAccountUserId } from '@kbn/agent-builder-common';

/** Who a session memory or transcript belongs to. Only its owner reads, recalls or deletes it. */
export interface MemoryOwner {
  /** Stable across sessions of the same user: the user profile uid when there is one. */
  id: string;
  username: string;
}

const resolveApiKeyOwnerProfileUid = async (
  request: KibanaRequest,
  esClient: ElasticsearchClient
): Promise<string | undefined> => {
  const id = extractApiKeyIdFromAuthzHeader(request.headers.authorization);
  if (!id) {
    return undefined;
  }
  try {
    const { api_keys: apiKeys } = await esClient.security.getApiKey({ id, with_profile_uid: true });
    return apiKeys?.[0]?.profile_uid;
  } catch (error) {
    if (
      error instanceof errors.ResponseError &&
      (error.statusCode === 403 || error.statusCode === 404)
    ) {
      return undefined;
    }
    throw error;
  }
};

/**
 * Resolves the owner of the request with the identity rules Agent Builder uses for conversation
 * owners: the user profile uid, the profile uid of an API key's creator, or the realm-qualified
 * username. A memory written over the API and one an agent writes for the same user share an owner.
 */
export const resolveMemoryOwner = async ({
  request,
  security,
  esClient,
}: {
  request: KibanaRequest;
  security: SecurityServiceStart;
  /** Scoped to the request. */
  esClient: ElasticsearchClient;
}): Promise<MemoryOwner> => {
  const user = security.authc.getCurrentUser(request);
  const username = user?.username ?? (await esClient.security.authenticate()).username;

  const principal = security.authc.getPrincipal(request);
  if (principal?.type === 'service_account') {
    return { id: serviceAccountUserId(principal.serviceAccountId), username };
  }

  const isApiKey = request.isFakeRequest || user?.authentication_type === 'api_key';
  const profileUid =
    user?.profile_uid ??
    (isApiKey ? await resolveApiKeyOwnerProfileUid(request, esClient) : undefined);
  if (profileUid) {
    return { id: profileUid, username };
  }

  const realm = user?.authentication_realm;
  return {
    id: `${REALM_USER_ID_PREFIX}${JSON.stringify([
      realm?.type ?? 'unknown',
      realm?.name ?? 'unknown',
      username,
    ])}`,
    username,
  };
};

/**
 * Document `_id` for a caller-chosen key. Hashing the space and owner in keeps two users' ids from
 * colliding and bounds the length whatever the key is.
 */
export const scopedDocumentId = (spaceId: string, owner: MemoryOwner, ...keys: string[]): string =>
  createHash('sha256')
    .update(JSON.stringify([spaceId, owner.id, ...keys]))
    .digest('hex');
