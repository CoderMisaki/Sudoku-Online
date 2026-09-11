"use client";
// Authoritative multi-layered orientation detection, PWA/display-mode
// detection and *progressive-enhancement* landscape locking.
//
// Design rules (see docs/harvest-orientation-reconnect.md):
//
//  1. Detection is "dimensions first". On installed PWAs some browsers report a
//     stale `screen.orientation.type` while the layout already rotated (or when
//     the manifest locks orientation). The live viewport is the truth.
//  2. Desktop / non-touch devices are NEVER gated and NEVER locked.
//  3. `screen.orientation.lock('landscape')` is a best-effort enhancement on
//     phones/tablets. It must never be a hard dependency: when the browser
//     refuses (iOS Safari, Firefox, non-fullscreen tabs) we fall back to the
//     OrientationGate instead of crashing, reloading or touching the socket.
//  4. We NEVER call `screen.orientation.unlock()` — the game wants landscape,
//     unlocking it is what left installed PWAs stuck in portrait.
import { useCallback, useEffect, useRef, useState } from 'react';
import { dlog } from './debug';

export type DeviceClass = 'desktop' | 'tablet' | 'phone';
export type DisplayMode = 'standalone' | 'fullscreen' | 'minimal-ui' | 'browser' | 'unknown';
export type LandscapeLockState =
  | 'idle'        // not attempted (desktop / not needed)
  | 'locking'     // request in flight
  | 'locked'      // browser accepted the lock
  | 'unsupported' // no Screen Orientation lock API (iOS Safari, Firefox, desktop)
  | 'denied';     // API exists but the browser refused this context

export interface LandscapeLockResult {
  state: LandscapeLockState;
  /** DOMException name (NotSupportedError / SecurityError / …) when refused. */
  reason?: string;
  /** The lock mode that was accepted, when `state === 'locked'`. */
  mode?: string;
}

type ScreenOrientationLike = {
  type?: string;
  angle?: number;
  lock?: (orientation: string) => Promise<void>;
  unlock?: () => void;
  addEventListener?: (type: string, cb: () => void) => void;
  removeEventListener?: (type: string, cb: () => void) => void;
};

function orientationApi(): ScreenOrientationLike | null {
  try {
    return (window.screen?.orientation as ScreenOrientationLike | undefined) ?? null;
  } catch {
    return null;
  }
}

export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const nav = window.navigator as Navigator & { maxTouchPoints?: number };
    return (nav.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
  } catch {
    return false;
  }
}

function readViewport(): { w: number; h: number } {
  const w = Math.max(
    window.innerWidth || 0,
    window.visualViewport?.width || 0,
    document.documentElement?.clientWidth || 0
  );
  const h = Math.max(
    window.innerHeight || 0,
    window.visualViewport?.height || 0,
    document.documentElement?.clientHeight || 0
  );
  return { w, h };
}

/**
 * Run `cb` after the browser finished its rotation reflow (two animation
 * frames), so viewport reads + connection recovery observe the final layout —
 * without any arbitrary millisecond delay.
 *
 * rAF is paused on hidden pages, so a short timer guarantees recovery can never
 * be stalled by a backgrounded tab. The callback runs exactly once.
 */
export function waitForViewportSettle(cb: () => void): void {
  if (typeof window === 'undefined') return;
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    cb();
  };
  try {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  } catch {
    run();
    return;
  }
  try {
    setTimeout(run, 250);
  } catch {
    /* no timers available — rAF will still fire */
  }
}

export function screenOrientationType(): string | null {
  const type = orientationApi()?.type;
  return typeof type === 'string' ? type : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// PWA / display-mode detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Robust installed-PWA / fullscreen detection:
 *  - `matchMedia('(display-mode: …)')` (Chromium, Firefox, Safari 13+)
 *  - `navigator.standalone` (legacy iOS home-screen web apps)
 */
export function displayMode(): DisplayMode {
  if (typeof window === 'undefined') return 'unknown';
  const modes: DisplayMode[] = ['standalone', 'fullscreen', 'minimal-ui'];
  try {
    if (typeof window.matchMedia === 'function') {
      for (const mode of modes) {
        if (window.matchMedia(`(display-mode: ${mode})`).matches) return mode;
      }
    }
  } catch {
    /* matchMedia unavailable */
  }
  try {
    const nav = window.navigator as Navigator & { standalone?: boolean };
    if (nav.standalone === true) return 'standalone';
  } catch {
    /* ignore */
  }
  return 'browser';
}

/** True when running as an installed PWA / standalone web app / fullscreen. */
export function isStandalonePWA(): boolean {
  const mode = displayMode();
  return mode === 'standalone' || mode === 'fullscreen';
}

/**
 * Coarse device class. Used to decide whether orientation may be locked at all:
 * desktops are never locked nor gated, tablets get a soft preference.
 */
export function deviceClass(): DeviceClass {
  if (typeof window === 'undefined') return 'desktop';
  if (!isTouchDevice()) return 'desktop';
  const { w, h } = readViewport();
  let shortSide = Math.min(w || 0, h || 0);
  try {
    const sw = window.screen?.width || 0;
    const sh = window.screen?.height || 0;
    if (sw > 0 && sh > 0) shortSide = Math.max(shortSide, Math.min(sw, sh));
  } catch {
    /* ignore */
  }
  if (shortSide <= 0) return 'phone';
  return shortSide >= 600 ? 'tablet' : 'phone';
}

// ─────────────────────────────────────────────────────────────────────────────
// Landscape detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Authoritative check for "is the usable viewport landscape?".
 * Evaluates multiple layers:
 * 1. Desktop / non-touch wide viewport → always landscape (never gated)
 * 2. Live viewport dimensions (innerWidth / visualViewport / documentElement)
 * 3. window.matchMedia('(orientation: landscape)')
 * 4. window.screen.orientation.type as the final tie-breaker
 */
export function isLandscapeDevice(): boolean {
  if (typeof window === 'undefined') return true;

  const { w, h } = readViewport();

  // Desktop / non-touch monitors are never locked behind the rotate gate.
  if (!isTouchDevice() && w >= 1024) return true;

  // Dimensions are the ground truth for mobile browsers & installed PWAs.
  if (w > 0 && h > 0) {
    if (w > h) return true;
    if (h > w) return false;
  }

  // Only use orientation APIs when the viewport is ambiguous (w === h).
  try {
    const mql = window.matchMedia?.('(orientation: landscape)');
    if (mql && typeof mql.matches === 'boolean') return mql.matches;
  } catch {}

  const type = screenOrientationType();
  if (type) return type.startsWith('landscape');

  // Ultra-safe fallback: treat square/unknown viewport as landscape-capable.
  return true;
}

/**
 * Whether the OrientationGate should be shown at all.
 * Desktop is exempt — the gate is a *mobile* affordance only.
 */
export function shouldGateOrientation(): boolean {
  if (typeof window === 'undefined') return false;
  if (deviceClass() === 'desktop') return false;
  return !isLandscapeDevice();
}

// ─────────────────────────────────────────────────────────────────────────────
// Progressive-enhancement landscape lock
// ─────────────────────────────────────────────────────────────────────────────

export function isOrientationLockSupported(): boolean {
  return typeof orientationApi()?.lock === 'function';
}

/**
 * Best-effort `screen.orientation.lock('landscape')`.
 *
 * NEVER throws and NEVER unlocks: a rejected lock is a normal, expected
 * outcome (iOS Safari, Firefox, plain browser tabs without fullscreen) and the
 * caller must simply fall back to the OrientationGate. Nothing in the game
 * session may depend on this promise resolving.
 */
export async function requestLandscapeLock(): Promise<LandscapeLockResult> {
  if (typeof window === 'undefined') return { state: 'unsupported', reason: 'ssr' };

  const device = deviceClass();
  if (device === 'desktop') {
    // Requirement: desktop must never be forced to rotate.
    return { state: 'idle', reason: 'desktop' };
  }

  const api = orientationApi();
  if (!api || typeof api.lock !== 'function') {
    dlog('orientation', 'lock unsupported — fallback gate', { device, mode: displayMode() });
    return { state: 'unsupported', reason: 'no-api' };
  }

  if (isLandscapeDevice()) {
    // Already landscape: still lock so an accidental rotation mid-game does not
    // flip the world, but treat failure as irrelevant.
    dlog('orientation', 'already landscape — locking to hold it', { device });
  } else {
    dlog('orientation', 'detected portrait — requesting landscape lock', { device, mode: displayMode() });
  }

  let lastReason = 'unknown';
  for (const mode of ['landscape', 'landscape-primary']) {
    try {
      await api.lock(mode);
      dlog('orientation', 'landscape lock success', { mode });
      return { state: 'locked', mode };
    } catch (err) {
      const name = (err as DOMException)?.name || 'Error';
      lastReason = name;
      // NotSupportedError → this browser only knows the concrete primary/
      // secondary values, so try the next candidate. Anything else
      // (SecurityError / InvalidStateError / NotAllowedError) means the context
      // is not allowed to lock at all — stop immediately.
      if (name !== 'NotSupportedError') break;
    }
  }

  const state: LandscapeLockState = lastReason === 'NotSupportedError' ? 'unsupported' : 'denied';
  dlog('orientation', 'landscape lock refused — fallback gate', { reason: lastReason, state });
  return { state, reason: lastReason };
}

/**
 * React hook: keeps a *best-effort* landscape lock alive while `active`.
 *
 * It only ever touches the Screen Orientation API — never the WebSocket, never
 * the store, never the page location. Browsers differ wildly:
 *  - Android Chrome (installed PWA / fullscreen): accepts the lock → the OS
 *    rotates the device by itself, no user action required.
 *  - Android Chrome (plain tab): refuses without fullscreen → OrientationGate.
 *  - iOS Safari / PWA: no lock API at all → OrientationGate.
 * A retry happens on the first user gesture and when the app returns to the
 * foreground, because several browsers require transient activation.
 */
export function useLandscapeLock(active: boolean) {
  const [lockState, setLockState] = useState<LandscapeLockState>('idle');
  const [lockReason, setLockReason] = useState<string | undefined>(undefined);
  const attemptsRef = useRef(0);
  const inFlightRef = useRef(false);

  const attempt = useCallback(async (source: string) => {
    if (typeof window === 'undefined') return;
    if (deviceClass() === 'desktop') {
      setLockState('idle');
      return;
    }
    if (inFlightRef.current) return;
    // Automatic attempts are bounded; explicit user gestures always retry.
    const isGesture = source === 'gesture';
    if (!isGesture && attemptsRef.current >= 4) return;
    attemptsRef.current += 1;
    inFlightRef.current = true;
    setLockState('locking');
    dlog('pwa', 'orientation lock attempt', { source, n: attemptsRef.current });
    try {
      const res = await requestLandscapeLock();
      setLockState(res.state);
      setLockReason(res.reason);
      if (res.state === 'locked' || res.state === 'idle') return;
      dlog('pwa', 'orientation lock unavailable — showing fallback gate', { reason: res.reason });
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active) return;
    // Deferred one frame: lets the browser settle the display mode (installed
    // PWA vs tab) before we ask for the lock, and keeps the effect body free of
    // synchronous state updates.
    const rafId = requestAnimationFrame(() => { void attempt('mount'); });

    // Browsers that need transient activation: retry once on the first gesture.
    const onGesture = () => { void attempt('gesture'); };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void attempt('foreground');
    };
    window.addEventListener('pointerdown', onGesture, { passive: true });
    window.addEventListener('keydown', onGesture);
    document.addEventListener('visibilitychange', onVisible);

    // Some platforms apply the manifest lock only after the display mode settles.
    const onDisplayMode = () => { void attempt('display-mode'); };
    let mql: MediaQueryList | null = null;
    try {
      mql = window.matchMedia?.('(display-mode: standalone)') ?? null;
      mql?.addEventListener?.('change', onDisplayMode);
    } catch {
      mql = null;
    }

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
      document.removeEventListener('visibilitychange', onVisible);
      try {
        mql?.removeEventListener?.('change', onDisplayMode);
      } catch {
        /* ignore */
      }
    };
  }, [active, attempt]);

  return { lockState, lockReason, attempt };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reactive orientation hook
// ─────────────────────────────────────────────────────────────────────────────

export interface OrientationInfo {
  isLandscape: boolean;
  orientationReady: boolean;
  isTouch: boolean;
  device: DeviceClass;
  displayMode: DisplayMode;
  standalone: boolean;
  /** True only when the mobile rotate gate should really be shown. */
  showGate: boolean;
}

/**
 * React hook that stays reactive to:
 * - resize events
 * - orientationchange events
 * - screen.orientation change
 * - visualViewport resize/scroll (mobile address bar / split-screen)
 * - matchMedia change
 * - visibilitychange, pageshow, and focus lifecycle events
 */
export function useOrientation(): OrientationInfo {
  const [info, setInfo] = useState<OrientationInfo>({
    // SSR-safe default: landscape + no gate (never blocks the first paint).
    isLandscape: true,
    orientationReady: false,
    isTouch: false,
    device: 'desktop',
    displayMode: 'unknown',
    standalone: false,
    showGate: false,
  });
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);

  const check = useCallback(() => {
    const landscape = isLandscapeDevice();
    const device = deviceClass();
    const mode = displayMode();
    setInfo((prev) => {
      const next: OrientationInfo = {
        isLandscape: landscape,
        orientationReady: true,
        isTouch: device !== 'desktop',
        device,
        displayMode: mode,
        standalone: mode === 'standalone' || mode === 'fullscreen',
        showGate: device !== 'desktop' && !landscape,
      };
      if (
        prev.orientationReady &&
        prev.isLandscape === next.isLandscape &&
        prev.device === next.device &&
        prev.displayMode === next.displayMode
      ) {
        return prev; // no state churn on unrelated resize events
      }
      if (prev.isLandscape !== next.isLandscape) {
        dlog('orientation', next.isLandscape ? 'detected landscape' : 'detected portrait', {
          device: next.device,
          mode: next.displayMode,
        });
      }
      return next;
    });
  }, []);

  const debouncedCheck = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(check);
    }, 40);
  }, [check]);

  useEffect(() => {
    // Start with the SSR-safe "landscape" default, then recompute on the client
    // in a requestAnimationFrame (avoids hydration mismatch on phones).
    const initialRaf = requestAnimationFrame(() => {
      check();
    });

    // 1. matchMedia listener
    let mql: MediaQueryList | null = null;
    try {
      if (typeof window.matchMedia === 'function') {
        mql = window.matchMedia('(orientation: landscape)');
        if (typeof mql.addEventListener === 'function') {
          mql.addEventListener('change', debouncedCheck);
        } else if (typeof mql.addListener === 'function') {
          // Legacy Safari support
          (mql as unknown as { addListener: (cb: () => void) => void }).addListener(debouncedCheck);
        }
      }
    } catch {}

    // 2. screen.orientation listener
    try {
      orientationApi()?.addEventListener?.('change', debouncedCheck);
    } catch {}

    // 3. visualViewport — catches reliable mobile reflow even when
    //    orientationchange/matchMedia are delayed by the browser.
    let vv: VisualViewport | null = null;
    try {
      vv = window.visualViewport;
      vv?.addEventListener?.('resize', debouncedCheck);
      vv?.addEventListener?.('scroll', debouncedCheck);
    } catch {}

    // 4. resize & orientationchange
    window.addEventListener('resize', debouncedCheck, { passive: true });
    window.addEventListener('orientationchange', debouncedCheck, { passive: true });

    // 5. Mobile app lifecycle
    const onVisibility = () => {
      if (document.visibilityState === 'visible') debouncedCheck();
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', debouncedCheck);
    window.addEventListener('focus', debouncedCheck);

    return () => {
      cancelAnimationFrame(initialRaf);
      try {
        if (mql) {
          if (typeof mql.removeEventListener === 'function') {
            mql.removeEventListener('change', debouncedCheck);
          } else if (typeof mql.removeListener === 'function') {
            (mql as unknown as { removeListener: (cb: () => void) => void }).removeListener(debouncedCheck);
          }
        }
      } catch {}
      try {
        orientationApi()?.removeEventListener?.('change', debouncedCheck);
      } catch {}
      try {
        vv?.removeEventListener?.('resize', debouncedCheck);
        vv?.removeEventListener?.('scroll', debouncedCheck);
      } catch {}
      window.removeEventListener('resize', debouncedCheck);
      window.removeEventListener('orientationchange', debouncedCheck);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', debouncedCheck);
      window.removeEventListener('focus', debouncedCheck);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, [debouncedCheck, check]);

  return info;
}
