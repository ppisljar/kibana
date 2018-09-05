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

import { CATEGORY } from '../vis_category';
import _ from 'lodash';

export class BaseVisType {
  constructor(opts = {}) {

    if (!opts.name) {
      throw('vis_type must define its name');
    }
    if (!opts.title) {
      throw('vis_type must define its title');
    }
    if (!opts.description) {
      throw('vis_type must define its description');
    }
    if (!opts.icon && !opts.image && !opts.legacyIcon) {
      throw('vis_type must define its icon or image');
    }
    if (!opts.visualization) {
      throw('vis_type must define visualization controller');
    }

    const _defaults = {
      // name, title, description, icon, image
      category: CATEGORY.OTHER,
      visualization: null,       // must be a class with render/resize/destroy methods
      visConfig: {
        defaults: {},            // default configuration
      },
      requestHandler: 'courier',    // select one from registry or pass a function
      responseHandler: 'tabify',
      editor: 'default',
      editorConfig: {
        collections: {},         // collections used for configuration (list of positions, ...)
      },
      options: {                // controls the visualize editor
        showTimePicker: true,
        showQueryBar: true,
        showFilterBar: true,
        showIndexSelection: true,
        hierarchicalData: false  // we should get rid of this i guess ?
      },
      stage: 'production',
      feedbackMessage: ''
    };

    _.defaultsDeep(this, opts, _defaults);

    this.requiresSearch = this.requestHandler !== 'none';
  }

  shouldMarkAsExperimentalInUI() {
    //we are not making a distinction in the UI if a plugin is experimental and/or labs.
    //we just want to indicate it is special. the current flask icon is sufficient for that.
    return this.stage === 'experimental' || this.stage === 'lab';
  }

  get schemas() {
    if (this.editorConfig && this.editorConfig.schemas) {
      return this.editorConfig.schemas;
    }
    return [];
  }
}
