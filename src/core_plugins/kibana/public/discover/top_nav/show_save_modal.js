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

import { SavedObjectSaveModal } from 'ui/saved_objects/components/saved_object_save_modal';
import React from 'react';
import ReactDOM from 'react-dom';

export function showSaveModal({ onSave, title, showCopyOnSave }) {
  const container = document.createElement('div');
  const closeModal = () => {
    ReactDOM.unmountComponentAtNode(container);
    document.body.removeChild(container);
  };

  const onSaveConfirmed = (...args) => {
    onSave(...args).then(({ id, error }) => {
      if (id || error) {
        closeModal();
      }
    });
  };
  document.body.appendChild(container);
  const element = (
    <SavedObjectSaveModal
      onSave={onSaveConfirmed}
      onClose={closeModal}
      title={title}
      showCopyOnSave={showCopyOnSave}
      objectType="search"
    />
  );
  ReactDOM.render(element, container);
}
