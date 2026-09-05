// Shared Playwright helpers for the Harvest Moon end-to-end suite.
import { chromium, devices } from 'playwright';

export const BASE = process.env.BASE_URL || 'http://localhost:3000';

export const VIEWPORTS = {
  'mobile-390': { width: 844, height: 390 },   // iPhone 12/13 landscape
  'mobile-412': { width: 915, height: 412 },
  'mobile-430': { width: 932, height: 430 },
  'tablet-768': { width: 1024, height: 768 },
  'tablet-1024': { width: 1024, height: 768 },
  'tablet-1280': { width: 1280, height: 800 },
  'desktop-1280': { width: 1280, height: 720 },
  'desktop-1366': { width: 1366, height: 768 },
  'desktop-1440': { width: 1440, height: 900 },
  'desktop-1920': { width: 1920, height: 1080 },
};

export const PORTRAIT = { width: 390, height: 844 };

let browser = null;
export async function getBrowser() {
  if (!browser) browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  return browser;
}
export async function closeBrowser() {
  if (browser) { await browser.close(); browser = null; }
}

/**
 * Open a game page as a specific player. Collects console errors and page errors
 * so tests can assert a clean console.
 */
export async function openPlayer({ room, name, viewport = VIEWPORTS['desktop-1280'], touch = false, userId }) {
  const b = await getBrowser();
  const ctx = await b.newContext({
    viewport,
    hasTouch: touch,
    isMobile: false, // isMobile forces mobile UA emulation which changes viewport handling
    deviceScaleFactor: 1,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  const uid = userId || `test-${name}-${Math.random().toString(36).slice(2, 10)}`;
  await page.addInitScript(([n, u, coarse]) => {
    localStorage.setItem('sudoku_username', n);
    localStorage.setItem('sudoku_user_id', u);
    if (coarse) {
      // Emulate a touch device so the client classifies it as mobile/tablet.
      const realMatchMedia = window.matchMedia.bind(window);
      window.matchMedia = (q) => {
        if (q.includes('pointer: coarse')) return { matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
        return realMatchMedia(q);
      };
      Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5, configurable: true });
    }
  }, [name, uid, touch]);

  await page.goto(`${BASE}/harvest/${room}`, { waitUntil: 'domcontentloaded' });
  return { page, ctx, errors, userId: uid, name };
}

/** Read the client store from the page. */
export function store(page, selector) {
  return page.evaluate(
    (sel) => {
      const s = window.__harvestStore?.getState?.();
      if (!s) return null;
      return new Function('s', `return (${sel});`)(s);
    },
    selector,
  );
}

/** Wait until the store satisfies a predicate expression string. */
export async function waitForStore(page, expr, timeout = 30000) {
  await page.waitForFunction(
    (sel) => {
      const s = window.__harvestStore?.getState?.();
      if (!s) return false;
      try {
          return !!new Function('s', `return (${sel});`)(s);
      } catch { return false; }
    },
    expr,
    { timeout, polling: 100 },
  );
}

/** Complete character creation (if the creator is showing) and wait for the world. */
export async function enterWorld(page, name) {
  await waitForStore(page, "s.screen === 'creator' || s.screen === 'game'", 40000);
  const screen = await store(page, 's.screen');
  if (screen === 'creator') {
    await page.evaluate((n) => {
      window.dispatchEvent(new CustomEvent('harvest-create', {
        detail: {
          char: {
            name: n, farmName: `${n} FARM`, gender: 'male',
            hair: 'short', hairColor: '#5a3a22', skin: '#f0c8a0', eye: '#3a5a8a',
            eyeStyle: 'round', outfit: 'overalls', outfitColor: '#3a6ea5',
            shoes: 'boots', accessory: 'none',
          },
          farmName: `${n} FARM`,
        },
      }));
    }, name);
  }
  await waitForStore(page, "s.screen === 'game' && !!s.me && !!s.me.char", 40000);
  // let the engine settle a frame or two
  await page.waitForTimeout(400);
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function approxEq(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

export { devices };
