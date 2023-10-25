/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { FiltersIndexPatternColumn } from "@kbn/lens-plugin/public";

export const getFiltersColumn = ({
                                       options,
                                   }: {
    options?: FiltersIndexPatternColumn['params'];
}): FiltersIndexPatternColumn => {
    const { filters = [], ...params } = options ?? {};
    return {
      label: `Filters`,
      dataType: 'number',
      operationType: 'filters',
      scale: 'ordinal',
      isBucketed: true,
      params: {
        filters,
        ...params,
      },
    };
};
