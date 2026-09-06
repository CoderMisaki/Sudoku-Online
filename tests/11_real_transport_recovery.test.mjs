// SUITE 11 — REAL TRANSPORT RECOVERY (no mocks).
//
// Boots the REAL game server (server/harvest-server.mjs) on a local port and
// drives the REAL HarvestSession + SyncClient over Node's native WebSocket.
// This is the closest thing to the browser E2E that can run headless:
//
//   • first handshake → creator → create → snapshot → game
//   • kill the socket → reconnect overlay state → automatic recovery → game
//   • manual retry → fresh socket, same identity, same world/player
//   • background/foreground resume on a healthy socket → no needless reconnect
//   • rotation storm → still exactly one socket, one engine, one player
//   • a second player in the same room is preserved across reconnects
import assert from 'assert';
import http from 'node:http';
import fs from 'node:fs';
import { loadTs, sleep, cleanBuildDir, createFakeEngine } from './helpers/harvest.mjs';
import { installDom, setViewport, createHost } from './helpers/dom.mjs';
import { createHarvestServer } from '../server/harvest-server.mjs';

console.log('--- TEST SUITE 11: REAL TRANSPORT RECONNECT (server + client, no mocks) ---');

// Capture the Node natives jsdom would otherwise shadow: undici's WebSocket
// dispatches Node `Event` instances and validates them with instanceof.
const NodeWebSocket = globalThis.WebSocket;
const NodeEvent = globalThis.Event;

// ── real server on an ephemeral port ──
const httpServer = http.createServer((req, res) => {
  if (req.url === '/api/harvest/health') { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":true}'); return; }
  res.statusCode = 404; res.end();
});
// Same wiring as server/run.mjs: the game server owns the /ws/harvest upgrade.
httpServer.on('upgrade', (req, socket, head) => {
  if (req.url && req.url.split('?')[0] === '/ws/harvest') harvestServer.handleUpgrade(req, socket, head);
  else socket.destroy();
});
await new Promise((r) => httpServer.listen(0, '127.0.0.1', r));
const port = httpServer.address().port;
const harvestServer = createHarvestServer(httpServer);
const harvest = harvestServer;

cleanBuildDir();
installDom({ width: 844, height: 390, touch: true, url: `http://127.0.0.1:${port}/harvest/LIVE1` });
// Use the REAL WebSocket implementation (and its Event class) for this suite.
const define = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
define('WebSocket', NodeWebSocket);
define('Event', NodeEvent);

const { HarvestSession } = await loadTs('src/harvest/session.ts');
const { useHarvestStore } = await loadTs('src/harvest/store.ts');
const overlayMod = await loadTs('src/harvest/overlay.ts');

const store = () => useHarvestStore.getState();
const overlay = () => overlayMod.connectionOverlay(store().screen, store().status);

/** Wait until `pred()` is true, polling like a browser would. */
async function until(pred, { timeout = 8000, label = 'condition' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (pred()) return true;
    await sleep(25);
  }
  throw new Error(`timeout waiting for ${label} (screen=${store().screen} status=${store().status})`);
}

const sessions = [];
function makeSession({ room, userId, username }) {
  useHarvestStore.setState({
    status: 'connecting', screen: 'loading', errorMsg: '', roomCode: room,
    userId, userName: username, me: null, defs: null, prices: {}, playersShort: {},
    menu: null, dialogue: null, toasts: [], chat: [], mine: null, wasInGame: false,
    selectedItem: null, chatOpen: false, snapshotCount: 0, lastRecovery: null,
  });
  const engines = [];
  const host = createHost();
  const session = new HarvestSession({
    roomId: room,
    engineFactory: (h) => { const e = createFakeEngine(h); engines.push(e); return e; },
    coalesceMs: 120,
    snapshotWatchdogMs: 3000,
    syncOptions: {
      heartbeatIntervalMs: 1000,
      heartbeatTimeoutMs: 4000,
      connectTimeoutMs: 4000,
      helloTimeoutMs: 4000,
      resumeGraceMs: 1200,
    },
  });
  sessions.push(session);
  session.attachHost(host);
  assert.strictEqual(session.start(), true);
  return { session, engines, host };
}

const ROOM = 'LIVE' + Date.now().toString(36).toUpperCase().slice(-4);

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — first handshake over a real socket: creator → snapshot → game
// ─────────────────────────────────────────────────────────────────────────────
const ctx = makeSession({ room: ROOM, userId: 'u-live-1', username: 'LIVE1' });
await until(() => store().screen === 'creator', { label: 'character creator' });
assert.strictEqual(store().status, 'ready', 'handshake reached its terminal state');
assert.strictEqual(overlay(), null, 'no overlay may cover the creator');
assert.strictEqual(ctx.session.diagnostics.socketsCreated, 1, 'exactly one socket');

ctx.session.createCharacter(
  {
    name: 'LIVE', farmName: 'Live Farm', gender: 'male', hair: 'short', hairColor: '#3b2a1e',
    skin: '#f2c9a0', eye: '#3b82f6', eyeStyle: 'round', outfit: 'overall',
    outfitColor: '#4a7a4a', shoes: '#5a4632', accessory: 'none',
  },
  'Live Farm',
);
await until(() => store().screen === 'game', { label: 'game screen after create' });
assert.strictEqual(store().status, 'ready');
assert.strictEqual(overlay(), null, 'overlay gone after the authoritative snapshot');
assert.strictEqual(ctx.engines.length, 1, 'one engine created');
assert.ok(store().me.char, 'character stored');
assert.ok(store().me.inv.length > 0, 'starter inventory applied');
const identity = { ...ctx.session.diagnostics.identity };
const goldBefore = store().me.gold;
console.log('✔ PART 1 — real handshake: creator → snapshot → game (one socket, one engine)');

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — a second real player joins the same room
// ─────────────────────────────────────────────────────────────────────────────
const ctx2 = makeSession({ room: ROOM, userId: 'u-live-2', username: 'LIVE2' });
await until(() => store().screen === 'creator', { label: 'second player creator' });
ctx2.session.createCharacter({ name: 'SIS', farmName: 'Sis Farm' }, 'Sis Farm');
await until(() => store().screen === 'game', { label: 'second player game' });
assert.strictEqual(ctx2.session.diagnostics.identity.userId, 'u-live-2');
console.log('✔ PART 2 — second player joins the same world');

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — kill the socket (TEST C/D): overlay appears, auto-recovery restores
// ─────────────────────────────────────────────────────────────────────────────
{
  // Put the store back on player 1's view for the assertions below.
  useHarvestStore.setState({ userId: 'u-live-1', userName: 'LIVE1', roomCode: ROOM });
  const before = ctx.session.diagnostics.socketsCreated;
  ctx.session.sync.ws.close(); // hard client-side kill, like a mobile radio drop

  await until(() => store().status === 'reconnecting' || store().status === 'recovering', {
    label: 'reconnecting state',
  });
  const shown = overlay();
  assert.ok(shown, 'connection overlay appears when the socket dies');
  assert.ok(['reconnecting', 'recovering', 'loading'].includes(shown.kind), `overlay kind=${shown.kind}`);
  assert.strictEqual(store().screen, 'game', 'game screen preserved during the drop');

  // Automatic recovery — no user action, no reload.
  await until(() => store().status === 'ready' && overlay() === null, { label: 'automatic recovery' });
  assert.strictEqual(store().screen, 'game', 'back in the game');
  assert.strictEqual(store().me.id, 'u-live-1', 'SAME player resumed (not a new one)');
  assert.ok(store().me.char, 'character preserved');
  assert.strictEqual(store().me.gold, goldBefore, 'gold preserved across the reconnect');
  assert.deepStrictEqual(ctx.session.diagnostics.identity, identity, 'identity unchanged');
  assert.strictEqual(ctx.engines.length, 1, 'no second engine after recovery');
  assert.ok(ctx.session.diagnostics.socketsCreated > before, 'recovery really opened a new socket');
  console.log('✔ PART 3 — socket kill → overlay → automatic recovery with the same player');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — manual retry (TEST E) over the real transport
// ─────────────────────────────────────────────────────────────────────────────
{
  const oldSocket = ctx.session.sync.ws;
  ctx.session.manualRetry();
  assert.notStrictEqual(store().status, 'error', 'manual retry never leaves the session FAILED');
  await until(() => store().status === 'ready' && overlay() === null, { label: 'manual retry recovery' });
  assert.notStrictEqual(ctx.session.sync.ws, oldSocket, 'a genuinely NEW socket is in use');
  assert.ok(
    oldSocket.readyState === NodeWebSocket.CLOSED || oldSocket.readyState === NodeWebSocket.CLOSING,
    'old socket closed',
  );
  assert.strictEqual(store().screen, 'game');
  assert.strictEqual(store().me.id, 'u-live-1', 'still the same player');
  assert.strictEqual(ctx.engines.length, 1, 'engine reused');
  console.log('✔ PART 4 — manual retry produces one fresh socket and restores the game');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — rotation storm on a live session (TEST F/G/L)
// ─────────────────────────────────────────────────────────────────────────────
{
  const socketsBefore = ctx.session.diagnostics.socketsCreated;
  const snapshotsBefore = store().snapshotCount;
  for (const [w, h] of [[390, 844], [844, 390], [390, 844], [844, 390], [390, 844], [844, 390]]) {
    setViewport(w, h, { fire: false });
    ctx.session.recoverNow('orientation', true);
    await sleep(40);
    assert.strictEqual(store().screen, 'game', `rotation to ${w}x${h} keeps the game screen`);
    assert.strictEqual(overlay(), null, `no overlay after rotating to ${w}x${h}`);
    assert.strictEqual(store().me.id, 'u-live-1', 'player identity survives rotation');
    assert.strictEqual(store().roomCode, ROOM, 'room survives rotation');
    assert.ok(store().me.char, 'never bounced back to the creator');
  }
  assert.strictEqual(ctx.session.diagnostics.socketsCreated, socketsBefore, 'rotation created no socket');
  assert.strictEqual(ctx.engines.length, 1, 'rotation rebuilt no engine');
  assert.ok(store().snapshotCount >= snapshotsBefore, 'snapshot state never lost');
  console.log('✔ PART 5 — 6 rotations: one socket, one engine, session intact');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 6 — background → foreground on a healthy socket (TEST I)
// ─────────────────────────────────────────────────────────────────────────────
{
  const socketsBefore = ctx.session.diagnostics.socketsCreated;
  ctx.session.recoverNow('visibility', true);
  await sleep(400); // comfortably longer than the resume grace period
  assert.strictEqual(ctx.session.diagnostics.socketsCreated, socketsBefore, 'healthy resume did not reconnect');
  assert.strictEqual(store().status, 'ready');
  assert.strictEqual(overlay(), null, 'no overlay flashed after resuming');
  assert.strictEqual(store().screen, 'game');
  console.log('✔ PART 6 — foreground resume keeps a healthy socket untouched');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 7 — one player record per identity; resync is idempotent
// ─────────────────────────────────────────────────────────────────────────────
{
  const world = harvest.getWorld(ROOM);
  const players = harvest.playersOf(world);
  assert.strictEqual(Object.keys(players).length, 2, 'exactly two player records');
  assert.ok(players['u-live-1'] && players['u-live-2']);
  assert.strictEqual(players['u-live-1'].char.name, 'LIVE', 'character persisted server-side');
  assert.strictEqual(harvest.clients.size, 2, 'exactly two live connections');

  const snaps = store().snapshotCount;
  ctx.session.sync.requestResync();
  ctx.session.sync.requestResync();
  await until(() => store().snapshotCount >= snaps + 1, { label: 'resync snapshot' });
  await sleep(200);
  assert.strictEqual(ctx.engines.length, 1, 'resync did not create an engine');
  assert.strictEqual(store().me.id, 'u-live-1', 'resync kept the same player');
  assert.strictEqual(overlay(), null);
  assert.strictEqual(harvest.clients.size, 2, 'resync did not duplicate the connection');
  console.log('✔ PART 7 — server holds one player per identity; resync is idempotent');
}

// ── teardown ──
for (const s of sessions) { try { s.dispose(); } catch {} }
harvest.stop();
httpServer.close();
try { fs.rmSync(harvest.saveFile(ROOM), { force: true }); } catch {}
await sleep(50);
cleanBuildDir();
console.log('SUITE 11 PASSED!\n');
process.exit(0);
