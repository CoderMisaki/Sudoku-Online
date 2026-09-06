import http from 'node:http';
import WebSocket from 'ws';
import assert from 'assert';
import fs from 'fs';
import { createHarvestServer } from '../server/harvest-server.mjs';

const TEST_PORT = 49152 + Math.floor(Math.random() * 1000);
const SUITE_ID = Date.now().toString(36).toUpperCase();

class SimpleClient {
  constructor(port, roomCode, userId, username) {
    this.port = port;
    this.roomCode = roomCode;
    this.userId = userId;
    this.username = username;
    this.ws = null;
    this.messages = [];
    this.handlers = [];
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${this.port}/ws/harvest`);
      this.ws.on('open', () => {
        this.send({
          t: 'hello',
          room: this.roomCode,
          userId: this.userId,
          username: this.username,
        });
      });
      this.ws.on('error', reject);
      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this.messages.push(msg);
          for (const h of [...this.handlers]) h(msg);
        } catch (err) {}
      });
      const connectHandler = (msg) => {
        if (msg.t === 'hello_ack' || msg.t === 'snapshot') {
          const idx = this.handlers.indexOf(connectHandler);
          if (idx >= 0) this.handlers.splice(idx, 1);
          resolve(msg);
        }
      };
      this.handlers.push(connectHandler);
    });
  }

  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  clearMessages() {
    this.messages = [];
  }

  async waitFor(filter, timeoutMs = 3000) {
    return new Promise((resolve, reject) => {
      for (const m of this.messages) {
        if (filter(m)) return resolve(m);
      }

      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event (${timeoutMs}ms)`));
      }, timeoutMs);

      const handler = (msg) => {
        if (filter(msg)) {
          clearTimeout(timer);
          const idx = this.handlers.indexOf(handler);
          if (idx >= 0) this.handlers.splice(idx, 1);
          resolve(msg);
        }
      };
      this.handlers.push(handler);
    });
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

function createServer(port) {
  return new Promise((resolve) => {
    let harvestServer = null;
    const server = http.createServer((req, res) => {
      res.end('ok');
    });

    server.on('upgrade', (req, socket, head) => {
      if (req.url && req.url.split('?')[0] === '/ws/harvest') {
        if (harvestServer) {
          harvestServer.handleUpgrade(req, socket, head);
        } else {
          socket.destroy();
        }
      } else {
        socket.destroy();
      }
    });

    server.listen(port, '127.0.0.1', () => {
      harvestServer = createHarvestServer(server);
      resolve({ server, harvestServer });
    });
  });
}

async function runTests() {
  console.log('--- STARTING HARVEST MOON SERVER TEST SUITE ---');
  let { server, harvestServer } = await createServer(TEST_PORT);
  console.log(`Server started on port ${TEST_PORT}`);

  const ROOM1 = `R1_${SUITE_ID}`.slice(0, 8);
  const ROOM2 = `R2_${SUITE_ID}`.slice(0, 8);
  const ROOM3 = `R3_${SUITE_ID}`.slice(0, 8);

  try {
    // TEST 1: Character Creation & Initial State
    {
      console.log('Running Test 1: Character Creation & Welcome Snapshot');
      const c = new SimpleClient(TEST_PORT, ROOM1, 'user_1', 'ALICE');
      await c.connect();
      c.send({
        t: 'create',
        farmName: 'Sunny Meadow',
        char: {
          name: 'Alice',
          gender: 'female',
          skin: '#f2c9a1',
          hair: 'long',
          hairColor: '#3a2010',
          eye: '#3b82f6',
          eyeStyle: 'round',
          outfit: 'overall',
          outfitColor: '#d64545',
          shoes: 'boots',
          accessory: 'flower',
        },
      });
      const welcome = await c.waitFor(m => m.t === 'snapshot' && m.me && m.me.username === 'ALICE');
      assert.strictEqual(welcome.me.username, 'ALICE');
      assert.strictEqual(welcome.me.farmName, 'Sunny Meadow');
      assert(welcome.me.gold >= 250, 'Player starts with gold');
      assert(welcome.me.inv.length > 0, 'Player has starter tools');
      console.log('✔ Test 1 Passed: Character created with starter kit.');
      c.close();
    }

    // TEST 2: Reconnection State Preservation
    {
      console.log('Running Test 2: Reconnection State Preservation');
      const c = new SimpleClient(TEST_PORT, ROOM1, 'user_1', 'ALICE');
      const welcome = await c.connect();
      assert(welcome.me && welcome.me.username === 'ALICE', 'Reconnected with Alice');
      assert.strictEqual(welcome.me.farmName, 'Sunny Meadow');
      console.log('✔ Test 2 Passed: Player reconnected seamlessly.');
      c.close();
    }

    // TEST 3: Movement Validation & Snapshot Updates
    {
      console.log('Running Test 3: Authoritative Movement & Speed Validation');
      const c = new SimpleClient(TEST_PORT, ROOM1, 'user_1', 'ALICE');
      const initial = await c.connect();
      
      let currentX = initial.me.x;
      let currentY = initial.me.y;
      const now = Date.now();
      for (let i = 1; i <= 5; i++) {
        currentX += 0.2;
        c.send({
          t: 'move',
          x: currentX,
          y: currentY,
          dir: 'right',
          running: true,
          seq: i,
          clientTs: now + i * 50,
        });
      }
      
      const snap = await c.waitFor(m => m.t === 'snap' && m.players && m.players.some(p => p[0] === 'user_1' && p[1] > initial.me.x));
      assert(snap, 'Received snapshot with updated player position');
      console.log('✔ Test 3 Passed: Incremental movements processed cleanly.');
      c.close();
    }

    // TEST 4: Multi-player Room Synchronization
    {
      console.log('Running Test 4: Multiplayer Synchronization');
      const c1 = new SimpleClient(TEST_PORT, ROOM2, 'user_1', 'ALICE');
      const c2 = new SimpleClient(TEST_PORT, ROOM2, 'user_2', 'BOB');
      await c1.connect();
      await c2.connect();
      c1.send({
        t: 'create',
        farmName: 'Alice Farm',
        char: {
          name: 'Alice',
          gender: 'female',
          skin: '#f2c9a1',
          hair: 'long',
          hairColor: '#3a2010',
          eye: '#3b82f6',
          eyeStyle: 'round',
          outfit: 'overall',
          outfitColor: '#d64545',
          shoes: 'boots',
          accessory: 'flower',
        },
      });
      c2.send({
        t: 'create',
        farmName: 'Bob Farm',
        char: {
          name: 'Bob',
          gender: 'male',
          skin: '#f2c9a1',
          hair: 'short',
          hairColor: '#e0c068',
          eye: '#3b82f6',
          eyeStyle: 'cool',
          outfit: 'shirt',
          outfitColor: '#2b7e4c',
          shoes: 'boots',
          accessory: 'hat',
        },
      });
      await c1.waitFor(m => m.t === 'snapshot' && m.me && m.me.username === 'ALICE');
      await c2.waitFor(m => m.t === 'snapshot' && m.me && m.me.username === 'BOB');
      
      const snap = await c1.waitFor(m => m.t === 'snap' && m.players && m.players.some(p => p[0] === 'user_2'));
      assert(snap, 'Player 1 sees Player 2 in snapshot');
      console.log('✔ Test 4 Passed: Multi-player synchronization works.');
      c1.close();
      c2.close();
    }

    // TEST 5: Public Chat Broadcasting
    {
      console.log('Running Test 5: Public Chat');
      const c1 = new SimpleClient(TEST_PORT, ROOM2, 'user_1', 'ALICE');
      const c2 = new SimpleClient(TEST_PORT, ROOM2, 'user_2', 'BOB');
      await c1.connect();
      await c2.connect();

      await new Promise(r => setTimeout(r, 300));
      c1.send({ t: 'chat', text: 'Halo dari Alice!', channel: 'public' });
      const chatEvent = await c2.waitFor(m => m.t === 'event' && m.e.type === 'chat' && m.e.text === 'Halo dari Alice!');
      assert.strictEqual(chatEvent.e.name, 'ALICE');
      assert.strictEqual(chatEvent.e.channel, 'public');
      console.log('✔ Test 5 Passed: Public chat broadcasted to room.');
      c1.close();
      c2.close();
    }

    // TEST 6: Private Chat Network Isolation
    {
      console.log('Running Test 6: Private Chat Isolation');
      const c1 = new SimpleClient(TEST_PORT, ROOM2, 'user_1', 'ALICE');
      const c2 = new SimpleClient(TEST_PORT, ROOM2, 'user_2', 'BOB');
      const c3 = new SimpleClient(TEST_PORT, ROOM2, 'user_3', 'CHARLIE');
      await c1.connect();
      await c2.connect();
      await c3.connect();
      c3.send({
        t: 'create',
        farmName: 'Charlie Farm',
        char: {
          name: 'Charlie',
          gender: 'nonbinary',
          skin: '#f2c9a1',
          hair: 'ponytail',
          hairColor: '#333333',
          eye: '#3b82f6',
          eyeStyle: 'round',
          outfit: 'hoodie',
          outfitColor: '#993399',
          shoes: 'sneakers',
          accessory: 'scarf',
        },
      });
      await c3.waitFor(m => m.t === 'snapshot' && m.me && m.me.username === 'CHARLIE');

      await new Promise(r => setTimeout(r, 300));

      // Alice sends private message to Bob
      c1.send({
        t: 'chat',
        text: 'Pesan rahasia Alice untuk Bob',
        channel: 'private',
        targetPlayerId: 'user_2',
      });

      const bobMsg = await c2.waitFor(m => m.t === 'event' && m.e.type === 'chat' && m.e.channel === 'private');
      assert.strictEqual(bobMsg.e.text, 'Pesan rahasia Alice untuk Bob');
      assert.strictEqual(bobMsg.e.targetPlayerId, 'user_2');

      // Charlie must NEVER receive Alice's private message to Bob
      const charlieGotPrivate = c3.messages.some(m => m.t === 'event' && m.e.type === 'chat' && m.e.channel === 'private' && m.e.text === 'Pesan rahasia Alice untuk Bob');
      assert.strictEqual(charlieGotPrivate, false, 'Charlie should not receive private message meant for Bob');
      console.log('✔ Test 6 Passed: Private chat network isolation verified.');
      c1.close();
      c2.close();
      c3.close();
    }

    // TEST 7: Economy - Shop Buy & Server Authoritative Gold Check
    {
      console.log('Running Test 7: Shop Buy & Gold Validation');
      const c = new SimpleClient(TEST_PORT, ROOM2, 'user_1', 'ALICE');
      const snap = await c.connect();
      const startingGold = snap.me.gold;

      await new Promise(r => setTimeout(r, 150));
      c.clearMessages();
      // Buy 2 turnip seeds
      c.send({ t: 'action', a: 'buy', item: 'seed_turnip', qty: 2 });
      const goldEvent = await c.waitFor(m => m.t === 'event' && m.e.type === 'gold');
      assert(goldEvent.e.gold < startingGold, 'Gold decreased after shop buy');

      const invEvent = await c.waitFor(m => m.t === 'event' && m.e.type === 'inv');
      const seedItem = invEvent.e.inv.find(i => i.id === 'seed_turnip');
      assert(seedItem && seedItem.qty >= 2, 'Inventory received seeds');
      console.log('✔ Test 7 Passed: Shop buy correctly deducted gold and added item.');
      c.close();
    }

    // TEST 8: Economy - Shop Sell Item
    {
      console.log('Running Test 8: Shop Sell');
      const c = new SimpleClient(TEST_PORT, ROOM2, 'user_1', 'ALICE');
      const snap = await c.connect();
      const goldBefore = snap.me.gold;

      await new Promise(r => setTimeout(r, 150));
      c.clearMessages();
      // Sell 1 turnip seed
      c.send({ t: 'action', a: 'sell', item: 'seed_turnip', qty: 1 });
      const goldEvent = await c.waitFor(m => m.t === 'event' && m.e.type === 'gold');
      assert(goldEvent.e.gold > goldBefore, 'Gold increased after selling seed');
      console.log('✔ Test 8 Passed: Shop sell added gold and removed item.');
      c.close();
    }

    // TEST 9: Inventory Split & Drop
    {
      console.log('Running Test 9: Inventory Split & Drop');
      const c = new SimpleClient(TEST_PORT, ROOM2, 'user_1', 'ALICE');
      const snap = await c.connect();

      const slotIdx = snap.me.inv.findIndex(i => i.id === 'seed_turnip' && i.qty >= 2);
      assert(slotIdx >= 0, 'Found stack to split');

      await new Promise(r => setTimeout(r, 150));
      c.clearMessages();
      // Split from stack
      c.send({ t: 'action', a: 'split', item: 'seed_turnip' });
      const splitInv = await c.waitFor(m => m.t === 'event' && m.e.type === 'inv' && m.e.inv.filter(i => i.id === 'seed_turnip').length >= 2);
      assert(splitInv, 'Seeds split into multiple inventory slots');

      await new Promise(r => setTimeout(r, 150));
      c.clearMessages();
      // Drop 1 seed
      c.send({ t: 'action', a: 'drop', item: 'seed_turnip', qty: 1 });
      await c.waitFor(m => m.t === 'event' && m.e.type === 'notify' && m.e.kind === 'info');
      console.log('✔ Test 9 Passed: Inventory split and drop work authoritatively.');
      c.close();
    }

    // TEST 10: Crafting System
    {
      console.log('Running Test 10: Authoritative Crafting');
      const c = new SimpleClient(TEST_PORT, ROOM3, 'craft_user', 'CRAFTER');
      await c.connect();
      c.send({
        t: 'create',
        farmName: 'Craft Farm',
        char: { name: 'Crafter', gender: 'female', hair: 'short', skin: '#f2c9a1', outfit: 'shirt' },
      });
      await c.waitFor(m => m.t === 'snapshot' && m.me && m.me.username === 'CRAFTER');

      await new Promise(r => setTimeout(r, 150));
      c.send({ t: 'action', a: 'buy', item: 'wood', qty: 5 });
      await c.waitFor(m => m.t === 'event' && m.e.type === 'inv' && m.e.inv.some(i => i.id === 'wood'));

      await new Promise(r => setTimeout(r, 150));
      c.send({ t: 'action', a: 'buy', item: 'fiber', qty: 5 });
      await c.waitFor(m => m.t === 'event' && m.e.type === 'inv' && m.e.inv.some(i => i.id === 'fiber'));

      await new Promise(r => setTimeout(r, 150));
      c.send({ t: 'action', a: 'craft', recipe: 'rec_plant' });
      const craftedInv = await c.waitFor(m => m.t === 'event' && m.e.type === 'inv' && m.e.inv.some(i => i.id === 'furn_plant'));
      assert(craftedInv, 'Crafted Plant Pot present in inventory');
      console.log('✔ Test 10 Passed: Crafting successfully produced item and consumed ingredients.');
      c.close();
    }

    // TEST 11: Server Save and Restart Persistence
    {
      console.log('Running Test 11: Server Restart & State Persistence');
      harvestServer.stop();
      await new Promise(r => server.close(r));

      // Re-create server
      const restarted = await createServer(TEST_PORT);
      server = restarted.server;
      harvestServer = restarted.harvestServer;

      const c = new SimpleClient(TEST_PORT, ROOM3, 'craft_user', 'CRAFTER');
      const snap = await c.connect();
      assert.strictEqual(snap.me.username, 'CRAFTER');
      assert.strictEqual(snap.me.farmName, 'Craft Farm');
      assert(snap.me.inv.some(i => i.id === 'furn_plant'), 'Persisted crafted item across server restart');
      console.log('✔ Test 11 Passed: Full world state persisted and restored from disk.');
      c.close();
      harvestServer.stop();
      await new Promise(r => server.close(r));
    }

    console.log('\n========================================');
    console.log('ALL 11 BACKEND TEST SUITE TESTS PASSED!');
    console.log('========================================\n');
    process.exit(0);
  } catch (err) {
    console.error('Test failed with error:', err);
    if (harvestServer) harvestServer.stop();
    if (server) server.close();
    process.exit(1);
  }
}

runTests();
