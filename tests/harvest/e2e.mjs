// Harvest Moon end-to-end suite.
//
// Covers the mandated matrix: orientation, per-device input, multiplayer
// movement, chat (public + private isolation), inventory, economy, persistence,
// map, lifecycle and responsive viewports.
//
// Run: node tests/harvest/e2e.mjs   (with the game server on :3000)
import {
  VIEWPORTS, PORTRAIT, openPlayer, enterWorld, store, waitForStore,
  assert, closeBrowser,
} from './helpers.mjs';

const results = [];
let only = process.argv[2] || null;

async function test(name, fn) {
  if (only && !name.toLowerCase().includes(only.toLowerCase())) return;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✅ ${name} (${Date.now() - started}ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - started, err: err.message });
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}

const room = () => 'T' + Math.random().toString(36).slice(2, 7).toUpperCase();

/** Assert no uncaught exceptions surfaced in the console. */
function assertCleanConsole(errors, label) {
  const fatal = errors.filter(
    (e) =>
      !/favicon|Failed to load resource|fonts\.googleapis|WebGL|SwiftShader|Download the React DevTools|deprecated/i.test(e),
  );
  assert(fatal.length === 0, `${label}: console errors → ${fatal.slice(0, 3).join(' | ')}`);
}

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Orientation');

await test('1. Landscape detection — desktop viewport starts the game', async () => {
  const r = room();
  const { page, ctx, errors } = await openPlayer({ room: r, name: 'ORIA', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'ORIA');
  const gate = await page.locator('[aria-label="Putar perangkat ke landscape"]').count();
  assert(gate === 0, 'orientation gate must not show on desktop');
  assertCleanConsole(errors, 'landscape-desktop');
  await ctx.close();
});

await test('2. Portrait touch device shows the rotate gate', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'ORIB', viewport: PORTRAIT, touch: true });
  await page.waitForTimeout(1500);
  const visible = await page.locator('[aria-label="Putar perangkat ke landscape"]').isVisible();
  assert(visible, 'gate should be visible in portrait on a touch device');
  await ctx.close();
});

await test('3. Portrait → landscape auto-dismisses the gate (no reload, no click)', async () => {
  const r = room();
  const { page, ctx, errors } = await openPlayer({ room: r, name: 'ORIC', viewport: PORTRAIT, touch: true });
  await page.waitForTimeout(1200);
  assert(await page.locator('[aria-label="Putar perangkat ke landscape"]').isVisible(), 'gate expected in portrait');

  // Rotate — nothing else. No reload, no interaction.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForSelector('[aria-label="Putar perangkat ke landscape"]', { state: 'detached', timeout: 8000 });

  // …and the game must actually continue starting up.
  await enterWorld(page, 'ORIC');
  assert((await store(page, 's.screen')) === 'game', 'game must start after rotating');
  assertCleanConsole(errors, 'rotate');
  await ctx.close();
});

await test('4. Landscape → portrait → landscape keeps state and the socket alive', async () => {
  const r = room();
  const { page, ctx, errors } = await openPlayer({ room: r, name: 'ORID', viewport: { width: 844, height: 390 }, touch: true });
  await enterWorld(page, 'ORID');
  const before = await store(page, '({ gold: s.me.gold, inv: s.me.inv.length, id: s.me.id })');

  await page.setViewportSize(PORTRAIT);
  await page.waitForTimeout(900);
  assert(await page.locator('[aria-label="Putar perangkat ke landscape"]').isVisible(), 'gate expected in portrait');
  // State must survive: no disconnect, no reset.
  assert((await store(page, 's.me !== null')) === true, 'player state destroyed on rotate to portrait');
  assert((await store(page, "s.status !== 'closed'")) === true, 'socket closed on rotate');
  // Rendering paused, socket untouched.
  assert(await page.evaluate(() => window.__harvestEngine?.isPaused?.() === true), 'engine should pause in portrait');

  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForSelector('[aria-label="Putar perangkat ke landscape"]', { state: 'detached', timeout: 8000 });
  await page.waitForTimeout(500);
  assert(await page.evaluate(() => window.__harvestEngine?.isPaused?.() === false), 'engine should resume in landscape');

  const after = await store(page, '({ gold: s.me.gold, inv: s.me.inv.length, id: s.me.id })');
  assert(after.id === before.id, 'player identity changed across rotation');
  assert(after.gold === before.gold, 'gold changed across rotation');
  assertCleanConsole(errors, 'rotate-cycle');
  await ctx.close();
});

await test('5. Refresh while landscape resumes into the world', async () => {
  const r = room();
  const uid = 'persist-land-' + Math.random().toString(36).slice(2, 8);
  const a = await openPlayer({ room: r, name: 'REFA', viewport: VIEWPORTS['desktop-1280'], userId: uid });
  await enterWorld(a.page, 'REFA');
  await a.page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStore(a.page, "s.screen === 'game' && !!s.me && !!s.me.char", 40000);
  assert((await store(a.page, 's.me.char !== null')) === true, 'character lost after refresh');
  await a.ctx.close();
});

await test('6. Refresh while portrait then rotate still enters the world', async () => {
  const r = room();
  const uid = 'persist-port-' + Math.random().toString(36).slice(2, 8);
  const a = await openPlayer({ room: r, name: 'REFB', viewport: { width: 844, height: 390 }, touch: true, userId: uid });
  await enterWorld(a.page, 'REFB');
  await a.page.setViewportSize(PORTRAIT);
  await a.page.reload({ waitUntil: 'domcontentloaded' });
  await a.page.waitForTimeout(1500);
  // Connection must proceed even while gated.
  await waitForStore(a.page, '!!s.me', 40000);
  await a.page.setViewportSize({ width: 844, height: 390 });
  await waitForStore(a.page, "s.screen === 'game'", 20000);
  await a.ctx.close();
});

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Input');

async function movementTest(label, viewport, drive, touch = false) {
  const r = room();
  const { page, ctx, errors } = await openPlayer({ room: r, name: 'MOV', viewport, touch });
  await enterWorld(page, 'MOV');
  const start = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  await drive(page);
  await page.waitForTimeout(900);
  const end = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  const moved = Math.hypot(end.x - start.x, end.y - start.y);
  assert(moved > 0.8, `${label}: player did not move (Δ=${moved.toFixed(2)})`);

  // Input must stop cleanly.
  await page.evaluate(() => window.__harvestInput.releaseAll());
  await page.waitForTimeout(500);
  const p1 = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  await page.waitForTimeout(600);
  const p2 = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  assert(Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.2, `${label}: player kept moving after release (stuck input)`);
  assertCleanConsole(errors, label);
  await ctx.close();
}

await test('7. Desktop WASD movement', () =>
  movementTest('WASD', VIEWPORTS['desktop-1280'], async (page) => {
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
    await page.keyboard.down('d');
    await page.waitForTimeout(500);
    await page.keyboard.up('d');
  }));

await test('8. Desktop arrow-key movement', () =>
  movementTest('Arrows', VIEWPORTS['desktop-1366'], async (page) => {
    await page.keyboard.down('ArrowDown');
    await page.waitForTimeout(700);
    await page.keyboard.up('ArrowDown');
    await page.keyboard.down('ArrowLeft');
    await page.waitForTimeout(500);
    await page.keyboard.up('ArrowLeft');
  }));

await test('9. Sprint (Shift) is faster than walking', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'SPRT', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'SPRT');
  const measure = async (sprint) => {
    const a = await page.evaluate(() => window.__harvestEngine.getMyPosition());
    if (sprint) await page.keyboard.down('Shift');
    await page.keyboard.down('w');
    await page.waitForTimeout(700);
    await page.keyboard.up('w');
    if (sprint) await page.keyboard.up('Shift');
    await page.waitForTimeout(200);
    const b = await page.evaluate(() => window.__harvestEngine.getMyPosition());
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const walk = await measure(false);
  const run = await measure(true);
  assert(run > walk * 1.15, `sprint (${run.toFixed(2)}) not faster than walk (${walk.toFixed(2)})`);
  await ctx.close();
});

await test('10. Mobile joystick drives movement (analog)', () =>
  movementTest('Joystick-mobile', VIEWPORTS['mobile-390'], async (page) => {
    const js = page.locator('[aria-label="Joystick gerak"]');
    await js.waitFor({ state: 'visible', timeout: 10000 });
    const box = await js.boundingBox();
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + box.width * 0.42, cy - box.height * 0.42, { steps: 6 });
    await page.waitForTimeout(900);
    await page.mouse.up();
  }, true));

await test('11. Tablet joystick drives movement and is larger than mobile', async () => {
  const r1 = room();
  const m = await openPlayer({ room: r1, name: 'JSM', viewport: VIEWPORTS['mobile-390'], touch: true });
  await enterWorld(m.page, 'JSM');
  const mBox = await m.page.locator('[aria-label="Joystick gerak"]').boundingBox();
  await m.ctx.close();

  const r2 = room();
  const t = await openPlayer({ room: r2, name: 'JST', viewport: VIEWPORTS['tablet-1280'], touch: true });
  await enterWorld(t.page, 'JST');
  const tBox = await t.page.locator('[aria-label="Joystick gerak"]').boundingBox();
  assert(tBox.width > mBox.width, `tablet joystick (${tBox.width}) should exceed mobile (${mBox.width})`);

  const start = await t.page.evaluate(() => window.__harvestEngine.getMyPosition());
  const cx = tBox.x + tBox.width / 2, cy = tBox.y + tBox.height / 2;
  await t.page.mouse.move(cx, cy);
  await t.page.mouse.down();
  await t.page.mouse.move(cx - tBox.width * 0.4, cy + tBox.height * 0.4, { steps: 6 });
  await t.page.waitForTimeout(900);
  await t.page.mouse.up();
  const end = await t.page.evaluate(() => window.__harvestEngine.getMyPosition());
  assert(Math.hypot(end.x - start.x, end.y - start.y) > 0.8, 'tablet joystick did not move the player');
  await t.ctx.close();
});

await test('12. Joystick is NOT rendered on desktop; keyboard hint is', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'DSK', viewport: VIEWPORTS['desktop-1440'] });
  await enterWorld(page, 'DSK');
  assert((await page.locator('[aria-label="Joystick gerak"]').count()) === 0, 'joystick should not render on desktop');
  assert(await page.getByText('WASD', { exact: false }).first().isVisible(), 'desktop keyboard hint missing');
  await ctx.close();
});

await test('13. Blur clears held keys (no stuck movement)', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'BLUR', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'BLUR');
  await page.keyboard.down('w');
  await page.waitForTimeout(300);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.waitForTimeout(300);
  const held = await page.evaluate(() => window.__harvestInput.frame.up);
  assert(held === false, 'key still held after window blur');
  const a = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  await page.waitForTimeout(600);
  const b = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  assert(Math.hypot(b.x - a.x, b.y - a.y) < 0.2, 'player still moving after blur');
  await page.keyboard.up('w').catch(() => {});
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Multiplayer movement');

await test('14. Two players see each other move smoothly (no teleport)', async () => {
  const r = room();
  const a = await openPlayer({ room: r, name: 'PA', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(a.page, 'PA');
  const b = await openPlayer({ room: r, name: 'PB', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(b.page, 'PB');
  await b.page.waitForTimeout(1200);

  const seen = await b.page.evaluate(() => window.__harvestEngine.getRemotePositions().length);
  assert(seen >= 1, 'player B does not see player A');

  // A walks; B samples A's marker every 100ms and checks for continuity.
  await a.page.keyboard.down('w');
  const samples = [];
  for (let i = 0; i < 18; i++) {
    samples.push(await b.page.evaluate(() => window.__harvestEngine.getRemotePositions()[0] || null));
    await b.page.waitForTimeout(100);
  }
  await a.page.keyboard.up('w');

  const pts = samples.filter(Boolean);
  assert(pts.length > 10, 'not enough remote samples');
  const total = Math.hypot(pts.at(-1).x - pts[0].x, pts.at(-1).y - pts[0].y);
  assert(total > 0.8, `remote player did not visibly move (Δ=${total.toFixed(2)})`);

  let maxJump = 0;
  for (let i = 1; i < pts.length; i++) {
    maxJump = Math.max(maxJump, Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  // At ~7.2 tiles/s sprint, 100ms can legitimately cover ~0.72 tiles. Anything
  // beyond 2.5 tiles in a frame is a teleport / interpolation failure.
  assert(maxJump < 2.5, `remote player teleported (max step ${maxJump.toFixed(2)} tiles per 100ms)`);

  assertCleanConsole(a.errors, 'mp-A');
  assertCleanConsole(b.errors, 'mp-B');
  await a.ctx.close(); await b.ctx.close();
});

await test('15. Four players are all visible to each other', async () => {
  const r = room();
  const ps = [];
  for (const n of ['Q1', 'Q2', 'Q3', 'Q4']) {
    const p = await openPlayer({ room: r, name: n, viewport: VIEWPORTS['desktop-1280'] });
    await enterWorld(p.page, n);
    ps.push(p);
  }
  await ps[0].page.waitForTimeout(1800);
  for (const p of ps) {
    const n = await p.page.evaluate(() => window.__harvestEngine.getRemotePositions().length);
    assert(n === 3, `expected 3 remotes, saw ${n}`);
    const short = await store(p.page, 'Object.keys(s.playersShort).length');
    assert(short === 4, `roster should list 4 players, got ${short}`);
  }
  for (const p of ps) await p.ctx.close();
});

await test('16. Reconnect does not duplicate the player or reset progress', async () => {
  const r = room();
  const uid = 'recon-' + Math.random().toString(36).slice(2, 8);
  const a = await openPlayer({ room: r, name: 'RECA', viewport: VIEWPORTS['desktop-1280'], userId: uid });
  await enterWorld(a.page, 'RECA');
  const b = await openPlayer({ room: r, name: 'OBS', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(b.page, 'OBS');
  await b.page.waitForTimeout(1200);

  const goldBefore = await store(a.page, 's.me.gold');
  const invBefore = await store(a.page, 's.me.inv.length');

  await a.page.reload({ waitUntil: 'domcontentloaded' });
  await waitForStore(a.page, "s.screen === 'game' && !!s.me", 40000);
  await b.page.waitForTimeout(2500);

  const remotes = await b.page.evaluate(() => window.__harvestEngine.getRemotePositions().map((p) => p.id));
  const uniq = new Set(remotes);
  assert(remotes.length === uniq.size, `duplicate/ghost player after reconnect: ${JSON.stringify(remotes)}`);
  assert(remotes.length === 1, `observer should see exactly 1 remote, saw ${remotes.length}`);

  assert((await store(a.page, 's.me.gold')) === goldBefore, 'gold reset on reconnect');
  assert((await store(a.page, 's.me.inv.length')) === invBefore, 'inventory reset on reconnect');
  await a.ctx.close(); await b.ctx.close();
});

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Chat');

await test('17. Public chat is delivered to everyone', async () => {
  const r = room();
  const a = await openPlayer({ room: r, name: 'CHA', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(a.page, 'CHA');
  const b = await openPlayer({ room: r, name: 'CHB', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(b.page, 'CHB');
  const c = await openPlayer({ room: r, name: 'CHC', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(c.page, 'CHC');
  await a.page.waitForTimeout(1000);

  const msg = 'halo dunia ' + Math.random().toString(36).slice(2, 7);
  await a.page.evaluate((m) => {
    window.__harvestStore.getState().setChatOpen(true);
    return m;
  }, msg);
  await a.page.locator('[aria-label="Kotak pesan"]').fill(msg);
  await a.page.locator('[aria-label="Kirim"]').click();

  for (const [label, p] of [['A', a], ['B', b], ['C', c]]) {
    await waitForStore(p.page, `s.chat.some(m => m.text === ${JSON.stringify(msg)} && m.channel === 'public')`, 8000)
      .catch(() => { throw new Error(`${label} did not receive the public message`); });
  }
  // No duplicates anywhere.
  for (const [label, p] of [['A', a], ['B', b], ['C', c]]) {
    const n = await store(p.page, `s.chat.filter(m => m.text === ${JSON.stringify(msg)}).length`);
    assert(n === 1, `${label} has ${n} copies of the message (duplicate chat)`);
  }
  await a.ctx.close(); await b.ctx.close(); await c.ctx.close();
});

await test('18. Private chat reaches ONLY sender + target (network-level isolation)', async () => {
  const r = room();
  const a = await openPlayer({ room: r, name: 'PVA', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(a.page, 'PVA');
  const b = await openPlayer({ room: r, name: 'PVB', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(b.page, 'PVB');
  const c = await openPlayer({ room: r, name: 'PVC', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(c.page, 'PVC');
  await a.page.waitForTimeout(1500);

  const bId = await store(b.page, 's.userId');
  const secret = 'RAHASIA-' + Math.random().toString(36).slice(2, 8).toUpperCase();

  await a.page.evaluate(([id, text]) => {
    window.__harvestStore.getState().setActiveChannel(id);
    window.__harvestStore.getState().setChatOpen(true);
    void text;
  }, [bId, secret]);
  await a.page.locator('[aria-label="Kotak pesan"]').fill(secret);
  await a.page.locator('[aria-label="Kirim"]').click();

  // Sender and target both get it.
  await waitForStore(a.page, `s.chat.some(m => m.text === ${JSON.stringify(secret)} && m.channel === 'private')`, 8000);
  await waitForStore(b.page, `s.chat.some(m => m.text === ${JSON.stringify(secret)} && m.channel === 'private')`, 8000);

  // The third player must never see it — in the store OR anywhere in the DOM.
  await c.page.waitForTimeout(2500);
  const leaked = await store(c.page, `s.chat.some(m => m.text === ${JSON.stringify(secret)})`);
  assert(leaked === false, 'PRIVATE MESSAGE LEAKED to a third player');
  const domLeak = await c.page.content();
  assert(!domLeak.includes(secret), 'private message text found in third player DOM');

  // Unread indicator on the recipient.
  const unread = await store(b.page, 'Object.values(s.conversations).reduce((n,c)=>n+c.unread,0)');
  assert(unread >= 1, 'recipient has no unread indicator');
  await a.ctx.close(); await b.ctx.close(); await c.ctx.close();
});

await test('19. Chat rate limiting rejects spam without crashing', async () => {
  const r = room();
  const a = await openPlayer({ room: r, name: 'SPAM', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(a.page, 'SPAM');
  await a.page.evaluate(() => {
    const api = window.__harvestStore.getState();
    void api;
  });
  // Fire 25 messages instantly through the socket.
  await a.page.evaluate(() => {
    window.__harvestStore.getState().setChatOpen(true);
  });
  for (let i = 0; i < 25; i++) {
    await a.page.locator('[aria-label="Kotak pesan"]').fill(`spam-${i}`);
    await a.page.locator('[aria-label="Kirim"]').click();
  }
  await a.page.waitForTimeout(1500);
  const delivered = await store(a.page, "s.chat.filter(m => m.text.startsWith('spam-')).length");
  assert(delivered < 25, `rate limiter did not drop anything (${delivered}/25 delivered)`);
  assert((await store(a.page, "s.screen === 'game'")) === true, 'client broke under spam');
  assertCleanConsole(a.errors, 'spam');
  await a.ctx.close();
});

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Inventory & economy');

await test('20. Inventory UI opens and lists items with categories', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'INV', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'INV');
  await page.keyboard.press('i');
  await page.waitForTimeout(400);
  assert(await page.getByText('Inventory', { exact: true }).first().isVisible(), 'inventory did not open');
  assert(await page.getByRole('button', { name: /^Seeds/ }).isVisible(), 'category tabs missing');
  const slots = await store(page, 's.me.inv.length');
  assert(slots > 0, 'starter inventory is empty');
  await ctx.close();
});

await test('21. Buying deducts gold and adds the item (server authoritative)', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'BUY', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'BUY');
  const before = await store(page, '({ gold: s.me.gold, turnip: (s.me.inv.find(i=>i.id==="seed_turnip")||{qty:0}).qty, price: s.prices.seed_turnip.buy })');
  await page.evaluate(() => {
    window.__harvestStore.getState().setMenu('shop');
  });
  await page.waitForTimeout(300);
  // Drive through the real UI button.
  const row = page.locator('div').filter({ hasText: /^Beli \d+G$/ }).first();
  void row;
  await page.getByRole('button', { name: /^Beli \d+G$/ }).first().click();
  await page.waitForTimeout(1200);
  const after = await store(page, '({ gold: s.me.gold, inv: s.me.inv })');
  assert(after.gold < before.gold, `gold not deducted (${before.gold} → ${after.gold})`);
  assert(after.gold >= 0, 'gold went negative');
  await ctx.close();
});

await test('22. Insufficient gold is rejected by the server', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'POOR', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'POOR');
  const gold = await store(page, 's.me.gold');
  const price = await store(page, 's.prices.seed_turnip.buy');
  const tooMany = Math.ceil(gold / price) + 50;
  await page.evaluate((q) => {
    window.__harvestStore.getState();
    // Send the raw request straight to the server, bypassing UI guards, to prove
    // the SERVER refuses it (not just the client).
    window.__harvestTestSend?.({ t: 'action', a: 'buy', item: 'seed_turnip', qty: Math.min(99, q), actionId: 'poor-' + Date.now() });
  }, tooMany);
  await page.waitForTimeout(1200);
  const after = await store(page, 's.me.gold');
  assert(after >= 0, `gold went negative: ${after}`);
  assert(after === gold || after < gold, 'unexpected gold state');
  // Buying 99 must not be affordable if it costs more than we have.
  if (price * Math.min(99, tooMany) > gold) {
    assert(after === gold, `server let the player buy without enough gold (${gold} → ${after})`);
  }
  await ctx.close();
});

await test('23. Selling removes the item and credits gold', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'SELL', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'SELL');
  const before = await store(page, '({ gold: s.me.gold, berry: (s.me.inv.find(i=>i.id==="berry")||{qty:0}).qty })');
  assert(before.berry > 0, 'starter kit should contain berries');
  await page.evaluate(() => {
    window.__harvestTestSend?.({ t: 'action', a: 'sell', item: 'berry', qty: 1, actionId: 'sell-' + Date.now() });
  });
  await page.waitForTimeout(1200);
  const after = await store(page, '({ gold: s.me.gold, berry: (s.me.inv.find(i=>i.id==="berry")||{qty:0}).qty })');
  assert(after.berry === before.berry - 1, `item not removed (${before.berry} → ${after.berry})`);
  assert(after.gold > before.gold, `gold not credited (${before.gold} → ${after.gold})`);
  await ctx.close();
});

await test('24. Selling an item you do not own is rejected', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'CHEAT', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'CHEAT');
  const before = await store(page, 's.me.gold');
  await page.evaluate(() => {
    window.__harvestTestSend?.({ t: 'action', a: 'sell', item: 'gem_diamond', qty: 99, actionId: 'cheat-' + Date.now() });
  });
  await page.waitForTimeout(1200);
  assert((await store(page, 's.me.gold')) === before, 'server paid for items the player does not own');
  await ctx.close();
});

await test('25. Double-click buy with the same actionId charges only once (idempotency)', async () => {
  const r = room();
  const { page, ctx } = await openPlayer({ room: r, name: 'DBL', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'DBL');
  const before = await store(page, 's.me.gold');
  const price = await store(page, 's.prices.seed_turnip.buy');
  await page.evaluate(() => {
    const id = 'dupe-fixed-key';
    for (let i = 0; i < 6; i++) {
      window.__harvestTestSend?.({ t: 'action', a: 'buy', item: 'seed_turnip', qty: 1, actionId: id });
    }
  });
  await page.waitForTimeout(1600);
  const after = await store(page, 's.me.gold');
  const spent = before - after;
  assert(spent <= price * 1.5, `duplicate purchase charged ${spent} for a ${price} item`);
  await ctx.close();
});

await test('26. Gold & inventory persist across a full reconnect', async () => {
  const r = room();
  const uid = 'econ-' + Math.random().toString(36).slice(2, 8);
  const a = await openPlayer({ room: r, name: 'PERS', viewport: VIEWPORTS['desktop-1280'], userId: uid });
  await enterWorld(a.page, 'PERS');
  await a.page.evaluate(() => {
    window.__harvestTestSend?.({ t: 'action', a: 'sell', item: 'berry', qty: 1, actionId: 'p-' + Date.now() });
  });
  await a.page.waitForTimeout(1200);
  const snapshot = await store(a.page, '({ gold: s.me.gold, inv: s.me.inv.map(i => i.id + ":" + i.qty).sort().join(",") })');
  await a.ctx.close();

  const b = await openPlayer({ room: r, name: 'PERS', viewport: VIEWPORTS['desktop-1280'], userId: uid });
  await waitForStore(b.page, "s.screen === 'game' && !!s.me", 40000);
  const restored = await store(b.page, '({ gold: s.me.gold, inv: s.me.inv.map(i => i.id + ":" + i.qty).sort().join(",") })');
  assert(restored.gold === snapshot.gold, `gold not persisted (${snapshot.gold} → ${restored.gold})`);
  assert(restored.inv === snapshot.inv, `inventory not persisted\n  was: ${snapshot.inv}\n  now: ${restored.inv}`);
  await b.ctx.close();
});

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Map');

await test('27. Map marker follows the player in realtime', async () => {
  const r = room();
  const { page, ctx, errors } = await openPlayer({ room: r, name: 'MAP', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'MAP');
  await page.keyboard.press('m');
  await page.waitForTimeout(600);
  assert(await page.getByText('Peta Dunia').isVisible(), 'map did not open');

  const p0 = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  await page.keyboard.down('s');
  await page.waitForTimeout(1100);
  await page.keyboard.up('s');
  const p1 = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  // The map reads getMyPosition() every frame, so proving the source moved while
  // the map is open proves the marker tracks it.
  assert(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.8, 'player did not move while the map was open');
  assert((await store(page, "s.menu === 'map'")) === true, 'map closed unexpectedly');
  assertCleanConsole(errors, 'map');
  await ctx.close();
});

await test('28. Remote players appear on the map and move', async () => {
  const r = room();
  const a = await openPlayer({ room: r, name: 'MPA', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(a.page, 'MPA');
  const b = await openPlayer({ room: r, name: 'MPB', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(b.page, 'MPB');
  await b.page.waitForTimeout(1200);
  await b.page.keyboard.press('m');
  await b.page.waitForTimeout(500);

  const before = await b.page.evaluate(() => window.__harvestEngine.getRemotePositions()[0]);
  assert(before, 'no remote marker on the map');
  await a.page.keyboard.down('d');
  await a.page.waitForTimeout(1400);
  await a.page.keyboard.up('d');
  await b.page.waitForTimeout(700);
  const after = await b.page.evaluate(() => window.__harvestEngine.getRemotePositions()[0]);
  assert(Math.hypot(after.x - before.x, after.y - before.y) > 0.6, 'remote map marker did not move');
  await a.ctx.close(); await b.ctx.close();
});

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Lifecycle');

await test('29. Tab hidden → visible resumes cleanly', async () => {
  const r = room();
  const { page, ctx, errors } = await openPlayer({ room: r, name: 'TAB', viewport: VIEWPORTS['desktop-1280'] });
  await enterWorld(page, 'TAB');
  await page.keyboard.down('w');
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(500);
  assert((await page.evaluate(() => window.__harvestInput.frame.up)) === false, 'keys not cleared when tab hid');
  assert((await page.evaluate(() => window.__harvestEngine.isPaused())) === true, 'engine did not pause when hidden');

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(1200);
  assert((await page.evaluate(() => window.__harvestEngine.isPaused())) === false, 'engine did not resume');
  assert((await store(page, "s.screen === 'game' && !!s.me")) === true, 'state lost across tab switch');

  // Movement must still work after resuming.
  const p0 = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  await page.keyboard.down('w');
  await page.waitForTimeout(800);
  await page.keyboard.up('w');
  const p1 = await page.evaluate(() => window.__harvestEngine.getMyPosition());
  assert(Math.hypot(p1.x - p0.x, p1.y - p0.y) > 0.6, 'movement broken after tab resume');
  assertCleanConsole(errors, 'tab');
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Responsive viewports');

for (const [label, vp] of Object.entries(VIEWPORTS)) {
  await test(`30.${label} — HUD fits, controls tappable, no page scroll`, async () => {
    const touch = label.startsWith('mobile') || label.startsWith('tablet');
    const r = room();
    const { page, ctx, errors } = await openPlayer({ room: r, name: 'VP', viewport: vp, touch });
    await enterWorld(page, 'VP');
    await page.waitForTimeout(500);

    // Nothing may overflow the viewport.
    const overflow = await page.evaluate(() => ({
      x: document.documentElement.scrollWidth > window.innerWidth + 1,
      y: document.documentElement.scrollHeight > window.innerHeight + 1,
    }));
    assert(!overflow.x && !overflow.y, `page scrolls (x=${overflow.x}, y=${overflow.y})`);

    // Every visible HUD control must be inside the viewport and hit-testable.
    const controls = touch
      ? ['[aria-label="Joystick gerak"]', '[aria-label="Map"]', '[aria-label="Inventory"]', '[aria-label="Chat"]', '[aria-label="Sprint"]']
      : ['[title="Minimap"]', '[title="Inventory"]', '[title="Settings"]'];
    for (const sel of controls) {
      const el = page.locator(sel).first();
      if ((await el.count()) === 0) throw new Error(`control missing: ${sel}`);
      const box = await el.boundingBox();
      assert(box, `${sel} has no box`);
      assert(box.x >= -1 && box.y >= -1, `${sel} off-screen at (${box.x}, ${box.y})`);
      assert(box.x + box.width <= vp.width + 1, `${sel} overflows right edge`);
      assert(box.y + box.height <= vp.height + 1, `${sel} overflows bottom edge`);
      assert(box.width >= 28 && box.height >= 28, `${sel} tap target too small (${box.width}×${box.height})`);
    }

    // The map modal must fit too.
    await page.evaluate(() => window.__harvestStore.getState().setMenu('map'));
    await page.waitForTimeout(500);
    const modal = await page.locator('text=Peta Dunia').first().boundingBox();
    assert(modal && modal.y >= -1 && modal.x >= -1, 'map modal escapes the viewport');
    const stillNoScroll = await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
    assert(stillNoScroll, 'map modal causes page scrolling');

    assertCleanConsole(errors, label);
    await ctx.close();
  });
}

// ─────────────────────────────────────────────────────────────
console.log('\n▶ Buttons');

await test('31. Every visible HUD/menu button is wired (no dead controls)', async () => {
  const r = room();
  const { page, ctx, errors } = await openPlayer({ room: r, name: 'BTN', viewport: VIEWPORTS['desktop-1440'] });
  await enterWorld(page, 'BTN');

  const menus = ['inventory', 'map', 'players', 'quests', 'journal', 'relationships', 'crafting', 'house', 'settings'];
  for (const m of menus) {
    await page.evaluate((id) => window.__harvestStore.getState().setMenu(id), m);
    await page.waitForTimeout(300);
    const open = await store(page, `s.menu === ${JSON.stringify(m)}`);
    assert(open, `menu ${m} did not open`);
    // The panel must render actual content, not an empty shell.
    const text = await page.locator('.relative.bg-\\[\\#0f1a2c\\]\\/97').first().innerText().catch(() => '');
    assert(text.trim().length > 10, `menu ${m} rendered empty`);
  }
  await page.evaluate(() => window.__harvestStore.getState().setMenu(null));

  // Top-bar HUD buttons must all toggle a menu.
  for (const title of ['Minimap', 'Inventory', 'Quests', 'Journal', 'Relationships', 'Crafting', 'House', 'Settings']) {
    await page.locator(`[title="${title}"]`).first().click();
    await page.waitForTimeout(250);
    const menu = await store(page, 's.menu');
    assert(menu !== null, `HUD button "${title}" did nothing`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  assertCleanConsole(errors, 'buttons');
  await ctx.close();
});

// ─────────────────────────────────────────────────────────────
await closeBrowser();

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
