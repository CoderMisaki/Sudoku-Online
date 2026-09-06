// Harvest Moon — session controller.
//
// ONE object owns the whole realtime session so that no React effect, rotation
// event or lifecycle signal can ever create a second socket, a second engine or
// a second identity:
//
//   • exactly one SyncClient per room session (created in start(), never by a
//     rotation/resize/foreground event)
//   • exactly one WorldEngine (created on the first authoritative snapshot,
//     re-attached — never rebuilt — when React remounts the canvas host)
//   • exactly one recovery coordinator (every lifecycle signal funnels through
//     recover(), coalesced, generation-guarded)
//   • exactly one state machine: SyncClient state → store.status, snapshot →
//     store.screen. `ready` is only reached after hello_ack/snapshot, never on
//     a bare socket OPEN.
//
// The React layer (HarvestMoonGame) is a thin view: it renders overlays from
// store state and forwards DOM/lifecycle events here.
import { SyncClient, SyncState, SyncStateInfo, SyncClientOptions } from './sync';
import { useHarvestStore } from './store';
// Type-only: the session must stay importable (and testable) without pulling
// three.js/WebGL into the module graph. The React layer injects the real
// WorldEngine factory.
import type { WorldEngine, EngineOpts } from './world';
import { audio } from './audio';
import { dlog, dwarn, derror } from './debug';
import { isLandscapeDevice, waitForViewportSettle } from './orientation';
import type { ClientMsg, ServerMsg, EventMsg, SnapshotMsg, PlayerState } from './types';

export type EngineFactory = (host: HTMLElement, opts: EngineOpts) => WorldEngine;

/** Signals that may trigger the single recovery coordinator. */
export type RecoverySource =
  | 'orientation'
  | 'viewport'
  | 'resize'
  | 'visibility'
  | 'pageshow'
  | 'focus'
  | 'online'
  | 'manual'
  | 'watchdog';

export interface HarvestSessionOptions {
  roomId: string;
  /** Creates the ONE world engine (injected so tests can supply a fake). */
  engineFactory: EngineFactory;
  syncOptions?: SyncClientOptions;
  /** Burst window for lifecycle events (rotation fires resize+orientationchange+…). */
  coalesceMs?: number;
  /** How long we wait for the authoritative snapshot after a handshake. */
  snapshotWatchdogMs?: number;
  /** How many resync attempts before the session declares FAILED. */
  maxSnapshotAttempts?: number;
  /** Injectable clock (tests). */
  now?: () => number;
}

export interface HarvestSessionDiagnostics {
  started: boolean;
  disposed: boolean;
  socketsCreated: number;
  generation: number;
  enginesCreated: number;
  snapshotsApplied: number;
  recoveries: number;
  lastRecovery: { source: string; action: string; at: number } | null;
  identity: { room: string; userId: string; username: string } | null;
  socketState: 'empty' | 'connecting' | 'open' | 'closing' | 'closed';
  healthy: boolean;
  handshakeDone: boolean;
  screen: string;
  status: string;
  landscape: boolean;
}

export class HarvestSession {
  readonly roomId: string;
  private engineFactory: EngineFactory;
  private syncOptions?: SyncClientOptions;
  private coalesceMs: number;
  private snapshotWatchdogMs: number;
  private maxSnapshotAttempts: number;
  private nowFn: () => number;

  private client: SyncClient | null = null;
  private engine: WorldEngine | null = null;
  private host: HTMLElement | null = null;

  private started = false;
  private disposed = false;
  private enginesCreated = 0;
  private snapshotsApplied = 0;
  private recoveries = 0;
  private lastRecoveryAt = 0;
  private lastRecoveryInfo: { source: string; action: string; at: number } | null = null;
  private lastSyncState: SyncState | null = null;
  private disconnectToastShown = false;
  private snapshotAttempts = 0;
  private snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  private createTries = 0;
  private createTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: HarvestSessionOptions) {
    this.roomId = String(opts.roomId || '').toUpperCase();
    this.engineFactory = opts.engineFactory;
    this.syncOptions = opts.syncOptions;
    this.coalesceMs = opts.coalesceMs ?? 1500;
    this.snapshotWatchdogMs = opts.snapshotWatchdogMs ?? 6000;
    this.maxSnapshotAttempts = opts.maxSnapshotAttempts ?? 3;
    this.nowFn = opts.now ?? (() => Date.now());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────────────────────────────────────

  get sync(): SyncClient | null { return this.client; }
  get worldEngine(): WorldEngine | null { return this.engine; }

  /**
   * Bind the (persistent) canvas host. Rotation/screen changes may remount the
   * host element; the engine simply moves its canvas across instead of being
   * rebuilt — the world, player and WebGL context survive.
   */
  attachHost(host: HTMLElement | null) {
    this.host = host;
    if (host && this.engine) this.engine.attachTo(host);
  }

  /**
   * Create the ONE SyncClient for this room session and start the handshake.
   * Idempotent: rotation, re-renders and lifecycle events can call it freely.
   */
  start(): boolean {
    if (this.disposed || this.started) return this.started;
    const st = useHarvestStore.getState();
    if (!st.userId || !st.userName) {
      dlog('session', 'start deferred — identity not ready');
      return false;
    }
    this.started = true;
    dlog('session', 'starting session', {
      room: this.roomId,
      userId: st.userId,
      username: st.userName,
      landscape: isLandscapeDevice(),
    });
    const client = new SyncClient(
      this.roomId,
      st.userId,
      st.userName,
      (raw) => this.handleRaw(raw),
      (s, err, info) => this.onSyncState(s, err, info),
      this.syncOptions,
    );
    this.client = client;
    client.connect();
    return true;
  }

  /** Send a gameplay message (no-op until the socket is OPEN). */
  send(msg: ClientMsg) {
    this.client?.send(msg);
  }

  /**
   * The single recovery coordinator. Every lifecycle signal (rotation, resize,
   * visualViewport, visibilitychange, pageshow, focus, online) funnels in here.
   *
   * Passive signals (rotation/resize) never tear down a healthy socket — they
   * only health-check and resync. Explicit resume signals (foreground/online/
   * manual) force a fresh handshake when the socket is unusable, and probe
   * (never blind-reconnect) when it looks fine.
   */
  recover(source: RecoverySource, aggressive = false) {
    if (this.disposed) return;
    const now = this.nowFn();
    if (now - this.lastRecoveryAt < this.coalesceMs) {
      dlog('recovery', 'coalesced (burst)', { source });
      return;
    }
    this.lastRecoveryAt = now;
    // Let the browser finish its rotation reflow before reading socket health.
    waitForViewportSettle(() => this.runRecovery(source, aggressive));
  }

  /** Force an immediate evaluation (bypasses the coalescing window). */
  recoverNow(source: RecoverySource, aggressive = false) {
    this.lastRecoveryAt = 0;
    this.recover(source, aggressive);
  }

  /**
   * "Coba Sambungkan Lagi" — always a genuinely fresh handshake:
   * cancel timers → destroy the old socket → reset the retry budget →
   * exactly one new socket → hello → snapshot → game.
   */
  manualRetry() {
    if (this.disposed) return;
    dlog('recovery', 'manual retry requested', { screen: this.screen(), status: this.status() });
    this.lastRecoveryAt = 0;           // explicit user intent beats coalescing
    this.snapshotAttempts = 0;
    this.clearSnapshotWatchdog();
    this.disconnectToastShown = false;
    if (!this.client) {
      this.started = false;            // no client at all → create exactly one
      this.start();
      return;
    }
    const store = useHarvestStore.getState();
    if (store.screen !== 'error') store.setStatus('recovering');
    store.markRecovery('manual', 'force-reconnect');
    this.recoveries += 1;
    this.client.forceReconnect('manual-retry');
  }

  /** Character creation bridge (waits for an OPEN socket, bounded retries). */
  createCharacter(char: PlayerState['char'], farmName: string) {
    if (!char || this.disposed) return;
    if (this.createTimer) { clearTimeout(this.createTimer); this.createTimer = null; }
    this.createTries = 0;
    const trySend = () => {
      this.createTimer = null;
      if (this.disposed) return;
      const c = this.client;
      if (c?.isOpen()) {
        c.send({ t: 'create', char, farmName: farmName || 'My Farm' } as ClientMsg);
        dlog('handshake', 'create sent');
        return;
      }
      this.createTries += 1;
      if (this.createTries > 15) {
        window.dispatchEvent(new CustomEvent('harvest-create-ack', {
          detail: { ok: false, msg: 'Koneksi ke server gagal. Coba hubungkan ulang.' },
        }));
        return;
      }
      this.createTimer = setTimeout(trySend, 300);
    };
    trySend();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.clearSnapshotWatchdog();
    if (this.createTimer) { clearTimeout(this.createTimer); this.createTimer = null; }
    dlog('session', 'disposing');
    try { this.client?.close(); } catch {}
    this.client = null;
    try { this.engine?.dispose(); } catch {}
    this.engine = null;
    this.started = false;
  }

  get diagnostics(): HarvestSessionDiagnostics {
    const st = useHarvestStore.getState();
    return {
      started: this.started,
      disposed: this.disposed,
      socketsCreated: this.client?.getSocketsCreated() ?? 0,
      generation: this.client?.getGeneration() ?? 0,
      enginesCreated: this.enginesCreated,
      snapshotsApplied: this.snapshotsApplied,
      recoveries: this.recoveries,
      lastRecovery: this.lastRecoveryInfo,
      identity: this.client?.getIdentity() ?? null,
      socketState: this.client?.socketState() ?? 'empty',
      healthy: this.client?.isHealthy() ?? false,
      handshakeDone: this.client?.isHandshakeDone() ?? false,
      screen: st.screen,
      status: st.status,
      landscape: isLandscapeDevice(),
    };
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Connection state machine
  // ───────────────────────────────────────────────────────────────────────────

  private screen() { return useHarvestStore.getState().screen; }
  private status() { return useHarvestStore.getState().status; }

  private onSyncState(s: SyncState, _err?: string, info?: SyncStateInfo) {
    if (this.disposed) return;
    const prev = this.lastSyncState;
    this.lastSyncState = s;
    const store = useHarvestStore.getState();
    switch (s) {
      case 'connecting':
        store.setStatus('connecting');
        break;
      case 'recovering':
        store.setStatus('recovering');
        break;
      case 'reconnecting':
        store.setStatus('reconnecting');
        // One toast per disconnect episode, not one per retry attempt.
        if (prev !== 'reconnecting' && !this.disconnectToastShown) {
          this.disconnectToastShown = true;
          store.toast('info', 'Koneksi terputus — mencoba menghubungkan kembali...');
        }
        break;
      case 'open':
        // OPEN is NOT connected: the handshake still has to complete.
        store.setStatus('hello');
        break;
      case 'ready':
        this.onHandshakeComplete(info?.reason || 'handshake');
        break;
      case 'closed':
        store.setStatus('closed');
        break;
      case 'error':
        store.setStatus('error');
        store.toast('warn', 'Koneksi belum pulih — ketuk Coba Sambungkan Lagi.');
        break;
      default:
        break;
    }
  }

  /**
   * Terminal success of the handshake: retry state is reset inside SyncClient,
   * the reconnect overlay may no longer block the game, and — if the
   * authoritative snapshot has not landed yet — we actively go and fetch it
   * instead of waiting forever.
   */
  private onHandshakeComplete(source: string) {
    if (this.disposed) return;
    const store = useHarvestStore.getState();
    this.disconnectToastShown = false;
    this.snapshotAttempts = 0;
    dlog('handshake', 'recovery complete', { source, screen: store.screen, status: store.status });
    if (store.screen === 'game' || store.screen === 'creator') {
      // Already in a playable/creatable state → overlays must disappear now.
      store.setStatus('ready');
      this.clearSnapshotWatchdog();
      return;
    }
    store.setStatus('syncing');
    this.armSnapshotWatchdog();
  }

  /**
   * Guarantees the loading overlay can never be infinite: after a completed
   * handshake the authoritative snapshot MUST arrive. If it does not, we resync
   * (bounded) and finally surface an actionable FAILED state.
   */
  private armSnapshotWatchdog() {
    this.clearSnapshotWatchdog();
    this.snapshotTimer = setTimeout(() => {
      this.snapshotTimer = null;
      if (this.disposed) return;
      const st = useHarvestStore.getState();
      if (st.screen === 'game' || st.screen === 'creator') return; // resolved
      const c = this.client;
      if (!c) return;
      if (this.snapshotAttempts >= this.maxSnapshotAttempts) {
        dwarn('recovery', 'snapshot never arrived — FAILED', { attempts: this.snapshotAttempts });
        st.setStatus('error');
        st.toast('warn', 'Data dunia belum diterima. Ketuk Coba Sambungkan Lagi.');
        return;
      }
      this.snapshotAttempts += 1;
      dlog('recovery', 'snapshot missing — resync', { attempt: this.snapshotAttempts });
      if (!c.requestResync()) c.forceReconnect('snapshot-missing');
      this.armSnapshotWatchdog();
    }, this.snapshotWatchdogMs);
  }

  private clearSnapshotWatchdog() {
    if (this.snapshotTimer) { clearTimeout(this.snapshotTimer); this.snapshotTimer = null; }
  }

  private runRecovery(source: RecoverySource, aggressive: boolean) {
    if (this.disposed) return;
    const c = this.client;
    if (!c) {
      // No client yet (identity was missing on first start) → create exactly one.
      if (this.start()) this.recordRecovery(source, 'started');
      return;
    }
    const st = useHarvestStore.getState();
    const landscape = isLandscapeDevice();
    const handshakeDone = c.isHandshakeDone();
    const blocked = c.isBudgetExhausted();
    dlog('recovery', 'evaluate', {
      source,
      aggressive,
      landscape,
      socket: c.socketState(),
      handshake: handshakeDone,
      budgetExhausted: blocked,
      screen: st.screen,
      status: st.status,
    });

    if (!aggressive) {
      // Passive (rotation / resize / viewport): never tear down a socket that is
      // OPEN and handshook — mobile browsers fire resize continuously (address
      // bar, split view) and a throttled heartbeat must not drop the session.
      if (c.isOpen() && c.isHandshakeDone()) {
        c.probeAfterResume(source);
        this.maybeResync(source);
      } else {
        c.ensureOpen();
      }
      this.recordRecovery(source, 'passive-health-check');
      return;
    }

    // Explicit resume (foreground / pageshow / focus / online / manual).
    if (!handshakeDone || blocked) {
      // Unusable socket, or the automatic budget ran out while we were away:
      // an explicit resume always gets a genuinely fresh handshake.
      this.recoveries += 1;
      this.snapshotAttempts = 0;
      c.forceReconnect(`lifecycle:${source}`);
      this.recordRecovery(source, 'force-reconnect');
      return;
    }
    // Looks healthy: prove it with a probe ping instead of blindly reconnecting,
    // then only resync when the UI is not already in a good state.
    const action = c.probeAfterResume(source);
    this.maybeResync(source);
    this.recordRecovery(source, `probe:${action}`);
  }

  private recordRecovery(source: string, action: string) {
    this.lastRecoveryInfo = { source, action, at: this.nowFn() };
    useHarvestStore.getState().markRecovery(source, action);
  }

  /**
   * Resync only when something is actually missing. A healthy game session that
   * is already on the game screen must not be poked (that is what caused the
   * reconnect overlay to reappear after a rotation).
   */
  private maybeResync(source: string) {
    const c = this.client;
    if (!c) return;
    const st = useHarvestStore.getState();
    const settled = st.screen === 'game' && (st.status === 'ready' || st.status === 'connected');
    if (settled) {
      dlog('recovery', 'session healthy — no resync needed', { source });
      return;
    }
    dlog('recovery', 'requesting resync', { source, screen: st.screen, status: st.status });
    c.requestResync();
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Message handling
  // ───────────────────────────────────────────────────────────────────────────

  private handleRaw(raw: string) {
    if (this.disposed) return;
    let msg: ServerMsg;
    try {
      msg = JSON.parse(raw) as ServerMsg;
    } catch {
      return;
    }
    const store = useHarvestStore.getState();
    switch (msg.t) {
      case 'hello_ack': {
        dlog('handshake', 'hello_ack', { needsCreation: !!msg.needsCreation });
        if (msg.needsCreation) {
          if (store.screen !== 'game') store.setScreen('creator');
          // The creator IS the terminal outcome of this handshake — no snapshot
          // is expected, so clear the loading state and its watchdog at once.
          if (store.status === 'syncing' || store.status === 'hello') store.setStatus('ready');
          this.snapshotAttempts = 0;
          this.clearSnapshotWatchdog();
        } else if (msg.player && msg.player.char) {
          store.setStatus('ready');
        }
        break;
      }
      case 'snapshot':
        this.applySnapshot(msg as SnapshotMsg);
        break;
      case 'snap': {
        const engine = this.engine;
        if (engine) {
          engine.syncSnapshotPositions(msg.players);
          engine.syncNpcPositions(msg.npcs);
          engine.setClock(msg.time);
          const w = engine.getWorldState();
          if (w && w.weather !== msg.weather) engine.setWeather(msg.weather);
        }
        store.applySnapMeta(msg.time, msg.day, msg.season, msg.weather);
        store.setPlayersShort([
          { id: store.userId, name: store.me?.username || store.userName, online: true },
          ...msg.players.filter((p) => String(p[0]) !== store.userId).map((p) => ({
            id: String(p[0]),
            name: (p[7] as string) || '',
            online: p[6] === 1,
          })),
        ]);
        break;
      }
      case 'event': {
        const e = (msg as EventMsg).e;
        const engine = this.engine;
        if (engine) {
          engine.handleEvent(e);
          if (e.type === 'festival') {
            if ((e.active as boolean) && e.items) {
              engine.setFestivalItems(e.items as { x: number; y: number; item: string }[]);
            }
            if (!e.active) engine.clearFestivalItems();
          }
          if (e.type === 'equipped') engine.setSelectedItem((e.item as string) || null);
          if (e.type === 'inv' && store.me) {
            engine.setMyPlayer({ ...store.me, inv: (e.inv || []) as PlayerState['inv'] });
          }
        }
        store.applyEvent(e);
        break;
      }
      case 'err': {
        if (msg.code === 'world_full' || msg.code === 'hello_invalid') {
          store.setError(msg.msg);
        } else if (msg.code === 'char_invalid') {
          window.dispatchEvent(new CustomEvent('harvest-create-ack', { detail: { ok: false, msg: msg.msg } }));
        } else {
          store.toast('warn', msg.msg);
        }
        break;
      }
      default:
        break;
    }
  }

  /**
   * Apply the authoritative snapshot.
   *
   * IDEMPOTENT: applying it twice must never duplicate players, world objects
   * or the engine, and must never bounce the player back to the character
   * creator or the loading screen. It is also the ONLY thing that may move the
   * UI into the game screen, and it always clears the recovery/loading state.
   */
  private applySnapshot(snap: SnapshotMsg) {
    const store = useHarvestStore.getState();
    const prevStatus = store.status;
    this.snapshotsApplied += 1;
    this.snapshotAttempts = 0;
    this.clearSnapshotWatchdog();
    this.disconnectToastShown = false;
    dlog('snapshot', 'received', {
      n: this.snapshotsApplied,
      char: !!snap.me?.char,
      players: snap.players?.length ?? 0,
      prevStatus,
    });
    store.setStatus('syncing');
    try {
      const engine = this.ensureEngine();
      if (engine) {
        // setWorld() clears previous scenery first → repeated snapshots are safe.
        engine.setWorld(snap.world, snap.defs);
        if (snap.me.char) engine.createMyPlayer(snap.me.char, snap.me.username);
        engine.setMyPos(snap.me.x, snap.me.y, snap.me.dir);
        engine.setClock(snap.world.time);
        engine.setWeather(snap.world.weather);
        if (snap.world.festival.active && snap.world.festival.items) {
          engine.setFestivalItems(snap.world.festival.items);
        } else {
          engine.clearFestivalItems();
        }
        engine.syncRemotePlayers(snap.players);
        engine.setMyPlayer(snap.me);
      }
      store.applySnapshot(snap.me, snap.defs, snap.world, snap.prices);
      audio.applySeason(snap.world.season);
      // A resync for a not-yet-created character must stay on the creator.
      if (snap.me.char && store.screen !== 'game') {
        store.setScreen('game');
      }
      if (prevStatus === 'reconnecting' || prevStatus === 'recovering' || prevStatus === 'error') {
        dlog('recovery', 'game recovered', { from: prevStatus, screen: useHarvestStore.getState().screen });
      }
    } catch (err) {
      derror('snapshot', 'apply failed', err);
      store.setError('Gagal memuat dunia. Coba hubungkan ulang.');
    }
  }

  /**
   * Exactly one engine for the whole session. If the canvas host changed (React
   * remount / rotation) the existing engine is re-attached, never rebuilt.
   */
  private ensureEngine(): WorldEngine | null {
    if (this.engine) {
      if (this.host) this.engine.attachTo(this.host);
      return this.engine;
    }
    if (!this.host) {
      dwarn('engine', 'snapshot arrived before a canvas host was mounted');
      return null;
    }
    const st = useHarvestStore.getState();
    const opts: EngineOpts = {
      userId: st.userId,
      quality: st.settings.quality,
      onAction: (a, payload) => {
        this.client?.send({ t: 'action', a, ...(payload || {}) } as ClientMsg);
      },
      onMove: (x, y, dir, anim, sprint) => {
        this.client?.send({ t: 'move', x, y, dir, anim, sprint });
      },
      onHint: (h) => useHarvestStore.getState().setInteraction(h),
      onSfx: (name) => audio.play(name),
      onZoneChange: () => {},
    };
    this.engine = this.engineFactory(this.host, opts);
    this.enginesCreated += 1;
    dlog('engine', 'world engine created', { id: this.enginesCreated });
    return this.engine;
  }
}
