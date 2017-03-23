import KibanaMapLayer from './kibana_map_layer';
import _ from 'lodash';
import { EventEmitter } from 'events';
import Heatmap from './heatmap';
import ScaledCircles from './scaled_circles';
import ShadedCircles from './shaded_circles';
import GeohashGrid from './geohash_grid';

export default class GeohashLayer extends KibanaMapLayer {

  constructor(featureCollection, options, zoom, kibanaMap) {

    super();

    this._geohashGeoJson = featureCollection;
    this._geohashOptions = options;
    this._zoom = zoom;
    this._kibanaMap = kibanaMap;

    this._createGeohashMarkers();
  }

  _createGeohashMarkers() {
    const markerOptions = {
      valueFormatter: this._geohashOptions.valueFormatter,
      tooltipFormatter: this._geohashOptions.tooltipFormatter
    };
    switch (this._geohashOptions.mapType) {
      case 'Scaled Circle Markers':
        this._geohashMarkers = new ScaledCircles(this._geohashGeoJson, markerOptions, this._zoom, this._kibanaMap);
        break;
      case 'Shaded Circle Markers':
        this._geohashMarkers = new ShadedCircles(this._geohashGeoJson, markerOptions, this._zoom, this._kibanaMap);
        break;
      case 'Shaded Geohash Grid':
        this._geohashMarkers = new GeohashGrid(this._geohashGeoJson, markerOptions, this._zoom, this._kibanaMap);
        break;
      case 'Heatmap':
        this._geohashMarkers = new Heatmap(this._geohashGeoJson, {
          radius: +this._geohashOptions.heatmap.heatRadius,
          blur: +this._geohashOptions.heatmap.heatBlur,
          maxZoom: +this._geohashOptions.heatmap.heatMaxZoom,
          minOpaxity: +this._geohashOptions.heatmap.heatMinOpacity,
          heatNormalizeData: this._geohashOptions.heatmap.heatNormalizeData,
          tooltipFormatter: this._geohashOptions.tooltipFormatter
        }, this._zoom, this._kibanaMap);
        break;
      default:
        throw new Error(`${this._geohashOptions.mapType} mapType not recognized`);

    }

    this._geohashMarkers.on('showTooltip', (event) => this.emit('showTooltip', event));
    this._geohashMarkers.on('hideTooltip', (event) => this.emit('hideTooltip', event));
    this._leafletLayer = this._geohashMarkers.getLeafletLayer();
  }

  appendLegendContents(jqueryDiv) {
    return this._geohashMarkers.appendLegendContents(jqueryDiv);
  }

  movePointer(...args) {
    this._geohashMarkers.movePointer(...args);
  }

  mapDragged() {
    //this removal is required to trigger the bounds filter again
    this._kibanaMap.removeLayer(this);
    this._createGeohashMarkers();
    this._kibanaMap.addLayer(this);
  }


  isReusable(options) {

    if (_.isEqual(this._geohashOptions, options)) {
      return true;
    }

    if (this._geohashOptions.mapType !== options.mapType) {
      return false;
    } else if (this._geohashOptions.mapType === 'Heatmap' && !_.isEqual(this._geohashOptions.heatmap, options)) {
      return false;
    } else {
      return true;
    }
  }
}



