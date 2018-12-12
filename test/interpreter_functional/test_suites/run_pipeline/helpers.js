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

import expect from 'expect.js';

export const expectExpressionProvider = ({ getService, updateBaselines }) => {
  const browser = getService('browser');
  const screenshot = getService('screenshots');
  const snapshots = getService('snapshots');
  const log = getService('log');

  return (name, expression, context = {}, initialContext = {}) => {
    log.debug(`executing expression ${expression}`);
    const steps = expression.split('|'); // todo: we should actually use interpreter parser and get the ast
    let responsePromise;

    const handler = {
      toReturn: async result => {
        const pipelineResponse = await handler.getResponse();
        expect(pipelineResponse).to.eql(result);
      },
      getResponse: () => {
        if (!responsePromise) responsePromise = handler.runExpression();
        return responsePromise;
      },
      runExpression: async (step, stepContext) => {
        log.debug(`running expression ${step || expression}`);
        const promise = browser.executeAsync((expression, context, initialContext, done) => {
          window.runPipeline(expression, context, initialContext).then(result => {
            done(result);
          });
        }, step || expression, stepContext || context, initialContext);
        return await promise;
      },
      stepsToMatchSnapshot: async () => {
        let lastResponse;
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          lastResponse = await handler.runExpression(step, lastResponse);
          const diff = await snapshots.compareAgainstBaseline(name + i, lastResponse, updateBaselines);
          expect(diff).to.be.lessThan(0.05);
        }
        if (!lastResponse) {
          responsePromise = new Promise(resolve => {
            resolve(lastResponse);
          });
        }
      },
      toMatchSnapshot: async () => {
        const pipelineResponse = await handler.getResponse();
        const diff = await snapshots.compareAgainstBaseline(name, pipelineResponse, updateBaselines);
        expect(diff).to.be.lessThan(0.05);
      },
      toMatchScreenshot: async () => {
        const pipelineResponse = await handler.getResponse();
        await browser.executeAsync((context, done) => {
          window.renderPipelineResponse(context).then(result => {
            done(result);
          });
        }, pipelineResponse);

        const percentDifference = await screenshot.compareAgainstBaseline(name, updateBaselines);
        expect(percentDifference).to.be.lessThan(0.05);
      }
    };

    return handler;
  };
};
