// Realtime WebSocket client with auto-reconnect, heartbeat & resume.
import { ClientMsg } from './types';

export type SyncState = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'error';

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
  private lastPong = 0;
  private lastPing = 0;
  /** Called after each successful (re)open, so callers can resync state. */
  private onOpen?: () => void;

  constructor(
    room: string,
    userId: string,
    username: string,
    onMsg: (raw: string) => void,
    onState: (s: SyncState, err?: string) => void,
    onOpen?: () => void,
  ) {
    this.room = room;
    this.userId = userId;
    this.username = username;
    this.onMsg = onMsg;
    this.onState = onState;
    this.onOpen = onOpen;
  }

  connect() {
    this.closed = false;
    this.openSocket();
  }

  private openSocket() {
    // Tear down any previous socket first: without this a reconnect scheduled
    // while an old socket is still closing leaves two live message listeners.
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      old.onopen = null; old.onmessage = null; old.onclose = null; old.onerror = null;
      try { old.close(); } catch { /* already closed */ }
    }
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}/ws/harvest`;
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
      this.retry = 0;
      this.onState('open');
      // hello re-establishes the session; the server replies with hello_ack and,
      // for an existing character, a full snapshot — so reconnect never resets
      // inventory/gold and never creates a duplicate character.
      this.send({ t: 'hello', room: this.room, userId: this.userId, username: this.username });
      this.startHeartbeat();
      this.onOpen?.();
    };
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(String(ev.data)) as { t: string; ts?: number };
        if (msg.t === 'pong') this.lastPong = Date.now();
        this.onMsg(String(ev.data));
      } catch {
        // ignore malformed frames
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return; // superseded socket — ignore its close
      this.stopHeartbeat();
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
    const delay = Math.min(10000, 800 * Math.pow(1.6, this.retry++));
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
        try { this.ws?.close(); } catch {}
      }
    }, 5000);
  }
  private stopHeartbeat() {
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try { this.ws.send(JSON.stringify(msg)); } catch {}
    }
  }

  isOpen() { return !!this.ws && this.ws.readyState === WebSocket.OPEN; }

  /** Force an immediate reconnect attempt (e.g. tab became visible again). */
  reconnectNow() {
    if (this.closed) return;
    if (this.isOpen()) return;
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.retry = 0;
    this.openSocket();
  }

  close() {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = null; ws.onmessage = null; ws.onclose = null; ws.onerror = null;
      try { ws.close(1000, 'bye'); } catch { /* already closed */ }
    }
    this.onState('closed');
  }
}
