/*
 * Licensed to Elasticsearch B.V. under one or more contributor
 * license agreements. See the NOTICE file distributed with
 * this work for additional information regarding copyright
 * ownership. Elasticsearch B.V. licenses this file to you under
 * the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied.  See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import { BehaviorSubject } from 'rxjs';
import { ClusterClient } from './cluster_client';
import { ScopedClusterClient } from './scoped_cluster_client';
import { ElasticsearchConfig } from './elasticsearch_config';
import { ElasticsearchService, ElasticsearchServiceSetup } from './elasticsearch_service';

const createScopedClusterClientMock = (): jest.Mocked<PublicMethodsOf<ScopedClusterClient>> => ({
  callAsInternalUser: jest.fn(),
  callAsCurrentUser: jest.fn(),
});

const createClusterClientMock = (): jest.Mocked<PublicMethodsOf<ClusterClient>> => ({
  callAsInternalUser: jest.fn(),
  asScoped: jest.fn().mockImplementation(createScopedClusterClientMock),
  close: jest.fn(),
});

const createSetupContractMock = () => {
  const setupContract: jest.Mocked<ElasticsearchServiceSetup> = {
    legacy: {
      config$: new BehaviorSubject({} as ElasticsearchConfig),
    },

    createClient: jest.fn().mockImplementation(createClusterClientMock),
    adminClient$: new BehaviorSubject((createClusterClientMock() as unknown) as ClusterClient),
    dataClient$: new BehaviorSubject((createClusterClientMock() as unknown) as ClusterClient),
  };
  return setupContract;
};

type ElasticsearchServiceContract = PublicMethodsOf<ElasticsearchService>;
const createMock = () => {
  const mocked: jest.Mocked<ElasticsearchServiceContract> = {
    setup: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
  };
  mocked.setup.mockResolvedValue(createSetupContractMock());
  mocked.stop.mockResolvedValue();
  return mocked;
};

export const elasticsearchServiceMock = {
  create: createMock,
  createSetupContract: createSetupContractMock,
  createClusterClient: createClusterClientMock,
  createScopedClusterClient: createScopedClusterClientMock,
};
