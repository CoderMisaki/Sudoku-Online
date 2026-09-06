// SUITE 9 — SESSION STATE MACHINE / RECOVERY COORDINATOR (integration).
//
// Drives the REAL `HarvestSession` (src/harvest/session.ts) + REAL store +
// REAL overlay state machine against a deterministic mock WebSocket and a fake
// world engine. This is the suite that proves the acceptance criteria:
//
//   J  successful snapshot → overlay gone, game screen, canvas host kept
//   8  snapshot applied twice → no duplicate engine/players/world
//   F/G rotation → same identity, same room, no creator, no stuck loading,
//       no duplicate socket
//   L  rapid resize/orientation storm → exactly one active WebSocket
//   C  socket killed → reconnect overlay appears
//   D/H network back → hello → snapshot → overlay gone, game visible
//   E  manual "Coba Sambungkan Lagi" → genuinely fresh socket + handshake
//   I  background → foreground → probe/resync (healthy) or fresh handshake
//   M  stale socket callback after a new socket exists → state untouched
//   9  handshake without snapshot → bounded resync → FAILED (never infinite)
//   K  desktop → no orientation gate, normal session
import assert from 'assert';
import {
  loadTs, sleep, sockets, MockWebSocket, liveSockets, waitForSocket, cleanBuildDir, createFakeEngine,
} from './helpers/harvest.mjs';
import { installDom, setViewport, createHost } from './helpers/dom.mjs';

console.log('--- TEST SUITE 9: SESSION STATE MACHINE + RECOVERY COORDINATOR ---');

cleanBuildDir();
installDom({ width: 844, height: 390, touch: true }); // landscape phone

const { HarvestSession } = await loadTs('src/harvest/session.ts');
const { useHarvestStore } = await loadTs('src/harvest/store.ts');
const overlayMod = await loadTs('src/harvest/overlay.ts');
const oriMod = await loadTs('src/harvest/orientation.ts');

const FAST_SYNC = {
  helloTimeoutMs: 60,
  connectTimeoutMs: 250,
  heartbeatIntervalMs: 25,
  heartbeatTimeoutMs: 500,
  resumeGraceMs: 80,
};

const CHAR = {
  name: 'Al', farmName: 'Fm', gender: 'male', hair: 'short', hairColor: '#3b2a1e',
  skin: '#f2c9a0', eye: '#3b82f6', eyeStyle: 'round', outfit: 'overall',
  outfitColor: '#4a7a4a', shoes: '#5a4632', accessory: 'none',
};

function makeWorld(over = {}) {
  return {
    size: [224, 224],
    tileRLE: '!A',
    time: 360, day: 1, season: 'spring', weather: 'sunny',
    community: null,
    festival: { active: false, def: null, items: [] },
    npcs: {}, crops: {}, tilled: {}, forage: {}, trees: {},
    mine: { depth: 0, maxDepth: 5 },
    mineDoor: [10, 10], bridge: [12, 12], villageCenter: [14, 14], farmArea: [4, 4, 10, 10],
    ...over,
  };
}

function makeSnapshot(over = {}) {
  return {
    t: 'snapshot',
    world: makeWorld(over.world),
    me: {
      id: 'u-1', username: 'BOB', farmName: 'Fm', char: over.char === undefined ? CHAR : over.char,
      x: 10, y: 10, dir: 2, anim: 'idle', sprint: false, gold: 500, stamina: 100, maxStamina: 100,
      inv: [{ id: 'tool_hoe', qty: 1 }], invMax: 24, skills: {}, quests: { active: [], done: [], progress: {} },
      journal: {}, rel: {}, spouse: null, house: { level: 1, furniture: [] }, buffs: [], stats: {},
      animals: [], toolLevels: {},
      ...(over.me || {}),
    },
    players: over.players || [],
    defs: over.defs || { items: {}, crops: {}, fish: {}, recipes: [], npcs: [], skills: {} },
    prices: over.prices || {},
  };
}

const freshStore = (over = {}) => useHarvestStore.setState({
  status: 'connecting', screen: 'loading', errorMsg: '', roomCode: 'ROOM9',
  userId: 'u-1', userName: 'BOB', me: null, defs: null, prices: {},
  playersShort: {}, menu: null, dialogue: null, toasts: [], chat: [],
  mine: null, wasInGame: false, selectedItem: null, chatOpen: false,
  snapshotCount: 0, lastRecovery: null,
  ...over,
});

const live = [];
function makeSession(over = {}) {
  freshStore(over.store);
  const engines = [];
  const host = createHost();
  const session = new HarvestSession({
    roomId: over.room || 'ROOM9',
    engineFactory: (h, opts) => {
      const e = createFakeEngine(h);
      e.opts = opts;
      engines.push(e);
      return e;
    },
    coalesceMs: over.coalesceMs ?? 40,
    snapshotWatchdogMs: over.snapshotWatchdogMs ?? 120,
    maxSnapshotAttempts: over.maxSnapshotAttempts ?? 2,
    syncOptions: { ...FAST_SYNC, ...(over.sync || {}) },
  });
  live.push(session);
  session.attachHost(host);
  assert.strictEqual(session.start(), true, 'session starts once identity is known');
  return { session, engines, host };
}

const store = () => useHarvestStore.getState();
const overlay = () => overlayMod.connectionOverlay(store().screen, store().status);
/** Open the socket of a freshly started session and complete the handshake. */
async function reachGame(ctx, snapshotOver) {
  const sock = await waitForSocket(sockets.length - 1, { open: true, timeout: 1000 });
  assert.ok(sock, 'socket opened');
  assert.ok(sock.lastHello(), 'hello sent on open');
  sock.__receive(makeSnapshot(snapshotOver));
  await sleep(10);
  return sock;
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 (TEST J) — snapshot is the ONLY door into the game; overlay must vanish
// ─────────────────────────────────────────────────────────────────────────────
{
  const ctx = makeSession();
  assert.strictEqual(store().screen, 'loading', 'starts on the loading screen');
  assert.ok(overlay(), 'loading overlay visible before the handshake');

  const sock = await reachGame(ctx);
  assert.strictEqual(store().screen, 'game', 'snapshot moves the UI into the game');
  assert.strictEqual(store().status, 'ready', 'status is terminal ready (not "open")');
  assert.strictEqual(overlay(), null, 'no overlay may survive a successful snapshot');
  assert.strictEqual(overlayMod.shouldShowConnectionOverlay('game', 'ready'), false);
  assert.strictEqual(ctx.engines.length, 1, 'exactly one engine created');
  assert.strictEqual(ctx.engines[0].host, ctx.host, 'engine bound to the persistent canvas host');
  assert.strictEqual(ctx.session.diagnostics.snapshotsApplied, 1);
  assert.strictEqual(ctx.session.diagnostics.socketsCreated, 1, 'one socket for the whole session');
  assert.strictEqual(store().me.gold, 500, 'player state applied');
  assert.ok(sock.messages('hello')[0].userId === 'u-1', 'identity sent to the server');
  ctx.session.dispose();
  console.log('✔ PART 1 — snapshot → game + ready, overlay gone, one engine, one socket');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 (REQ 8) — snapshot application is idempotent
// ─────────────────────────────────────────────────────────────────────────────
{
  const ctx = makeSession();
  const sock = await reachGame(ctx, {
    players: [{ id: 'u-2', username: 'SIS', char: CHAR, x: 5, y: 5, dir: 0, anim: 'idle' }],
  });
  const engine = ctx.engines[0];
  const firstCount = store().snapshotCount;

  // The server resends the very same authoritative snapshot (resync/reconnect).
  sock.__receive(makeSnapshot({
    players: [{ id: 'u-2', username: 'SIS', char: CHAR, x: 5, y: 5, dir: 0, anim: 'idle' }],
  }));
  await sleep(10);

  assert.strictEqual(store().snapshotCount, firstCount + 1, 'snapshot counter moved');
  assert.strictEqual(ctx.engines.length, 1, 'NO duplicate engine on a repeated snapshot');
  assert.strictEqual(ctx.session.diagnostics.enginesCreated, 1);
  assert.strictEqual(engine.remotes.size, 1, 'NO duplicate remote players');
  assert.strictEqual(store().screen, 'game');
  assert.strictEqual(store().status, 'ready');
  assert.strictEqual(overlay(), null, 'still no overlay');
  assert.strictEqual(store().chat.length, 0, 'no duplicated chat lines');
  ctx.session.dispose();
  console.log('✔ PART 2 — repeated snapshots are idempotent (no duplicate engine/players)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 (TEST F/G) — rotation never resets the session
// ─────────────────────────────────────────────────────────────────────────────
{
  const ctx = makeSession();
  await reachGame(ctx);
  const identity = { ...ctx.session.diagnostics.identity };
  const socketsBefore = ctx.session.diagnostics.socketsCreated;
  const engine = ctx.engines[0];

  for (const [w, h] of [[390, 844], [844, 390], [390, 844], [844, 390]]) {
    setViewport(w, h, { fire: false });
    ctx.session.recoverNow('orientation', true);
    await sleep(90); // double-rAF settle + probe
    assert.strictEqual(store().screen, 'game', `rotation to ${w}x${h} must keep the game screen`);
    assert.strictEqual(store().status, 'ready', 'rotation must not reopen the loading state');
    assert.strictEqual(overlay(), null, 'no overlay after a rotation');
    assert.strictEqual(ctx.session.diagnostics.socketsCreated, socketsBefore, 'rotation never creates a socket');
    assert.deepStrictEqual(ctx.session.diagnostics.identity, identity, 'identity is stable across rotation');
    assert.strictEqual(ctx.engines.length, 1, 'engine is never rebuilt by rotation');
    assert.strictEqual(engine.calls.dispose, 0, 'engine never disposed by rotation');
    assert.strictEqual(store().userId, 'u-1');
    assert.strictEqual(store().roomCode, 'ROOM9');
    assert.ok(store().me && store().me.char, 'character never lost → no creator screen');
  }
  assert.strictEqual(liveSockets().length, 1, 'exactly one live socket after 4 rotations');
  ctx.session.dispose();
  console.log('✔ PART 3 — rotation preserves identity/room/engine, never re-enters creator');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 (TEST L) — resize/orientation event storm → one WebSocket
// ─────────────────────────────────────────────────────────────────────────────
{
  const ctx = makeSession();
  await reachGame(ctx);
  const before = ctx.session.diagnostics.socketsCreated;

  // A real rotation fires resize + orientationchange + visualViewport together.
  for (let i = 0; i < 25; i++) {
    setViewport(i % 2 ? 844 : 390, i % 2 ? 390 : 844, { fire: false });
    ctx.session.recover('resize', false);
    ctx.session.recover('orientation', true);
    ctx.session.recover('viewport', false);
  }
  await sleep(120);
  assert.strictEqual(ctx.session.diagnostics.socketsCreated, before, 'storm created no socket');
  assert.strictEqual(liveSockets().length, 1, 'exactly one active WebSocket during a storm');
  assert.strictEqual(ctx.session.diagnostics.recoveries, 0, 'no forced recovery for a healthy session');
  assert.strictEqual(overlay(), null, 'no stuck overlay after the storm');
  ctx.session.dispose();
  console.log('✔ PART 4 — event storm is coalesced, exactly one active WebSocket');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4b — passive events probe (never instantly kill) an OPEN socket
// ─────────────────────────────────────────────────────────────────────────────
{
  const ctx = makeSession();
  const sock = await reachGame(ctx);
  sock.noPong = true; // link silently died (mobile radio handover)
  const before = ctx.session.diagnostics.socketsCreated;

  // Mobile browsers fire resize continuously: a passive signal must not drop an
  // OPEN + handshook socket on a stale heartbeat alone.
  ctx.session.recoverNow('resize', false);
  await sleep(30);
  assert.strictEqual(ctx.session.diagnostics.socketsCreated, before, 'passive resize probed instead of reconnecting');
  assert.strictEqual(sock.readyState, MockWebSocket.OPEN, 'socket left alive during the grace window');

  // The unanswered probe then forces exactly one fresh handshake.
  const since = sockets.length;
  await sleep(200);
  assert.ok(ctx.session.diagnostics.socketsCreated > before, 'dead socket recovered after the probe grace');
  const fresh = await waitForSocket(since, { open: true, timeout: 1000 });
  assert.ok(fresh, 'one fresh socket');
  fresh.__receive(makeSnapshot());
  await sleep(10);
  assert.strictEqual(store().status, 'ready');
  assert.strictEqual(overlay(), null, 'no stuck overlay after a passive-triggered recovery');
  assert.strictEqual(ctx.engines.length, 1);
  ctx.session.dispose();
  console.log('✔ PART 4b — passive signals probe first, then recover a dead socket');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 5 (TEST C/D/H) — kill socket → overlay; network back → game
// ─────────────────────────────────────────────────────────────────────────────
{
  const ctx = makeSession();
  const sock = await reachGame(ctx);
  assert.strictEqual(overlay(), null);

  // ── C: the link dies ──
  sock.__kill();
  await sleep(10);
  assert.strictEqual(store().status, 'reconnecting', 'disconnect surfaces as reconnecting');
  const shown = overlay();
  assert.ok(shown && shown.kind === 'reconnecting', 'reconnect overlay appears');
  assert.strictEqual(shown.title, 'Menghubungkan Kembali...');
  assert.strictEqual(store().screen, 'game', 'the game screen is preserved while reconnecting');
  assert.ok(store().me && store().me.char, 'player state is NOT wiped by a disconnect');

  // ── D/H: the network comes back (browser fired `online`) ──
  const since = sockets.length;
  ctx.session.recoverNow('online', true);
  const fresh = await waitForSocket(since, { open: true, timeout: 1500 });
  assert.ok(fresh, 'a fresh socket was opened by the recovery coordinator');
  assert.notStrictEqual(fresh, sock, 'it is a NEW socket, not the dead one');
  const hello = fresh.lastHello();
  assert.strictEqual(hello.userId, 'u-1', 'same userId → same player resumes');
  assert.strictEqual(hello.room, 'ROOM9', 'same room → no new world');
  fresh.__receive(makeSnapshot());
  await sleep(10);
  assert.strictEqual(store().status, 'ready', 'handshake terminal state reached');
  assert.strictEqual(store().screen, 'game');
  assert.strictEqual(overlay(), null, 'reconnect overlay is GONE after recovery');
  assert.strictEqual(ctx.engines.length, 1, 'recovery did not build a second engine');
  ctx.session.dispose();
  console.log('✔ PART 5 — disconnect shows overlay, online recovery clears it (same identity)');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 6 (TEST E) — "Coba Sambungkan Lagi" is a genuinely fresh handshake
// ─────────────────────────────────────────────────────────────────────────────
{
  const ctx = makeSession();
  const sock = await reachGame(ctx);
  sock.noPong = true;
  sock.__kill();
  await sleep(10);
  assert.ok(overlay(), 'overlay visible while down');

  const since = sockets.length;
  ctx.session.manualRetry();
  assert.strictEqual(store().status, 'recovering', 'manual retry leaves the failed state at once');
  const fresh = await waitForSocket(since, { open: true, timeout: 1000 });
  assert.ok(fresh, 'manual retry opened exactly one fresh socket');
  assert.strictEqual(sockets.slice(since).length, 1, 'exactly ONE socket created by the retry');
  assert.strictEqual(sock.readyState, MockWebSocket.CLOSED, 'old socket destroyed');
  // The dead socket must be inert: late frames / close events cannot touch the
  // new session (generation guard), even if the browser still holds handlers.
  const snapsBefore = store().snapshotCount;
  if (sock.onmessage) sock.onmessage({ data: JSON.stringify(makeSnapshot({ me: { gold: 1 } })) });
  if (sock.onclose) sock.onclose({});
  await sleep(5);
  assert.strictEqual(store().snapshotCount, snapsBefore, 'dead socket cannot deliver a snapshot');
  assert.ok(liveSockets().includes(fresh), 'dead socket close did not kill the fresh one');
  assert.ok(fresh.lastHello(), 'fresh hello sent');
  assert.strictEqual(fresh.lastHello().username, 'BOB', 'same username');

  fresh.__receive(makeSnapshot());
  await sleep(10);
  assert.strictEqual(store().screen, 'game');
  assert.strictEqual(store().status, 'ready');
  assert.strictEqual(overlay(), null, 'overlay hidden after the manual retry succeeded');

  // Manual retry also works from the FAILED state (budget exhausted).
  const ctx2 = makeSession({ sync: { maxAutoRetries: 0 } });
  const s2 = await waitForSocket(sockets.length - 1, { open: true });
  s2.__kill();
  await sleep(20);
  assert.strictEqual(store().status, 'error', 'exhausted budget → FAILED, not infinite loading');
  const failed = overlay();
  assert.ok(failed && failed.kind === 'failed', 'actionable FAILED overlay');
  assert.strictEqual(failed.title, 'Koneksi belum berhasil dipulihkan');
  assert.strictEqual(failed.allowReload, true);
  ctx2.session.manualRetry();
  assert.notStrictEqual(store().status, 'error', 'manual retry clears FAILED');
  const s3 = await waitForSocket(sockets.length - 1, { open: true });
  s3.__receive(makeSnapshot());
  await sleep(10);
  assert.strictEqual(store().screen, 'game', 'FAILED → game after one manual retry');
  assert.strictEqual(overlay(), null);
  ctx.session.dispose();
  ctx2.session.dispose();
  console.log('✔ PART 6 — manual retry rebuilds one fresh socket and clears FAILED');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 7 (TEST I) — background → foreground
// ─────────────────────────────────────────────────────────────────────────────
{
  // 7a. healthy session resumes without a needless reconnect
  {
    const ctx = makeSession();
    await reachGame(ctx);
    const before = ctx.session.diagnostics.socketsCreated;
    ctx.session.recoverNow('visibility', true);
    await sleep(90);
    assert.strictEqual(ctx.session.diagnostics.socketsCreated, before, 'healthy resume does not reconnect');
    assert.strictEqual(store().status, 'ready');
    assert.strictEqual(overlay(), null, 'no overlay flashed on resume');
    ctx.session.dispose();
  }
  // 7b. socket that silently died in the background → fresh handshake
  {
    const ctx = makeSession();
    const sock = await reachGame(ctx);
    sock.noPong = true; // suspended socket: OPEN but never answers
    const since = sockets.length;
    ctx.session.recoverNow('visibility', true);
    await sleep(200); // resume grace elapses without a pong
    const fresh = await waitForSocket(since, { open: true, timeout: 1500 });
    assert.ok(fresh, 'dead-after-background socket replaced');
    fresh.__receive(makeSnapshot());
    await sleep(10);
    assert.strictEqual(store().screen, 'game', 'game restored after backgrounding');
    assert.strictEqual(overlay(), null);
    assert.strictEqual(ctx.engines.length, 1);
    ctx.session.dispose();
  }
  // 7c. resync is requested when the UI is NOT settled (lost snapshot)
  {
    const ctx = makeSession();
    const sock = await reachGame(ctx);
    useHarvestStore.setState({ screen: 'loading' }); // simulate a lost snapshot
    ctx.session.recoverNow('pageshow', true);
    await sleep(90);
    assert.ok(sock.messages('req_state').length >= 1, 'resync requested when the UI is not settled');
    sock.__receive(makeSnapshot());
    await sleep(10);
    assert.strictEqual(store().screen, 'game');
    ctx.session.dispose();
  }
  console.log('✔ PART 7 — foreground resume: probe healthy, replace dead, resync when needed');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 8 (TEST M) — stale socket callbacks can never corrupt the new session
// ─────────────────────────────────────────────────────────────────────────────
{
  const ctx = makeSession();
  const stale = await reachGame(ctx);
  const snapshotsBefore = store().snapshotCount;
  const goldBefore = store().me.gold;

  ctx.session.manualRetry();
  const fresh = await waitForSocket(sockets.length - 1, { open: true, timeout: 1000 });

  // The nuked socket tries to deliver a snapshot / close event late.
  stale.__receive(makeSnapshot({ me: { gold: 1 } }));
  stale.__serverClose();
  await sleep(30);

  assert.strictEqual(store().snapshotCount, snapshotsBefore, 'stale snapshot ignored');
  assert.strictEqual(store().me.gold, goldBefore, 'stale payload did not corrupt player state');
  assert.strictEqual(store().status, 'hello', 'stale close did not flip the new socket into reconnecting');
  assert.strictEqual(liveSockets().length, 1, 'stale close did not kill the fresh socket');
  assert.ok(liveSockets().includes(fresh));

  fresh.__receive(makeSnapshot({ me: { gold: 777 } }));
  await sleep(10);
  assert.strictEqual(store().me.gold, 777, 'only the current socket feeds the store');
  assert.strictEqual(store().status, 'ready');
  assert.strictEqual(overlay(), null);
  ctx.session.dispose();
  console.log('✔ PART 8 — generation guard: stale socket callbacks are inert');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 9 (REQ 9) — loading can never be infinite
// ─────────────────────────────────────────────────────────────────────────────
{
  // Handshake acks but the snapshot never arrives → bounded resync → FAILED.
  const ctx = makeSession({ snapshotWatchdogMs: 60, maxSnapshotAttempts: 2 });
  const sock = await waitForSocket(sockets.length - 1, { open: true, timeout: 1000 });
  sock.__receive({ t: 'hello_ack', player: null, needsCreation: false });
  await sleep(10);
  assert.strictEqual(store().status, 'syncing', 'waiting for the snapshot is explicit');
  assert.ok(overlay(), 'loading overlay while waiting');

  await sleep(260); // 2 watchdog windows elapse without a snapshot
  assert.ok(sock.messages('req_state').length >= 1, 'resync requested instead of waiting forever');
  assert.strictEqual(store().status, 'error', 'bounded resync ends in FAILED');
  const failed = overlay();
  assert.ok(failed && failed.kind === 'failed', 'actionable FAILED overlay, never an infinite spinner');

  // …and a late snapshot still rescues the session.
  sock.__receive(makeSnapshot());
  await sleep(10);
  assert.strictEqual(store().screen, 'game', 'a late snapshot recovers the game');
  assert.strictEqual(overlay(), null, 'FAILED disappears the moment the snapshot lands');
  ctx.session.dispose();

  // New player: hello_ack(needsCreation) must land on the creator, unblocked.
  const ctx2 = makeSession({ snapshotWatchdogMs: 60 });
  const s2 = await waitForSocket(sockets.length - 1, { open: true, timeout: 1000 });
  s2.__receive({ t: 'hello_ack', player: null, needsCreation: true });
  await sleep(10);
  assert.strictEqual(store().screen, 'creator', 'new player goes to the character creator');
  assert.strictEqual(overlay(), null, 'the creator is never covered by a loading overlay');
  await sleep(140);
  assert.notStrictEqual(store().status, 'error', 'creator flow does not time out into FAILED');
  ctx2.session.dispose();
  console.log('✔ PART 9 — bounded resync, FAILED is recoverable, creator never blocked');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 10 (TEST K) — desktop is never gated, engine host re-attachment
// ─────────────────────────────────────────────────────────────────────────────
{
  installDom({ width: 1920, height: 1080, touch: false, lock: false });
  assert.strictEqual(oriMod.deviceClass(), 'desktop');
  assert.strictEqual(oriMod.shouldGateOrientation(), false, 'desktop shows no orientation gate');
  assert.strictEqual(oriMod.isLandscapeDevice(), true);
  const lockRes = await oriMod.requestLandscapeLock();
  assert.strictEqual(lockRes.state, 'idle', 'desktop is never asked to rotate');
  assert.strictEqual((globalThis.window.__lockCalls || []).length, 0, 'no lock/unlock call on desktop');

  const ctx = makeSession();
  await reachGame(ctx);
  assert.strictEqual(store().screen, 'game', 'desktop session reaches the game');

  // React remounting the canvas host must re-attach, never rebuild the engine.
  const host2 = createHost(1280, 720);
  ctx.session.attachHost(host2);
  assert.strictEqual(ctx.engines.length, 1, 'no second engine after a host remount');
  assert.strictEqual(ctx.engines[0].calls.attachTo, 1, 'existing canvas re-attached');
  assert.strictEqual(ctx.engines[0].host, host2);
  ctx.session.dispose();

  // Tablet portrait → gate; tablet landscape → no gate (lock refused is OK).
  installDom({ width: 768, height: 1024, touch: true, lock: 'reject' });
  assert.strictEqual(oriMod.deviceClass(), 'tablet');
  assert.strictEqual(oriMod.shouldGateOrientation(), true, 'tablet portrait gates');
  const refused = await oriMod.requestLandscapeLock();
  assert.strictEqual(refused.state, 'denied', 'refused lock degrades to the gate, never throws');
  setViewport(1024, 768, { fire: false });
  assert.strictEqual(oriMod.shouldGateOrientation(), false, 'tablet landscape plays on');

  // PWA standalone detection
  installDom({ width: 390, height: 844, touch: true, standalone: true, lock: true });
  assert.strictEqual(oriMod.displayMode(), 'standalone');
  assert.strictEqual(oriMod.isStandalonePWA(), true);
  assert.strictEqual(oriMod.deviceClass(), 'phone');
  assert.strictEqual(oriMod.shouldGateOrientation(), true, 'portrait phone gates until locked');
  const locked = await oriMod.requestLandscapeLock();
  assert.strictEqual(locked.state, 'locked', 'Android PWA accepts the landscape lock');
  assert.ok((globalThis.window.__lockCalls || []).includes('landscape'), 'lock("landscape") requested');
  assert.ok(!(globalThis.window.__lockCalls || []).includes('unlock'), 'NEVER unlocks orientation');

  // No lock API at all (iOS Safari) → unsupported, never a crash
  installDom({ width: 390, height: 844, touch: true, lock: false });
  const noApi = await oriMod.requestLandscapeLock();
  assert.strictEqual(noApi.state, 'unsupported');
  assert.strictEqual(oriMod.shouldGateOrientation(), true, 'fallback gate stays available');
  console.log('✔ PART 10 — desktop exempt, host re-attach, PWA lock as progressive enhancement');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 11 — overlay truth table (single source of truth for the UI)
// ─────────────────────────────────────────────────────────────────────────────
{
  const { connectionOverlay: co, shouldShowConnectionOverlay: show } = overlayMod;
  // Terminal states must never cover the game.
  for (const s of ['ready', 'connected', 'closed']) {
    assert.strictEqual(co('game', s), null, `game + ${s} → no overlay`);
    assert.strictEqual(show('game', s), false);
  }
  // Every non-terminal state must be visible (no silent hang).
  assert.strictEqual(co('loading', 'connecting').kind, 'loading');
  assert.strictEqual(co('loading', 'hello').kind, 'loading', 'first load copy');
  assert.strictEqual(co('loading', 'syncing').kind, 'loading', 'first load copy');
  assert.strictEqual(co('game', 'reconnecting').kind, 'reconnecting');
  assert.strictEqual(co('game', 'recovering').kind, 'recovering');
  assert.strictEqual(co('game', 'connecting').kind, 'loading');
  // Re-handshaking an existing session reads as recovery, not as a first load.
  assert.strictEqual(co('game', 'hello').kind, 'recovering');
  assert.strictEqual(co('game', 'syncing').kind, 'recovering');
  assert.strictEqual(co('game', 'error').kind, 'failed');
  // The creator is playable during the handshake, blocked only by real trouble.
  assert.strictEqual(co('creator', 'ready'), null);
  assert.strictEqual(co('creator', 'hello'), null);
  assert.strictEqual(co('creator', 'syncing'), null);
  assert.strictEqual(co('creator', 'reconnecting').kind, 'reconnecting');
  assert.strictEqual(co('creator', 'error').kind, 'failed');
  // The dedicated error screen owns its state.
  assert.strictEqual(co('error', 'error'), null);
  // Pre-game screens always own an overlay (never a blank page).
  for (const s of ['ready', 'connected', 'closed', 'connecting', 'hello', 'syncing']) {
    assert.ok(co('loading', s), `loading screen + ${s} still shows an overlay`);
  }
  console.log('✔ PART 11 — overlay truth table (ready always wins, nothing hangs silently)');
}

for (const s of live) { try { s.dispose(); } catch {} }
await sleep(30);
cleanBuildDir();
console.log('SUITE 9 PASSED!\n');
