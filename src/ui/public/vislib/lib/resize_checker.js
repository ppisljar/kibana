import ResizeObserver from 'resize-observer-polyfill';
import { uniqueId } from 'lodash';

import EventsProvider from 'ui/events';

export default function ResizeCheckerFactory(Private, Notifier) {
  const EventEmitter = Private(EventsProvider);

  return class ResizeChecker extends EventEmitter {
    constructor(el) {
      super();

      this._el = el;

      this._notify = new Notifier({
        location: `Vislib ResizeChecker ${uniqueId()}`
      });

      this._active = true;
      this._observer = new ResizeObserver(() => {
        if (this._active) this.emit('resize');
      });

      this._observer.observe(this._el);
    }

    /**
     *  Start listening to resize events on the element. If
     *  already listening then this is a noop.
     *
     *  @return {undefined}
     */
    start() {
      this._active = true;
    }

    /**
     *  Stop listening to resize events on the element. If
     *  not listening this is a noop.
     *
     *  @return {undefined}
     */
    stop() {
      this._active = false;
    }

    /**
    * Signal that the ResizeChecker should shutdown.
    *
    * Cleans up it's listeners and timers.
    *
    * @method destroy
    * @return {void}
    */
    destroy() {
      if (!this._observer) return;

      this._observer.disconnect();
      this._observer = null;
    }
  };
}
