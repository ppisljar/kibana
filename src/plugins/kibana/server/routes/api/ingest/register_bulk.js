import { Promise } from 'bluebird';
import { parse, transform } from 'csv';
import _ from 'lodash';
import hi from 'highland';
import { patternToIngest } from '../../../../common/lib/convert_pattern_and_ingest_name';
import { PassThrough } from 'stream';
import bulkRequestSchema from '../../../lib/schemas/bulk_request_schema';

export function registerBulk(server) {
  server.route({
    path: '/api/kibana/{id}/_bulk',
    method: 'POST',
    config: {
      payload: {
        output: 'stream',
        maxBytes: 1024 * 1024 * 1024
      },
      validate: {
        payload: bulkRequestSchema
      }
    },
    handler: function (req, reply) {
      const boundCallWithRequest = _.partial(server.plugins.elasticsearch.callWithRequest, req);
      const indexPattern = req.params.id;
      const usePipeline = req.payload.pipeline;
      const csv = req.payload.csv;
      const fileName = csv.hapi.filename;
      const responseStream = new PassThrough();
      const parser = parse({
        columns: true,
        auto_parse: true,
        delimiter: _.get(req.payload, 'delimiter', ',')
      });

      let currentLine = 2; // Starts at 2 since we parse the header separately

      responseStream.write('[');
      csv.pipe(parser);

      hi(parser)
      .consume((err, doc, push, next) => {
        if (err) {
          push(err, null);
          next();
        }
        else if (doc === hi.nil) {
          // pass nil (end event) along the stream
          push(null, doc);
        }
        else {
          push(null, {index: {_id: `L${currentLine} - ${fileName}`}});
          push(null, doc);
          currentLine++;
          next();
        }
      })
      .batch(2000)
      .map((bulkBody) => {
        const bulkParams = {
          index: indexPattern,
          type: 'default',
          body: bulkBody
        };

        if (usePipeline) {
          bulkParams.pipeline = patternToIngest(indexPattern);
        }

        return hi(boundCallWithRequest('bulk', bulkParams));
      })
      .parallel(2)
      .map((response) => {
        return JSON.stringify(_.reduce(response.items, (memo, docResponse) => {
          const indexResult = docResponse.index;
          if (indexResult.error) {
            if (_.isUndefined(_.get(memo, 'errors.index'))) {
              _.set(memo, 'errors.index', []);
            }
            memo.errors.index.push(_.pick(indexResult, ['_id', 'error']));
          }
          else {
            memo.created++;
          }

          return memo;
        }, {created: 0}));
      })
      .stopOnError((err, push) => {
        push(null, JSON.stringify({created: 0, errors: {other: [err.message]}}));
      })
      .intersperse(',')
      .append(']')
      .pipe(responseStream);

      reply(responseStream).type('application/json');
    }
  });
}
