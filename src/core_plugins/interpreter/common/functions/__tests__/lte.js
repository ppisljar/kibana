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
import { lte } from '../lte';
import { functionWrapper } from '../../../../../../packages/kbn-interpreter/common/__tests__/helpers/function_wrapper';

describe('lte', () => {
  const fn = functionWrapper(lte);

  it('should return false when the types are different', () => {
    expect(fn(1, { value: '1' })).to.be(false);
    expect(fn(true, { value: 'true' })).to.be(false);
    expect(fn(null, { value: 'null' })).to.be(false);
  });

  it('should return false when greater than', () => {
    expect(fn(2, { value: 1 })).to.be(false);
    expect(fn('foo', { value: 'bar' })).to.be(false);
    expect(fn(true, { value: false })).to.be(false);
  });

  it('should return true when less than or equal to', () => {
    expect(fn(1, { value: 2 })).to.be(true);
    expect(fn(2, { value: 2 })).to.be(true);
    expect(fn('bar', { value: 'foo' })).to.be(true);
    expect(fn('foo', { value: 'foo' })).to.be(true);
    expect(fn(false, { value: true })).to.be(true);
    expect(fn(true, { value: true })).to.be(true);
  });
});
