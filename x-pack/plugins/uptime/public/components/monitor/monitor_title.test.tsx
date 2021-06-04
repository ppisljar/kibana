/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React from 'react';
import moment from 'moment';
import { screen } from '@testing-library/react';
import { render } from '../../lib/helper/rtl_helpers';
import * as reactRouterDom from 'react-router-dom';
import { Ping } from '../../../common/runtime_types';
import { MonitorPageTitle } from './monitor_title';

jest.mock('react-router-dom', () => {
  const originalModule = jest.requireActual('react-router-dom');

  return {
    ...originalModule,
    useParams: jest.fn(),
  };
});

export function mockReactRouterDomHooks({ useParamsResponse }: { useParamsResponse: any }) {
  jest.spyOn(reactRouterDom, 'useParams').mockReturnValue(useParamsResponse);
}

describe('MonitorTitle component', () => {
  const monitorName = 'sample monitor';
  const defaultMonitorId = 'always-down';
  const defaultMonitorIdEncoded = 'YWx3YXlzLWRvd24'; // resolves to always-down
  const autoGeneratedMonitorIdEncoded = 'YXV0by1pY21wLTBYMjQ5NDhGNDY3QzZDNEYwMQ'; // resolves to auto-icmp-0X24948F467C6C4F01

  const defaultMonitorStatus: Ping = {
    docId: 'few213kl',
    timestamp: moment(new Date()).subtract(15, 'm').toString(),
    monitor: {
      duration: {
        us: 1234567,
      },
      id: defaultMonitorId,
      status: 'up',
      type: 'http',
    },
    url: {
      full: 'https://www.elastic.co/',
    },
  };

  const defaultBrowserMonitorStatus: Ping = {
    docId: 'few213kl',
    timestamp: moment(new Date()).subtract(15, 'm').toString(),
    monitor: {
      duration: {
        us: 1234567,
      },
      id: 'browser',
      status: 'up',
      type: 'browser',
    },
    url: {
      full: 'https://www.elastic.co/',
    },
  };

  const monitorStatusWithName: Ping = {
    ...defaultMonitorStatus,
    monitor: {
      ...defaultMonitorStatus.monitor,
      name: monitorName,
    },
  };

  beforeEach(() => {
    mockReactRouterDomHooks({ useParamsResponse: { monitorId: defaultMonitorIdEncoded } });
  });

  it('renders the monitor heading and EnableMonitorAlert toggle', () => {
    render(<MonitorPageTitle />, {
      state: { monitorStatus: { status: monitorStatusWithName, loading: false } },
    });
    expect(screen.getByRole('heading', { level: 1, name: monitorName })).toBeInTheDocument();
    expect(screen.getByTestId('uptimeDisplayDefineConnector')).toBeInTheDocument();
  });

  it('renders the user provided monitorId when the name is not present', () => {
    mockReactRouterDomHooks({ useParamsResponse: { monitorId: defaultMonitorIdEncoded } });
    render(<MonitorPageTitle />, {
      state: { monitorStatus: { status: defaultMonitorStatus, loading: false } },
    });
    expect(screen.getByRole('heading', { level: 1, name: defaultMonitorId })).toBeInTheDocument();
  });

  it('renders the url when the monitorId is auto generated and the monitor name is not present', () => {
    mockReactRouterDomHooks({ useParamsResponse: { monitorId: autoGeneratedMonitorIdEncoded } });
    render(<MonitorPageTitle />, {
      state: { monitorStatus: { status: defaultMonitorStatus, loading: false } },
    });
    expect(
      screen.getByRole('heading', { level: 1, name: defaultMonitorStatus.url?.full })
    ).toBeInTheDocument();
  });

  it('renders beta disclaimer for synthetics monitors', () => {
    render(<MonitorPageTitle />, {
      state: { monitorStatus: { status: defaultBrowserMonitorStatus, loading: false } },
    });
    const betaLink = screen.getByRole('link', {
      name: 'See more External link (opens in a new tab or window)',
    }) as HTMLAnchorElement;
    expect(betaLink).toBeInTheDocument();
    expect(betaLink.href).toBe('https://www.elastic.co/what-is/synthetic-monitoring');
    expect(screen.getByText('Browser (BETA)')).toBeInTheDocument();
  });
});
