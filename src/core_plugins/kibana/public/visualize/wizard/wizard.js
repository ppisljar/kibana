import 'plugins/kibana/visualize/saved_visualizations/saved_visualizations';
import 'ui/directives/saved_object_finder';
import 'ui/directives/paginated_selectable_list';
import 'plugins/kibana/discover/saved_searches/saved_searches';
import './wizard.less';

import _ from 'lodash';
import VisVisTypeProvider from 'ui/vis/vis_type';
import { DashboardConstants } from 'plugins/kibana/dashboard/dashboard_constants';
import { VisualizeConstants } from '../visualize_constants';
import routes from 'ui/routes';
import RegistryVisTypesProvider from 'ui/registry/vis_types';
import uiModules from 'ui/modules';
import visualizeWizardStep1Template from './step_1.html';
import visualizeWizardStep2Template from './step_2.html';

const module = uiModules.get('app/visualize', ['kibana/courier']);

/********
/** Wizard Step 1
/********/

// Redirect old route to new route.
routes.when('/visualize/step/1', {
  redirectTo: VisualizeConstants.WIZARD_STEP_1_PAGE_PATH,
});

routes.when(VisualizeConstants.WIZARD_STEP_1_PAGE_PATH, {
  template: visualizeWizardStep1Template,
  controller: 'VisualizeWizardStep1',
});

module.controller('VisualizeWizardStep1', function ($scope, $route, kbnUrl, timefilter, Private) {
  const VisType = Private(VisVisTypeProvider);

  const visTypeCategoryToHumanReadableMap = {
    [VisType.CATEGORY.BASIC]: 'Basic Charts',
    [VisType.CATEGORY.DATA]: 'Data',
    [VisType.CATEGORY.GRAPHIC]: 'Graphic',
    [VisType.CATEGORY.MAP]: 'Maps',
    [VisType.CATEGORY.OTHER]: 'Other',
    [VisType.CATEGORY.TIME]: 'Time Series',
  };

  timefilter.enabled = false;

  const addToDashMode = $route.current.params[DashboardConstants.ADD_VISUALIZATION_TO_DASHBOARD_MODE_PARAM];
  kbnUrl.removeParam(DashboardConstants.ADD_VISUALIZATION_TO_DASHBOARD_MODE_PARAM);

  const visTypes = Private(RegistryVisTypesProvider);

  const categoryToVisTypesMap = {};

  visTypes.forEach(visType => {
    const category = visType.category;

    if (!categoryToVisTypesMap[category]) {
      categoryToVisTypesMap[category] = {
        label: visTypeCategoryToHumanReadableMap[category],
        list: [],
      };
    }

    categoryToVisTypesMap[category].list.push(visType);

    categoryToVisTypesMap[category].list = _.sortBy(
      categoryToVisTypesMap[category].list,
      type => type.shortTitle || type.title
    );
  });

  const sortedVisTypeCategories = Object.values(categoryToVisTypesMap).sort((a, b) => {
    const other = VisType.CATEGORY.OTHER.toLowerCase();

    // Put "other" category at the end of the list.
    const labelA = a.label.toLowerCase();
    if (labelA === other) return 1;

    const labelB = b.label.toLowerCase();
    if (labelB === other) return -1;

    if (labelA < labelB) return -1;

    if (labelA > labelB) return 1;

    return 0;
  });

  function getVisTypeCategories() {
    const filteredVisTypeCategories = sortedVisTypeCategories.map(category => {
      const filteredVisTypes = category.list.filter(visType => {
        const title = visType.shortTitle || visType.title;
        return title.toLowerCase().includes($scope.searchTerm.toLowerCase().trim());
      });

      return {
        label: category.label,
        list: filteredVisTypes,
      };
    });

    return filteredVisTypeCategories.filter(category => category.list.length);
  }

  $scope.searchTerm = '';

  $scope.filteredVisTypeCategories = [];

  $scope.$watch('searchTerm', () => {
    $scope.filteredVisTypeCategories = getVisTypeCategories();
  });

  $scope.getVisTypeLabel = type => {
    if (type.shortTitle) {
      return type.shortTitle;
    }

    // Preserve BWC in case we're missing a short label.
    return type.title;
  };

  $scope.getVisTypeTooltip = type => {
    const prefix = type.isExperimental ? '(Experimental)' : '';

    if (type.shortDescription) {
      return `${prefix} ${type.shortDescription}`;
    }

    // Preserve BWC in case we're missing a short tooltip.
    return `${prefix} ${type.description}`;
  };

  $scope.getVisTypeTooltipPosition = index => {
    // Tooltips should appear on the bottom by default, unless they're on the last row. This is a
    // cheap workaround to automatically positioning the tooltip so that it won't disappear off
    // the edge of the screen.
    if (index === $scope.filteredVisTypeCategories.length - 1) {
      return 'top';
    }

    return 'bottom';
  };

  $scope.visTypeUrl = function (visType) {
    const baseUrl =
      visType.requiresSearch
      ? `#${VisualizeConstants.WIZARD_STEP_2_PAGE_PATH}?`
      : `#${VisualizeConstants.CREATE_PATH}?`;

    const params = [`type=${encodeURIComponent(visType.name)}`];

    if (addToDashMode) {
      params.push(DashboardConstants.ADD_VISUALIZATION_TO_DASHBOARD_MODE_PARAM);
    }

    return baseUrl + params.join('&');
  };
});

/********
/** Wizard Step 2
/********/

// Redirect old route to new route.
// NOTE: Accessing this route directly means the user has entered into the wizard UX without
// selecting a Visualization type in step 1. So we want to redirect them to step 1, not step 2.
routes.when('/visualize/step/2', {
  redirectTo: VisualizeConstants.WIZARD_STEP_1_PAGE_PATH,
});

routes.when(VisualizeConstants.WIZARD_STEP_2_PAGE_PATH, {
  template: visualizeWizardStep2Template,
  controller: 'VisualizeWizardStep2',
  resolve: {
    indexPatternIds: function (courier) {
      return courier.indexPatterns.getIds();
    }
  }
});

module.controller('VisualizeWizardStep2', function ($route, $scope, timefilter, kbnUrl) {
  const type = $route.current.params.type;
  const addToDashMode = $route.current.params[DashboardConstants.ADD_VISUALIZATION_TO_DASHBOARD_MODE_PARAM];
  kbnUrl.removeParam(DashboardConstants.ADD_VISUALIZATION_TO_DASHBOARD_MODE_PARAM);

  $scope.step2WithSearchUrl = function (hit) {
    if (addToDashMode) {
      return kbnUrl.eval(
        `#${VisualizeConstants.CREATE_PATH}` +
        `?type={{type}}&savedSearchId={{id}}` +
        `&${DashboardConstants.ADD_VISUALIZATION_TO_DASHBOARD_MODE_PARAM}`,
        { type: type, id: hit.id }
      );
    }

    return kbnUrl.eval(
      `#${VisualizeConstants.CREATE_PATH}?type={{type}}&savedSearchId={{id}}`,
      { type: type, id: hit.id }
    );
  };

  timefilter.enabled = false;

  $scope.indexPattern = {
    selection: null,
    list: $route.current.locals.indexPatternIds
  };

  $scope.makeUrl = function (pattern) {
    if (!pattern) return;

    if (addToDashMode) {
      return `#${VisualizeConstants.CREATE_PATH}` +
        `?${DashboardConstants.ADD_VISUALIZATION_TO_DASHBOARD_MODE_PARAM}` +
        `&type=${type}&indexPattern=${pattern}`;
    }

    return `#${VisualizeConstants.CREATE_PATH}?type=${type}&indexPattern=${pattern}`;
  };
});
