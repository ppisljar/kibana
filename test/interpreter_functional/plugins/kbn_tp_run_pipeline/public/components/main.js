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

import React from 'react';
import {
  EuiPage,
  EuiPageBody,
  EuiPageContent,
  EuiPageContentHeader,
} from '@elastic/eui';

import { RequestAdapter } from 'ui/inspector/adapters/request';
import { DataAdapter } from 'ui/inspector/adapters/data';
import { runPipeline } from 'ui/visualize/loader/pipeline_helpers';

// todo: registries must be taken out of package
import { registries } from '@kbn/interpreter/public';

class Main extends React.Component {

  chartDiv = React.createRef();
  exprDiv = React.createRef();

  constructor(props) {
    super(props);

    window.runPipeline = async (expression, context = {}, initialContext = {}) => {
      const adapters = {
        requests: new RequestAdapter(),
        data: new DataAdapter(),
      };
      console.log('running expression', expression);
      this.exprDiv.innerText = expression;
      return await runPipeline(expression, context, {
        inspectorAdapters: adapters,
        getInitialContext: () => initialContext,
      });
    };

    window.renderPipelineResponse = async (context = {}) => {
      if (context.type !== 'render') {
        this.exprDiv.innerText = 'Expression did not return render type!\n\n' + JSON.stringify(context);
        return;
      }
      const renderer = registries.renderers.get(context.as);
      if (!renderer) {
        this.exprDiv.innerText = 'Renderer was not found in registry!\n\n' + JSON.stringify(context);
        return;
      }

      renderer.render(this.chartDiv, context.value, {
        onDestroy: () => { return; },
      });
    };

  }


  render() {
    const pStyle = {
      display: 'flex',
      width: '100%',
      height: '300px'
    };

    return (
      <EuiPage>
        <EuiPageBody>
          <EuiPageContent>
            <EuiPageContentHeader>
              runPipeline tests are running ...
            </EuiPageContentHeader>
            <div ref={ref => this.exprDiv = ref} />
            <div ref={ref => this.chartDiv = ref} style={pStyle}/>
          </EuiPageContent>
        </EuiPageBody>
      </EuiPage>
    );
  }
}

export { Main };
