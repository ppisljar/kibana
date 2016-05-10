import url from 'url';
import ScenarioManager from '../fixtures/scenario_manager';
import Common from './pages/common';
import DiscoverPage from './pages/discover_page';
import SettingsPage from './pages/settings_page';
import HeaderPage from './pages/header_page';
import VisualizePage from './pages/visualize_page';
import ShieldPage from './pages/shield_page';
import ConsolePage from './pages/console_page';

const kbnInternVars = global.__kibana__intern__;

exports.bdd = kbnInternVars.bdd;
exports.intern = kbnInternVars.intern;
exports.config = exports.intern.config;
exports.defaultTimeout = exports.config.defaultTimeout;
exports.defaultFindTimeout = exports.config.defaultFindTimeout;
exports.scenarioManager = new ScenarioManager(url.format(exports.config.servers.elasticsearch));

defineDelayedExport('remote', (suite) => suite.remote);
defineDelayedExport('common', () => new Common());
defineDelayedExport('discoverPage', () => new DiscoverPage());
defineDelayedExport('headerPage', () => new HeaderPage());
defineDelayedExport('settingsPage', () => new SettingsPage());
defineDelayedExport('visualizePage', () => new VisualizePage());
defineDelayedExport('shieldPage', () => new ShieldPage());
defineDelayedExport('consolePage', () => new ConsolePage());

// creates an export for values that aren't actually avaialable until
// until tests start to run. These getters will throw errors if the export
// is accessed before it's available, hopefully making debugging easier.
// Once the first before() handler is called the onEarliestBefore() handlers
// will fire and rewrite all of these exports to be their correct value.
function defineDelayedExport(name, define) {
  Object.defineProperty(exports, name, {
    configurable: true,
    get() {
      throw new TypeError(
        'remote is not available until tests start to run. Move your ' +
        'usage of the import inside a test setup hook or a test itself.'
      );
    }
  });

  kbnInternVars.onEarliestBefore(function () {
    Object.defineProperty(exports, name, {
      value: define(this),
    });
  });
}
