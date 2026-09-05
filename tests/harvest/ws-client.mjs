// Minimal RFC6455 WebSocket client (no deps) for server integration tests.
import net from 'node:net';
import crypto from 'node:crypto';

export class TestClient {
  constructor(port = 3000, host = '127.0.0.1') {
    this.port = port; this.host = host;
    this.messages = [];
    this.listeners = new Set();
    this.buffer = Buffer.alloc(0);
    this.open = false;
  }

  connect() {
    return new Promise((resolve, reject) => {
      const key = crypto.randomBytes(16).toString('base64');
      this.socket = net.connect(this.port, this.host, () => {
        this.socket.write(
          `GET /ws/harvest HTTP/1.1\r\nHost: ${this.host}:${this.port}\r\n` +
          `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
          `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
        );
      });
      let handshake = false;
      this.socket.on('data', (chunk) => {
        if (!handshake) {
          const str = chunk.toString('latin1');
          const idx = str.indexOf('\r\n\r\n');
          if (idx === -1) return;
          if (!/101/.test(str.slice(0, 20))) { reject(new Error('handshake failed: ' + str.slice(0, 80))); return; }
          handshake = true;
          this.open = true;
          const rest = chunk.subarray(Buffer.byteLength(str.slice(0, idx + 4), 'latin1'));
          if (rest.length) this._onData(rest);
          resolve(this);
          return;
        }
        this._onData(chunk);
      });
      this.socket.on('error', (e) => { this.open = false; reject(e); });
      this.socket.on('close', () => { this.open = false; });
      setTimeout(() => reject(new Error('connect timeout')), 8000).unref?.();
    });
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const opcode = b0 & 0x0f;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buffer.length < 10) return; len = Number(this.buffer.readBigUInt64BE(2)); off = 10; }
      if (this.buffer.length < off + len) return;
      const payload = this.buffer.subarray(off, off + len);
      this.buffer = this.buffer.subarray(off + len);
      if (opcode === 0x1) {
        try {
          const msg = JSON.parse(payload.toString('utf8'));
          this.messages.push(msg);
          for (const fn of this.listeners) fn(msg);
        } catch { /* ignore */ }
      } else if (opcode === 0x8) { this.close(); }
      else if (opcode === 0x9) this._frame(0xA, payload);
    }
  }

  _frame(opcode, payload) {
    if (!this.open) return;
    const mask = crypto.randomBytes(4);
    const len = payload.length;
    let header;
    if (len < 126) header = Buffer.from([0x80 | opcode, 0x80 | len]);
    else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x80 | opcode; header[1] = 0x80 | 126; header.writeUInt16BE(len, 2); }
    else { header = Buffer.alloc(10); header[0] = 0x80 | opcode; header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(len), 2); }
    const masked = Buffer.alloc(len);
    for (let i = 0; i < len; i++) masked[i] = payload[i] ^ mask[i & 3];
    this.socket.write(Buffer.concat([header, mask, masked]));
  }

  send(obj) { this._frame(0x1, Buffer.from(JSON.stringify(obj))); }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  /** Wait for the first message matching a predicate. */
  wait(pred, timeout = 8000, label = 'message') {
    const existing = this.messages.find(pred);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { off(); reject(new Error(`timeout waiting for ${label}`)); }, timeout);
      const off = this.on((m) => {
        if (pred(m)) { clearTimeout(t); off(); resolve(m); }
      });
    });
  }

  /** Collect every message matching a predicate over a window. */
  async collect(pred, ms) {
    const out = [];
    const off = this.on((m) => { if (pred(m)) out.push(m); });
    await sleep(ms);
    off();
    return out;
  }

  close() {
    this.open = false;
    try { this.socket.destroy(); } catch { /* noop */ }
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function joinWorld(port, room, userId, username, { create = true } = {}) {
  const c = new TestClient(port);
  await c.connect();
  c.send({ t: 'hello', room, userId, username });
  const ack = await c.wait((m) => m.t === 'hello_ack', 8000, 'hello_ack');
  if (ack.needsCreation && create) {
    c.send({
      t: 'create',
      farmName: `${username} FARM`,
      char: {
        name: username, farmName: `${username} FARM`, gender: 'male',
        hair: 'short', hairColor: '#5a3a22', skin: '#f0c8a0', eye: '#3a5a8a',
        eyeStyle: 'round', outfit: 'overalls', outfitColor: '#3a6ea5',
        shoes: 'boots', accessory: 'none',
      },
    });
  }
  const snap = await c.wait((m) => m.t === 'snapshot', 10000, 'snapshot');
  c.me = snap.me;
  c.userId = userId;
  return c;
}
