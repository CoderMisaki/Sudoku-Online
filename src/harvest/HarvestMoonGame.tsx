"use client";
// Harvest Moon — top-level game orchestrator.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WorldEngine } from './world';
import { SyncClient } from './sync';
import { useHarvestStore } from './store';
import { audio } from './audio';
import { getOrCreateUserId } from '@/utils/uuid';
import type { ClientMsg, ServerMsg, EventMsg, SnapshotMsg, PlayerState } from './types';
import { HudLayer, Toasts } from './Hud';
import { Menus } from './Menus';
import { CharacterCreator } from './CharacterCreator';
import { OrientationGate, LoadingScreen, ErrorScreen } from './Screens';
import { UIApi, getQuickSlots } from './api';

export type { UIApi };

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

  // ── landscape-only gate (auto-dismisses when rotated) ──
  const [portrait, setPortrait] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const update = () => setPortrait(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

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
          setScreen('game');
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
          ...msg.players.filter((p) => String(p[0]) !== store.userId).map((p) => ({ id: String(p[0]), name: '', online: p[6] === 1 })),
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

  // ── connect ──
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
      }
    );
    client.connect();
    syncRef.current = client;
    return () => {
      client.close();
      syncRef.current = null;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [handleMessage, roomId, setStatus, toast]);

  // ── character creation bridge (retries until the socket is open, then fails loudly) ──
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
        if (tries > 10) {
          window.dispatchEvent(new CustomEvent('harvest-create-ack', { detail: { ok: false, msg: 'Koneksi ke server gagal. Muat ulang halaman.' } }));
          return;
        }
        setTimeout(trySend, 400);
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

  // ── server status watcher (greet → in_game, welcome when snapshot arrives) ──
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
    sendChat: (text) => syncRef.current?.send({ t: 'chat', text } as ClientMsg),
    emote: (id) => syncRef.current?.send({ t: 'emote', emote: id } as ClientMsg),
    leave: () => {
      router.replace('/');
    },
  };

  // ── keyboard shortcuts ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
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
      else if (key === 'e' || key === ' ' || key === 'enter') { e.preventDefault(); api.interact(); }
      else if (key === 'p' || key === 'l') setMenu(st.menu === 'relationships' ? null : 'relationships');
      else if (key === 'n') setMenu(st.menu === 'settings' ? null : 'settings');
      else if (key === '1' || key === '2' || key === '3' || key === '4' || key === '5' || key === '6' || key === '7' || key === '8') {
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
      {(portrait || screen === 'orientation') && <OrientationGate />}
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
      {(screen === 'loading' || status === 'connecting' || status === 'reconnecting') && screen !== 'orientation' && screen !== 'error' && <LoadingScreen status={status} />}
    </div>
  );
}


