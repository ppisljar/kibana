const $ = require('jquery');
if (window) window.jQuery = $;
require('flot-charts/jquery.flot');
require('flot-charts/jquery.flot.time');
require('flot-charts/jquery.flot.canvas');
require('flot-charts/jquery.flot.symbol');
require('flot-charts/jquery.flot.crosshair');
require('flot-charts/jquery.flot.selection');
require('flot-charts/jquery.flot.pie');
require('flot-charts/jquery.flot.stack');
require('flot-charts/jquery.flot.threshold');
require('flot-charts/jquery.flot.fillbetween');
module.exports = $;
