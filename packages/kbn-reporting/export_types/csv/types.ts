/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import type { CustomRequestHandlerContext } from '@kbn/core-http-request-handler-context-server';
import { ReportingServerPluginSetup } from '@kbn/reporting-server';

/**
 * Needed because of CsvSearchSourceImmediateExportType
 * @internal
 */
export type ReportingRequestHandlerContext = CustomRequestHandlerContext<{
  reporting: ReportingServerPluginSetup | null;
}>;
