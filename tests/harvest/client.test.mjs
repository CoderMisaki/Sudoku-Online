// Client logic suite (jsdom): orientation detection layers + InputManager.
// These are the two modules the landscape bug and the stuck-input bugs live in,
// so they are tested directly rather than only through the browser.
//
// Run: node tests/harvest/client.test.mjs
import { JSDOM } from 'jsdom';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const results = [];
async function test(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  ✅ ${name}`); }
  catch (e) { results.push({ name, ok: false, err: e.message }); console.log(`  ❌ ${name} — ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m); }
void register; void pathToFileURL;

const ROOT = path.resolve('src/harvest');

/** Compile a TS module to CJS and evaluate it in the current (jsdom-backed) realm. */
function loadTs(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', js)(mod, mod.exports, () => ({}));
  return mod.exports;
}

/** Install a fresh jsdom with a controllable viewport / orientation. */
function setupDom({ width, height, coarse, orientationType }) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  const w = dom.window;
  Object.defineProperty(w, 'innerWidth', { value: width, writable: true, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: height, writable: true, configurable: true });
  Object.defineProperty(w.navigator, 'maxTouchPoints', { value: coarse ? 5 : 0, configurable: true });
  w.matchMedia = (q) => ({
    matches:
      q.includes('pointer: coarse') ? !!coarse :
      q.includes('orientation: landscape') ? w.innerWidth > w.innerHeight :
      q.includes('orientation: portrait') ? w.innerHeight > w.innerWidth : false,
    media: q,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
    onchange: null, dispatchEvent: () => false,
  });
  if (orientationType) {
    Object.defineProperty(w.screen, 'orientation', {
      value: { type: orientationType, addEventListener() {}, removeEventListener() {} },
      configurable: true,
    });
  }
  if (coarse) w.ontouchstart = null;

  // Node >=20 defines a read-only global `navigator`, so assign via defineProperty.
  const setGlobal = (k, v) => Object.defineProperty(globalThis, k, { value: v, writable: true, configurable: true });
  setGlobal('window', w);
  setGlobal('document', w.document);
  setGlobal('navigator', w.navigator);
  setGlobal('screen', w.screen);
  setGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(Date.now()), 0));
  setGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
  setGlobal('KeyboardEvent', w.KeyboardEvent);
  setGlobal('Event', w.Event);
  return w;
}

console.log('\n▶ Orientation detection');

await test('desktop (non-touch) is always landscape, even in a tall window', () => {
  setupDom({ width: 600, height: 1000, coarse: false });
  const { isLandscapeDevice, classifyDevice } = loadTs('orientation.ts');
  assert(isLandscapeDevice() === true, 'a narrow desktop window must never gate the game');
  assert(classifyDevice(600, 1000) === 'desktop', 'non-touch must classify as desktop');
});

await test('touch device in portrait geometry reports portrait', () => {
  setupDom({ width: 390, height: 844, coarse: true, orientationType: 'portrait-primary' });
  const { isLandscapeDevice } = loadTs('orientation.ts');
  assert(isLandscapeDevice() === false, 'portrait phone should not be landscape');
});

await test('touch device in landscape geometry reports landscape', () => {
  setupDom({ width: 844, height: 390, coarse: true, orientationType: 'landscape-primary' });
  const { isLandscapeDevice } = loadTs('orientation.ts');
  assert(isLandscapeDevice() === true, 'landscape phone must be landscape');
});

await test('geometry wins when screen.orientation is stale (the core rotate bug)', () => {
  // The device HAS rotated (geometry is landscape) but screen.orientation still
  // says portrait — exactly the iOS/Android race that left players stuck.
  setupDom({ width: 844, height: 390, coarse: true, orientationType: 'portrait-primary' });
  const { isLandscapeDevice } = loadTs('orientation.ts');
  assert(isLandscapeDevice() === true, 'stale screen.orientation must not block a rotated device');
});

await test('geometry wins when matchMedia is stale', () => {
  setupDom({ width: 844, height: 390, coarse: true });
  global.window.matchMedia = (q) => ({
    matches: q.includes('pointer: coarse') ? true : false, // claims NOT landscape
    media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  });
  const { isLandscapeDevice } = loadTs('orientation.ts');
  assert(isLandscapeDevice() === true, 'stale matchMedia must not block a rotated device');
});

await test('device classification: mobile vs tablet vs desktop', () => {
  setupDom({ width: 844, height: 390, coarse: true });
  const { classifyDevice } = loadTs('orientation.ts');
  assert(classifyDevice(844, 390) === 'mobile', '844×390 should be mobile');
  assert(classifyDevice(390, 844) === 'mobile', 'rotating must not change the class');
  assert(classifyDevice(1024, 768) === 'tablet', '1024×768 should be tablet');
  assert(classifyDevice(1280, 800) === 'tablet', '1280×800 touch should be tablet');
});

await test('observer emits a STABLE snapshot object (no React render loop)', async () => {
  const w = setupDom({ width: 844, height: 390, coarse: true });
  const { orientationObserver } = loadTs('orientation.ts');
  let notifications = 0;
  const unsub = orientationObserver.subscribe(() => { notifications++; });
  const a = orientationObserver.getSnapshot();
  const b = orientationObserver.getSnapshot();
  assert(a === b, 'getSnapshot must be referentially stable — otherwise React renders forever');

  // A resize that changes nothing must not notify.
  w.dispatchEvent(new w.Event('resize'));
  await new Promise((r) => setTimeout(r, 250));
  assert(notifications === 0, `no-op resize notified ${notifications} times (render loop risk)`);

  // A real rotation must notify exactly once.
  Object.defineProperty(w, 'innerWidth', { value: 390, writable: true, configurable: true });
  Object.defineProperty(w, 'innerHeight', { value: 844, writable: true, configurable: true });
  w.dispatchEvent(new w.Event('resize'));
  await new Promise((r) => setTimeout(r, 300));
  assert(notifications === 1, `rotation notified ${notifications} times (expected 1)`);
  assert(orientationObserver.getSnapshot().landscape === false, 'snapshot did not update after rotation');
  unsub();
});

await test('observer detaches all listeners when the last subscriber leaves', () => {
  const w = setupDom({ width: 844, height: 390, coarse: true });
  const { orientationObserver } = loadTs('orientation.ts');
  const added = [];
  const removed = [];
  const origAdd = w.addEventListener.bind(w);
  const origRemove = w.removeEventListener.bind(w);
  w.addEventListener = (t, f, o) => { added.push(t); origAdd(t, f, o); };
  w.removeEventListener = (t, f, o) => { removed.push(t); origRemove(t, f, o); };
  const un1 = orientationObserver.subscribe(() => {});
  const un2 = orientationObserver.subscribe(() => {});
  const afterSubscribe = added.length;
  un1(); un2();
  assert(afterSubscribe > 0, 'no listeners attached');
  assert(removed.length >= afterSubscribe, `leak: attached ${afterSubscribe}, removed ${removed.length}`);
});

await test('two subscribers share ONE set of DOM listeners (no duplicates)', () => {
  const w = setupDom({ width: 844, height: 390, coarse: true });
  const { orientationObserver } = loadTs('orientation.ts');
  const counts = {};
  const origAdd = w.addEventListener.bind(w);
  w.addEventListener = (t, f, o) => { counts[t] = (counts[t] || 0) + 1; origAdd(t, f, o); };
  const un1 = orientationObserver.subscribe(() => {});
  const un2 = orientationObserver.subscribe(() => {});
  const un3 = orientationObserver.subscribe(() => {});
  assert((counts.resize || 0) === 1, `resize attached ${counts.resize} times (expected 1)`);
  un1(); un2(); un3();
});

console.log('\n▶ InputManager');

function freshInput() {
  setupDom({ width: 1280, height: 720, coarse: false });
  const { InputManager } = loadTs('input.ts');
  const im = new InputManager();
  im.attach();
  return { im, w: global.window };
}
function key(w, type, code) {
  w.dispatchEvent(new w.KeyboardEvent(type, { code, key: code, bubbles: true }));
}

await test('WASD produces the correct unified frame', () => {
  const { im, w } = freshInput();
  key(w, 'keydown', 'KeyW');
  assert(im.frame.up === true && im.frame.y > 0, 'W should move up');
  key(w, 'keydown', 'KeyD');
  assert(im.frame.right === true && im.frame.x > 0, 'D should move right');
  // Diagonal must be normalised, not 1.41 long.
  assert(Math.abs(Math.hypot(im.frame.x, im.frame.y) - 1) < 0.01, 'diagonal not normalised');
  key(w, 'keyup', 'KeyW'); key(w, 'keyup', 'KeyD');
  assert(im.frame.magnitude === 0, 'frame not cleared on keyup');
  im.detach();
});

await test('arrow keys produce the same frame as WASD', () => {
  const { im, w } = freshInput();
  key(w, 'keydown', 'ArrowUp');
  assert(im.frame.up === true, 'ArrowUp should move up');
  key(w, 'keyup', 'ArrowUp');
  key(w, 'keydown', 'ArrowLeft');
  assert(im.frame.left === true && im.frame.x < 0, 'ArrowLeft should move left');
  key(w, 'keyup', 'ArrowLeft');
  assert(im.frame.magnitude === 0, 'not cleared');
  im.detach();
});

await test('Shift sets sprint', () => {
  const { im, w } = freshInput();
  key(w, 'keydown', 'ShiftLeft');
  assert(im.frame.sprint === true, 'shift should sprint');
  key(w, 'keyup', 'ShiftLeft');
  assert(im.frame.sprint === false, 'sprint stuck');
  im.detach();
});

await test('key repeat does not corrupt state', () => {
  const { im, w } = freshInput();
  key(w, 'keydown', 'KeyW');
  for (let i = 0; i < 20; i++) {
    w.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyW', repeat: true, bubbles: true }));
  }
  assert(im.frame.up === true, 'repeat broke the frame');
  key(w, 'keyup', 'KeyW');
  assert(im.frame.up === false, 'single keyup must release a repeated key');
  im.detach();
});

await test('window blur clears every held key (stuck-key root cause)', () => {
  const { im, w } = freshInput();
  key(w, 'keydown', 'KeyW');
  key(w, 'keydown', 'KeyD');
  key(w, 'keydown', 'ShiftLeft');
  w.dispatchEvent(new w.Event('blur'));
  assert(im.frame.up === false && im.frame.right === false && im.frame.sprint === false, 'keys stuck after blur');
  assert(im.frame.magnitude === 0, 'magnitude stuck after blur');
  im.detach();
});

await test('tab hidden clears held keys', () => {
  const { im, w } = freshInput();
  key(w, 'keydown', 'KeyS');
  Object.defineProperty(w.document, 'hidden', { get: () => true, configurable: true });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  assert(im.frame.down === false, 'keys stuck after the tab was hidden');
  im.detach();
});

await test('typing in an input never moves the player', () => {
  const { im, w } = freshInput();
  const field = w.document.createElement('input');
  w.document.body.appendChild(field);
  field.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }));
  field.dispatchEvent(new w.KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }));
  assert(im.frame.magnitude === 0, 'typing moved the player');
  im.detach();
});

await test('joystick: dead zone, analog magnitude and direction', () => {
  const { im } = freshInput();
  im.setJoystick(0.05, 0.05);
  assert(im.frame.magnitude === 0, 'dead zone not applied');

  im.setJoystick(0, 1);
  assert(Math.abs(im.frame.magnitude - 1) < 0.01, `full tilt should be magnitude 1, got ${im.frame.magnitude}`);
  assert(im.frame.up === true, 'full up not detected');

  im.setJoystick(0, 0.55);
  assert(im.frame.magnitude > 0.2 && im.frame.magnitude < 0.9, `half tilt magnitude out of range: ${im.frame.magnitude}`);

  im.setJoystick(-1, 0);
  assert(im.frame.left === true && im.frame.x < -0.9, 'left tilt wrong');

  im.releaseJoystick();
  assert(im.frame.magnitude === 0, 'joystick not released');
  im.detach();
});

await test('joystick overrides keyboard while engaged, keyboard resumes after', () => {
  const { im, w } = freshInput();
  key(w, 'keydown', 'KeyW');
  im.setJoystick(1, 0);
  assert(im.frame.right === true && im.frame.up === false, 'joystick should win while engaged');
  im.releaseJoystick();
  assert(im.frame.up === true, 'keyboard should resume after the stick is released');
  key(w, 'keyup', 'KeyW');
  im.detach();
});

await test('suppression (menu open) stops movement but keeps keys tracked', () => {
  const { im, w } = freshInput();
  key(w, 'keydown', 'KeyW');
  im.setSuppressed(true);
  assert(im.frame.magnitude === 0, 'movement not suppressed while a menu is open');
  im.setSuppressed(false);
  assert(im.frame.up === true, 'key state lost through suppression');
  key(w, 'keyup', 'KeyW');
  im.detach();
});

await test('action shortcuts fire once and unsubscribe cleanly', () => {
  const { im, w } = freshInput();
  const seen = [];
  const off = im.onAction((a) => seen.push(a));
  key(w, 'keydown', 'KeyI');
  key(w, 'keydown', 'KeyM');
  key(w, 'keydown', 'Escape');
  assert(seen.includes('inventory'), 'I → inventory missing');
  assert(seen.includes('map'), 'M → map missing');
  assert(seen.includes('close'), 'Escape → close missing');
  off();
  const before = seen.length;
  key(w, 'keydown', 'KeyI');
  assert(seen.length === before, 'listener still firing after unsubscribe (leak)');
  im.detach();
});

await test('quick slots 1-8 dispatch the right index', () => {
  const { im, w } = freshInput();
  const idx = [];
  im.onQuickSlot((i) => idx.push(i));
  key(w, 'keydown', 'Digit1');
  key(w, 'keydown', 'Digit5');
  assert(idx[0] === 0 && idx[1] === 4, `wrong indices: ${idx}`);
  im.detach();
});

await test('detach removes all DOM listeners (no leak)', () => {
  setupDom({ width: 1280, height: 720, coarse: false });
  const { InputManager } = loadTs('input.ts');
  const w = global.window;
  const added = [], removed = [];
  const oa = w.addEventListener.bind(w), orm = w.removeEventListener.bind(w);
  w.addEventListener = (t, f, o) => { added.push(t); oa(t, f, o); };
  w.removeEventListener = (t, f, o) => { removed.push(t); orm(t, f, o); };
  const im = new InputManager();
  im.attach();
  im.detach();
  for (const t of added) {
    assert(removed.includes(t), `listener "${t}" was never removed`);
  }
});

await test('double attach does not register duplicate listeners', () => {
  setupDom({ width: 1280, height: 720, coarse: false });
  const { InputManager } = loadTs('input.ts');
  const w = global.window;
  const counts = {};
  const oa = w.addEventListener.bind(w);
  w.addEventListener = (t, f, o) => { counts[t] = (counts[t] || 0) + 1; oa(t, f, o); };
  const im = new InputManager();
  im.attach(); im.attach(); im.attach();
  assert(counts.keydown === 1, `keydown attached ${counts.keydown} times`);
  im.detach();
});

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
console.log(`\n${'─'.repeat(60)}`);
console.log(`  ${passed}/${results.length} passed`);
if (failed.length) {
  console.log('\nFailures:');
  for (const f of failed) console.log(`  ❌ ${f.name}\n     ${f.err}`);
}
console.log('');
process.exit(failed.length ? 1 : 0);
