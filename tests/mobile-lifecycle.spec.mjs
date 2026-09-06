// E2E: PWA orientation + WebSocket reconnect recovery against the REAL stack
// (custom Node server with a persistent /ws/harvest endpoint + real browser).
//
//   A. mobile portrait      → fallback OrientationGate (or automatic lock)
//   B. mobile landscape     → no gate, game continues
//   C. kill socket          → reconnect overlay appears
//   D. network back         → hello → snapshot → overlay gone, game visible
//   E. "Coba Sambungkan Lagi" → genuinely fresh socket + handshake
//   F. portrait → landscape → same userId/room, no character creator
//   G. landscape → portrait → landscape → no stuck loading, no duplicate socket
//   H. offline → online     → automatic recovery (no reload)
//   I. background → foreground → probe/resync, never a needless reconnect
//   J. successful snapshot  → zero reconnect overlays, canvas visible
//   K. desktop              → no orientation gate at all
//   L. resize/orientation storm → exactly one active WebSocket
//   M. stale socket callback after a new socket → state untouched
//   PWA. installed-app display mode + landscape manifest are wired up
import { test, expect } from 'playwright/test';

const MOBILE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const DESKTOP = { viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false };

const room = ('E2E' + Date.now().toString(36).toUpperCase()).replace(/[^A-Z0-9]/g, '').slice(0, 8);

test.use(MOBILE);

const GATE = '[data-testid="orientation-gate"]';
const OVERLAY = '[data-testid="connection-overlay"]';
const RETRY = '[data-testid="overlay-retry"]';
const CANVAS = '[data-testid="canvas-host"] canvas';

// ── helpers ──────────────────────────────────────────────────────────────────
async function waitScreen(page, screen, timeout = 45000) {
  await page.waitForFunction((s) => window.__harvest?.getState().screen === s, screen, { timeout });
}

async function waitReady(page, timeout = 45000) {
  await page.waitForFunction(
    () => {
      const st = window.__harvest?.getState();
      return !!st && st.status === 'ready' && (st.screen === 'game' || st.screen === 'creator');
    },
    undefined,
    { timeout },
  );
}

const diag = (page) => page.evaluate(() => window.__harvest.getDiagnostics());
const userId = (page) => page.evaluate(() => localStorage.getItem('sudoku_user_id'));

async function killSocket(page) {
  await page.evaluate(() => {
    const ws = window.__harvest?.sync?.ws;
    if (!ws) throw new Error('no live socket to kill');
    ws.close();
  });
}

async function rotate(page, width, height) {
  await page.setViewportSize({ width, height });
  // Real browsers fire both; the coordinator must coalesce them.
  await page.evaluate(() => {
    window.dispatchEvent(new Event('orientationchange'));
    window.dispatchEvent(new Event('resize'));
  });
}

async function completeCreator(page) {
  await page.getByRole('button', { name: 'Mulai Pembuatan Karakter' }).click();
  await page.getByPlaceholder('Contoh: MILA').fill('E2E');
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await page.getByRole('button', { name: 'Lanjut' }).click(); // appearance (defaults)
  await page.getByPlaceholder('Contoh: Sunrise Farm').fill('E2E Farm');
  await page.getByRole('button', { name: 'Lanjut' }).click();
  await page.getByRole('button', { name: 'START ADVENTURE' }).click();
}

/** Open the room in landscape and make sure we are in the playable game. */
async function enterGame(page) {
  await page.goto(`/harvest/${room}`, { waitUntil: 'domcontentloaded' });
  await rotate(page, 844, 390);
  await expect(page.locator(GATE)).toHaveCount(0);
  await waitReady(page);
  if (await page.evaluate(() => window.__harvest.getState().screen === 'creator')) {
    await completeCreator(page);
  }
  await waitScreen(page, 'game');
  await expect(page.locator(CANVAS)).toBeVisible();
  await expect(page.locator(OVERLAY)).toHaveCount(0);
}

// ── A/B/F/G/J/L: orientation lifecycle on a phone ────────────────────────────
test('A/B — portrait gates, landscape plays', async ({ page }) => {
  await page.goto(`/harvest/${room}`, { waitUntil: 'domcontentloaded' });

  // A. portrait → fallback gate (headless Chromium refuses orientation.lock)
  await expect(page.locator(GATE)).toBeVisible();
  await expect(page.locator(GATE)).toContainText('Putar perangkat ke Landscape');
  // The lock was still attempted as a progressive enhancement (never unlock()).
  const ori = await page.evaluate(() => window.__harvest.orientation);
  expect(['denied', 'unsupported', 'locked', 'locking', 'idle']).toContain(ori.lockState);
  expect(ori.device).toBe('phone');
  expect(ori.showGate).toBe(true);

  // B. rotate → gate gone, the handshake simply continues (no reload)
  await rotate(page, 844, 390);
  await expect(page.locator(GATE)).toHaveCount(0);
  await waitReady(page);
  const screen = await page.evaluate(() => window.__harvest.getState().screen);
  expect(['creator', 'game']).toContain(screen);

  if (screen === 'creator') await completeCreator(page);
  await waitScreen(page, 'game');

  // J. a successful snapshot leaves zero overlays and a visible canvas
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.locator(CANVAS)).toBeVisible();
  const d = await diag(page);
  expect(d.enginesCreated).toBe(1);
  expect(d.snapshotsApplied).toBeGreaterThanOrEqual(1);
  expect(d.identity.room).toBe(room);
});

test('F/G/L — rotations preserve the session and keep ONE socket', async ({ page }) => {
  await enterGame(page);
  const uid = await userId(page);
  const before = await diag(page);
  expect(before.socketsCreated).toBe(1);

  // G. landscape → portrait → landscape, repeated
  for (let i = 0; i < 3; i++) {
    await rotate(page, 390, 844);
    await expect(page.locator(GATE)).toBeVisible();
    // F. rotating never resets the session
    const st = await page.evaluate(() => window.__harvest.getState());
    expect(st.screen).toBe('game');
    expect(st.userId).toBe(uid);
    expect(st.roomCode).toBe(room);
    expect(st.me?.char).toBeTruthy();

    // L. a rotation fires a storm of resize/orientation/viewport events
    await page.evaluate(() => {
      for (let k = 0; k < 12; k++) {
        window.dispatchEvent(new Event('resize'));
        window.dispatchEvent(new Event('orientationchange'));
        window.visualViewport?.dispatchEvent?.(new Event('resize'));
      }
    });
    await rotate(page, 844, 390);
    await expect(page.locator(GATE)).toHaveCount(0);
    await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 10000 });
    await waitScreen(page, 'game');
  }

  const after = await diag(page);
  expect(after.socketsCreated).toBe(before.socketsCreated); // no duplicate socket
  expect(after.enginesCreated).toBe(1);                    // no duplicate engine
  expect(after.identity).toEqual(before.identity);         // same room/user
  expect(await userId(page)).toBe(uid);
  await expect(page.getByText('Character Creation')).toHaveCount(0);
  await expect(page.locator(CANVAS)).toBeVisible();
});

test('C/D — dead socket shows the overlay, recovery clears it', async ({ page }) => {
  await enterGame(page);
  const uid = await userId(page);

  // C. kill the WebSocket → reconnect overlay
  await killSocket(page);
  await expect(page.locator(OVERLAY)).toBeVisible();
  const kind = await page.locator(OVERLAY).getAttribute('data-kind');
  expect(['reconnecting', 'recovering', 'loading']).toContain(kind);
  // the game screen and player state survive the drop
  const st = await page.evaluate(() => window.__harvest.getState());
  expect(st.screen).toBe('game');
  expect(st.me?.char).toBeTruthy();

  // D. the automatic retry recovers without any user action
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 30000 });
  await waitScreen(page, 'game', 30000);
  const d = await diag(page);
  expect(d.healthy).toBe(true);
  expect(d.snapshotsApplied).toBeGreaterThanOrEqual(2);
  expect(d.enginesCreated).toBe(1);
  expect(await userId(page)).toBe(uid);
  expect(page.url()).toContain(`/harvest/${room}`);
  await expect(page.locator(CANVAS)).toBeVisible();
});

test('E — "Coba Sambungkan Lagi" forces a genuinely fresh handshake', async ({ page }) => {
  await enterGame(page);
  const before = await diag(page);

  await killSocket(page);
  await expect(page.locator(OVERLAY)).toBeVisible();

  await page.locator(RETRY).click();
  await expect
    .poll(async () => (await diag(page)).socketsCreated, { timeout: 10000 })
    .toBeGreaterThan(before.socketsCreated);

  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 30000 });
  await waitScreen(page, 'game', 30000);
  const after = await diag(page);
  expect(after.socketsCreated).toBe(before.socketsCreated + 1); // exactly ONE new socket
  expect(after.healthy).toBe(true);
  expect(after.enginesCreated).toBe(1);
  await expect(page.locator(CANVAS)).toBeVisible();
});

test('H — offline → online recovers automatically, without a reload', async ({ page, context }) => {
  await enterGame(page);
  const uid = await userId(page);
  const goldBefore = await page.evaluate(() => window.__harvest.getState().me.gold);

  await context.setOffline(true);
  await killSocket(page);
  await expect(page.locator(OVERLAY)).toBeVisible();

  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));

  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 30000 });
  await waitScreen(page, 'game', 30000);
  const st = await page.evaluate(() => window.__harvest.getState());
  expect(st.userId).toBe(uid);
  expect(st.me.gold).toBe(goldBefore); // session preserved, not a new player
  expect(st.me.char).toBeTruthy();
  expect(page.url()).toContain(`/harvest/${room}`);
});

test('I — background → foreground: healthy session is not disturbed', async ({ page }) => {
  await enterGame(page);
  const before = await diag(page);

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
  });

  await page.waitForTimeout(1500);
  const after = await diag(page);
  expect(after.socketsCreated).toBe(before.socketsCreated); // no needless reconnect
  expect(after.enginesCreated).toBe(1);
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.locator(CANVAS)).toBeVisible();

  // …but a socket that died while hidden IS replaced on resume.
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    window.__harvest.sync.ws.close();
  });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 30000 });
  await waitScreen(page, 'game', 30000);
  expect((await diag(page)).socketsCreated).toBeGreaterThan(after.socketsCreated);
});

test('M — a stale socket can never corrupt the live session', async ({ page }) => {
  await enterGame(page);
  const gold = await page.evaluate(() => window.__harvest.getState().me.gold);
  const snapshots = (await diag(page)).snapshotsApplied;

  // Grab the current socket, force a fresh one, then fire callbacks on the old.
  await page.evaluate(() => {
    const stale = window.__harvest.sync.ws;
    window.__stale = stale;
    window.__harvest.session.manualRetry();
  });
  await page.waitForTimeout(500);
  await page.evaluate(() => {
    const stale = window.__stale;
    try {
      stale.onmessage?.({ data: JSON.stringify({ t: 'snapshot', me: { id: 'GHOST', gold: 1 } }) });
      stale.onclose?.({});
    } catch {}
  });
  await page.waitForTimeout(300);

  const st = await page.evaluate(() => window.__harvest.getState());
  expect(st.me.gold).toBe(gold);
  expect(st.me.id).not.toBe('GHOST');
  await expect(page.locator(OVERLAY)).toHaveCount(0, { timeout: 30000 });
  await waitScreen(page, 'game', 30000);
  expect((await diag(page)).snapshotsApplied).toBeGreaterThanOrEqual(snapshots);
});

test('PWA — standalone display mode + landscape manifest wiring', async ({ page, context }) => {
  // The harvest route advertises its own landscape manifest.
  await page.goto(`/harvest/${room}`, { waitUntil: 'domcontentloaded' });
  const manifestHref = await page.locator('link[rel="manifest"]').first().getAttribute('href');
  expect(manifestHref).toContain('manifest.harvest.json');

  const manifest = await page.request.get('/manifest.harvest.json');
  expect(manifest.ok()).toBeTruthy();
  const json = await manifest.json();
  expect(json.orientation).toBe('landscape');
  expect(json.display).toBe('standalone');

  // The Sudoku lobby keeps its own (portrait friendly) manifest.
  const rootManifest = await (await page.request.get('/manifest.json')).json();
  expect(rootManifest.orientation).not.toBe('landscape');

  // Emulate an installed PWA: display-mode becomes standalone, and the runtime
  // lock is attempted automatically (headless Chromium refuses it → gate stays,
  // but nothing crashes and no reload happens).
  const client = await context.newCDPSession(page);
  await client.send('Emulation.setDisplayOverride', { displayOverride: ['standalone'] });
  await rotate(page, 844, 390);
  await page.reload({ waitUntil: 'domcontentloaded' });
  expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true);
  const mode = await page.evaluate(() => window.__harvest.getDiagnostics().landscape);
  expect(mode).toBe(true);
  await waitReady(page);
  await expect(page.locator(GATE)).toHaveCount(0);
});

// ── K: desktop is never gated ────────────────────────────────────────────────
test('K — desktop never shows the orientation gate', async ({ browser }) => {
  const context = await browser.newContext(DESKTOP);
  const page = await context.newPage();
  await page.goto(`/harvest/${room}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(GATE)).toHaveCount(0);
  await waitReady(page);

  // Even a tall/narrow desktop window must not gate.
  await page.setViewportSize({ width: 700, height: 1100 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(300);
  await expect(page.locator(GATE)).toHaveCount(0);

  await page.setViewportSize({ width: 1440, height: 900 });
  if (await page.evaluate(() => window.__harvest.getState().screen === 'creator')) {
    await completeCreator(page);
  }
  await waitScreen(page, 'game');
  await expect(page.locator(OVERLAY)).toHaveCount(0);
  await expect(page.locator(CANVAS)).toBeVisible();
  await context.close();
});
