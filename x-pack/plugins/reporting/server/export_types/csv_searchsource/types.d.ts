/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License;
 * you may not use this file except in compliance with the Elastic License.
 */

import { BaseParams, BasePayload } from '../../types';
import { TimeRangeParams } from '../common';

export type RawValue = string | object | null | undefined;

interface BaseParamsCSV {
  timerange?: TimeRangeParams;
  searchSource: any;
}

export type JobParamsCSV = BaseParamsCSV & BaseParams;
export type TaskPayloadCSV = BaseParamsCSV & BasePayload;

export interface SavedSearchGeneratorResult {
  content: string;
  size: number;
  maxSizeReached: boolean;
  csvContainsFormulas?: boolean;
  warnings: string[];
}

export interface CsvResultFromSearch {
  type: string;
  result: SavedSearchGeneratorResult;
}
