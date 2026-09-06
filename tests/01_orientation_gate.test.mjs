// SUITE 1 — ORIENTATION DETECTION, PWA DISPLAY MODE & LANDSCAPE LOCK.
//
// Drives the REAL src/harvest/orientation.ts (no emulation) in jsdom, including
// the React hooks (`useOrientation`, `useLandscapeLock`).
//
//   TEST A  mobile portrait → gate (or automatic lock when supported)
//   TEST B  mobile landscape → no gate, game can continue
//   TEST K  desktop → never gated, never locked
//   REQ 1/2 progressive-enhancement lock: manifest → lock() → gate fallback,
//           and NEVER `screen.orientation.unlock()`
import assert from 'assert';
import { loadTs, sleep, cleanBuildDir } from './helpers/harvest.mjs';
import { installDom, setViewport } from './helpers/dom.mjs';

console.log('--- TEST SUITE 1: ORIENTATION DETECTION, PWA MODE & LANDSCAPE LOCK ---');

cleanBuildDir();
installDom({ width: 844, height: 390, touch: true });

const ori = await loadTs('src/harvest/orientation.ts');
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function scenario({ width, height, touch = true, standalone = false, lock = true }) {
  installDom({ width, height, touch, standalone, lock });
  return {
    landscape: ori.isLandscapeDevice(),
    gate: ori.shouldGateOrientation(),
    device: ori.deviceClass(),
    mode: ori.displayMode(),
    pwa: ori.isStandalonePWA(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — device matrix: who is gated and who is not
// ─────────────────────────────────────────────────────────────────────────────
{
  // Phones, portrait (TEST A)
  for (const [w, h, name] of [[390, 844, 'iPhone 14'], [412, 915, 'Galaxy S20'], [430, 932, 'iPhone 14 Pro Max']]) {
    const s = scenario({ width: w, height: h });
    assert.strictEqual(s.landscape, false, `${name} portrait must not count as landscape`);
    assert.strictEqual(s.gate, true, `${name} portrait shows the fallback gate`);
    assert.strictEqual(s.device, 'phone', `${name} is a phone`);
  }

  // Phones, landscape (TEST B)
  for (const [w, h, name] of [[844, 390, 'iPhone 14'], [915, 412, 'Galaxy S20'], [932, 430, 'Pro Max']]) {
    const s = scenario({ width: w, height: h });
    assert.strictEqual(s.landscape, true, `${name} landscape is valid`);
    assert.strictEqual(s.gate, false, `${name} landscape never gates`);
  }

  // Tablets
  assert.strictEqual(scenario({ width: 1024, height: 768 }).gate, false, 'iPad landscape plays on');
  assert.strictEqual(scenario({ width: 768, height: 1024 }).gate, true, 'iPad portrait prefers landscape');
  assert.strictEqual(scenario({ width: 768, height: 1024 }).device, 'tablet');

  // Desktop (TEST K) — never gated, whatever the window shape
  assert.strictEqual(scenario({ width: 1920, height: 1080, touch: false }).gate, false);
  assert.strictEqual(scenario({ width: 1280, height: 720, touch: false }).gate, false);
  assert.strictEqual(scenario({ width: 800, height: 1200, touch: false }).gate, false, 'narrow desktop window is not gated');
  assert.strictEqual(scenario({ width: 1920, height: 1080, touch: false }).device, 'desktop');

  // Dimensions beat lying orientation APIs (installed PWAs report stale values)
  installDom({ width: 390, height: 844, touch: true, orientationType: 'landscape-primary' });
  assert.strictEqual(ori.isLandscapeDevice(), false, 'stale screen.orientation cannot unlock a portrait viewport');
  installDom({ width: 844, height: 390, touch: true, orientationType: 'portrait-primary' });
  assert.strictEqual(ori.isLandscapeDevice(), true, 'stale portrait report cannot gate a landscape viewport');

  // Square viewport falls back to matchMedia instead of guessing
  installDom({ width: 500, height: 500, touch: true });
  assert.strictEqual(typeof ori.isLandscapeDevice(), 'boolean');
  console.log('✔ PART 1 — phone/tablet/desktop matrix, dimensions-first detection');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — PWA / display-mode detection
// ─────────────────────────────────────────────────────────────────────────────
{
  assert.strictEqual(scenario({ width: 390, height: 844, standalone: true }).mode, 'standalone');
  assert.strictEqual(scenario({ width: 390, height: 844, standalone: true }).pwa, true);
  assert.strictEqual(scenario({ width: 390, height: 844 }).mode, 'browser');
  assert.strictEqual(scenario({ width: 390, height: 844 }).pwa, false);

  // Legacy iOS home-screen flag
  installDom({ width: 390, height: 844, touch: true });
  Object.defineProperty(globalThis.window.navigator, 'standalone', { configurable: true, value: true });
  assert.strictEqual(ori.isStandalonePWA(), true, 'iOS navigator.standalone detected');
  assert.strictEqual(ori.displayMode(), 'standalone');
  console.log('✔ PART 2 — installed PWA / fullscreen / browser detection');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — landscape lock as progressive enhancement (REQ 1, 2, 12)
// ─────────────────────────────────────────────────────────────────────────────
{
  // Android PWA: lock accepted → the OS rotates, no gate needed afterwards.
  installDom({ width: 390, height: 844, touch: true, standalone: true, lock: true });
  let res = await ori.requestLandscapeLock();
  assert.strictEqual(res.state, 'locked');
  assert.deepStrictEqual(globalThis.window.__lockCalls, ['landscape'], 'lock("landscape") requested once');
  assert.ok(!globalThis.window.__lockCalls.includes('unlock'), 'NEVER unlocks orientation');
  assert.strictEqual(ori.screenOrientationType(), 'landscape-primary', 'orientation API followed the lock');

  // Browser refuses (plain tab without fullscreen) → denied, gate remains, no throw.
  installDom({ width: 390, height: 844, touch: true, lock: 'reject' });
  res = await ori.requestLandscapeLock();
  assert.strictEqual(res.state, 'denied');
  assert.strictEqual(res.reason, 'SecurityError');
  assert.strictEqual(ori.shouldGateOrientation(), true, 'refused lock falls back to the gate');

  // Only knows concrete values → falls back to landscape-primary.
  installDom({ width: 390, height: 844, touch: true, lock: 'unsupported-mode' });
  globalThis.window.screen.orientation.lock = (mode) => {
    globalThis.window.__lockCalls.push(mode);
    if (mode === 'landscape') {
      const err = new Error('nope');
      err.name = 'NotSupportedError';
      return Promise.reject(err);
    }
    globalThis.window.screen.orientation.type = 'landscape-primary';
    return Promise.resolve();
  };
  res = await ori.requestLandscapeLock();
  assert.strictEqual(res.state, 'locked', 'falls back to landscape-primary');
  assert.deepStrictEqual(globalThis.window.__lockCalls, ['landscape', 'landscape-primary']);

  // No lock API at all (iOS Safari / Firefox) → unsupported, never a crash.
  installDom({ width: 390, height: 844, touch: true, lock: false });
  assert.strictEqual(ori.isOrientationLockSupported(), false);
  res = await ori.requestLandscapeLock();
  assert.strictEqual(res.state, 'unsupported');
  assert.strictEqual(ori.shouldGateOrientation(), true, 'gate is the fallback');

  // Desktop: never even asked (REQ 14).
  installDom({ width: 1920, height: 1080, touch: false, lock: true });
  res = await ori.requestLandscapeLock();
  assert.strictEqual(res.state, 'idle');
  assert.strictEqual(globalThis.window.__lockCalls.length, 0, 'desktop is never locked or unlocked');
  console.log('✔ PART 3 — lock accepted / denied / unsupported / desktop-skip, unlock never called');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — useOrientation reacts to real rotation events (TEST A/B/G)
// ─────────────────────────────────────────────────────────────────────────────
function renderProbe(hookFn) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  const state = { current: null };
  function Probe() {
    state.current = hookFn();
    return null;
  }
  act(() => { root.render(React.createElement(Probe)); });
  return {
    state,
    settle: async (ms = 140) => { await act(async () => { await sleep(ms); }); },
    unmount: () => act(() => root.unmount()),
  };
}

{
  installDom({ width: 390, height: 844, touch: true });
  const probe = renderProbe(() => ori.useOrientation());
  await probe.settle();
  assert.strictEqual(probe.state.current.orientationReady, true);
  assert.strictEqual(probe.state.current.isLandscape, false, 'portrait phone detected on mount');
  assert.strictEqual(probe.state.current.showGate, true, 'gate shown in portrait');
  assert.strictEqual(probe.state.current.device, 'phone');

  // Rotate to landscape → gate disappears (TEST B)
  await act(async () => { setViewport(844, 390); });
  await probe.settle();
  assert.strictEqual(probe.state.current.isLandscape, true, 'landscape detected after rotation');
  assert.strictEqual(probe.state.current.showGate, false, 'gate gone in landscape');

  // Rotate back and forth rapidly (TEST G) — state must always settle correctly
  for (const [w, h] of [[390, 844], [844, 390], [390, 844], [844, 390]]) {
    await act(async () => { setViewport(w, h); });
    await probe.settle(90);
    assert.strictEqual(probe.state.current.isLandscape, w > h, `settles at ${w}x${h}`);
  }
  probe.unmount();

  // Desktop never reports a gate, even in a tall window
  installDom({ width: 900, height: 1400, touch: false });
  const desk = renderProbe(() => ori.useOrientation());
  await desk.settle();
  assert.strictEqual(desk.state.current.showGate, false, 'desktop never gates');
  assert.strictEqual(desk.state.current.device, 'desktop');
  desk.unmount();
  console.log('✔ PART 4 — useOrientation reacts to rotation, desktop exempt');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — useLandscapeLock: automatic, bounded, never fatal
// ─────────────────────────────────────────────────────────────────────────────
{
  // Installed PWA on Android → automatic lock without any user interaction.
  installDom({ width: 390, height: 844, touch: true, standalone: true, lock: true });
  const probe = renderProbe(() => ori.useLandscapeLock(true));
  await probe.settle(120);
  assert.strictEqual(probe.state.current.lockState, 'locked', 'PWA auto-locks to landscape');
  assert.ok(globalThis.window.__lockCalls.includes('landscape'));
  probe.unmount();

  // Browser refuses → 'denied', the gate stays, nothing throws.
  installDom({ width: 390, height: 844, touch: true, lock: 'reject' });
  const denied = renderProbe(() => ori.useLandscapeLock(true));
  await denied.settle(120);
  assert.strictEqual(denied.state.current.lockState, 'denied');
  assert.strictEqual(denied.state.current.lockReason, 'SecurityError');
  denied.unmount();

  // Desktop → hook stays idle and never calls the API.
  installDom({ width: 1920, height: 1080, touch: false, lock: true });
  const desk = renderProbe(() => ori.useLandscapeLock(true));
  await desk.settle(120);
  assert.strictEqual(desk.state.current.lockState, 'idle', 'desktop never attempts a lock');
  assert.strictEqual(globalThis.window.__lockCalls.length, 0);
  desk.unmount();
  console.log('✔ PART 5 — useLandscapeLock: PWA auto-lock, graceful denial, desktop idle');
}

cleanBuildDir();
console.log('SUITE 1 PASSED!\n');
