import assert from 'assert';

console.log('--- TEST SUITE 7: PERSISTENCE, RLE & OFFLINE ADVANCEMENT ---');

// RLE Encoder/Decoder test
function rleEncode(grid) {
  const runs = [];
  let cur = grid[0];
  let count = 1;
  for (let i = 1; i < grid.length; i++) {
    const v = grid[i];
    if (v === cur && count < 255) {
      count++;
    } else {
      runs.push(String.fromCharCode(cur + 33), String.fromCharCode(count + 33));
      cur = v;
      count = 1;
    }
  }
  runs.push(String.fromCharCode(cur + 33), String.fromCharCode(count + 33));
  return runs.join('');
}

function rleDecode(encoded) {
  let total = 0;
  for (let i = 1; i < encoded.length; i += 2) {
    total += encoded.charCodeAt(i) - 33;
  }
  const out = new Uint8Array(total);
  let idx = 0;
  for (let i = 0; i < encoded.length; i += 2) {
    const v = encoded.charCodeAt(i) - 33;
    const len = encoded.charCodeAt(i + 1) - 33;
    out.fill(v, idx, idx + len);
    idx += len;
  }
  return out;
}

// 1. Tile grid RLE compression round-trip
{
  const grid = new Uint8Array(260 * 260);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = Math.floor(i / 1000) % 8;
  }

  const encoded = rleEncode(grid);
  const decoded = rleDecode(encoded);

  assert.strictEqual(grid.length, decoded.length);
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== decoded[i]) {
      throw new Error(`RLE mismatch at ${i}: expected ${grid[i]}, got ${decoded[i]}`);
    }
  }
  console.log(`✔ RLE Tile compression validated (${grid.length} bytes -> ${encoded.length} chars)`);
}

// 2. Offline time advancement calculation
{
  function advanceWorldTime(world, elapsedSeconds) {
    const gameMinutes = elapsedSeconds * 2.4; // 1440 min / 600 sec
    world.time += gameMinutes;
    while (world.time >= 24 * 60) {
      world.time -= 24 * 60;
      world.day++;
      if (world.day > 7) {
        world.day = 1;
        const seasons = ['spring', 'summer', 'autumn', 'winter'];
        const nextSeasonIdx = (seasons.indexOf(world.season) + 1) % seasons.length;
        world.season = seasons[nextSeasonIdx];
      }
    }
  }

  const world = { time: 6 * 60, day: 1, season: 'spring' }; // 06:00 Day 1 Spring

  // 10 real minutes = 1 game day
  advanceWorldTime(world, 600);
  assert.strictEqual(world.day, 2);
  assert.strictEqual(world.season, 'spring');

  // 7 game days = 1 season
  advanceWorldTime(world, 600 * 6);
  assert.strictEqual(world.day, 1);
  assert.strictEqual(world.season, 'summer');
  console.log('✔ Offline time and seasonal advancement accurately computed');
}

// 3. Player reconnection without duplicate instances
{
  const connectedClients = new Map();

  function onClientConnect(peerId, userId, playerObj) {
    // Remove stale peer connection for same userId
    for (const [pId, info] of connectedClients.entries()) {
      if (info.userId === userId && pId !== peerId) {
        connectedClients.delete(pId);
      }
    }
    connectedClients.set(peerId, { userId, player: playerObj });
  }

  const playerAlice = { id: 'user_alice', name: 'Alice', gold: 500 };

  // First connection
  onClientConnect('peer_1', 'user_alice', playerAlice);
  assert.strictEqual(connectedClients.size, 1);

  // Reconnection from new tab/peer before socket closed
  onClientConnect('peer_2', 'user_alice', playerAlice);
  assert.strictEqual(connectedClients.size, 1, 'Duplicate peer removed on reconnect');
  assert.strictEqual(connectedClients.has('peer_2'), true);
  console.log('✔ Reconnection state preservation and single-player deduplication verified');
}

console.log('SUITE 7 PASSED!\n');
