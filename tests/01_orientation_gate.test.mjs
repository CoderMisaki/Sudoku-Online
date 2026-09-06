import { JSDOM } from 'jsdom';
import assert from 'assert';

console.log('--- TEST SUITE 1: ORIENTATION DETECTION & GATE ---');

function createDom(width, height, isTouch = false, orientationType = 'landscape-primary') {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost:3000/harvest',
    pretendToBeVisual: true,
  });
  const win = dom.window;

  Object.defineProperty(win, 'innerWidth', { writable: true, configurable: true, value: width });
  Object.defineProperty(win, 'innerHeight', { writable: true, configurable: true, value: height });
  Object.defineProperty(win.screen, 'width', { writable: true, configurable: true, value: width });
  Object.defineProperty(win.screen, 'height', { writable: true, configurable: true, value: height });

  if (isTouch) {
    Object.defineProperty(win.navigator, 'maxTouchPoints', { writable: true, configurable: true, value: 5 });
    win.ontouchstart = () => {};
  } else {
    Object.defineProperty(win.navigator, 'maxTouchPoints', { writable: true, configurable: true, value: 0 });
  }

  win.screen.orientation = {
    type: orientationType,
    angle: orientationType.includes('landscape') ? 90 : 0,
    addEventListener: () => {},
    removeEventListener: () => {},
  };

  win.matchMedia = (query) => {
    const isLandscapeQuery = query.includes('landscape');
    const matches = isLandscapeQuery ? width >= height : height > width;
    return {
      matches,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };

  return win;
}

// Emulate orientation helper from src/harvest/orientation.ts
function checkIsLandscape(win) {
  if (typeof win === 'undefined') return true;
  const isTouch = (win.navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in win;
  const w = win.innerWidth || 1280;
  const h = win.innerHeight || 720;
  if (!isTouch && w >= 1024) return true;

  const mm = win.matchMedia && win.matchMedia('(orientation: landscape)');
  if (mm && typeof mm.matches === 'boolean') {
    if (w > h) return true;
    if (h > w) return false;
    return mm.matches;
  }
  if (win.screen?.orientation?.type) {
    return win.screen.orientation.type.startsWith('landscape');
  }
  return w >= h;
}

// 1. Mobile devices in portrait
{
  const phonePortrait = createDom(390, 844, true, 'portrait-primary');
  assert.strictEqual(checkIsLandscape(phonePortrait), false, 'iPhone 14 portrait must require rotation');

  const samsungPortrait = createDom(412, 915, true, 'portrait-primary');
  assert.strictEqual(checkIsLandscape(samsungPortrait), false, 'Samsung Galaxy S20 portrait must require rotation');

  const proMaxPortrait = createDom(430, 932, true, 'portrait-primary');
  assert.strictEqual(checkIsLandscape(proMaxPortrait), false, 'iPhone 14 Pro Max portrait must require rotation');
  console.log('✔ Mobile portrait orientation correctly identified for gate');
}

// 2. Mobile devices in landscape
{
  const phoneLandscape = createDom(844, 390, true, 'landscape-primary');
  assert.strictEqual(checkIsLandscape(phoneLandscape), true, 'iPhone 14 landscape is valid');

  const samsungLandscape = createDom(915, 412, true, 'landscape-primary');
  assert.strictEqual(checkIsLandscape(samsungLandscape), true, 'Galaxy landscape is valid');
  console.log('✔ Mobile landscape orientation immediately unlocks game');
}

// 3. Tablet devices
{
  const tabletLandscape = createDom(1024, 768, true, 'landscape-primary');
  assert.strictEqual(checkIsLandscape(tabletLandscape), true, 'iPad landscape is valid');

  const tabletPortrait = createDom(768, 1024, true, 'portrait-primary');
  assert.strictEqual(checkIsLandscape(tabletPortrait), false, 'iPad portrait requires landscape');
  console.log('✔ Tablet orientation handling verified');
}

// 4. Desktop devices
{
  const desktopFHD = createDom(1920, 1080, false);
  assert.strictEqual(checkIsLandscape(desktopFHD), true, 'Desktop 1080p is always landscape');

  const desktopHD = createDom(1280, 720, false);
  assert.strictEqual(checkIsLandscape(desktopHD), true, 'Desktop 720p is always landscape');
  console.log('✔ Desktop orientation bypasses mobile lock');
}

console.log('SUITE 1 PASSED!\n');
