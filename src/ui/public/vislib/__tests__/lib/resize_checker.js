import $ from 'jquery';
import { delay, fromNode } from 'bluebird';
import expect from 'expect.js';
import sinon from 'auto-release-sinon';

import ngMock from 'ng_mock';
import ResizeCheckerProvider from '../../lib/resize_checker';
import EventsProvider from 'ui/events';
import NoDigestPromises from 'test_utils/no_digest_promises';

const once = (emitter, event, handler) => {
  const onceHandler = () => {
    try {
      handler();
    } finally {
      emitter.off(event, onceHandler);
    }
  };

  emitter.on(event, onceHandler);
};

describe('Vislib Resize Checker', () => {
  NoDigestPromises.activateForSuite();

  const teardown = [];
  let setup;

  beforeEach(ngMock.module('kibana'));
  beforeEach(ngMock.inject(($injector) => {
    setup = () => {
      const Private = $injector.get('Private');
      const ResizeChecker = Private(ResizeCheckerProvider);
      const EventEmitter = Private(EventsProvider);

      const el = $('<div>').appendTo('body').get(0);
      teardown.push(() => $(el).remove());

      const checker = new ResizeChecker(el);
      teardown.push(() => checker.destroy());

      return { EventEmitter, el, checker };
    };
  }));

  afterEach(() => {
    teardown.splice(0).forEach(fn => {
      fn();
    });
  });

  describe('events', () => {
    it('is an event emitter', () => {
      const { checker, EventEmitter } = setup();

      expect(checker).to.be.a(EventEmitter);
    });

    it('emits a "resize" event when the el is resized', async () => {
      const { checker, el } = setup();

      const emit = fromNode(cb => once(checker, 'resize', cb));
      $(el).height(100);
      await emit;
    });
  });

  describe('#start()', () => {
    it('restarts event emitting', async () => {
      const { checker, el } = setup();

      checker.stop();
      checker.start();

      const emit = fromNode(cb => once(checker, 'resize', cb));
      $(el).height(100);
      await emit;
    });
  });

  describe('#stop()', () => {
    it('stops events emitting', async () => {
      const { checker, el } = setup();

      checker.stop();

      const stub = sinon.stub();
      once(checker, 'resize', stub);
      $(el).height(100);
      await delay(1000);
      sinon.assert.notCalled(stub);
    });
  });

  describe('#destroy()', () => {
    it('destroys internal observer instance', () => {
      const { checker } = setup();
      checker.destroy();
      expect(checker).to.have.property('_observer', null);
    });
  });
});
