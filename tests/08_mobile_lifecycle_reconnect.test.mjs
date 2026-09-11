import assert from 'assert';
import fs from 'node:fs';
import {
  loadTs, sleep, sockets, MockWebSocket, liveSockets, waitForSocket, cleanBuildDir,
} from './helpers/harvest.mjs';
import { installDom } from './helpers/dom.mjs';

console.log('--- TEST SUITE 8: MOBILE LIFECYCLE + WEBSOCKET RECONNECT ---');

cleanBuildDir();

// jsdom window (landscape phone). The client modules read window.* lazily, so
// PART 6 can still swap in synthetic windows for orientation scenarios.
installDom({ width: 844, height: 390, touch: true });

// NOTE: transpiling is synchronous and blocks the event loop, so ALL test
// modules are loaded up-front before any client timers start.
const syncMod = await loadTs('src/harvest/sync.ts');
const oriMod = await loadTs('src/harvest/orientation.ts');
const { HarvestServer } = await import('../server/harvest-server.mjs');

const SHORT = { helloTimeoutMs: 60, connectTimeoutMs: 250, heartbeatIntervalMs: 25, heartbeatTimeoutMs: 500 };
const clients = [];
function mkClient(onMsg, onState, opts) {
  const msgs = [];
  const states = [];
  const c = new syncMod.SyncClient(
    'ROOM1', 'user-1', 'BOB',
    (raw) => { msgs.push(JSON.parse(raw)); if (onMsg) onMsg(JSON.parse(raw)); },
    (s, e, info) => { states.push(s); if (onState) onState(s, e, info); },
    opts,
  );
  clients.push(c);
  return { c, msgs, states };
}
const lastHello = (sock) => {
  const hellos = sock.sent.map((s) => JSON.parse(s)).filter((m) => m.t === 'hello');
  return hellos[hellos.length - 1];
};

// ─────────────────────────────────────────────────────────────────────────────
// PART 1 — SyncClient: hello handshake success
// ─────────────────────────────────────────────────────────────────────────────
{
  const before = sockets.length;
  const { c, states } = mkClient(null, null, { ...SHORT });
  c.connect();
  assert.strictEqual(sockets.length - before, 1, 'connect() opens exactly one socket');
  const sock = sockets[sockets.length - 1];
  assert.ok(sock.url.includes('/ws/harvest'), 'socket targets /ws/harvest, got ' + sock.url);
  sock.__open();
  const hello = lastHello(sock);
  assert.deepStrictEqual(
    { t: hello.t, room: hello.room, userId: hello.userId, username: hello.username },
    { t: 'hello', room: 'ROOM1', userId: 'user-1', username: 'BOB' },
  );
  assert.deepStrictEqual(states, ['connecting', 'open']);
  assert.strictEqual(c.isHandshakeDone(), false, 'OPEN alone is not a completed handshake');
  assert.strictEqual(c.isHealthy(), false, 'not healthy before hello_ack');

  sock.__receive({ t: 'hello_ack', needsCreation: true });
  assert.strictEqual(c.isHandshakeDone(), true, 'hello_ack completes the handshake');
  assert.deepStrictEqual(states, ['connecting', 'open', 'ready'], 'handshake has an explicit terminal state');
  assert.strictEqual(c.isHealthy(), true, 'healthy after hello_ack + fresh heartbeat');
  assert.strictEqual(c.socketState(), 'open');
  assert.strictEqual(c.requestResync(), true, 'resync allowed after handshake');
  const resync = sock.sent.map((s) => JSON.parse(s)).find((m) => m.t === 'req_state');
  assert.ok(resync, 'req_state uses the existing protocol');

  await sleep(120); // past the hello watchdog — must stay quiet
  assert.ok(!states.includes('reconnecting'), 'no spurious reconnect after successful handshake');
  assert.strictEqual(liveSockets().length, 1, 'still exactly one live socket');
  console.log('✔ PART 1 — hello handshake success, watchdog silenced, resync works');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 2 — hello watchdog: unanswered hello recovers with backoff, one socket
// ─────────────────────────────────────────────────────────────────────────────
{
  const { c, states } = mkClient(null, null, { ...SHORT });
  c.connect();
  const first = sockets[sockets.length - 1];
  first.__open();
  assert.ok(lastHello(first), 'hello re-sent on open');

  await sleep(140); // hello watchdog (60ms) must fire, retry scheduled (800ms base)
  assert.strictEqual(first.readyState, MockWebSocket.CLOSED, 'stale socket destroyed by watchdog');
  assert.ok(states.includes('reconnecting'), 'state moves to reconnecting, got ' + states.join(','));

  // Backoff elapses → exactly one fresh socket; open it before its own
  // connect watchdog (250ms) can fire, like a real network would.
  const since = sockets.length;
  const repl = await waitForSocket(since, { open: true });
  assert.ok(repl, 'replacement socket opened after backoff');
  assert.notStrictEqual(repl, first, 'replacement is a new socket');
  assert.ok(lastHello(repl), 'hello sent again on the new socket');
  repl.__receive({ t: 'snapshot' });
  assert.strictEqual(c.isHandshakeDone(), true, 'snapshot also completes the handshake');
  assert.strictEqual(c.getRetryCount(), 0, 'retry budget resets on handshake success');
  console.log('✔ PART 2 — hello watchdog force-recovers with backoff, no duplicate sockets');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 3 — forceReconnect(): healthy socket is nuked and handshook from zero
// ─────────────────────────────────────────────────────────────────────────────
{
  const { c } = mkClient(null, null, { ...SHORT });
  c.connect();
  const old = sockets[sockets.length - 1];
  old.__open();
  old.__receive({ t: 'hello_ack', needsCreation: false });
  assert.strictEqual(c.isHealthy(), true, 'precondition: healthy connection');

  const liveBefore = liveSockets().length;
  const countBefore = sockets.length;
  c.forceReconnect('test-button');
  assert.strictEqual(old.readyState, MockWebSocket.CLOSED, 'old socket forcibly closed');
  assert.strictEqual(old.onopen, null, 'stale callbacks detached');
  assert.strictEqual(old.onclose, null, 'stale onclose detached');
  assert.strictEqual(liveSockets().length, liveBefore, 'still exactly one live socket after force');
  const next = sockets.slice(countBefore).find((s) => s.readyState !== MockWebSocket.CLOSED);
  assert.ok(next, 'a NEW socket object was created');
  assert.notStrictEqual(next, old, 'replacement differs from the nuked socket');
  next.__open();
  const hello = lastHello(next);
  assert.strictEqual(hello.userId, 'user-1', 'same identity re-handshook (no new session)');
  assert.strictEqual(hello.room, 'ROOM1', 'same room re-handshook');
  next.__receive({ t: 'snapshot' });
  assert.strictEqual(c.isHealthy(), true, 'healthy again after re-handshake');
  console.log('✔ PART 3 — forceReconnect nukes stale socket, re-hellos with same identity');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 4 — ensureOpen(): passive health check, never a second socket
// ─────────────────────────────────────────────────────────────────────────────
{
  // 4a. healthy → no-op
  {
    const { c } = mkClient(null, null, { ...SHORT });
    c.connect();
    const s0 = sockets[sockets.length - 1];
    s0.__open();
    s0.__receive({ t: 'hello_ack', needsCreation: false });
    const n = sockets.length;
    c.ensureOpen();
    c.ensureOpen();
    assert.strictEqual(sockets.length, n, 'ensureOpen on healthy socket creates nothing');
  }
  // 4b. double connect() → single socket
  {
    const { c } = mkClient(null, null, { ...SHORT });
    const n = sockets.length;
    c.connect();
    c.connect();
    assert.strictEqual(sockets.length - n, 1, 'double connect() opens one socket');
  }
  // 4c. server-side close → immediate ensureOpen recovers; pending retry
  // timer must NOT create a second socket later.
  {
    const { c } = mkClient(null, null, { ...SHORT });
    c.connect();
    const s0 = sockets[sockets.length - 1];
    s0.__open();
    s0.__receive({ t: 'snapshot' });
    s0.__serverClose(); // schedules a retry in ~800ms
    const countBefore = sockets.length;
    c.ensureOpen(); // user/lifecycle-triggered immediate recovery
    const reopened = sockets.slice(countBefore).find((s) => s.readyState !== MockWebSocket.CLOSED);
    assert.ok(reopened, 'ensureOpen reopens a dead socket');
    reopened.__open(); // network answers at once, like the real world
    reopened.__receive({ t: 'snapshot' });
    assert.strictEqual(c.isHealthy(), true, 'recovered socket is healthy');
    const total = sockets.length;
    await sleep(950); // let the stale retry timer fire (it must no-op)
    assert.strictEqual(sockets.length, total, 'stale retry timer created no extra socket');
    assert.ok(liveSockets().includes(reopened), 'healthy socket untouched by stale timer');
  }
  // 4d. CONNECTING stuck past watchdog → auto recovery
  {
    const { c, states } = mkClient(null, null, { ...SHORT, connectTimeoutMs: 60 });
    c.connect();
    const stuck = sockets[sockets.length - 1];
    await sleep(140); // connect watchdog (60ms) fires
    assert.strictEqual(stuck.readyState, MockWebSocket.CLOSED, 'stuck CONNECTING destroyed');
    assert.ok(states.includes('reconnecting'));
    const repl = await waitForSocket(sockets.length, { open: true });
    assert.ok(repl, 'replacement socket opened after backoff');
    assert.notStrictEqual(repl, stuck, 'replacement is a new socket');
    repl.__receive({ t: 'hello_ack', needsCreation: false });
    assert.strictEqual(c.isHealthy(), true);
  }
  console.log('✔ PART 4 — ensureOpen semantics + single-socket invariant + connect watchdog');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 5 — backoff cap (10s) + bounded retry budget (clear error state)
// ─────────────────────────────────────────────────────────────────────────────
{
  assert.strictEqual(syncMod.computeReconnectDelay(0), 800, 'base delay 800ms');
  assert.strictEqual(syncMod.computeReconnectDelay(100), 10000, 'delay capped at 10s');
  assert.ok(syncMod.computeReconnectDelay(3) <= 10000, 'all delays within cap');

  // Capture the real scheduled delay through a setTimeout spy.
  const origSetTimeout = globalThis.setTimeout;
  let captured = -1;
  globalThis.setTimeout = ((fn, ms, ...a) => {
    captured = ms;
    return origSetTimeout(fn, ms, ...a);
  });
  try {
    const { c } = mkClient(null, null, { ...SHORT, maxAutoRetries: 200 });
    c.retry = 50; // (TS-private, reachable at runtime)
    c.scheduleReconnect('cap-probe');
    assert.ok(captured > 0 && captured <= 10000, `scheduled delay capped, got ${captured}ms`);
    c.close(); // cancel the probe's 10s timer immediately
  } finally {
    globalThis.setTimeout = origSetTimeout;
  }

  // Budget exhaustion → 'error' state, no infinite socket churn.
  {
    const { c, states } = mkClient(null, null, { ...SHORT, maxAutoRetries: 2 });
    c.connect();
    sockets[sockets.length - 1].__open(); // never acked → watchdog loop
    // Open every replacement at once (real network behavior) but never ack:
    // 60+800+60+1280+60 ≈ 2.3s until the budget runs out.
    const t0 = Date.now();
    while (!states.includes('error') && Date.now() - t0 < 8000) {
      const s = await waitForSocket(sockets.length, { open: true, timeout: 2500 });
      if (!s) break;
      await sleep(90); // let the hello watchdog fire
    }
    assert.ok(states.includes('error'), 'budget exhaustion surfaces error, got ' + states.join(','));
    assert.strictEqual(c.isBudgetExhausted(), true);
    const total = sockets.length;
    await sleep(350);
    assert.strictEqual(sockets.length, total, 'no infinite reconnect loop after budget');
    // Explicit user action still recovers.
    const countBefore = sockets.length;
    c.forceReconnect('manual-after-budget');
    assert.strictEqual(c.isBudgetExhausted(), false, 'manual retry resets the budget');
    const s2 = sockets.slice(countBefore).find((s) => s.readyState !== MockWebSocket.CLOSED);
    assert.ok(s2, 'manual retry opens a socket');
    s2.__open();
    s2.__receive({ t: 'snapshot' });
    assert.strictEqual(c.isHealthy(), true, 'manual retry recovers the game path');
  }
  // Budget exhausted → passive ensureOpen stays quiet (waits for the user).
  {
    const { c } = mkClient(null, null, { ...SHORT, maxAutoRetries: 0 });
    c.scheduleReconnect('probe'); // retry(0) >= max(0) → error immediately
    const n = sockets.length;
    c.ensureOpen();
    assert.strictEqual(sockets.length, n, 'ensureOpen does not reopen after budget exhaustion');
  }
  console.log('✔ PART 5 — backoff capped at 10s, bounded budget, explicit recovery works');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 6 — orientation: viewport dimensions win over lying orientation APIs
// ─────────────────────────────────────────────────────────────────────────────
{
  function fakeWindow(w, h, { touch = true, type = 'landscape-primary', mmMatches = true } = {}) {
    globalThis.window = {
      innerWidth: w,
      innerHeight: h,
      navigator: { maxTouchPoints: touch ? 5 : 0 },
      matchMedia: () => ({ matches: mmMatches }),
      screen: { orientation: { type } },
      visualViewport: undefined,
    };
    if (touch) globalThis.window.ontouchstart = () => {};
    globalThis.document = { documentElement: { clientWidth: 0, clientHeight: 0 } };
  }

  // Portrait phone even when the PWA orientation API lies about landscape.
  fakeWindow(390, 844, { type: 'landscape-primary', mmMatches: true });
  assert.strictEqual(oriMod.isLandscapeDevice(), false, '390x844 portrait must gate');

  // Landscape phone even when the orientation API claims portrait.
  fakeWindow(844, 390, { type: 'portrait-primary', mmMatches: false });
  assert.strictEqual(oriMod.isLandscapeDevice(), true, '844x390 landscape must pass');

  // Rotation sequence portrait → landscape → portrait → landscape.
  fakeWindow(390, 844);
  assert.strictEqual(oriMod.isLandscapeDevice(), false);
  fakeWindow(844, 390);
  assert.strictEqual(oriMod.isLandscapeDevice(), true);
  fakeWindow(390, 844);
  assert.strictEqual(oriMod.isLandscapeDevice(), false);
  fakeWindow(844, 390);
  assert.strictEqual(oriMod.isLandscapeDevice(), true);

  // Desktop is never gated.
  fakeWindow(1920, 1080, { touch: false });
  assert.strictEqual(oriMod.isLandscapeDevice(), true, 'desktop bypasses the gate');

  // Square viewport falls back to matchMedia.
  fakeWindow(500, 500, { mmMatches: true });
  assert.strictEqual(oriMod.isLandscapeDevice(), true, 'square viewport defers to matchMedia');
  console.log('✔ PART 6 — dimensions-first orientation, rotation sequences, desktop bypass');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 7 — server: duplicate connections, takeover, resync (REAL server)
// ─────────────────────────────────────────────────────────────────────────────
{
  const server = new HarvestServer();
  const ROOM = 'T' + Date.now().toString(36).toUpperCase().slice(-6);

  function fakePeer() {
    const p = {
      alive: true,
      closed: false,
      sent: [],
      onclose: null,
      send(obj) { this.sent.push(obj); },
      close() {
        this.closed = true;
        this.alive = false;
        if (this.onclose) this.onclose();
      },
    };
    p.onclose = () => server.onClose(p);
    return p;
  }
  const lastOf = (p, t) => p.sent.filter((m) => m.t === t).pop();

  // 7a. hello → hello_ack(needsCreation) → create → snapshot with inventory.
  const p1 = fakePeer();
  server.onHello(p1, { t: 'hello', room: ROOM, userId: 'u-rot', username: 'ROT' });
  const ack = lastOf(p1, 'hello_ack');
  assert.ok(ack && ack.needsCreation === true, 'new player gets needsCreation ack');
  server.onMessage(p1, { t: 'create', char: { name: 'Al', farmName: 'Fm' }, farmName: 'Fm' });
  const snap1 = lastOf(p1, 'snapshot');
  assert.ok(snap1, 'create returns a full snapshot');
  assert.strictEqual(snap1.me.char.name, 'Al');
  assert.ok(snap1.me.inv.some((i) => i.id === 'tool_hoe'), 'starter inventory present');
  assert.ok(snap1.world && snap1.world.tileRLE, 'world payload present');
  assert.ok(snap1.defs && snap1.prices, 'defs + prices present');

  // Mark persistent state, then simulate rotation-reconnect on a NEW socket.
  const players = server.playersOf(server.getWorld(ROOM));
  players['u-rot'].gold = 4242;
  players['u-rot'].inv.push({ id: 'berry', qty: 7 });

  // 7b. duplicate hello (same room+user) → stale peer closed, snapshot resent.
  const p2 = fakePeer();
  server.onHello(p2, { t: 'hello', room: ROOM, userId: 'u-rot', username: 'ROT' });
  assert.strictEqual(p1.closed, true, 'stale socket closed on takeover');
  assert.strictEqual(server.clients.has(p1), false, 'stale peer unmapped');
  assert.strictEqual(server.clients.has(p2), true, 'new peer mapped');
  const snap2 = lastOf(p2, 'snapshot');
  assert.ok(snap2, 'reconnect receives the latest snapshot');
  assert.strictEqual(snap2.me.gold, 4242, 'gold preserved across reconnect');
  assert.ok(snap2.me.inv.some((i) => i.id === 'berry' && i.qty === 7), 'inventory preserved');
  assert.strictEqual(Object.keys(players).length, 1, 'no duplicate player object');
  assert.strictEqual(server.clients.size, 1, 'no duplicate connection');

  // 7c. the stale socket's late onclose must not emit a bogus 'leave'.
  p1.onclose();
  const leaves = p2.sent.filter((m) => m.t === 'event' && m.e.type === 'leave' && m.e.playerId === 'u-rot');
  assert.strictEqual(leaves.length, 0, 'no phantom leave for the reconnected player');
  assert.strictEqual(server.clients.has(p2), true, 'new mapping survives stale close');

  // 7d. idempotent re-hello on the SAME socket → resync, no duplication.
  const sizeBefore = server.clients.size;
  server.onHello(p2, { t: 'hello', room: ROOM, userId: 'u-rot', username: 'ROT' });
  assert.strictEqual(server.clients.size, sizeBefore, 'same-socket re-hello adds nothing');
  assert.ok(lastOf(p2, 'snapshot'), 'same-socket re-hello resends snapshot');

  // 7e. explicit resync request (post-rotation) → fresh snapshot.
  const snapsBefore = p2.sent.filter((m) => m.t === 'snapshot').length;
  server.onMessage(p2, { t: 'req_state' });
  assert.strictEqual(
    p2.sent.filter((m) => m.t === 'snapshot').length, snapsBefore + 1,
    'req_state returns the authoritative snapshot',
  );

  // 7f. second user shares the room; player cap still enforced at 16.
  const pU2 = fakePeer();
  server.onHello(pU2, { t: 'hello', room: ROOM, userId: 'u-two', username: 'TWO' });
  assert.ok(lastOf(pU2, 'hello_ack'), 'second user welcomed');
  for (let i = 3; i <= 16; i++) {
    const p = fakePeer();
    server.onHello(p, { t: 'hello', room: ROOM, userId: 'u-' + i, username: 'P' + i });
    assert.ok(!lastOf(p, 'err'), `user ${i} admitted`);
  }
  const pFull = fakePeer();
  server.onHello(pFull, { t: 'hello', room: ROOM, userId: 'u-17', username: 'FULL' });
  assert.strictEqual(lastOf(pFull, 'err')?.code, 'world_full', '17th player rejected');
  assert.strictEqual(pFull.closed, true, 'rejected socket closed');

  server.stop();
  try { fs.rmSync(server.saveFile(ROOM), { force: true }); } catch {}
  console.log('✔ PART 7 — takeover closes stale peer, state preserved, resync + cap verified');
}

// ─────────────────────────────────────────────────────────────────────────────
// PART 8 — resume probe, generation guard, single-socket invariants
// ─────────────────────────────────────────────────────────────────────────────
// PART 6 swapped in synthetic windows without `location`; restore a full one.
installDom({ width: 844, height: 390, touch: true });
// Close every client from earlier parts so their pending retry timers cannot
// create sockets while PART 8 counts them.
for (const prev of clients.splice(0)) { try { prev.close(); } catch {} }
await sleep(20);
{
  // 8a. probeAfterResume on a healthy socket: NO new socket, ping sent.
  {
    const { c } = mkClient(null, null, { ...SHORT, resumeGraceMs: 120 });
    c.connect();
    const s0 = sockets[sockets.length - 1];
    s0.__open();
    s0.__receive({ t: 'hello_ack', needsCreation: false });
    const created = c.getSocketsCreated();
    assert.strictEqual(c.probeAfterResume('visibility'), 'probing');
    assert.strictEqual(c.getSocketsCreated(), created, 'healthy socket is probed, not replaced');
    assert.ok(s0.messages('ping').length >= 1, 'probe ping sent');
    await sleep(220); // grace elapses — the pong answered, so nothing happens
    assert.strictEqual(c.getSocketsCreated(), created, 'no reconnect after a successful probe');
    assert.strictEqual(c.isHealthy(), true);
    c.close();
  }

  // 8b. probeAfterResume on a silent (dead but OPEN) socket → forced handshake.
  {
    const { c, states } = mkClient(null, null, { ...SHORT, resumeGraceMs: 80 });
    c.connect();
    const s0 = sockets[sockets.length - 1];
    s0.__open();
    s0.__receive({ t: 'hello_ack', needsCreation: false });
    s0.noPong = true; // link is alive at TCP level but the server never answers
    const since = sockets.length;
    assert.strictEqual(c.probeAfterResume('visibility'), 'probing');
    await sleep(160);
    assert.strictEqual(s0.readyState, MockWebSocket.CLOSED, 'silent socket torn down after grace');
    const repl = await waitForSocket(since, { open: true });
    assert.ok(repl, 'fresh socket opened after a failed probe');
    assert.ok(repl.lastHello(), 'fresh handshake re-sent with the same identity');
    assert.ok(states.includes('recovering'), 'explicit resume surfaces as recovering, got ' + states.join(','));
    repl.__receive({ t: 'snapshot' });
    assert.ok(states.includes('ready'), 'handshake completes with a terminal ready state');
    c.close();
  }

  // 8c. probeAfterResume with no socket + exhausted budget → forced recovery.
  {
    const { c } = mkClient(null, null, { ...SHORT, maxAutoRetries: 0 });
    c.scheduleReconnect('probe-budget'); // → error, budget exhausted
    assert.strictEqual(c.isBudgetExhausted(), true);
    const created = c.getSocketsCreated();
    assert.strictEqual(c.probeAfterResume('online'), 'forced', 'resume always gets a fresh handshake');
    assert.strictEqual(c.isBudgetExhausted(), false, 'explicit resume resets the budget');
    assert.strictEqual(c.getSocketsCreated(), created + 1, 'exactly one socket opened');
    c.close();
  }

  // 8d. GENERATION GUARD — a stale socket must never touch the new session.
  {
    const { c, msgs, states } = mkClient(null, null, { ...SHORT, resumeGraceMs: 60 });
    c.connect();
    const stale = sockets[sockets.length - 1];
    stale.__open();
    stale.__receive({ t: 'hello_ack', needsCreation: false });
    const genBefore = c.getGeneration();
    c.forceReconnect('test-generation');
    const fresh = sockets[sockets.length - 1];
    assert.strictEqual(c.getGeneration(), genBefore + 1, 'generation bumped for the new socket');
    fresh.__open();

    // Late callbacks from the nuked socket arrive AFTER the fresh one is live.
    const msgsBefore = msgs.length;
    const statesBefore = states.length;
    stale.__receive({ t: 'snapshot', me: { id: 'GHOST' } });
    stale.__serverClose();
    await sleep(30);
    assert.strictEqual(msgs.length, msgsBefore, 'stale socket messages are dropped');
    assert.deepStrictEqual(states.slice(statesBefore), [], 'stale socket cannot emit state');
    assert.strictEqual(c.socketState(), 'open', 'fresh socket still open');
    assert.ok(liveSockets().includes(fresh), 'fresh socket untouched by the stale close');

    fresh.__receive({ t: 'snapshot', me: { id: 'user-1' } });
    assert.strictEqual(msgs[msgs.length - 1].me.id, 'user-1', 'only the fresh socket feeds the app');
    c.close();
  }

  // 8e. RAPID EVENT STORM — many forceReconnect/ensureOpen calls, one socket.
  {
    const { c } = mkClient(null, null, { ...SHORT });
    c.connect();
    sockets[sockets.length - 1].__open();
    for (let i = 0; i < 12; i++) {
      c.ensureOpen();
      c.probeAfterResume('resize');
    }
    assert.strictEqual(liveSockets().filter((s) => s.url.includes('/ws/harvest')).length >= 1, true);
    const live = liveSockets();
    assert.ok(live.length <= 2, `no socket pile-up during an event storm, live=${live.length}`);
    c.forceReconnect('storm');
    c.forceReconnect('storm');
    c.forceReconnect('storm');
    await sleep(20);
    assert.strictEqual(liveSockets().length, 1, 'exactly one live socket after repeated force reconnects');
    c.close();
  }

  // 8f. ready clears a pending automatic retry (no zombie reconnect later).
  {
    const { c, states } = mkClient(null, null, { ...SHORT });
    c.connect();
    const first = sockets[sockets.length - 1];
    first.__open();
    first.__serverClose(); // → scheduleReconnect (800ms base delay)
    assert.ok(states.includes('reconnecting'));
    c.forceReconnect('user');
    const second = sockets[sockets.length - 1];
    second.__open();
    second.__receive({ t: 'snapshot' });
    assert.ok(states.includes('ready'));
    assert.strictEqual(c.getRetryCount(), 0, 'retry budget reset by the handshake');
    const total = sockets.length;
    await sleep(1000); // the stale retry timer window has passed
    assert.strictEqual(sockets.length, total, 'no zombie retry socket after recovery');
    assert.strictEqual(liveSockets().length, 1);
    c.close();
  }

  console.log('✔ PART 8 — resume probe, generation guard, event-storm + zombie-retry invariants');
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup (timers must not keep the process alive)
// ─────────────────────────────────────────────────────────────────────────────
for (const c of clients) {
  try { c.close(); } catch {}
}
cleanBuildDir();

console.log('SUITE 8 PASSED!\n');
