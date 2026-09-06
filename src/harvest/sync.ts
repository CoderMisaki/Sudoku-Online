// Realtime WebSocket client with auto-reconnect, heartbeat & resume.
//
// Connection model (a socket being OPEN is NOT enough — the game handshake must
// complete before the client is considered connected):
//
//   CONNECTING → OPEN → HELLO SENT → HELLO_ACK / SNAPSHOT → READY
//
// Two distinct recovery primitives:
//
//   ensureOpen()     = "make sure the connection is healthy" (passive, keeps the
//                      retry budget, never opens a second socket).
//   forceReconnect() = "throw the old socket away and redo the handshake from
//                      zero" (explicit user/lifecycle signal, resets the budget).
//
// Automatic retries use exponential backoff capped at 10s, and stop after a
// bounded budget so the UI can show an explicit recovery state instead of
// spinning forever.
import type { ClientMsg } from './types';

export type SyncState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

export interface SyncStateInfo {
  /** Current automatic-retry attempt counter (resets on successful handshake). */
  retry: number;
  /** Human-readable reason for the last transition (logging/diagnostics). */
  reason?: string;
}

export const HELLO_TIMEOUT_MS = 9000;
export const CONNECT_TIMEOUT_MS = 8000;
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 12000;
export const MAX_RECONNECT_DELAY_MS = 10000;
export const BASE_RECONNECT_DELAY_MS = 800;
/** Automatic retries stop after this many attempts — the user takes over. */
export const MAX_AUTO_RETRIES = 10;

export interface SyncClientOptions {
  helloTimeoutMs?: number;
  connectTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxAutoRetries?: number;
}

export function computeReconnectDelay(retry: number): number {
  return Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * Math.pow(1.6, Math.max(0, retry)));
}

export class SyncClient {
  private ws: WebSocket | null = null;
  private room: string;
  private userId: string;
  private username: string;
  private onMsg: (raw: string) => void;
  private onState: (s: SyncState, err?: string, info?: SyncStateInfo) => void;
  private retry = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPong = 0;
  private lastPing = 0;
  private helloHandled = false;
  private helloSentAt = 0;
  private connectingSince = 0;
  private budgetExhausted = false;
  private readonly helloTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly maxAutoRetries: number;

  constructor(
    room: string,
    userId: string,
    username: string,
    onMsg: (raw: string) => void,
    onState: (s: SyncState, err?: string, info?: SyncStateInfo) => void,
    opts?: SyncClientOptions,
  ) {
    this.room = room;
    this.userId = userId;
    this.username = username;
    this.onMsg = onMsg;
    this.onState = onState;
    this.helloTimeoutMs = opts?.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
    this.connectTimeoutMs = opts?.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    this.heartbeatIntervalMs = opts?.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    this.heartbeatTimeoutMs = opts?.heartbeatTimeoutMs ?? HEARTBEAT_TIMEOUT_MS;
    this.maxAutoRetries = opts?.maxAutoRetries ?? MAX_AUTO_RETRIES;
  }

  private emit(s: SyncState, reason?: string) {
    this.onState(s, undefined, { retry: this.retry, reason });
  }

  connect() {
    if (this.closed) this.closed = false;
    // Avoid leaking a second socket if something calls connect twice.
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.openSocket();
  }

  /**
   * Passive health check — "make sure the connection is healthy".
   *
   * - Healthy socket (OPEN + handshake done + fresh heartbeat): no-op.
   * - OPEN but the hello handshake never completed in time: unhealthy → recover.
   * - CONNECTING past the connection watchdog: unhealthy → recover.
   * - Dead/missing socket: reopen (unless the automatic budget is exhausted —
   *   then only an explicit forceReconnect() may open a new socket).
   *
   * Never creates a second socket while one is alive.
   */
  ensureOpen() {
    if (this.closed) this.closed = false;
    const ws = this.ws;
    if (!ws) {
      if (this.budgetExhausted) return;
      this.openSocket();
      return;
    }
    if (ws.readyState === WebSocket.OPEN) {
      if (!this.helloHandled) {
        if (this.helloSentAt > 0 && Date.now() - this.helloSentAt > this.helloTimeoutMs) {
          this.recover('stale-handshake');
        }
        return;
      }
      if (this.lastPong > 0 && Date.now() - this.lastPong > this.heartbeatTimeoutMs) {
        this.recover('stale-heartbeat');
      }
      return;
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      if (this.connectingSince > 0 && Date.now() - this.connectingSince > this.connectTimeoutMs) {
        this.recover('connect-timeout');
      }
      return;
    }
    // CLOSED / CLOSING — reopen from scratch unless we're waiting on the user.
    if (this.budgetExhausted) return;
    this.destroySocket();
    this.openSocket();
  }

  /**
   * Explicit recovery — "throw the old socket away and redo the handshake
   * from zero". Used by the "Coba Sambungkan Lagi" button and by mobile
   * lifecycle resume signals (foreground/online/rotation).
   *
   * 1. cancels pending retry timers, 2. stops heartbeat + watchdogs,
   * 3. destroys the old socket, 4. resets the retry budget,
   * 5. opens exactly one fresh socket and re-runs the hello handshake.
   */
  forceReconnect(reason = 'manual') {
    console.log('[harvest] force reconnect', reason);
    if (this.closed) this.closed = false;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopHeartbeat();
    this.stopHelloWatchdog();
    this.stopConnectWatchdog();
    this.destroySocket();
    this.retry = 0;
    this.budgetExhausted = false;
    this.openSocket();
  }

  private openSocket() {
    if (this.closed) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    // A pending retry timer must never fire later and kill this fresh socket.
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws/harvest`;
    console.log('[harvest] websocket opening', `attempt=${this.retry + 1}`);
    this.helloHandled = false;
    this.helloSentAt = 0;
    this.connectingSince = Date.now();
    if (this.retry > 0) this.emit('reconnecting', 'opening');
    else this.emit('connecting', 'opening');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect('open-failed');
      return;
    }
    this.ws = ws;
    this.startConnectWatchdog(ws);
    ws.onopen = () => {
      if (this.closed || this.ws !== ws) return;
      console.log('[harvest] websocket open');
      this.stopConnectWatchdog();
      this.emit('open', 'socket-open');
      this.send({ t: 'hello', room: this.room, userId: this.userId, username: this.username });
      this.helloSentAt = Date.now();
      console.log('[harvest] hello sent');
      this.startHeartbeat();
      this.startHelloWatchdog();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(String(ev.data)) as { t: string; ts?: number };
        if (msg.t === 'pong') this.lastPong = Date.now();
        // The server replied to our hello — the handshake is complete and the
        // retry budget resets. Loading is no longer allowed to hang.
        if (!this.helloHandled && (msg.t === 'hello_ack' || msg.t === 'snapshot')) {
          this.helloHandled = true;
          this.retry = 0;
          this.budgetExhausted = false;
          this.stopHelloWatchdog();
          if (msg.t === 'hello_ack') console.log('[harvest] hello_ack received');
          else console.log('[harvest] snapshot received');
        }
        this.onMsg(String(ev.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopHeartbeat();
      this.stopHelloWatchdog();
      this.stopConnectWatchdog();
      if (!this.closed) {
        this.scheduleReconnect('close');
      } else {
        this.emit('closed', 'client-closed');
      }
    };
    ws.onerror = () => {
      if (this.ws !== ws) return;
      try { ws.close(); } catch {}
    };
  }

  /**
   * Internal watchdog path: destroy the stale socket and retry with
   * exponential backoff (never a tight immediate loop).
   */
  private recover(reason: string) {
    console.warn(`[harvest] connection unhealthy (${reason}) — recovering`);
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopHeartbeat();
    this.stopHelloWatchdog();
    this.stopConnectWatchdog();
    this.destroySocket();
    this.scheduleReconnect(reason);
  }

  /** Detach + close the current socket so its late callbacks can never fire. */
  private destroySocket() {
    const ws = this.ws;
    this.ws = null;
    this.helloHandled = false;
    this.helloSentAt = 0;
    this.connectingSince = 0;
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
      } catch {}
      try { ws.close(); } catch {}
    }
  }

  private scheduleReconnect(reason: string) {
    if (this.closed) return;
    if (this.retry >= this.maxAutoRetries) {
      this.budgetExhausted = true;
      console.warn('[harvest] reconnect failed — retry budget exhausted, waiting for user action');
      this.emit('error', reason);
      return;
    }
    const delay = computeReconnectDelay(this.retry);
    this.retry += 1;
    console.log(`[harvest] retry scheduled in ${delay}ms (${reason}, attempt=${this.retry})`);
    this.emit('reconnecting', reason);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      // Something else may have already recovered (manual retry, lifecycle).
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      this.destroySocket();
      this.openSocket();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastPong = Date.now();
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.lastPing = Date.now();
      this.send({ t: 'ping', ts: this.lastPing });
      if (Date.now() - this.lastPong > this.heartbeatTimeoutMs) {
        console.warn('[harvest] heartbeat timeout — reconnecting');
        this.recover('heartbeat-timeout');
      }
    }, this.heartbeatIntervalMs);
  }
  private stopHeartbeat() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  /**
   * If the TCP/WebSocket pair connects but the game server never answers the
   * hello handshake, recover with backoff instead of leaving the user at the
   * loading screen forever.
   */
  private startHelloWatchdog() {
    this.stopHelloWatchdog();
    this.helloTimer = setTimeout(() => {
      this.helloTimer = null;
      if (this.helloHandled || this.closed || !this.ws) return;
      console.warn('[harvest] hello watchdog — server did not answer, reconnecting');
      this.recover('hello-timeout');
    }, this.helloTimeoutMs);
  }
  private stopHelloWatchdog() {
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
  }

  /**
   * CONNECTING must never hang forever (common after rotation/backgrounding
   * when the browser suspends the socket without firing onclose).
   */
  private startConnectWatchdog(ws: WebSocket) {
    this.stopConnectWatchdog();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.closed || this.ws !== ws) return;
      if (ws.readyState === WebSocket.CONNECTING) {
        console.warn('[harvest] connect watchdog — stuck in CONNECTING, reconnecting');
        this.recover('connect-timeout');
      }
    }, this.connectTimeoutMs);
  }
  private stopConnectWatchdog() {
    if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch {}
    }
  }

  isOpen() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  /** True only after the server answered our hello (hello_ack / snapshot). */
  isHandshakeDone() { return this.isOpen() && this.helloHandled; }

  /**
   * True when the socket is OPEN, the handshake completed, and heartbeats are
   * fresh. This is the only state where gameplay traffic is trustworthy.
   */
  isHealthy() {
    if (!this.isHandshakeDone()) return false;
    if (this.lastPong > 0 && Date.now() - this.lastPong > this.heartbeatTimeoutMs + 3000) return false;
    return true;
  }

  socketState(): 'empty' | 'connecting' | 'open' | 'closing' | 'closed' {
    if (!this.ws) return 'empty';
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'open';
      case WebSocket.CLOSING: return 'closing';
      default: return 'closed';
    }
  }

  /**
   * Ask the server for the authoritative snapshot again (post-rotation
   * resync). Only sent when the handshake already completed — never before.
   */
  requestResync(): boolean {
    if (!this.isHandshakeDone()) return false;
    console.log('[harvest] requesting resync (req_state)');
    this.send({ t: 'req_state' });
    return true;
  }

  getRetryCount() { return this.retry; }
  isBudgetExhausted() { return this.budgetExhausted; }

  close() {
    this.closed = true;
    this.stopHeartbeat();
    this.stopHelloWatchdog();
    this.stopConnectWatchdog();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.onopen = null;
        ws.onmessage = null;
        ws.onclose = null;
        ws.onerror = null;
      } catch {}
      try { ws.close(1000, 'bye'); } catch {}
    }
  }
}
