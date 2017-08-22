import _ from 'lodash';
import { AggTypesBucketsBucketAggTypeProvider } from 'ui/agg_types/buckets/_bucket_agg_type';
import { VisAggConfigProvider } from 'ui/vis/agg_config';
import precisionTemplate from 'ui/agg_types/controls/precision.html';
import { geohashColumns } from 'ui/utils/decode_geo_hash';
import { geoContains, scaleBounds } from 'ui/utils/geo_utils';

export function AggTypesBucketsGeoHashProvider(Private, config) {
  const BucketAggType = Private(AggTypesBucketsBucketAggTypeProvider);
  const AggConfig = Private(VisAggConfigProvider);

  const defaultPrecision = 2;
  const maxPrecision = parseInt(config.get('visualization:tileMap:maxPrecision'), 10) || 12;
  /**
   * Map Leaflet zoom levels to geohash precision levels.
   * The size of a geohash column-width on the map should be at least `minGeohashPixels` pixels wide.
   */
  const zoomPrecision = {};
  const minGeohashPixels = 16;
  for (let zoom = 0; zoom <= 21; zoom += 1) {
    const worldPixels = 256 * Math.pow(2, zoom);
    zoomPrecision[zoom] = 1;
    for (let precision = 2; precision <= maxPrecision; precision += 1) {
      const columns = geohashColumns(precision);
      if ((worldPixels / columns) >= minGeohashPixels) {
        zoomPrecision[zoom] = precision;
      } else {
        break;
      }
    }
  }

  function getPrecision(precision) {

    precision = parseInt(precision, 10);

    if (isNaN(precision)) {
      precision = defaultPrecision;
    }

    if (precision > maxPrecision) {
      return maxPrecision;
    }

    return precision;
  }

  function isOutsideCollar(bounds, collar) {
    return bounds && collar && !geoContains(collar, bounds);
  }

  function getZoomLevel(vis) {
    const savedMapZoom = vis.params.mapZoom;
    const zoomFromUiState = vis.hasUiState() ? parseInt(vis.getUiState().get('mapZoom')) : null;
    return zoomFromUiState || savedMapZoom || vis.type.visConfig.defaults.mapZoom;
  }

  return new BucketAggType({
    name: 'geohash_grid',
    title: 'Geohash',
    params: [
      {
        name: 'field',
        filterFieldTypes: 'geo_point'
      },
      {
        name: 'autoPrecision',
        default: true,
        write: _.noop
      },
      {
        name: 'isFilteredByCollar',
        default: true,
        write: _.noop
      },
      {
        name: 'useGeocentroid',
        default: true,
        write: _.noop
      },
      {
        name: 'mapZoom',
        write: _.noop
      },
      {
        name: 'mapCenter',
        write: _.noop
      },
      {
        name: 'precision',
        editor: precisionTemplate,
        default: defaultPrecision,
        deserialize: getPrecision,
        controller: function () {
        },
        write: function (aggConfig, output) {
          const vis = aggConfig.vis;
          let currZoom;
          if (vis.hasUiState()) {
            currZoom = parseInt(vis.uiStateVal('mapZoom'), 10);
          }
          const autoPrecisionVal = zoomPrecision[currZoom >= 0 ? currZoom : parseInt(vis.params.mapZoom)];
          output.params.precision = aggConfig.params.autoPrecision ? autoPrecisionVal : getPrecision(aggConfig.params.precision);
        }
      }
    ],
    getRequestAggs: function (agg) {
      const aggs = [];

      if (agg.params.isFilteredByCollar && agg.getField()) {
        const vis = agg.vis;
        const mapBounds = vis.sessionState.mapBounds;
        const mapZoom = getZoomLevel(vis);
        if (mapBounds && mapZoom) {
          const lastMapCollar = vis.sessionState.mapCollar;
          let mapCollar;
          if (!lastMapCollar || lastMapCollar.zoom !== mapZoom || isOutsideCollar(mapBounds, lastMapCollar)) {
            mapCollar = scaleBounds(mapBounds);
            mapCollar.zoom = mapZoom;
          } else {
            mapCollar = lastMapCollar;
          }
          const boundingBox = {};
          delete mapCollar.zoom; // zoom is not part of bounding box filter
          boundingBox[agg.getField().name] = mapCollar;
          vis.sessionState.mapCollar = mapCollar;
          aggs.push(new AggConfig(agg.vis, {
            type: 'filter',
            id: 'filter_agg',
            enabled:true,
            params: {
              geo_bounding_box: boundingBox
            },
            schema: {
              group: 'buckets'
            }
          }));
        }
      }

      aggs.push(agg);

      if (agg.params.useGeocentroid) {
        aggs.push(new AggConfig(agg.vis, {
          type: 'geo_centroid',
          enabled:true,
          params: {
            field: agg.getField()
          },
          schema: 'metric'
        }));
      }

      return aggs;
    }
  });
}
