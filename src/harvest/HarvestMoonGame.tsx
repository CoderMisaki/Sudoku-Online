"use client";
// Harvest Moon — top-level game orchestrator.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WorldEngine } from './world';
import { SyncClient } from './sync';
import { useHarvestStore } from './store';
import { audio } from './audio';
import { getOrCreateUserId } from '@/utils/uuid';
import { useOrientation, isLandscapeDevice, waitForViewportSettle } from './orientation';
import type { ClientMsg, ServerMsg, EventMsg, SnapshotMsg, PlayerState } from './types';
import { HudLayer, Toasts } from './Hud';
import { Menus } from './Menus';
import { CharacterCreator } from './CharacterCreator';
import { OrientationGate, LoadingScreen, ErrorScreen } from './Screens';
import { UIApi, getQuickSlots } from './api';

export type { UIApi };

/**
 * Post-resume resync: if the socket is healthy but the UI never reached the
 * game screen (snapshot was lost during rotation/backgrounding), ask the
 * server for the authoritative snapshot again via the existing `req_state`
 * protocol. Never sent before the hello handshake completes.
 */
function maybeResyncAfterResume(client: SyncClient) {
  const st = useHarvestStore.getState();
  if (st.screen !== 'game') {
    client.requestResync();
    return;
  }
  if (st.status === 'reconnecting' || st.status === 'connecting' || st.status === 'hello' || st.status === 'syncing') {
    client.requestResync();
  }
}

export function HarvestMoonGame({ roomId }: { roomId: string }) {
  const router = useRouter();
  const screen = useHarvestStore((s) => s.screen);
  const status = useHarvestStore((s) => s.status);
  const errorMsg = useHarvestStore((s) => s.errorMsg);
  const mine = useHarvestStore((s) => s.mine);
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
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

  // ── Authoritative multi-layer orientation detection ──
  const { isLandscape } = useOrientation();

  // ── session identity ──
  useEffect(() => {
    const uid = getOrCreateUserId();
    let name = (typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') : null) || '';
    if (!name) {
      name = 'FARMER_' + uid.slice(0, 4).toUpperCase();
      try { localStorage.setItem('sudoku_username', name); } catch {}
    }
    setSession(roomId.toUpperCase(), uid, name.toUpperCase());
  }, [roomId, setSession]);

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

  // ── ensure installed PWA/browser doesn't stay locked to portrait ──
  useEffect(() => {
    try {
      (window.screen?.orientation as unknown as { unlock?: () => void })?.unlock?.();
    } catch {}
  }, []);

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
        const prevStatus = useHarvestStore.getState().status;
        setStatus('syncing');
        try {
          if (!engineRef.current && canvasHostRef.current) {
            const engine = new WorldEngine(canvasHostRef.current, {
              userId: store.userId,
              quality: store.settings.quality,
              onAction: (a, payload) => {
                syncRef.current?.send({ t: 'action', a, ...(payload || {}) } as ClientMsg);
              },
              onMove: (x, y, dir, anim, sprint) => {
                syncRef.current?.send({ t: 'move', x, y, dir, anim, sprint });
              },
              onHint: (h) => setInteraction(h),
              onSfx: (name) => audio.play(name),
              onZoneChange: () => {},
            });
            engineRef.current = engine;
            setEngineVersion((v) => v + 1);
          }
          const engine = engineRef.current;
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
          // The authoritative snapshot is the ONLY thing that may enter the
          // game screen — orientation merely gates visibility, never state.
          // (A resync for a not-yet-created character must stay on creator.)
          if (snap.me.char) {
            setScreen('game');
            if (prevStatus === 'reconnecting' || prevStatus === 'error') {
              console.log('[harvest] game recovered');
            }
          }
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
          if (engine.getWorldState()) {
            const w = engine.getWorldState()!;
            if (w.weather !== msg.weather) engine.setWeather(msg.weather);
          }
        }
        applySnapMeta(msg.time, msg.day, msg.season, msg.weather);
        setPlayersShort([
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
  }, [applyEvent, applySnapMeta, applySnapshot, setError, setInteraction, setPlayersShort, setScreen, setStatus, toast]);

  // ── connect (created exactly once — rotation must never recreate it) ──
  const lastSyncStateRef = useRef<string>('');
  useEffect(() => {
    if (startedRef.current) return;
    const st = useHarvestStore.getState();
    if (!st.userId || !st.userName) return;
    startedRef.current = true;
    const client = new SyncClient(
      roomId.toUpperCase(),
      st.userId,
      st.userName,
      handleMessage,
      (s) => {
        const prev = lastSyncStateRef.current;
        lastSyncStateRef.current = s;
        if (s === 'reconnecting') {
          setStatus('reconnecting');
          // One toast per disconnect episode, not one per retry attempt.
          if (prev !== 'reconnecting') {
            toast('info', 'Koneksi terputus — mencoba menghubungkan kembali...');
          }
        } else if (s === 'open') {
          setStatus('hello');
        } else if (s === 'closed') {
          setStatus('closed');
        } else if (s === 'error') {
          setStatus('error');
          toast('warn', 'Koneksi belum pulih — ketuk Hubungkan Ulang.');
        } else {
          setStatus('connecting');
        }
      }
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
  }, [handleMessage, roomId, setStatus, toast]);

  // ── single mobile-lifecycle recovery coordinator ──
  // Rotation / backgrounding / PWA viewport changes can leave the WebSocket
  // OPEN-but-dead without ever firing onclose. Every resume signal funnels
  // through this one coordinator (coalesced, never spawning a second socket):
  // - passive signals (rotation/resize/viewport): health check only, keeps the
  //   automatic retry budget.
  // - explicit resume signals (foreground/pageshow/focus/online): force a
  //   fresh handshake when unhealthy, resync when already healthy.
  const lastRecoveryRef = useRef(0);
  const recoverFromLifecycle = useCallback((source: string, aggressive: boolean) => {
    const now = Date.now();
    if (now - lastRecoveryRef.current < 1500) return; // coalesce event bursts
    lastRecoveryRef.current = now;
    // Let the browser finish its rotation reflow first, then read the fresh
    // viewport and socket health (double-rAF, no arbitrary delay).
    waitForViewportSettle(() => {
      const s = syncRef.current;
      if (!s) return;
      const landscape = isLandscapeDevice();
      if (aggressive) {
        if (!s.isHealthy()) {
          console.log(`[harvest] lifecycle resume (${source}, landscape=${landscape}) — forcing reconnect`);
          s.forceReconnect(`lifecycle:${source}`);
        } else {
          maybeResyncAfterResume(s);
        }
        return;
      }
      s.ensureOpen();
      if (s.isHealthy()) maybeResyncAfterResume(s);
    });
  }, []);

  useEffect(() => {
    const passive = () => recoverFromLifecycle('viewport', false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') recoverFromLifecycle('visibility', true);
    };
    const onPageShow = () => recoverFromLifecycle('pageshow', true);
    const onFocus = () => recoverFromLifecycle('focus', true);
    const onOnline = () => recoverFromLifecycle('online', true);
    window.addEventListener('orientationchange', passive, { passive: true });
    window.addEventListener('resize', passive, { passive: true });
    try { window.visualViewport?.addEventListener('resize', passive); } catch {}
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('orientationchange', passive);
      window.removeEventListener('resize', passive);
      try { window.visualViewport?.removeEventListener('resize', passive); } catch {}
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
    };
  }, [recoverFromLifecycle]);

  // Rotating into landscape re-checks the connection (passive — the snapshot,
  // not the orientation, is what enters the game screen).
  const prevLandscapeRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevLandscapeRef.current;
    prevLandscapeRef.current = isLandscape;
    if (prev === null) return; // skip initial mount
    if (isLandscape && !prev) recoverFromLifecycle('orientation', false);
  }, [isLandscape, recoverFromLifecycle]);

  // ── diagnostics hook (used by automated lifecycle tests) ──
  useEffect(() => {
    try {
      (window as unknown as { __harvest?: unknown }).__harvest = {
        get sync() { return syncRef.current; },
        getState: () => useHarvestStore.getState(),
      };
    } catch {}
    return () => {
      try { delete (window as unknown as { __harvest?: unknown }).__harvest; } catch {}
    };
  }, []);

  // ── character creation bridge ──
  useEffect(() => {
    const onCreate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ char: PlayerState['char']; farmName: string }>).detail;
      if (!detail?.char) return;
      let tries = 0;
      const trySend = () => {
        const s = syncRef.current;
        if (s?.isOpen()) {
          s.send({ t: 'create', char: detail.char!, farmName: detail.farmName || 'My Farm' } as ClientMsg);
          return;
        }
        tries += 1;
        if (tries > 15) {
          window.dispatchEvent(new CustomEvent('harvest-create-ack', { detail: { ok: false, msg: 'Koneksi ke server gagal. Muat ulang halaman.' } }));
          return;
        }
        setTimeout(trySend, 300);
      };
      trySend();
    };
    window.addEventListener('harvest-create', onCreate);
    return () => window.removeEventListener('harvest-create', onCreate);
  }, []);

  // ── engine input gating by menus ──
  const menu = useHarvestStore((s) => s.menu);
  const dialogue = useHarvestStore((s) => s.dialogue);
  const chatOpen = useHarvestStore((s) => s.chatOpen);
  useEffect(() => {
    const blocked = menu !== null || dialogue !== null || chatOpen;
    if (blocked) engineRef.current?.setMoveVector(0, 0);
  }, [menu, dialogue, chatOpen]);

  // ── audio settings sync ──
  useEffect(() => {
    audio.setMusicVolume(useHarvestStore.getState().settings.music);
    audio.setSfxVolume(useHarvestStore.getState().settings.sfx);
  }, []);

  // ── server status watcher ──
  useEffect(() => {
    const unsub = useHarvestStore.subscribe((s, prev) => {
      if (s.me && !prev.me && s.status !== 'closed') setStatus('connected');
    });
    return unsub;
  }, [setStatus]);

  // ── api for children ──
  const api: UIApi = {
    getEngine: () => engineRef.current,
    action: (a, payload) => syncRef.current?.send({ t: 'action', a, ...(payload || {}) } as ClientMsg),
    interact: () => {
      const engine = engineRef.current;
      if (!engine) return;
      if (mine) engine.doMineInteract();
      else engine.doInteract();
    },
    move: (vx, vy) => engineRef.current?.setMoveVector(vx, vy),
    select: (id) => {
      setSelectedItem(id || null);
      engineRef.current?.setSelectedItem(id || null);
      syncRef.current?.send({ t: 'action', a: 'equip', item: id || 'none' } as ClientMsg);
    },
    sendChat: (text, channel = 'public', targetPlayerId) => {
      syncRef.current?.send({ t: 'chat', text, channel, targetPlayerId } as ClientMsg);
    },
    emote: (id) => syncRef.current?.send({ t: 'emote', emote: id } as ClientMsg),
    leave: () => {
      router.replace('/');
    },
  };

  // ── keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        if (e.key === 'Escape') target.blur();
        return;
      }
      const st = useHarvestStore.getState();
      const key = e.key.toLowerCase();
      if (e.key === 'Escape') {
        if (st.menu) setMenu(null);
        else if (st.dialogue) useHarvestStore.getState().setDialogue(null);
        else if (st.chatOpen) setChatOpen(false);
        return;
      }
      if (st.menu || st.dialogue) return;
      if (key === 'i' || key === 'tab') { e.preventDefault(); setMenu(st.menu === 'inventory' ? null : 'inventory'); }
      else if (key === 'm') setMenu(st.menu === 'map' ? null : 'map');
      else if (key === 'q') setMenu(st.menu === 'quests' ? null : 'quests');
      else if (key === 'j') setMenu(st.menu === 'journal' ? null : 'journal');
      else if (key === 'c') setMenu(st.menu === 'crafting' ? null : 'crafting');
      else if (key === 'e' || key === ' ' || key === 'enter') {
        if (key !== 'enter' || !st.chatOpen) {
          e.preventDefault();
          api.interact();
        }
      }
      else if (key === 'p' || key === 'l') setMenu(st.menu === 'relationships' ? null : 'relationships');
      else if (key === 'n') setMenu(st.menu === 'settings' ? null : 'settings');
      else if (['1', '2', '3', '4', '5', '6', '7', '8'].includes(key)) {
        const idx = Number(key) - 1;
        const quick = getQuickSlots(useHarvestStore.getState().me, useHarvestStore.getState().defs);
        if (quick[idx]) api.select(quick[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, setMenu]);

  // ignore: engineVersion keeps engine in api fresh
  void engineVersion; void me; void defs; void status;

  // ambience follows weather
  useEffect(() => {
    if (screen === 'game') {
      audio.setAmbience({ weather: weatherNow, night: false, inMine: !!mine });
    }
  }, [screen, mine, weatherNow]);

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#101a2e] select-none" style={{ height: '100dvh' }}>
      {!isLandscape && <OrientationGate />}
      {(screen === 'loading' || screen === 'creator') && <div ref={canvasHostRef} className="absolute inset-0" />}
      {screen === 'game' && (
        <>
          <div ref={canvasHostRef} className="absolute inset-0" />
          <HudLayer api={api} />
          <Menus api={api} />
          <Toasts />
        </>
      )}
      {screen === 'creator' && <CharacterCreator />}
      {screen === 'error' && <ErrorScreen message={errorMsg} onRetry={() => window.location.reload()} />}
      {screen !== 'error' && (
        screen === 'loading' ||
        status === 'connecting' ||
        status === 'reconnecting' ||
        status === 'error' ||
        ((status === 'hello' || status === 'syncing') && screen !== 'creator')
      ) && (
        <LoadingScreen
          status={status}
          failed={status === 'error'}
          onRetry={() => {
            syncRef.current?.forceReconnect('manual-retry');
          }}
          onReload={() => window.location.reload()}
        />
      )}
    </div>
  );
}
