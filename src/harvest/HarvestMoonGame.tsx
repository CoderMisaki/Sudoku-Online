"use client";
// Harvest Moon — top-level game orchestrator.
//
// Startup ordering is deliberate and race-free:
//   session identity → WebSocket connect → hello_ack → (creator if needed) → snapshot → world
// Orientation is completely decoupled from that pipeline: it only decides whether
// we *render/accept input*, never whether we connect. Rotating the device can
// therefore never stall startup, disconnect the socket or reset player state.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WorldEngine } from './world';
import { SyncClient } from './sync';
import { useHarvestStore } from './store';
import { audio } from './audio';
import { getOrCreateUserId } from '@/utils/uuid';
import type { ClientMsg, ServerMsg, EventMsg, SnapshotMsg, PlayerState, ChatChannel } from './types';
import { HudLayer, Toasts } from './Hud';
import { Menus } from './Menus';
import { CharacterCreator } from './CharacterCreator';
import { OrientationGate, LoadingScreen, ErrorScreen } from './Screens';
import { UIApi, getQuickSlots } from './api';
import { useOrientation } from './useOrientation';
import { inputManager, type InputAction } from './input';

export type { UIApi };

/** Unique, collision-free idempotency key for gold-moving requests. */
function newActionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function HarvestMoonGame({ roomId }: { roomId: string }) {
  const router = useRouter();
  const screen = useHarvestStore((s) => s.screen);
  const status = useHarvestStore((s) => s.status);
  const errorMsg = useHarvestStore((s) => s.errorMsg);
  const mine = useHarvestStore((s) => s.mine);
  const setScreen = useHarvestStore((s) => s.setScreen);
  const setStatus = useHarvestStore((s) => s.setStatus);
  const setError = useHarvestStore((s) => s.setError);
  const setSession = useHarvestStore((s) => s.setSession);
  const applySnapshot = useHarvestStore((s) => s.applySnapshot);
  const applyEvent = useHarvestStore((s) => s.applyEvent);
  const applySnapMeta = useHarvestStore((s) => s.applySnapMeta);
  const setInteraction = useHarvestStore((s) => s.setInteraction);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const toast = useHarvestStore((s) => s.toast);
  const setPlayersShort = useHarvestStore((s) => s.setPlayersShort);
  const setChatOpen = useHarvestStore((s) => s.setChatOpen);
  const setSelectedItem = useHarvestStore((s) => s.setSelectedItem);
  const weatherNow = useHarvestStore((s) => s.worldMeta.weather);

  const canvasHostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<WorldEngine | null>(null);
  const syncRef = useRef<SyncClient | null>(null);
  const startedRef = useRef(false);
  const [engineVersion, setEngineVersion] = useState(0);

  // ── orientation (layered detection, shared observer, no render loop) ──
  const orientation = useOrientation();
  const needsRotate = orientation.ready && !orientation.landscape;

  // ── session identity ──
  useEffect(() => {
    const uid = getOrCreateUserId();
    const name = (typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') : null) || '';
    if (!name) {
      router.replace('/');
      return;
    }
    setSession(roomId.toUpperCase(), uid, name.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId]);

  // ── audio unlock on first gesture ──
  useEffect(() => {
    const unlock = () => { audio.ensure(); };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  // ── engine construction, decoupled from screen state ──
  // The host div is ALWAYS mounted, so the engine can be created the moment the
  // first snapshot lands regardless of which screen is showing. This removes the
  // old race where a snapshot arriving during the orientation screen was dropped.
  const ensureEngine = useCallback(() => {
    if (engineRef.current) return engineRef.current;
    const host = canvasHostRef.current;
    if (!host) return null;
    const store = useHarvestStore.getState();
    const engine = new WorldEngine(host, {
      userId: store.userId,
      quality: store.settings.quality,
      onAction: (a, payload) => {
        syncRef.current?.send({ t: 'action', a, ...(payload || {}) } as ClientMsg);
      },
      onMove: (x, y, dir, anim, sprint, seq) => {
        syncRef.current?.send({ t: 'move', x, y, dir, anim, sprint, seq });
      },
      onHint: (h) => setInteraction(h),
      onSfx: (name) => audio.play(name),
      onZoneChange: () => {},
    });
    engineRef.current = engine;
    if (typeof window !== 'undefined') {
      (window as unknown as { __harvestEngine?: WorldEngine }).__harvestEngine = engine;
      (window as unknown as { __harvestInput?: typeof inputManager }).__harvestInput = inputManager;
    }
    setEngineVersion((v) => v + 1);
    return engine;
  }, [setInteraction]);

  // ── message handler ──
  const handleMessage = useCallback((raw: string) => {
    let msg: ServerMsg;
    try { msg = JSON.parse(raw) as ServerMsg; } catch { return; }
    const store = useHarvestStore.getState();
    switch (msg.t) {
      case 'hello_ack': {
        if (msg.needsCreation) {
          setScreen('creator');
        } else if (msg.player && msg.player.char) {
          setStatus('ready');
        }
        break;
      }
      case 'snapshot': {
        const snap = msg as SnapshotMsg;
        try {
          const engine = ensureEngine();
          if (engine) {
            engine.setWorld(snap.world, snap.defs);
            if (snap.me.char) engine.createMyPlayer(snap.me.char, snap.me.username);
            engine.setMyPos(snap.me.x, snap.me.y, snap.me.dir);
            engine.setClock(snap.world.time);
            engine.setWeather(snap.world.weather);
            if (snap.world.festival.active && snap.world.festival.items) {
              engine.setFestivalItems(snap.world.festival.items);
            }
            engine.syncRemotePlayers(snap.players);
            engine.setMyPlayer(snap.me);
          }
          applySnapshot(snap.me, snap.defs, snap.world, snap.prices);
          audio.applySeason(snap.world.season);
          if (snap.me.char) setScreen('game');
        } catch (err) {
          console.error('[harvest] snapshot apply failed', err);
          setError('Gagal memuat dunia. Coba muat ulang.');
        }
        break;
      }
      case 'snap': {
        const engine = engineRef.current;
        if (engine) {
          engine.syncSnapshotPositions(msg.players);
          engine.syncNpcPositions(msg.npcs);
          engine.setClock(msg.time);
          // Server reconciliation for our own avatar.
          if (typeof msg.mx === 'number' && typeof msg.my === 'number') {
            engine.reconcile(msg.mx, msg.my, msg.ack || 0);
          }
          const w = engine.getWorldState();
          if (w && w.weather !== msg.weather) engine.setWeather(msg.weather);
        }
        applySnapMeta(msg.time, msg.day, msg.season, msg.weather);
        const nameById = new Map<string, string>(msg.names || []);
        setPlayersShort([
          { id: store.userId, name: store.me?.username || store.userName, online: true },
          ...msg.players
            .filter((p) => String(p[0]) !== store.userId)
            .map((p) => ({ id: String(p[0]), name: nameById.get(String(p[0])) || '', online: p[6] === 1 })),
        ]);
        break;
      }
      case 'event': {
        const e = (msg as EventMsg).e;
        const engine = engineRef.current;
        if (engine) {
          engine.handleEvent(e);
          if (e.type === 'festival') {
            if ((e.active as boolean) && e.items) engine.setFestivalItems(e.items as { x: number; y: number; item: string }[]);
            if (!e.active) engine.clearFestivalItems();
          }
          if (e.type === 'equipped') engine.setSelectedItem((e.item as string) || null);
          if (e.type === 'inv' && store.me) {
            engine.setMyPlayer({ ...store.me, inv: (e.inv || []) as PlayerState['inv'] });
          }
        }
        applyEvent(e);
        break;
      }
      case 'err': {
        if (msg.code === 'world_full' || msg.code === 'hello_invalid') setError(msg.msg);
        else if (msg.code === 'char_invalid') {
          window.dispatchEvent(new CustomEvent('harvest-create-ack', { detail: { ok: false, msg: msg.msg } }));
        } else toast('warn', msg.msg);
        break;
      }
      default: break;
    }
  }, [applyEvent, applySnapMeta, applySnapshot, ensureEngine, setError, setPlayersShort, setScreen, setStatus, toast]);

  // Keep the latest handler in a ref so the socket effect never re-runs (and thus
  // never tears down / duplicates the connection when a callback identity changes).
  const handleMessageRef = useRef(handleMessage);
  useEffect(() => { handleMessageRef.current = handleMessage; }, [handleMessage]);

  // ── connect ──
  // Runs once identity is known. Guarded by a ref so React strict-mode double
  // invocation (and any re-render) can never open a second socket.
  const roomCode = roomId.toUpperCase();
  const userId = useHarvestStore((s) => s.userId);
  const userName = useHarvestStore((s) => s.userName);
  useEffect(() => {
    if (!userId || !userName) return;
    if (startedRef.current) return;
    startedRef.current = true;

    const client = new SyncClient(
      roomCode,
      userId,
      userName,
      (raw) => handleMessageRef.current(raw),
      (s) => {
        if (s === 'reconnecting') {
          setStatus('reconnecting');
          toast('info', 'Koneksi terputus — mencoba menghubungkan kembali...');
        } else if (s === 'open') {
          setStatus('hello');
        } else if (s === 'closed') {
          setStatus('closed');
        } else {
          setStatus(s);
        }
      },
    );
    client.connect();
    syncRef.current = client;

    return () => {
      startedRef.current = false;
      client.close();
      syncRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [roomCode, userId, userName, setStatus, toast]);

  // ── character creation bridge ──
  useEffect(() => {
    const onCreate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ char: PlayerState['char']; farmName: string }>).detail;
      if (!detail?.char) return;
      let tries = 0;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const trySend = () => {
        const s = syncRef.current;
        if (s?.isOpen()) {
          s.send({ t: 'create', char: detail.char!, farmName: detail.farmName || 'My Farm' } as ClientMsg);
          return;
        }
        tries += 1;
        if (tries > 10) {
          window.dispatchEvent(new CustomEvent('harvest-create-ack', { detail: { ok: false, msg: 'Koneksi ke server gagal. Muat ulang halaman.' } }));
          return;
        }
        timer = setTimeout(trySend, 400);
      };
      trySend();
      cleanupRef.current = () => { if (timer) clearTimeout(timer); };
    };
    const cleanupRef = { current: null as null | (() => void) };
    window.addEventListener('harvest-create', onCreate);
    return () => {
      window.removeEventListener('harvest-create', onCreate);
      cleanupRef.current?.();
    };
  }, []);

  // ── api for children (stable identity; reads refs, never stale state) ──
  const api: UIApi = useMemo(() => ({
    getEngine: () => engineRef.current,
    action: (a, payload) => syncRef.current?.send({ t: 'action', a, ...(payload || {}) } as ClientMsg),
    transact: (a, payload) =>
      syncRef.current?.send({ t: 'action', a, actionId: newActionId(), ...(payload || {}) } as ClientMsg),
    interact: () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (useHarvestStore.getState().mine) engine.doMineInteract();
      else engine.doInteract();
    },
    move: (vx, vy) => inputManager.setJoystick(vx, vy),
    select: (id) => {
      setSelectedItem(id || null);
      engineRef.current?.setSelectedItem(id || null);
      syncRef.current?.send({ t: 'action', a: 'equip', item: id || 'none' } as ClientMsg);
    },
    sendChat: (text, channel?: ChatChannel, to?: string) =>
      syncRef.current?.send({ t: 'chat', text, channel: channel || 'public', ...(to ? { to } : {}) } as ClientMsg),
    emote: (id) => syncRef.current?.send({ t: 'emote', emote: id } as ClientMsg),
    leave: () => { router.replace('/'); },
  }), [router, setSelectedItem]);

  // ── input manager lifecycle + global shortcuts ──
  useEffect(() => {
    inputManager.attach();
    const offAction = inputManager.onAction((action: InputAction) => {
      const st = useHarvestStore.getState();
      if (action === 'close') {
        if (st.menu) setMenu(null);
        else if (st.dialogue) st.setDialogue(null);
        else if (st.chatOpen) setChatOpen(false);
        return;
      }
      // While a modal or the chat box owns the screen, shortcuts are inert.
      if (st.menu || st.dialogue || st.chatOpen) {
        if (action === 'chat' && !st.menu && !st.dialogue) setChatOpen(!st.chatOpen);
        return;
      }
      switch (action) {
        case 'interact': api.interact(); break;
        case 'inventory': setMenu(st.menu === 'inventory' ? null : 'inventory'); break;
        case 'map': setMenu(st.menu === 'map' ? null : 'map'); break;
        case 'chat': setChatOpen(true); break;
        case 'quests': setMenu(st.menu === 'quests' ? null : 'quests'); break;
        case 'journal': setMenu(st.menu === 'journal' ? null : 'journal'); break;
        case 'crafting': setMenu(st.menu === 'crafting' ? null : 'crafting'); break;
        case 'relationships': setMenu(st.menu === 'relationships' ? null : 'relationships'); break;
        case 'settings': setMenu(st.menu === 'settings' ? null : 'settings'); break;
      }
    });
    const offSlot = inputManager.onQuickSlot((idx) => {
      const st = useHarvestStore.getState();
      if (st.menu || st.dialogue || st.chatOpen) return;
      const quick = getQuickSlots(st.me, st.defs);
      if (quick[idx]) api.select(quick[idx]);
    });
    return () => { offAction(); offSlot(); inputManager.detach(); };
  }, [api, setChatOpen, setMenu]);

  // ── suppress movement while a modal owns the screen (keys stay tracked) ──
  const menu = useHarvestStore((s) => s.menu);
  const dialogue = useHarvestStore((s) => s.dialogue);
  const chatOpen = useHarvestStore((s) => s.chatOpen);
  useEffect(() => {
    inputManager.setSuppressed(menu !== null || dialogue !== null || chatOpen);
  }, [menu, dialogue, chatOpen]);

  // ── pause rendering/input in portrait or when the tab is hidden ──
  // The socket, world state and player are all left completely untouched.
  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.setPaused(needsRotate);
    if (needsRotate) inputManager.releaseAll();
  }, [needsRotate, engineVersion]);

  // Keep the pause condition in a ref so the visibility handler is never stale.
  const needsRotateRef = useRef(needsRotate);
  useEffect(() => { needsRotateRef.current = needsRotate; }, [needsRotate]);

  useEffect(() => {
    const onVisibility = () => {
      const engine = engineRef.current;
      if (document.hidden) {
        // Tab hidden: drop held input so nothing is stuck, stop rendering.
        inputManager.releaseAll();
        engine?.setPaused(true);
      } else {
        engine?.setPaused(needsRotateRef.current);
        // Back in view: verify the socket and resync authoritative state.
        const s = syncRef.current;
        if (!s) return;
        if (!s.isOpen()) s.reconnectNow();
        else s.send({ t: 'req_state' } as ClientMsg);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onVisibility);
    };
  }, []);

  // Resize the renderer whenever the viewport geometry changes (incl. rotation).
  useEffect(() => {
    engineRef.current?.onResize();
  }, [orientation.width, orientation.height, engineVersion]);

  // ── audio settings sync ──
  useEffect(() => {
    audio.setMusicVolume(useHarvestStore.getState().settings.music);
    audio.setSfxVolume(useHarvestStore.getState().settings.sfx);
  }, []);

  // ── connected status watcher ──
  useEffect(() => {
    const unsub = useHarvestStore.subscribe((s, prev) => {
      if (s.me && !prev.me && s.status !== 'closed') setStatus('connected');
    });
    return unsub;
  }, [setStatus]);

  // ambience follows weather
  useEffect(() => {
    if (screen === 'game') {
      audio.setAmbience({ weather: weatherNow, night: false, inMine: !!mine });
    }
  }, [screen, mine, weatherNow]);

  const showLoading =
    screen !== 'error' &&
    screen !== 'creator' &&
    (screen === 'loading' || status === 'connecting' || status === 'reconnecting');

  return (
    <div
      className="fixed inset-0 overflow-hidden bg-[#101a2e] select-none touch-none"
      style={{
        height: '100dvh',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/* Canvas host is always mounted so the engine can attach as soon as the
          first snapshot arrives — independent of the current screen. */}
      <div ref={canvasHostRef} className="absolute inset-0" />

      {screen === 'game' && (
        <>
          <HudLayer api={api} device={orientation.device} />
          <Menus api={api} device={orientation.device} />
          <Toasts />
        </>
      )}
      {screen === 'creator' && <CharacterCreator />}
      {screen === 'error' && <ErrorScreen message={errorMsg} onRetry={() => window.location.reload()} />}
      {showLoading && <LoadingScreen status={status} />}

      {/* Highest layer: rotation overlay. It never unmounts the game beneath it. */}
      {needsRotate && <OrientationGate />}
    </div>
  );
}
