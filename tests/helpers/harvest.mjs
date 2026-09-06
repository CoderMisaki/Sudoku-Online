// Shared test harness: loads the REAL TypeScript sources (transpiled in-memory,
// no build step) together with a deterministic jsdom + WebSocket environment.
//
// The transpiler walks the local import graph so `src/harvest/sync.ts` can
// import `./debug`, `./store`, etc. — every module is flattened into
// tests/.tmp-build/<path_with_underscores>.mjs with its specifiers rewritten.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
export const ts = require('typescript');

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT_DIR = path.join(ROOT, 'tests/.tmp-build');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const built = new Map(); // absolute source path → output file URL

function outName(absPath) {
  const rel = path.relative(ROOT, absPath).split(path.sep).join('_').replace(/\.(tsx|ts|mts)$/, '');
  return `${rel}.mjs`;
}

function resolveLocal(spec, fromFile) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}.mts`, path.join(base, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function rewriteSpecifiers(code, absPath, queue) {
  return code.replace(/(from|import)\s*\(?\s*(['"])(\.{1,2}\/[^'"]*)\2/g, (match, head, quote, spec) => {
    const target = resolveLocal(spec, absPath);
    if (!target) return match; // bare package specifier (zustand, three, …)
    queue.push(target);
    return `${head} ${quote}./${outName(target)}${quote}`;
  });
}

/**
 * Transpile `entryRel` (e.g. 'src/harvest/session.ts') plus its local import
 * graph and import the result. Modules are cached across calls in one process.
 */
export async function loadTs(entryRel) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const entryAbs = path.resolve(ROOT, entryRel);
  if (!fs.existsSync(entryAbs)) throw new Error(`missing source: ${entryRel}`);

  const queue = [entryAbs];
  while (queue.length) {
    const abs = queue.shift();
    if (built.has(abs)) continue;
    const source = fs.readFileSync(abs, 'utf8');
    const isTsx = abs.endsWith('.tsx');
    const out = ts.transpileModule(source, {
      fileName: abs,
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        jsx: isTsx ? ts.JsxEmit.ReactJSX : undefined,
      },
    });
    const code = rewriteSpecifiers(out.outputText, abs, queue);
    const outFile = path.join(OUT_DIR, outName(abs));
    fs.writeFileSync(outFile, code);
    built.set(abs, pathToFileURL(outFile).href);
  }
  return import(built.get(entryAbs));
}

export function cleanBuildDir() {
  try { fs.rmSync(OUT_DIR, { recursive: true, force: true }); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic WebSocket mock (no network)
// ─────────────────────────────────────────────────────────────────────────────
export const sockets = [];

export class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  constructor(url) {
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    this.onopen = null;
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    /** set true to simulate a dead link that never answers pings */
    this.noPong = false;
    /** set true to simulate a browser that cannot open a socket at all */
    sockets.push(this);
  }
  send(data) {
    if (this.readyState !== MockWebSocket.OPEN) throw new Error('socket not open');
    this.sent.push(String(data));
    if (!this.noPong && String(data).includes('"ping"')) {
      queueMicrotask(() => this.__receive({ t: 'pong', ts: Date.now() }));
    }
  }
  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    queueMicrotask(() => { try { if (this.onclose) this.onclose({}); } catch {} });
  }
  // ── test-side controls ──
  __open() {
    if (this.readyState !== MockWebSocket.CONNECTING) return;
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) this.onopen({});
  }
  __receive(obj) {
    if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
  }
  __serverClose() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) this.onclose({});
  }
  /** Simulate a raw browser-level close (handlers still attached). */
  __kill() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    try { if (this.onclose) this.onclose({}); } catch {}
  }
  messages(type) {
    return this.sent.map((s) => JSON.parse(s)).filter((m) => !type || m.t === type);
  }
  lastHello() {
    const hellos = this.messages('hello');
    return hellos[hellos.length - 1];
  }
}

export const liveSockets = () =>
  sockets.filter((s) => s.readyState === MockWebSocket.OPEN || s.readyState === MockWebSocket.CONNECTING);

/** Wait for a socket created at/after index `since`; optionally open it at once. */
export async function waitForSocket(since, { open = false, timeout = 3000, poll = 10 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const fresh = sockets.slice(since).find(
      (s) => s.readyState === MockWebSocket.CONNECTING || s.readyState === MockWebSocket.OPEN,
    );
    if (fresh) {
      if (open && fresh.readyState === MockWebSocket.CONNECTING) fresh.__open();
      return fresh;
    }
    await sleep(poll);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fake world engine — records every call so tests can assert idempotency
// ─────────────────────────────────────────────────────────────────────────────
export function createFakeEngine(host) {
  const engine = {
    host,
    calls: {
      setWorld: 0, createMyPlayer: 0, syncRemotePlayers: 0, setMyPos: 0,
      attachTo: 0, dispose: 0, setFestivalItems: 0, clearFestivalItems: 0,
      handleEvent: 0, setWeather: 0, setClock: 0, setMyPlayer: 0,
    },
    remotes: new Map(),
    world: null,
    setWorld(world) { this.calls.setWorld++; this.world = world; },
    createMyPlayer() { this.calls.createMyPlayer++; },
    setMyPos() { this.calls.setMyPos++; },
    setClock() { this.calls.setClock++; },
    setWeather() { this.calls.setWeather++; },
    setFestivalItems() { this.calls.setFestivalItems++; },
    clearFestivalItems() { this.calls.clearFestivalItems++; },
    syncRemotePlayers(players) {
      this.calls.syncRemotePlayers++;
      // Mirrors the real engine: keyed by player id → never duplicated.
      for (const p of players || []) this.remotes.set(String(p.id), p);
    },
    setMyPlayer() { this.calls.setMyPlayer++; },
    setSelectedItem() {},
    handleEvent() { this.calls.handleEvent++; },
    syncSnapshotPositions() {},
    syncNpcPositions() {},
    getWorldState() { return this.world; },
    attachTo(host) { this.calls.attachTo++; this.host = host; },
    setMoveVector() {},
    dispose() { this.calls.dispose++; },
  };
  return engine;
}
