/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { UseMutationOptions, UseMutationResult } from 'react-query';
import { useMutation } from 'react-query';
import type { IHttpFetchError } from '@kbn/core-http-browser';
import type {
  HostIsolationRequestBody,
  HostIsolationResponse,
} from '../../../../common/endpoint/types';
import { unIsolateHost } from '../../../common/lib/endpoint_isolation';

/**
 * Create host release requests
 * @param customOptions
 */
export const useSendReleaseEndpointRequest = (
  customOptions?: UseMutationOptions<
    HostIsolationResponse,
    IHttpFetchError,
    HostIsolationRequestBody
  >
): UseMutationResult<HostIsolationResponse, IHttpFetchError, HostIsolationRequestBody> => {
  return useMutation<HostIsolationResponse, IHttpFetchError, HostIsolationRequestBody>(
    (releaseData: HostIsolationRequestBody) => {
      return unIsolateHost(releaseData);
    },
    customOptions
  );
};
