/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import { i18n } from '@kbn/i18n';
import { ExpressionFunctionDefinition } from '../types';
import { Datatable } from '../..';

interface Arguments {
  name?: string;
}

export type ExpressionFunctionLogTableDefinition = ExpressionFunctionDefinition<
  'logTable',
  Datatable,
  Arguments,
  Datatable
>;

export const logTable: ExpressionFunctionLogTableDefinition = {
  name: 'logTable',
  help: i18n.translate('expressions.functions.logTable.help', {
    defaultMessage: 'Logs input table to inspector.',
  }),
  type: 'datatable',
  inputTypes: ['datatable'],
  args: {
    name: {
      types: ['string'],
      aliases: ['_'],
      required: false,
      help: i18n.translate('expressions.functions.var.name.help', {
        defaultMessage: 'Specify the name of the table.',
      }),
    },
  },
  fn(input, args, context) {
    const { inspectorAdapters } = context;

    if (input.type === 'datatable' && inspectorAdapters.tables) {
      inspectorAdapters.tables.logDatatable(args.name || 'default', input);
    }

    return input;
  },
};
