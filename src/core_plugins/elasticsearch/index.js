import { trim, trimRight, bindKey, get } from 'lodash';
import { methodNotAllowed } from 'boom';

import healthCheck from './lib/health_check';
import { createDataCluster } from './lib/create_data_cluster';
import { createAdminCluster } from './lib/create_admin_cluster';
import { clientLogger } from './lib/client_logger';
import { createClusters } from './lib/create_clusters';
import filterHeaders from './lib/filter_headers';

import createProxy, { createPath } from './lib/create_proxy';

const DEFAULT_REQUEST_HEADERS = [ 'authorization' ];

module.exports = function ({ Plugin }) {
  return new Plugin({
    require: ['kibana'],

    config(Joi) {
      const { array, boolean, number, object, string, ref } = Joi;

      return object({
        enabled: boolean().default(true),
        url: string().uri({ scheme: ['http', 'https'] }).default('http://localhost:9200'),
        preserveHost: boolean().default(true),
        username: string(),
        password: string(),
        shardTimeout: number().default(0),
        requestTimeout: number().default(30000),
        requestHeadersWhitelist: array().items().single().default(DEFAULT_REQUEST_HEADERS),
        customHeaders: object().default({}),
        pingTimeout: number().default(ref('requestTimeout')),
        startupTimeout: number().default(5000),
        logQueries: boolean().default(false),
        ssl: object({
          verify: boolean().default(true),
          ca: array().single().items(string()),
          cert: string(),
          key: string()
        }).default(),
        apiVersion: Joi.string().default('master'),
        healthCheck: object({
          delay: number().default(2500)
        }).default(),
        tribe: object({
          url: string().uri({ scheme: ['http', 'https'] }),
          preserveHost: boolean().default(true),
          username: string(),
          password: string(),
          shardTimeout: number().default(0),
          requestTimeout: number().default(30000),
          requestHeadersWhitelist: array().items().single().default(DEFAULT_REQUEST_HEADERS),
          customHeaders: object().default({}),
          pingTimeout: number().default(ref('requestTimeout')),
          startupTimeout: number().default(5000),
          logQueries: boolean().default(false),
          ssl: object({
            verify: boolean().default(true),
            ca: array().single().items(string()),
            cert: string(),
            key: string()
          }).default(),
          apiVersion: Joi.string().default('master'),
        }).default()
      }).default();
    },

    uiExports: {
      injectDefaultVars(server, options) {
        return {
          esRequestTimeout: options.requestTimeout,
          esShardTimeout: options.shardTimeout,
          esApiVersion: options.apiVersion,
          esDataIsTribe: get(options, 'tribe.url') ? true : false,
        };
      }
    },

    init(server, options) {
      const kibanaIndex = server.config().get('kibana.index');
      const clusters = createClusters(server);

      server.expose('getCluster', clusters.get);
      server.expose('createCluster', clusters.create);

      server.expose('filterHeaders', filterHeaders);
      server.expose('ElasticsearchClientLogging', clientLogger(server));

      createDataCluster(server);
      createAdminCluster(server);

      createProxy(server, 'GET', '/{paths*}');
      createProxy(server, 'POST', '/_mget');
      createProxy(server, 'POST', '/{index}/_search');
      createProxy(server, 'POST', '/{index}/_field_stats');
      createProxy(server, 'POST', '/_msearch');
      createProxy(server, 'POST', '/_search/scroll');

      function noBulkCheck({ path }, reply) {
        if (/\/_bulk/.test(path)) {
          return reply({
            error: 'You can not send _bulk requests to this interface.'
          }).code(400).takeover();
        }
        return reply.continue();
      }

      function noDirectIndex({ path }, reply) {
        const requestPath = trimRight(trim(path), '/');
        const matchPath = createPath('/elasticsearch', kibanaIndex);

        if (requestPath === matchPath) {
          return reply(methodNotAllowed('You cannot modify the primary kibana index through this interface.'));
        }

        reply.continue();
      }

      // These routes are actually used to deal with things such as managing
      // index patterns and advanced settings, but since hapi treats route
      // wildcards as zero-or-more, the routes also match the kibana index
      // itself. The client-side kibana code does not deal with creating nor
      // destroying the kibana index, so we limit that ability here.
      createProxy(
        server,
        ['PUT', 'POST', 'DELETE'],
        `/${kibanaIndex}/{paths*}`,
        {
          pre: [ noDirectIndex, noBulkCheck ]
        }
      );

      // Set up the health check service and start it.
      const { start, waitUntilReady } = healthCheck(this, server);
      server.expose('waitUntilReady', waitUntilReady);
      start();
    }
  });

};
