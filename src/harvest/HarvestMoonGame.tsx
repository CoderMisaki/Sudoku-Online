"use client";
// Harvest Moon — top-level game orchestrator (thin view layer).
//
// All realtime/session logic lives in `HarvestSession` (src/harvest/session.ts)
// so that exactly ONE socket, ONE engine and ONE state machine exist per room
// session. This component only:
//   • resolves the session identity (stable across rotation/reconnect)
//   • mounts a PERSISTENT canvas host (never remounted on screen changes)
//   • runs best-effort landscape locking on phones/tablets (never on desktop)
//   • funnels every lifecycle signal into the session's recovery coordinator
//   • renders overlays derived from the single (screen, status) state machine
import React, { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { HarvestSession, RecoverySource, EngineFactory } from './session';
import { WorldEngine } from './world';
import { useHarvestStore } from './store';
import { audio } from './audio';
import { getOrCreateUserId } from '@/utils/uuid';
import { useOrientation, useLandscapeLock, deviceClass, displayMode, isLandscapeDevice } from './orientation';
import { connectionOverlay } from './overlay';
import { dlog } from './debug';
import type { ClientMsg, PlayerState } from './types';
import { HudLayer, Toasts } from './Hud';
import { Menus } from './Menus';
import { CharacterCreator } from './CharacterCreator';
import { OrientationGate, LoadingScreen, ErrorScreen } from './Screens';
import { UIApi, getQuickSlots } from './api';

export type { UIApi };

/** The real three.js engine factory (kept out of session.ts so the session
 *  controller stays testable without WebGL). */
const createWorldEngine: EngineFactory = (host, opts) => new WorldEngine(host, opts);

export function HarvestMoonGame({ roomId }: { roomId: string }) {
  const router = useRouter();
  const screen = useHarvestStore((s) => s.screen);
  const status = useHarvestStore((s) => s.status);
  const errorMsg = useHarvestStore((s) => s.errorMsg);
  const mine = useHarvestStore((s) => s.mine);
  const menu = useHarvestStore((s) => s.menu);
  const dialogue = useHarvestStore((s) => s.dialogue);
  const chatOpen = useHarvestStore((s) => s.chatOpen);
  const weatherNow = useHarvestStore((s) => s.worldMeta.weather);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const setChatOpen = useHarvestStore((s) => s.setChatOpen);
  const setSelectedItem = useHarvestStore((s) => s.setSelectedItem);
  const setSession = useHarvestStore((s) => s.setSession);

  // PERSISTENT canvas host: mounted once for the whole page life so the WebGL
  // canvas is never orphaned by a screen transition or a rotation.
  const hostRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<HarvestSession | null>(null);

  // ── orientation: detection (dimensions-first) + best-effort landscape lock ──
  const orientation = useOrientation();
  const wantsLock = orientation.device !== 'desktop';
  const { lockState } = useLandscapeLock(wantsLock);

  // Orientation/lock state mirrored into the diagnostics object (E2E tests read
  // it). Kept in a ref so the `__harvest` getter never goes stale.
  const orientationInfoRef = useRef<Record<string, unknown>>({});
  useEffect(() => {
    orientationInfoRef.current = {
      isLandscape: orientation.isLandscape,
      showGate: orientation.showGate,
      device: orientation.device,
      displayMode: orientation.displayMode,
      standalone: orientation.standalone,
      lockState,
    };
  }, [orientation.isLandscape, orientation.showGate, orientation.device, orientation.displayMode, orientation.standalone, lockState]);

  // ── session bootstrap: identity → session → socket (exactly once per room) ──
  useEffect(() => {
    const uid = getOrCreateUserId();
    let name = '';
    try {
      name = localStorage.getItem('sudoku_username') || '';
    } catch {}
    if (!name) {
      name = 'FARMER_' + uid.slice(0, 4).toUpperCase();
      try { localStorage.setItem('sudoku_username', name); } catch {}
    }
    // Identity is stable for the whole page life: rotation, backgrounding and
    // reconnects must never mint a new userId/room/username.
    setSession(roomId.toUpperCase(), uid, name.toUpperCase());

    const session = new HarvestSession({ roomId, engineFactory: createWorldEngine });
    sessionRef.current = session;
    session.attachHost(hostRef.current);
    session.start();

    dlog('pwa', 'game shell mounted', {
      room: roomId,
      device: deviceClass(),
      mode: displayMode(),
      landscape: isLandscapeDevice(),
    });

    // Diagnostics hook used by the automated lifecycle/E2E tests.
    const w = window as unknown as { __harvest?: unknown };
    w.__harvest = {
      get sync() { return session.sync; },
      get session() { return session; },
      get engine() { return session.worldEngine; },
      get orientation() { return orientationInfoRef.current; },
      getState: () => useHarvestStore.getState(),
      getDiagnostics: () => session.diagnostics,
      recover: (source: RecoverySource, aggressive?: boolean) => session.recover(source, !!aggressive),
      manualRetry: () => session.manualRetry(),
    };

    return () => {
      try { delete w.__harvest; } catch {}
      session.dispose();
      sessionRef.current = null;
    };
    // `roomId` is the only thing that may rebuild a session. Orientation state
    // is deliberately NOT a dependency: rotation must not touch the socket.
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

  // ── ONE lifecycle recovery coordinator (all signals funnel here) ──
  // Passive signals (rotation/resize/viewport) only health-check + resync;
  // explicit resume signals (foreground/pageshow/focus/online) may force a
  // fresh handshake when the socket is unusable or the retry budget ran out.
  useEffect(() => {
    const passive = () => sessionRef.current?.recover('viewport', false);
    const onOrientationChange = () => sessionRef.current?.recover('orientation', true);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') sessionRef.current?.recover('visibility', true);
    };
    const onPageShow = () => sessionRef.current?.recover('pageshow', true);
    const onFocus = () => sessionRef.current?.recover('focus', true);
    const onOnline = () => sessionRef.current?.recover('online', true);
    const onOffline = () => dlog('recovery', 'browser went offline');

    window.addEventListener('orientationchange', onOrientationChange, { passive: true });
    window.addEventListener('resize', passive, { passive: true });
    try { window.visualViewport?.addEventListener('resize', passive); } catch {}
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('orientationchange', onOrientationChange);
      window.removeEventListener('resize', passive);
      try { window.visualViewport?.removeEventListener('resize', passive); } catch {}
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  // Rotating into landscape re-checks the connection — but only ever through the
  // coordinator: it never recreates the SyncClient, never resets the store and
  // never leaves the game screen. The snapshot (not the orientation) is what
  // decides whether the game is visible.
  const prevLandscapeRef = useRef<boolean | null>(null);
  useEffect(() => {
    const prev = prevLandscapeRef.current;
    prevLandscapeRef.current = orientation.isLandscape;
    if (prev === null) return; // skip initial mount
    if (orientation.isLandscape && !prev) {
      dlog('orientation', 'rotated to landscape — verifying session');
      sessionRef.current?.recover('orientation', true);
    } else if (!orientation.isLandscape && prev) {
      dlog('orientation', 'rotated to portrait — session preserved');
    }
  }, [orientation.isLandscape]);

  // ── character creation bridge ──
  useEffect(() => {
    const onCreate = (ev: Event) => {
      const detail = (ev as CustomEvent<{ char: PlayerState['char']; farmName: string }>).detail;
      if (!detail?.char) return;
      sessionRef.current?.createCharacter(detail.char, detail.farmName);
    };
    window.addEventListener('harvest-create', onCreate);
    return () => window.removeEventListener('harvest-create', onCreate);
  }, []);

  // ── engine input gating by menus ──
  useEffect(() => {
    const blocked = menu !== null || dialogue !== null || chatOpen;
    if (blocked) sessionRef.current?.worldEngine?.setMoveVector(0, 0);
  }, [menu, dialogue, chatOpen]);

  // ── audio settings sync ──
  useEffect(() => {
    audio.setMusicVolume(useHarvestStore.getState().settings.music);
    audio.setSfxVolume(useHarvestStore.getState().settings.sfx);
  }, []);

  // ── api for children ──
  const api: UIApi = useMemo(() => ({
    getEngine: () => sessionRef.current?.worldEngine ?? null,
    action: (a, payload) => sessionRef.current?.send({ t: 'action', a, ...(payload || {}) } as ClientMsg),
    interact: () => {
      const engine = sessionRef.current?.worldEngine;
      if (!engine) return;
      if (useHarvestStore.getState().mine) engine.doMineInteract();
      else engine.doInteract();
    },
    move: (vx, vy) => sessionRef.current?.worldEngine?.setMoveVector(vx, vy),
    select: (id) => {
      setSelectedItem(id || null);
      sessionRef.current?.worldEngine?.setSelectedItem(id || null);
      sessionRef.current?.send({ t: 'action', a: 'equip', item: id || 'none' } as ClientMsg);
    },
    sendChat: (text, channel = 'public', targetPlayerId) => {
      sessionRef.current?.send({ t: 'chat', text, channel, targetPlayerId } as ClientMsg);
    },
    emote: (id) => sessionRef.current?.send({ t: 'emote', emote: id } as ClientMsg),
    leave: () => { router.replace('/'); },
  }), [router, setSelectedItem]);

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
        else if (st.dialogue) st.setDialogue(null);
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
        const quick = getQuickSlots(st.me, st.defs);
        if (quick[idx]) api.select(quick[idx]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api, setChatOpen, setMenu]);

  // ambience follows weather
  useEffect(() => {
    if (screen === 'game') {
      audio.setAmbience({ weather: weatherNow, night: false, inMine: !!mine });
    }
  }, [screen, mine, weatherNow]);

  // ── overlay: derived from the ONE (screen, status) state machine ──
  const overlay = connectionOverlay(screen, status);
  const showGate = orientation.showGate;
  const gateLocking = lockState === 'locking';

  return (
    <div className="fixed inset-0 overflow-hidden bg-[#101a2e] select-none" style={{ height: '100dvh' }}>
      {/* persistent canvas host — never remounted (rotation/screen changes only
          re-attach the existing canvas, the engine and world are preserved) */}
      <div ref={hostRef} data-testid="canvas-host" className="absolute inset-0" />

      {screen === 'game' && (
        <>
          <HudLayer api={api} />
          <Menus api={api} />
          <Toasts />
        </>
      )}
      {screen === 'creator' && <CharacterCreator />}
      {screen === 'error' && <ErrorScreen message={errorMsg} onRetry={() => window.location.reload()} />}

      {overlay && (
        <LoadingScreen
          overlay={overlay}
          onRetry={() => sessionRef.current?.manualRetry()}
          onReload={() => window.location.reload()}
        />
      )}

      {/* Mobile-only fallback gate: shown when the viewport is portrait AND the
          platform refused/does not support the automatic landscape lock. */}
      {showGate && <OrientationGate locking={gateLocking} />}
    </div>
  );
}
