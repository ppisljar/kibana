import { VisResponseHandlersRegistryProvider } from 'ui/registry/vis_response_handlers';

const SeriesResponseHandlerProvider = function () {
  return {
    name: 'series_data',
    handler: (vis, esResponse) => {

      const getSeries = (data) => {
        data.map((agg) => {
          if (agg.buckets) {
            return getSeries(agg.buckets);
          }

        });
      };

      const series = getSeries(esResponse.aggregations);

      return Promise.resolve(series);
    }
  };
};

VisResponseHandlersRegistryProvider.register(SeriesResponseHandlerProvider);

export { SeriesResponseHandlerProvider };
