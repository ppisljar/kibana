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

import { SavedObject } from '../../../../../../plugins/saved_objects/public';
import { ISearchSource, AggConfigOptions } from '../../../../../../plugins/data/public';
import { SerializedVis, Vis, VisParams } from './vis';

export { Vis, SerializedVis, VisParams };

export interface VisualizationController {
  render(visData: any, visParams: any): Promise<void>;
  destroy(): void;
  isLoaded?(): Promise<void> | void;
}

export interface SavedVisState {
  type: string;
  params: VisParams;
  aggs: AggConfigOptions[];
}

export interface ISavedVis {
  title: string;
  description?: string;
  visState: SavedVisState;
  searchSource?: ISearchSource;
  uiStateJSON?: string;
  savedSearchRefName?: string;
  savedSearchId?: string;
}

// @ts-ignore-next-line
export interface VisSavedObject extends SavedObject, ISavedVis {}
