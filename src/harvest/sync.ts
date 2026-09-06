// Realtime WebSocket client with auto-reconnect, heartbeat & resume.
import { ClientMsg } from './types';

export type SyncState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

const HELLO_TIMEOUT_MS = 9000;
const MAX_RECONNECT_DELAY_MS = 10000;

export class SyncClient {
  private ws: WebSocket | null = null;
  private room: string;
  private userId: string;
  private username: string;
  private onMsg: (raw: string) => void;
  private onState: (s: SyncState, err?: string) => void;
  private retry = 0;
  private closed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private helloTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPong = 0;
  private lastPing = 0;
  private helloHandled = false;

  constructor(room: string, userId: string, username: string, onMsg: (raw: string) => void, onState: (s: SyncState, err?: string) => void) {
    this.room = room;
    this.userId = userId;
    this.username = username;
    this.onMsg = onMsg;
    this.onState = onState;
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
   * Re-open an abandoned/unhealthy socket. Safe to call after backgrounding,
   * visibility changes, or when the UI wants to force a handshake retry.
   */
  ensureOpen() {
    if (this.closed) this.closed = false;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.retry = 0;
    this.openSocket();
  }

  private openSocket() {
    if (!this.closed && this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws/harvest`;
    this.helloHandled = false;
    if (this.retry > 0) this.onState('reconnecting');
    else this.onState('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.closed || this.ws !== ws) return;
      this.retry = 0;
      this.onState('open');
      this.send({ t: 'hello', room: this.room, userId: this.userId, username: this.username });
      this.startHeartbeat();
      this.startHelloWatchdog();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      try {
        const msg = JSON.parse(String(ev.data)) as { t: string; ts?: number };
        if (msg.t === 'pong') this.lastPong = Date.now();
        // The server replied to our hello — loading is no longer allowed to hang.
        if (!this.helloHandled && (msg.t === 'hello_ack' || msg.t === 'snapshot')) {
          this.helloHandled = true;
          this.stopHelloWatchdog();
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
      if (!this.closed) {
        this.scheduleReconnect();
      } else {
        this.onState('closed');
      }
    };
    ws.onerror = () => {
      try { ws.close(); } catch {}
    };
  }

  private scheduleReconnect() {
    const delay = Math.min(MAX_RECONNECT_DELAY_MS, 800 * Math.pow(1.6, this.retry++));
    this.onState('reconnecting');
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (!this.closed) this.openSocket();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.lastPong = Date.now();
    this.pingTimer = setInterval(() => {
      this.lastPing = Date.now();
      this.send({ t: 'ping', ts: this.lastPing });
      if (Date.now() - this.lastPong > 12000) {
        console.warn('[harvest] heartbeat timeout — reconnecting');
        try {
          if (this.ws) this.ws.close();
        } catch {}
      }
    }, 5000);
  }
  private stopHeartbeat() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  /**
   * If the TCP/WebSocket pair connects but the game server never answers the
   * hello handshake, force a reconnect instead of leaving the user at the
   * "Menghubungkan ke Server..." / "Menyiapkan Dunia..." screen forever.
   */
  private startHelloWatchdog() {
    this.stopHelloWatchdog();
    this.helloTimer = setTimeout(() => {
      if (this.helloHandled || this.closed || !this.ws) return;
      console.warn('[harvest] hello watchdog — server did not answer, reconnecting');
      try { this.ws.close(); } catch {}
    }, HELLO_TIMEOUT_MS);
  }
  private stopHelloWatchdog() {
    if (this.helloTimer) { clearTimeout(this.helloTimer); this.helloTimer = null; }
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch {}
    }
  }

  isOpen() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  close() {
    this.closed = true;
    this.stopHeartbeat();
    this.stopHelloWatchdog();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { this.ws?.close(1000, 'bye'); } catch {}
  }
}
