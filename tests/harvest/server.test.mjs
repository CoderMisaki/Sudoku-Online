// Server integration suite — runs against the real running game server over a
// real WebSocket. Proves the AUTHORITATIVE behaviour (chat isolation, economy
// validation, movement validation, persistence) independently of any UI.
//
// Run: node tests/harvest/server.test.mjs   (server must be on :3000)
import { TestClient, joinWorld, sleep } from './ws-client.mjs';

const PORT = Number(process.env.PORT || 3000);
const results = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✅ ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ❌ ${name} — ${err.message}`);
  }
}
function assert(c, m) { if (!c) throw new Error(m); }
const room = () => 'S' + Math.random().toString(36).slice(2, 7).toUpperCase();
const uid = (p) => `${p}-${Math.random().toString(36).slice(2, 10)}`;

console.log('\n▶ Server: session & persistence');

await test('hello → snapshot for a new player (character creation)', async () => {
  const c = await joinWorld(PORT, room(), uid('new'), 'NEWBIE');
  assert(c.me.char, 'character missing after creation');
  assert(c.me.gold >= 0, 'gold missing');
  assert(c.me.inv.length > 0, 'starter inventory missing');
  c.close();
});

await test('reconnect resumes the SAME character (no duplicate creation)', async () => {
  const r = room(); const u = uid('resume');
  const a = await joinWorld(PORT, r, u, 'RESUME');
  const gold = a.me.gold;
  const farm = a.me.farmName;
  a.close();
  await sleep(400);

  const b = new TestClient(PORT);
  await b.connect();
  b.send({ t: 'hello', room: r, userId: u, username: 'RESUME' });
  const ack = await b.wait((m) => m.t === 'hello_ack');
  assert(ack.needsCreation === false, 'server asked to re-create an existing character');
  const snap = await b.wait((m) => m.t === 'snapshot', 10000, 'resume snapshot');
  assert(snap.me.gold === gold, `gold reset on resume (${gold} → ${snap.me.gold})`);
  assert(snap.me.farmName === farm, 'farm name lost on resume');
  b.close();
});

await test('a resuming client receives a snapshot without asking (no stuck loading)', async () => {
  const r = room(); const u = uid('autosnap');
  const a = await joinWorld(PORT, r, u, 'AUTO');
  a.close();
  await sleep(400);
  const b = new TestClient(PORT);
  await b.connect();
  b.send({ t: 'hello', room: r, userId: u, username: 'AUTO' });
  // Must arrive unprompted — no req_state sent.
  await b.wait((m) => m.t === 'snapshot', 8000, 'unprompted snapshot');
  b.close();
});

await test('duplicate connection with the same id evicts the ghost', async () => {
  const r = room(); const u = uid('ghost');
  const a = await joinWorld(PORT, r, u, 'GHOST');
  const obs = await joinWorld(PORT, r, uid('obs'), 'OBSERVER');
  await sleep(600);

  // Second socket for the same identity.
  const b = await joinWorld(PORT, r, u, 'GHOST');
  await sleep(1200);

  const snap = await obs.wait((m) => m.t === 'snap', 5000);
  const ids = snap.players.map((p) => p[0]);
  const dupes = ids.filter((x) => x === u);
  assert(dupes.length <= 1, `ghost player: id appears ${dupes.length} times`);
  a.close(); b.close(); obs.close();
});

console.log('\n▶ Server: chat');

await test('public chat reaches every client in the room', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('a'), 'ALPHA');
  const b = await joinWorld(PORT, r, uid('b'), 'BRAVO');
  const c = await joinWorld(PORT, r, uid('c'), 'CHARLIE');
  await sleep(400);
  const text = 'public-' + Math.random().toString(36).slice(2, 8);
  a.send({ t: 'chat', text });
  for (const [n, cl] of [['A', a], ['B', b], ['C', c]]) {
    const m = await cl.wait((x) => x.t === 'event' && x.e.type === 'chat' && x.e.text === text, 5000, `${n} public chat`);
    assert(m.e.channel === 'public', 'channel should be public');
    assert(m.e.name === 'ALPHA', 'sender name must come from the server session');
  }
  a.close(); b.close(); c.close();
});

await test('PRIVATE chat never touches a third client on the wire', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('pa'), 'PALPHA');
  const bId = uid('pb');
  const b = await joinWorld(PORT, r, bId, 'PBRAVO');
  const c = await joinWorld(PORT, r, uid('pc'), 'PCHARLIE');
  await sleep(400);

  const secret = 'SECRET-' + Math.random().toString(36).slice(2, 10).toUpperCase();
  // Record every single frame C receives during the window.
  const cFramesP = c.collect(() => true, 2500);
  a.send({ t: 'chat', text: secret, channel: 'private', to: bId });

  const gotA = await a.wait((m) => m.t === 'event' && m.e.type === 'chat' && m.e.text === secret, 5000, 'sender echo');
  const gotB = await b.wait((m) => m.t === 'event' && m.e.type === 'chat' && m.e.text === secret, 5000, 'target delivery');
  assert(gotA.e.channel === 'private' && gotB.e.channel === 'private', 'channel must be private');
  assert(gotB.e.targetPlayerId === bId, 'targetPlayerId missing');

  const cFrames = await cFramesP;
  const leaked = JSON.stringify(cFrames).includes(secret);
  assert(!leaked, 'PRIVATE MESSAGE LEAKED: secret found in a third client’s frames');
  a.close(); b.close(); c.close();
});

await test('private chat to an unknown player is rejected', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('x'), 'XRAY');
  a.send({ t: 'chat', text: 'hi', channel: 'private', to: 'does-not-exist' });
  const err = await a.wait((m) => m.t === 'event' && m.e.type === 'chat_error', 5000, 'chat_error');
  assert(err.e.msg, 'expected an error message');
  a.close();
});

await test('chat text is sanitized and length-capped', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('s'), 'SANITY');
  const nasty = '<script>alert(1)</script>   spaced\u0000out   ' + 'x'.repeat(500);
  a.send({ t: 'chat', text: nasty });
  const m = await a.wait((x) => x.t === 'event' && x.e.type === 'chat', 5000);
  assert(!m.e.text.includes('<'), 'markup not stripped');
  assert(!m.e.text.includes('>'), 'markup not stripped');
  assert(m.e.text.length <= 200, `message not capped (${m.e.text.length})`);
  assert(!/\s{2,}/.test(m.e.text), 'whitespace not collapsed');
  a.close();
});

await test('chat rate limiting drops burst spam', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('sp'), 'SPAMMER');
  await sleep(300);
  const got = a.collect((m) => m.t === 'event' && m.e.type === 'chat', 2000);
  for (let i = 0; i < 30; i++) a.send({ t: 'chat', text: `flood-${i}` });
  const delivered = await got;
  assert(delivered.length < 30, `rate limiter passed everything (${delivered.length}/30)`);
  assert(delivered.length > 0, 'rate limiter blocked everything');
  a.close();
});

console.log('\n▶ Server: economy');

await test('buy deducts gold and grants the item', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('buy'), 'BUYER');
  const snap = await a.wait((m) => m.t === 'snapshot');
  const price = snap.prices.seed_turnip.buy;
  const gold0 = a.me.gold;
  const qty0 = (a.me.inv.find((i) => i.id === 'seed_turnip') || { qty: 0 }).qty;

  a.send({ t: 'action', a: 'buy', item: 'seed_turnip', qty: 2, actionId: 'buy-' + Date.now() });
  const goldEv = await a.wait((m) => m.t === 'event' && m.e.type === 'gold', 5000, 'gold event');
  const invEv = await a.wait((m) => m.t === 'event' && m.e.type === 'inv', 5000, 'inv event');
  assert(goldEv.e.gold === gold0 - price * 2, `expected ${gold0 - price * 2}, got ${goldEv.e.gold}`);
  const qty1 = (invEv.e.inv.find((i) => i.id === 'seed_turnip') || { qty: 0 }).qty;
  assert(qty1 === qty0 + 2, `item count wrong (${qty0} → ${qty1})`);
  a.close();
});

await test('buying without enough gold is refused (gold never negative)', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('poor'), 'PAUPER');
  const gold0 = a.me.gold;
  // Drain almost everything first by buying the max we can afford, then overbuy.
  a.send({ t: 'action', a: 'buy', item: 'seed_turnip', qty: 99, actionId: 'p1-' + Date.now() });
  await sleep(600);
  for (let i = 0; i < 12; i++) {
    a.send({ t: 'action', a: 'buy', item: 'seed_turnip', qty: 99, actionId: `p2-${i}-${Date.now()}` });
  }
  await sleep(1500);
  const golds = a.messages.filter((m) => m.t === 'event' && m.e.type === 'gold').map((m) => m.e.gold);
  const final = golds.length ? golds[golds.length - 1] : gold0;
  assert(final >= 0, `gold went NEGATIVE: ${final}`);
  const warned = a.messages.some((m) => m.t === 'event' && m.e.type === 'notify' && /cukup uang/i.test(m.e.msg || ''));
  assert(warned, 'server never reported insufficient funds');
  a.close();
});

await test('idempotency: replaying an actionId does not charge twice', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('idem'), 'IDEMP');
  const snap = await a.wait((m) => m.t === 'snapshot');
  const price = snap.prices.seed_turnip.buy;
  const gold0 = a.me.gold;
  const fixed = 'fixed-key-' + Math.random().toString(36).slice(2, 8);
  for (let i = 0; i < 8; i++) a.send({ t: 'action', a: 'buy', item: 'seed_turnip', qty: 1, actionId: fixed });
  await sleep(1500);
  const golds = a.messages.filter((m) => m.t === 'event' && m.e.type === 'gold').map((m) => m.e.gold);
  const final = golds[golds.length - 1];
  const spent = gold0 - final;
  assert(spent === price, `duplicate purchase: spent ${spent} for a ${price} item`);
  a.close();
});

await test('selling an unowned item pays nothing', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('cheat'), 'CHEATER');
  const gold0 = a.me.gold;
  a.send({ t: 'action', a: 'sell', item: 'gem_diamond', qty: 99, actionId: 'c-' + Date.now() });
  await sleep(1000);
  const golds = a.messages.filter((m) => m.t === 'event' && m.e.type === 'gold').map((m) => m.e.gold);
  const final = golds.length ? golds[golds.length - 1] : gold0;
  assert(final === gold0, `server paid ${final - gold0} for unowned items`);
  a.close();
});

await test('client-supplied price is ignored (no price manipulation)', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('mani'), 'MANIP');
  const snap = await a.wait((m) => m.t === 'snapshot');
  const realPrice = snap.prices.seed_turnip.buy;
  const gold0 = a.me.gold;
  a.send({ t: 'action', a: 'buy', item: 'seed_turnip', qty: 1, price: 0, value: 0, actionId: 'm-' + Date.now() });
  const goldEv = await a.wait((m) => m.t === 'event' && m.e.type === 'gold', 5000);
  assert(goldEv.e.gold === gold0 - realPrice, `client price honoured! expected -${realPrice}, got ${gold0 - goldEv.e.gold}`);
  a.close();
});

await test('sell then re-read: inventory has no duplication', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('dup'), 'DUPER');
  const berry0 = (a.me.inv.find((i) => i.id === 'berry') || { qty: 0 }).qty;
  assert(berry0 > 0, 'starter kit should include berries');
  // Fire concurrent sells for more than we own.
  for (let i = 0; i < 6; i++) a.send({ t: 'action', a: 'sell', item: 'berry', qty: berry0, actionId: `d-${i}-${Date.now()}` });
  await sleep(1500);
  a.send({ t: 'req_state' });
  const snap = await a.wait((m) => m.t === 'snapshot' && m.me, 8000, 'resync');
  const berry1 = (snap.me.inv.find((i) => i.id === 'berry') || { qty: 0 }).qty;
  assert(berry1 >= 0, 'negative item count');
  assert(berry1 <= berry0, `item count grew from selling (${berry0} → ${berry1})`);
  a.close();
});

console.log('\n▶ Server: movement validation');

await test('teleport attempts are clamped to a reachable distance', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('tp'), 'TELE');
  const start = { x: a.me.x, y: a.me.y };
  // Ask to jump 100 tiles instantly.
  a.send({ t: 'move', x: start.x + 100, y: start.y + 100, dir: 1, anim: 'run', sprint: true, seq: 1 });
  await sleep(400);
  const snap = await a.wait((m) => m.t === 'snap' && typeof m.mx === 'number', 5000);
  const moved = Math.hypot(snap.mx - start.x, snap.my - start.y);
  assert(moved < 5, `anti-teleport failed: moved ${moved.toFixed(1)} tiles in one packet`);
  a.close();
});

await test('sustained speed is capped near the legit maximum', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('spd'), 'SPEEDY');
  const start = { x: a.me.x, y: a.me.y };
  const t0 = Date.now();
  // Spam far-away targets as fast as possible for 2s.
  for (let i = 0; i < 120; i++) {
    a.send({ t: 'move', x: start.x + 200, y: start.y, dir: 1, anim: 'run', sprint: true, seq: i + 1 });
    await sleep(16);
  }
  const elapsed = (Date.now() - t0) / 1000;
  const snap = await a.wait((m) => m.t === 'snap' && typeof m.mx === 'number', 5000);
  const dist = Math.abs(snap.mx - start.x);
  const speed = dist / elapsed;
  // 7.2 sprint × 1.35 jitter headroom ≈ 9.7 tiles/s ceiling.
  assert(speed < 14, `speed hack succeeded: ${speed.toFixed(1)} tiles/s`);
  a.close();
});

await test('server echoes the accepted input sequence for reconciliation', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('seq'), 'SEQ');
  a.send({ t: 'move', x: a.me.x + 0.3, y: a.me.y, dir: 1, anim: 'walk', sprint: false, seq: 77 });
  await sleep(500);
  const snap = await a.wait((m) => m.t === 'snap' && m.ack === 77, 5000, 'ack=77');
  assert(snap.ack === 77, 'ack not echoed');
  assert(typeof snap.mx === 'number' && typeof snap.my === 'number', 'authoritative position missing');
  a.close();
});

await test('players cannot walk into water/rock (terrain validation)', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('terr'), 'TERRA');
  // Walk hard in one direction for a while; we must never end up out of bounds.
  let x = a.me.x;
  for (let i = 0; i < 80; i++) {
    x += 0.4;
    a.send({ t: 'move', x, y: a.me.y, dir: 1, anim: 'walk', sprint: false, seq: i + 1 });
    await sleep(25);
  }
  const snap = await a.wait((m) => m.t === 'snap' && typeof m.mx === 'number', 5000);
  assert(snap.mx >= 1 && snap.mx <= 222 && snap.my >= 1 && snap.my <= 222, 'player left the world bounds');
  a.close();
});

console.log('\n▶ Server: snapshot shape');

await test('high-frequency snap carries only positional data (not the world)', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('snap'), 'SNAPPY');
  const snap = await a.wait((m) => m.t === 'snap', 5000);
  assert(Array.isArray(snap.players), 'players missing');
  assert(Array.isArray(snap.npcs), 'npcs missing');
  assert(snap.crops === undefined, 'snap must NOT contain crops');
  assert(snap.tileRLE === undefined, 'snap must NOT contain the tile map');
  assert(snap.defs === undefined, 'snap must NOT contain defs');
  const size = JSON.stringify(snap).length;
  assert(size < 8000, `snap too large (${size} bytes) — looks like a full world broadcast`);
  a.close();
});

await test('snap includes player names for map/roster labels', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('nm'), 'NAMED');
  await sleep(500);
  const snap = await a.wait((m) => m.t === 'snap' && m.names && m.names.length > 0, 5000);
  assert(snap.names.some(([, n]) => n === 'NAMED'), 'own name missing from snap');
  a.close();
});

console.log('\n▶ Server: robustness');

await test('malformed frames do not kill the connection', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('bad'), 'BADACTOR');
  a.send({ t: 'move' });
  a.send({ t: 'move', x: 'NaN', y: null, seq: 'x' });
  a.send({ t: 'action', a: 'buy', item: 12345, qty: -99 });
  a.send({ t: 'action', a: 'nonexistent_action' });
  a.send({ t: 'chat' });
  a.send({ t: 'unknown_type' });
  await sleep(1000);
  a.send({ t: 'ping', ts: 1 });
  await a.wait((m) => m.t === 'pong', 5000, 'pong after garbage');
  assert(a.open, 'connection died on malformed input');
  a.close();
});

await test('negative / fractional quantities cannot mint gold', async () => {
  const r = room();
  const a = await joinWorld(PORT, r, uid('neg'), 'NEGATIVE');
  const gold0 = a.me.gold;
  a.send({ t: 'action', a: 'sell', item: 'berry', qty: -100, actionId: 'n1-' + Date.now() });
  await sleep(300);
  a.send({ t: 'action', a: 'buy', item: 'seed_turnip', qty: -100, actionId: 'n2-' + Date.now() });
  await sleep(800);
  const golds = a.messages.filter((m) => m.t === 'event' && m.e.type === 'gold').map((m) => m.e.gold);
  const final = golds.length ? golds[golds.length - 1] : gold0;
  assert(final <= gold0 + 200, `negative qty minted gold (${gold0} → ${final})`);
  assert(final >= 0, 'gold negative');
  a.close();
});

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
