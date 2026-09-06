// Minimal jsdom environment for driving the REAL client modules in Node.
import { JSDOM } from 'jsdom';
import { MockWebSocket } from './harvest.mjs';

export let dom = null;

/**
 * Install a jsdom window as the global environment.
 *
 * @param {object} opts
 * @param {number} opts.width      viewport width (CSS px)
 * @param {number} opts.height     viewport height (CSS px)
 * @param {boolean} opts.touch     touch device (phone/tablet) vs desktop
 * @param {string} opts.orientationType  screen.orientation.type
 * @param {boolean} opts.standalone       installed PWA (display-mode: standalone)
 * @param {boolean|'reject'} opts.lock     screen.orientation.lock behaviour
 */
export function installDom({
  width = 844,
  height = 390,
  touch = true,
  orientationType = 'landscape-primary',
  standalone = false,
  lock = true,
  url = 'http://localhost:3000/harvest/TEST',
} = {}) {
  dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url,
    pretendToBeVisual: true,
  });
  const win = dom.window;

  setViewport(width, height);

  Object.defineProperty(win.navigator, 'maxTouchPoints', {
    writable: true, configurable: true, value: touch ? 5 : 0,
  });
  if (touch) win.ontouchstart = () => {};
  else delete win.ontouchstart;

  const lockCalls = [];
  win.screen.orientation = {
    type: orientationType,
    angle: orientationType.includes('landscape') ? 90 : 0,
    addEventListener: () => {},
    removeEventListener: () => {},
    lock: lock === false
      ? undefined
      : (mode) => {
          lockCalls.push(mode);
          if (lock === 'reject') {
            const err = new Error('lock refused');
            err.name = 'SecurityError';
            return Promise.reject(err);
          }
          if (lock === 'unsupported-mode') {
            const err = new Error('bad mode');
            err.name = 'NotSupportedError';
            return Promise.reject(err);
          }
          win.screen.orientation.type = String(mode).startsWith('landscape') ? 'landscape-primary' : 'portrait-primary';
          return Promise.resolve();
        },
    unlock: () => { lockCalls.push('unlock'); },
  };
  win.__lockCalls = lockCalls;

  win.matchMedia = (query) => {
    const q = String(query);
    let matches = false;
    if (q.includes('orientation: landscape')) matches = win.innerWidth >= win.innerHeight;
    else if (q.includes('display-mode: standalone')) matches = !!standalone;
    else if (q.includes('display-mode: fullscreen')) matches = false;
    else if (q.includes('display-mode: minimal-ui')) matches = false;
    else if (q.includes('prefers-color-scheme: dark')) matches = true;
    return {
      matches,
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };

  // Globals the client modules touch directly. (`navigator` is a read-only
  // getter on Node ≥ 21, so it needs defineProperty.)
  const define = (name, value) => {
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  };
  define('window', win);
  define('document', win.document);
  define('navigator', win.navigator);
  define('localStorage', win.localStorage);
  define('CustomEvent', win.CustomEvent);
  define('Event', win.Event);
  define('requestAnimationFrame', win.requestAnimationFrame.bind(win));
  define('cancelAnimationFrame', win.cancelAnimationFrame.bind(win));
  define('WebSocket', MockWebSocket);
  define('HTMLElement', win.HTMLElement);
  define('Element', win.Element);
  define('Node', win.Node);
  define('MouseEvent', win.MouseEvent);
  define('getComputedStyle', win.getComputedStyle.bind(win));
  define('VisualViewport', win.VisualViewport || class {});
  return win;
}

/** Resize/rotate the virtual viewport (also fires resize + orientationchange). */
export function setViewport(width, height, { fire = true } = {}) {
  const win = dom ? dom.window : globalThis.window;
  Object.defineProperty(win, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(win, 'innerHeight', { writable: true, configurable: true, value: height });
  Object.defineProperty(win.screen, 'width', { writable: true, configurable: true, value: width });
  Object.defineProperty(win.screen, 'height', { writable: true, configurable: true, value: height });
  if (win.screen?.orientation) {
    win.screen.orientation.type = width >= height ? 'landscape-primary' : 'portrait-primary';
    win.screen.orientation.angle = width >= height ? 90 : 0;
  }
  if (fire) {
    try { win.dispatchEvent(new win.Event('resize')); } catch {}
    try { win.dispatchEvent(new win.Event('orientationchange')); } catch {}
  }
}

export function setVisibility(state) {
  const doc = globalThis.document;
  Object.defineProperty(doc, 'visibilityState', { configurable: true, get: () => state });
  doc.dispatchEvent(new globalThis.window.Event('visibilitychange'));
}

/** Fake canvas host element with a measurable box. */
export function createHost(width = 844, height = 390) {
  const el = globalThis.document.createElement('div');
  el.getBoundingClientRect = () => ({ width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0 });
  Object.defineProperty(el, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => height });
  globalThis.document.body.appendChild(el);
  return el;
}
