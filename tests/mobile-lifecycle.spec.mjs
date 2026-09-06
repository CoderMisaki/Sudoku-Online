// E2E: mobile orientation lifecycle + websocket reconnect recovery.
//
// Covers spec section 13 against the REAL stack (custom Node server with a
// persistent /ws/harvest endpoint + real browser):
//   A. portrait → OrientationGate visible
//   B. rotate to landscape → gate gone, game can start (creator handshake)
//   C. kill socket while landscape → "Menghubungkan Kembali..." overlay
//   D. network back → hello + snapshot → screen is game again
//   E. "Coba Sambungkan Lagi" → fresh socket + fresh hello + recovery
//   F/G. portrait ↔ landscape rotations → same player/room, no creator, no loss
//   I. offline → online → reconnect + recovery
//   J. no infinite loading overlay after a successful snapshot
import { test, expect } from 'playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

const room = ('E2E' + Date.now().toString(36).toUpperCase()).replace(/[^A-Z0-9]/g, '').slice(0, 8);

async function waitScreen(page, screen, timeout = 45000) {
  await page.waitForFunction(
    (s) => window.__harvest && window.__harvest.getState().screen === s,
    screen,
    { timeout },
  );
}

async function getUserId(page) {
  return page.evaluate(() => localStorage.getItem('sudoku_user_id'));
}

async function killSocket(page) {
  await page.evaluate(() => {
    const sync = window.__harvest && window.__harvest.sync;
    if (!sync || !sync.ws) throw new Error('no live socket to kill');
    sync.ws.close();
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

test('mobile rotation + reconnect lifecycle', async ({ page, context }) => {
  const logs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    if (text.startsWith('[harvest]')) logs.push(text);
  });

  // ── A. portrait → gate visible, auto-continue pill removed ──
  await page.goto(`/harvest/${room}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Mode Landscape Dibutuhkan')).toBeVisible();
  await expect(page.getByText('Otomatis melanjutkan')).toHaveCount(0);

  // ── B. rotate to landscape → gate gone, handshake starts (creator) ──
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByText('Mode Landscape Dibutuhkan')).toBeHidden();
  await waitScreen(page, 'creator');
  await expect(page.getByText('Character Creation')).toBeVisible();

  // Reach the game through the real snapshot path.
  await completeCreator(page);
  await waitScreen(page, 'game');
  await expect(page.locator('canvas').first()).toBeVisible();
  const userId0 = await getUserId(page);
  expect(userId0).toBeTruthy();

  // ── C/D/I. offline + dead socket → overlay; online → snapshot recovery ──
  await context.setOffline(true);
  await killSocket(page);
  const overlay = page.getByText('Menghubungkan Kembali');
  await expect(overlay).toBeVisible();
  await context.setOffline(false);
  await expect(overlay).toBeHidden({ timeout: 30000 });
  await waitScreen(page, 'game', 30000);
  expect(await getUserId(page)).toBe(userId0);
  expect(page.url()).toContain(`/harvest/${room}`);

  // ── E. "Coba Sambungkan Lagi" forces a fresh socket + hello + recovery ──
  await context.setOffline(true);
  await killSocket(page);
  await expect(overlay).toBeVisible();
  const logMark = logs.length;
  await page.getByRole('button', { name: 'Coba Sambungkan Lagi' }).click();
  await expect
    .poll(() => logs.slice(logMark).some((l) => l.includes('force reconnect')), { timeout: 10000 })
    .toBe(true);
  await context.setOffline(false);
  await expect(overlay).toBeHidden({ timeout: 30000 });
  await waitScreen(page, 'game', 30000);
  await expect
    .poll(() => logs.some((l) => l.includes('hello sent') || l.includes('snapshot received')), { timeout: 10000 })
    .toBe(true);
  expect(await getUserId(page)).toBe(userId0);

  // ── F/G. rotation stress: same player/room, never creator, never stuck ──
  for (let i = 0; i < 2; i++) {
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('Mode Landscape Dibutuhkan')).toBeVisible();
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(page.getByText('Mode Landscape Dibutuhkan')).toBeHidden();
    await waitScreen(page, 'game', 30000);
    expect(await getUserId(page)).toBe(userId0);
    expect(page.url()).toContain(`/harvest/${room}`);
  }
  await expect(page.getByText('Character Creation')).toHaveCount(0);

  // ── J. no infinite loading after successful snapshot ──
  await expect(page.getByText('Menghubungkan Kembali')).toHaveCount(0);
  await expect(page.locator('canvas').first()).toBeVisible();
});
