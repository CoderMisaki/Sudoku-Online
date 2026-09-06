// SUITE 10 — ORIENTATION / LOADING / RECONNECT OVERLAY UI.
//
// Renders the REAL src/harvest/Screens.tsx in jsdom and asserts:
//   REQ 10/11  strictly MONOCHROME (no emerald/green/gradient/neon), driven by
//              the project's existing theme tokens so dark AND light mode work
//   REQ 4/9    correct copy per state, retry always available, reload only when
//              the session actually FAILED
import assert from 'assert';
import fs from 'node:fs';
import path from 'node:path';
import { loadTs, cleanBuildDir, ROOT } from './helpers/harvest.mjs';
import { installDom } from './helpers/dom.mjs';

console.log('--- TEST SUITE 10: OVERLAY UI (MONOCHROME THEME + COPY) ---');

// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — PWA / deep-link wiring + no-unlock, no-automatic-reload guarantees
// ─────────────────────────────────────────────────────────────────────────────
{
  const repo = ROOT; // helpers' ROOT is the repository root
  const read = (rel) => fs.readFileSync(path.join(repo, rel), 'utf8');

  const manifest = JSON.parse(read('public/manifest.harvest.json'));
  assert.strictEqual(manifest.orientation, 'landscape', 'harvest manifest locks the install to landscape');
  assert.strictEqual(manifest.display, 'standalone', 'harvest manifest installs standalone');
  assert.strictEqual(manifest.start_url, '/harvest', 'harvest manifest start_url');

  const harvestLayout = read('src/app/harvest/layout.tsx');
  assert.ok(harvestLayout.includes('/manifest.harvest.json'), 'harvest layout overrides the manifest link');
  assert.ok(harvestLayout.includes("width: 'device-width'"), 'game viewport is device-width');
  assert.ok(harvestLayout.includes('userScalable: false'), 'game viewport disables pinch-zoom');
  // Safe: the HUD already pads itself with env(safe-area-inset-*).
  assert.ok(harvestLayout.includes("viewportFit: 'cover'"), 'game viewport is full-bleed');

  const harvestPage = read('src/app/harvest/page.tsx');
  assert.ok(harvestPage.includes('/?game=harvest'), 'harvest shell deep-links the lobby');

  const lobby = read('src/app/page.tsx');
  assert.ok(lobby.includes("get('game') === 'harvest'"), 'lobby honors ?game=harvest');
  assert.ok(lobby.includes("setJoinGameType('harvest')"), 'lobby preselects the harvest join flow');

  const hud = read('src/harvest/Hud.tsx');
  assert.ok(hud.includes("status === 'recovering'"), 'HUD reconnect badge covers the recovering status');

  // Structural guarantees across the whole client source.
  const files = [
    'src/harvest/orientation.ts',
    'src/harvest/session.ts',
    'src/harvest/sync.ts',
    'src/harvest/Screens.tsx',
    'src/harvest/HarvestMoonGame.tsx',
  ];
  const stripComments = (src) => src
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
    .join('\n');
  for (const rel of files) {
    const src = stripComments(read(rel));
    assert.ok(!src.includes('orientation.unlock()'), `${rel} never unlocks the orientation`);
    if (rel.endsWith('session.ts') || rel.endsWith('sync.ts') || rel.endsWith('orientation.ts')) {
      assert.ok(!src.includes('location.reload'), `${rel} never reloads as a recovery mechanism`);
    }
  }

  console.log('✔ PART 5 — PWA wiring, no unlock(), no automatic reload');
}

cleanBuildDir();
installDom({ width: 390, height: 844, touch: true });

const Screens = await loadTs('src/harvest/Screens.tsx');
const { connectionOverlay } = await loadTs('src/harvest/overlay.ts');
const React = (await import('react')).default;
const { act } = await import('react');
const { createRoot } = await import('react-dom/client');
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function render(element) {
  const container = globalThis.document.createElement('div');
  globalThis.document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(element); });
  return {
    container,
    html: () => container.innerHTML,
    text: () => container.textContent || '',
    query: (sel) => container.querySelector(sel),
    all: (sel) => Array.from(container.querySelectorAll(sel)),
    unmount: () => act(() => root.unmount()),
  };
}
const el = (type, props) => React.createElement(type, props);

// Colour words that must never appear in these system overlays.
const FORBIDDEN = [
  'emerald', 'green', 'lime', 'teal', 'amber', 'yellow', 'orange', 'red-', 'pink',
  'violet', 'fuchsia', 'purple', 'indigo', 'sky-', 'blue-', 'cyan', 'rose-',
  'gradient', 'neon', 'shadow-[0_0_',
];
// Theme tokens that must be used instead (dark + light both resolve through them).
const REQUIRED_TOKENS = ['bg-background', 'text-foreground', 'border-border', 'bg-card', 'text-secondary'];

function assertMonochrome(html, label) {
  for (const bad of FORBIDDEN) {
    assert.ok(!html.toLowerCase().includes(bad.toLowerCase()), `${label} must stay monochrome — found "${bad}"`);
  }
  for (const token of REQUIRED_TOKENS) {
    assert.ok(html.includes(token), `${label} must use theme token ${token}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — OrientationGate: compact, monochrome, actionable copy
// ─────────────────────────────────────────────────────────────────────────────
{
  const gate = await render(el(Screens.OrientationGate, {}));
  assert.ok(gate.query('[data-testid="orientation-gate"]'), 'gate is rendered');
  assert.ok(gate.text().includes('Putar perangkat ke Landscape'), 'gate tells the user what to do');
  assert.strictEqual(gate.query('[role="alert"]').getAttribute('aria-live'), 'assertive');
  assertMonochrome(gate.html(), 'OrientationGate');
  assert.ok(gate.html().includes('max-w-'), 'gate stays compact (bounded panel width)');
  gate.unmount();

  // While an automatic lock is in flight the copy says so (no manual action).
  const locking = await render(el(Screens.OrientationGate, { locking: true }));
  assert.ok(locking.text().includes('Menyesuaikan orientasi'), 'locking state copy');
  assertMonochrome(locking.html(), 'OrientationGate (locking)');
  locking.unmount();
  console.log('✔ PART 1 — OrientationGate is compact + monochrome (dark & light tokens)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — connection overlay copy per state
// ─────────────────────────────────────────────────────────────────────────────
{
  const cases = [
    ['loading', 'connecting', 'Menghubungkan ke Server...'],
    ['loading', 'hello', 'Menyiapkan Dunia...'],
    ['loading', 'syncing', 'Memuat Data Dunia...'],
    ['reconnecting', 'reconnecting', 'Menghubungkan Kembali...'],
    ['recovering', 'recovering', 'Memulihkan Koneksi...'],
    ['failed', 'error', 'Koneksi belum berhasil dipulihkan'],
  ];
  for (const [kind, status, title] of cases) {
    const overlay = connectionOverlay(kind === 'failed' ? 'game' : 'loading', status);
    assert.ok(overlay, `overlay for ${status}`);
    assert.strictEqual(overlay.kind, kind);
    assert.strictEqual(overlay.title, title);
    const view = await render(el(Screens.LoadingScreen, { overlay, onRetry: () => {}, onReload: () => {} }));
    assert.ok(view.text().includes(title), `renders "${title}"`);
    assert.strictEqual(view.query('[data-testid="connection-overlay"]').dataset.kind, kind);
    assert.ok(view.text().includes('Coba Sambungkan Lagi'), 'retry is always offered');
    assertMonochrome(view.html(), `LoadingScreen(${kind})`);
    // Reload only in the FAILED state (never an automatic reload anywhere).
    assert.strictEqual(view.text().includes('Muat Ulang Game'), kind === 'failed');
    view.unmount();
  }
  console.log('✔ PART 2 — overlay copy per state, retry always present, reload only on FAILED');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — the retry button really calls the handler
// ─────────────────────────────────────────────────────────────────────────────
{
  let retried = 0;
  let reloaded = 0;
  const overlay = connectionOverlay('game', 'error');
  const view = await render(
    el(Screens.LoadingScreen, {
      overlay,
      onRetry: () => { retried += 1; },
      onReload: () => { reloaded += 1; },
    }),
  );
  const retry = view.query('[data-testid="overlay-retry"]');
  assert.ok(retry, 'retry button rendered');
  await act(async () => {
    retry.dispatchEvent(new globalThis.window.MouseEvent('click', { bubbles: true }));
  });
  assert.strictEqual(retried, 1, 'retry handler invoked exactly once');
  assert.strictEqual(reloaded, 0, 'no automatic reload');
  view.unmount();
  console.log('✔ PART 3 — retry button wiring (no implicit reload)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — ErrorScreen monochrome + source-level guard
// ─────────────────────────────────────────────────────────────────────────────
{
  const view = await render(el(Screens.ErrorScreen, { message: 'World penuh', onRetry: () => {} }));
  assert.ok(view.text().includes('Tidak Bisa Terhubung'));
  assert.ok(view.text().includes('World penuh'));
  assertMonochrome(view.html(), 'ErrorScreen');
  view.unmount();

  // Static guard: the overlay source must not reintroduce coloured styling
  // (comments are stripped first — they legitimately mention the old palette).
  const src = fs.readFileSync(path.join(ROOT, 'src/harvest/Screens.tsx'), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/*'))
    .join('\n');
  for (const bad of ['emerald', 'green', 'gradient', 'amber', 'neon', 'bg-[#', 'text-[#']) {
    assert.ok(!src.includes(bad), `Screens.tsx must not reference "${bad}"`);
  }
  console.log('✔ PART 4 — ErrorScreen monochrome + source guard');
}

cleanBuildDir();
console.log('SUITE 10 PASSED!\n');
