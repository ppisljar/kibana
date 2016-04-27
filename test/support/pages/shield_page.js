// in test/support/pages/shield_page.js
define(function (require) {
  var config = require('intern').config;
  var defaultTimeout = config.timeouts.findTimeout;

  // the page object is created as a constructor
  // so we can provide the remote Command object
  // at runtime
  function ShieldPage(remote) {
    this.remote = remote;
  }

  ShieldPage.prototype = {
    constructor: ShieldPage,

    login: function login(user, pwd) {
      var remote = this.remote;
      return remote.setFindTimeout(defaultTimeout)
      .findById('username')
      .type(user)
      .then(function () {
        return remote.findById('password')
        .type(pwd);
      })
      .then(function () {
        return remote.findByCssSelector('.btn')
        .click();
      });
    }


  };

  return ShieldPage;
});
