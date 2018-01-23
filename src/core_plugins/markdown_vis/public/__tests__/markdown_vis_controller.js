import ngMock from 'ng_mock';
import expect from 'expect.js';
import $ from 'jquery';

describe('markdown vis controller', function () {
  let $scope;

  const applyChanges = () => {
    $scope.updateStatus.params = true;
    $scope.renderComplete = () => {};
    $scope.$digest();
  };

  beforeEach(ngMock.module('kibana/markdown_vis'));
  beforeEach(ngMock.inject(function ($rootScope, $controller) {
    $scope = $rootScope.$new();
    $scope.updateStatus = {};
    $scope.vis = { params: {} };
    $scope.renderComplete = () => {};
    const $element = $('<div>');
    $controller('KbnMarkdownVisController', { $scope, $element });
    $scope.$digest();
  }));

  it('should set html from markdown params', function () {
    expect($scope).to.not.have.property('html');
    $scope.vis.params.markdown = 'This is a test of the [markdown](http://daringfireball.net/projects/markdown) vis.';
    applyChanges();

    expect($scope).to.have.property('html');
    expect($scope.html.toString().indexOf('<a href')).to.be.greaterThan(-1);
  });
});
