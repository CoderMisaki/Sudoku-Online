// Realtime WebSocket client with auto-reconnect, heartbeat & resume.
//
// ONE state machine — the single source of truth for "is the game connected?":
//
//   connecting ─┐
//   recovering ─┼→ open → (hello sent) → ready          ← terminal success
//   reconnecting┘                       ↘ (drop) → reconnecting → open → ready
//
//   ready/connecting/reconnecting → error (FAILED: retry budget exhausted,
//                                        an explicit user action is required)
//
// A socket being OPEN is **not** enough: `ready` is only emitted after the
// server answered the hello handshake (`hello_ack` or the authoritative
// `snapshot`). UI must never treat OPEN as "game recovered".
//
// Two distinct recovery primitives:
//
//   ensureOpen()        = "make sure the connection is healthy" (passive, keeps
//                         the retry budget, never opens a second socket).
//   probeAfterResume()  = "we just came back to the foreground / rotated":
//                         ping the socket and give it a short grace period to
//                         prove it is alive before tearing it down.
//   forceReconnect()    = "throw the old socket away and redo the handshake
//                         from zero" (explicit user/lifecycle signal, resets
//                         the retry budget).
//
// Socket identity: every socket gets a monotonically increasing **generation**
// id. All callbacks (onopen/onmessage/onclose/onerror) and all timers capture
// their generation and bail out when it is no longer current, so a stale socket
// can never mutate state, schedule a retry, or close a fresh socket.
//
// Automatic retries use exponential backoff capped at 10s and stop after a
// bounded budget so the UI can show an explicit FAILED state instead of
// spinning forever.
import type { ClientMsg } from './types';
import { dlog, dwarn } from './debug';

export type SyncState =
  | 'connecting'   // first attempt at a socket
  | 'reconnecting' // automatic retry after a drop (backoff)
  | 'recovering'   // explicit recovery in progress (manual retry / resume)
  | 'open'         // socket OPEN, handshake still pending
  | 'ready'        // handshake complete (hello_ack | snapshot) — success
  | 'closed'       // client intentionally closed
  | 'error';       // FAILED — retry budget exhausted, user action required

export interface SyncStateInfo {
  /** Current automatic-retry attempt counter (resets on successful handshake). */
  retry: number;
  /** Human-readable reason for the last transition (logging/diagnostics). */
  reason?: string;
  /** Socket generation the transition belongs to. */
  gen?: number;
  /** True once the server answered our hello. */
  handshake?: boolean;
}

export const HELLO_TIMEOUT_MS = 9000;
export const CONNECT_TIMEOUT_MS = 8000;
export const HEARTBEAT_INTERVAL_MS = 5000;
export const HEARTBEAT_TIMEOUT_MS = 12000;
export const MAX_RECONNECT_DELAY_MS = 10000;
export const BASE_RECONNECT_DELAY_MS = 800;
/** Automatic retries stop after this many attempts — the user takes over. */
export const MAX_AUTO_RETRIES = 10;
/** Grace period for a resumed socket to answer a probe ping. */
export const RESUME_GRACE_MS = 4000;

export interface SyncClientOptions {
  helloTimeoutMs?: number;
  connectTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  maxAutoRetries?: number;
  resumeGraceMs?: number;
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
  private resumeTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPong = 0;
  private lastPing = 0;
  private helloHandled = false;
  private helloSentAt = 0;
  private connectingSince = 0;
  private budgetExhausted = false;
  private explicitRecovery = false;
  /** Socket identity guard — bumped for every socket we create. */
  private gen = 0;
  private socketsCreated = 0;
  private readyAt = 0;
  private readonly helloTimeoutMs: number;
  private readonly connectTimeoutMs: number;
  private readonly heartbeatIntervalMs: number;
  private readonly heartbeatTimeoutMs: number;
  private readonly maxAutoRetries: number;
  private readonly resumeGraceMs: number;

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
    this.resumeGraceMs = opts?.resumeGraceMs ?? RESUME_GRACE_MS;
  }

  private emit(s: SyncState, reason?: string) {
    this.onState(s, undefined, {
      retry: this.retry,
      reason,
      gen: this.gen,
      handshake: this.helloHandled,
    });
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
      if (this.budgetExhausted) return false;
      this.openSocket();
      return true;
    }
    if (ws.readyState === WebSocket.OPEN) {
      if (!this.helloHandled) {
        if (this.helloSentAt > 0 && Date.now() - this.helloSentAt > this.helloTimeoutMs) {
          this.recover('stale-handshake');
          return true;
        }
        return false;
      }
      if (this.lastPong > 0 && Date.now() - this.lastPong > this.heartbeatTimeoutMs) {
        this.recover('stale-heartbeat');
        return true;
      }
      return false;
    }
    if (ws.readyState === WebSocket.CONNECTING) {
      if (this.connectingSince > 0 && Date.now() - this.connectingSince > this.connectTimeoutMs) {
        this.recover('connect-timeout');
        return true;
      }
      return false;
    }
    // CLOSED / CLOSING — reopen from scratch unless we're waiting on the user.
    if (this.budgetExhausted) return false;
    this.destroySocket();
    this.openSocket();
    return true;
  }

  /**
   * Resume probe — used after foreground/rotation/online events.
   *
   * A socket that merely *looks* stale (timers were throttled while the PWA was
   * backgrounded) must not be torn down: that is what caused the reconnect
   * overlay to flash over a perfectly playable game. Instead we ping it and
   * grant a short grace period; only if no pong arrives do we recover.
   *
   * Returns the action taken, for logging/tests.
   */
  probeAfterResume(reason = 'resume'): 'healthy' | 'probing' | 'reopened' | 'forced' | 'connecting' | 'closed' {
    if (this.closed) return 'closed';
    const ws = this.ws;
    if (!ws) {
      // No socket at all: an exhausted budget must not block an explicit resume.
      if (this.budgetExhausted) {
        this.forceReconnect(`${reason}:budget-reset`);
        return 'forced';
      }
      this.openSocket();
      return 'reopened';
    }
    if (ws.readyState === WebSocket.CONNECTING) return 'connecting';
    if (ws.readyState !== WebSocket.OPEN) {
      this.forceReconnect(`${reason}:dead-socket`);
      return 'forced';
    }
    if (!this.helloHandled) {
      // OPEN but never handshook — redo the handshake from zero.
      this.forceReconnect(`${reason}:no-handshake`);
      return 'forced';
    }
    const gen = this.gen;
    // Give the socket a grace window to prove it is alive instead of judging it
    // on a pong that may simply have been throttled in the background.
    const probeAt = Date.now();
    this.lastPong = probeAt;
    this.send({ t: 'ping', ts: probeAt });
    this.stopResumeTimer();
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      if (this.closed || gen !== this.gen) return;
      if (this.lastPong <= probeAt) {
        dwarn('ws', 'resume probe unanswered — forcing fresh handshake', { gen, reason });
        this.forceReconnect(`${reason}:probe-timeout`);
      }
    }, this.resumeGraceMs);
    dlog('recovery', 'socket probed', { reason, gen });
    return 'probing';
  }

  /**
   * Explicit recovery — "throw the old socket away and redo the handshake
   * from zero". Used by the "Coba Sambungkan Lagi" button and by mobile
   * lifecycle resume signals (foreground/online) when the socket is unhealthy.
   *
   * 1. cancels pending retry/resume timers, 2. stops heartbeat + watchdogs,
   * 3. destroys the old socket (detaching every stale callback),
   * 4. resets the retry budget, 5. bumps the socket generation,
   * 6. opens exactly one fresh socket and re-runs the hello handshake.
   */
  forceReconnect(reason = 'manual') {
    dlog('recovery', 'force reconnect', { reason, gen: this.gen });
    if (this.closed) this.closed = false;
    this.clearAllTimers();
    this.destroySocket();
    this.retry = 0;
    this.budgetExhausted = false;
    this.explicitRecovery = true;
    this.openSocket();
  }

  private clearAllTimers() {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.stopHeartbeat();
    this.stopHelloWatchdog();
    this.stopConnectWatchdog();
    this.stopResumeTimer();
  }

  private stopResumeTimer() {
    if (this.resumeTimer) { clearTimeout(this.resumeTimer); this.resumeTimer = null; }
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

    // ── new socket identity: every callback below is bound to this generation ──
    const gen = ++this.gen;
    this.socketsCreated += 1;
    this.helloHandled = false;
    this.helloSentAt = 0;
    this.connectingSince = Date.now();
    this.lastPong = 0;
    this.readyAt = 0;

    if (this.explicitRecovery && this.retry === 0) this.emit('recovering', 'opening');
    else if (this.retry > 0) this.emit('reconnecting', 'opening');
    else this.emit('connecting', 'opening');
    dlog('ws', 'socket created', { id: gen, attempt: this.retry + 1, url });

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      dwarn('ws', 'socket constructor threw', { id: gen, err: String(err) });
      this.scheduleReconnect('open-failed');
      return;
    }
    this.ws = ws;
    this.startConnectWatchdog(ws, gen);

    ws.onopen = () => {
      if (this.closed || gen !== this.gen || this.ws !== ws) return;
      dlog('ws', 'socket open', { id: gen });
      this.stopConnectWatchdog();
      this.emit('open', 'socket-open');
      this.send({ t: 'hello', room: this.room, userId: this.userId, username: this.username });
      this.helloSentAt = Date.now();
      dlog('handshake', 'hello sent', { id: gen, room: this.room, userId: this.userId });
      this.startHeartbeat(gen);
      this.startHelloWatchdog(gen);
    };

    ws.onmessage = (ev) => {
      if (gen !== this.gen || this.ws !== ws) return; // stale socket → ignore
      let msg: { t?: string };
      try {
        msg = JSON.parse(String(ev.data)) as { t?: string };
      } catch {
        return; // ignore malformed frames
      }
      const t = msg.t;
      if (t === 'pong') {
        this.lastPong = Date.now();
        this.stopResumeTimer();
        return;
      }
      // The server replied to our hello — this frame completes the handshake.
      const completesHandshake = !this.helloHandled && (t === 'hello_ack' || t === 'snapshot');
      // Deliver the payload FIRST so the app can record the authoritative
      // result (snapshot → game screen, hello_ack → creator), then flip the
      // connection state machine to its terminal `ready` state. Doing it in
      // this order keeps store.status and store.screen from ever contradicting.
      try {
        this.onMsg(String(ev.data));
      } catch (err) {
        dwarn('ws', 'message handler threw', { id: gen, err: String(err) });
      }
      if (completesHandshake && gen === this.gen) {
        this.markReady(t === 'snapshot' ? 'snapshot' : 'hello_ack', gen);
      }
    };

    ws.onclose = () => {
      if (gen !== this.gen || this.ws !== ws) return; // stale socket → ignore
      this.ws = null;
      this.stopHeartbeat();
      this.stopHelloWatchdog();
      this.stopConnectWatchdog();
      this.stopResumeTimer();
      dlog('ws', 'socket closed', { id: gen, intentional: this.closed });
      if (!this.closed) {
        this.scheduleReconnect('close');
      } else {
        this.emit('closed', 'client-closed');
      }
    };

    ws.onerror = () => {
      if (gen !== this.gen || this.ws !== ws) return;
      dwarn('ws', 'socket error', { id: gen });
      try { ws.close(); } catch {}
    };
  }

  /** Handshake complete → terminal success state, no retry may stay pending. */
  private markReady(source: 'hello_ack' | 'snapshot', gen: number) {
    this.helloHandled = true;
    this.retry = 0;
    this.budgetExhausted = false;
    this.explicitRecovery = false;
    this.readyAt = Date.now();
    this.lastPong = Date.now();
    this.stopHelloWatchdog();
    // A pending automatic retry must never fire after a successful handshake.
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    dlog('handshake', `${source} received — handshake complete`, { id: gen });
    this.emit('ready', source);
  }

  /**
   * Internal watchdog path: destroy the stale socket and retry with
   * exponential backoff (never a tight immediate loop).
   */
  private recover(reason: string) {
    dwarn('ws', 'connection unhealthy — recovering', { reason, gen: this.gen });
    this.clearAllTimers();
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
    // Never contradict a live socket: if one is already open/connecting there
    // is nothing to retry (and emitting 'reconnecting' here is what used to
    // leave the overlay stuck over a healthy game).
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    if (this.retry >= this.maxAutoRetries) {
      this.budgetExhausted = true;
      this.explicitRecovery = false;
      dwarn('recovery', 'retry budget exhausted — FAILED, waiting for user action', {
        reason,
        attempts: this.retry,
      });
      this.emit('error', reason);
      return;
    }
    const delay = computeReconnectDelay(this.retry);
    const gen = this.gen;
    this.retry += 1;
    dlog('recovery', 'retry scheduled', { delay, reason, attempt: this.retry });
    this.emit('reconnecting', reason);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.closed) return;
      if (gen !== this.gen) return; // a newer socket took over — stay out of it
      // Something else may have already recovered (manual retry, lifecycle).
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
        return;
      }
      this.destroySocket();
      this.openSocket();
    }, delay);
  }

  private startHeartbeat(gen: number) {
    this.stopHeartbeat();
    this.lastPong = Date.now();
    this.pingTimer = setInterval(() => {
      if (this.closed || gen !== this.gen) { this.stopHeartbeat(); return; }
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.lastPing = Date.now();
      this.send({ t: 'ping', ts: this.lastPing });
      if (Date.now() - this.lastPong > this.heartbeatTimeoutMs) {
        dwarn('ws', 'heartbeat timeout — reconnecting', { gen });
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
  private startHelloWatchdog(gen: number) {
    this.stopHelloWatchdog();
    this.helloTimer = setTimeout(() => {
      this.helloTimer = null;
      if (gen !== this.gen) return;
      if (this.helloHandled || this.closed || !this.ws) return;
      dwarn('ws', 'hello watchdog — server did not answer, reconnecting', { gen });
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
  private startConnectWatchdog(ws: WebSocket, gen: number) {
    this.stopConnectWatchdog();
    this.connectTimer = setTimeout(() => {
      this.connectTimer = null;
      if (this.closed || gen !== this.gen || this.ws !== ws) return;
      if (ws.readyState === WebSocket.CONNECTING) {
        dwarn('ws', 'connect watchdog — stuck in CONNECTING, reconnecting', { gen });
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
    dlog('recovery', 'requesting resync (req_state)', { gen: this.gen });
    this.send({ t: 'req_state' });
    return true;
  }

  getRetryCount() { return this.retry; }
  isBudgetExhausted() { return this.budgetExhausted; }
  /** True when automatic retries are on hold and only an explicit retry helps. */
  isRecoveryBlocked() { return this.budgetExhausted && !this.isOpen(); }
  getGeneration() { return this.gen; }
  getSocketsCreated() { return this.socketsCreated; }
  getReadyAt() { return this.readyAt; }
  getIdentity() { return { room: this.room, userId: this.userId, username: this.username }; }

  close() {
    this.closed = true;
    this.clearAllTimers();
    // Bumping the generation invalidates every outstanding callback/timer.
    this.gen += 1;
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
