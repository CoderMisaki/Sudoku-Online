"use client";
// Authoritative multi-layered orientation detection and responsive lifecycle hooks.
//
// The detection is deliberately "dimensions first":
// - On installed PWAs some browsers report a stale screen.orientation.type
//   while the layout actually rotated (or when orientation is locked by the
//   manifest). The live viewport width/height is the most trustworthy signal.
// - Desktop / non-touch devices are treated as landscape by default so users
//   are never forced into the rotate gate on a laptop or desktop monitor.
import { useEffect, useState, useCallback, useRef } from 'react';

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

export function screenOrientationType(): string | null {
  try {
    return typeof window.screen?.orientation?.type === 'string'
      ? window.screen.orientation.type
      : null;
  } catch {
    return null;
  }
}

/**
 * Authoritative function to check if the current viewport/device is in landscape mode.
 * Evaluates multiple layers:
 * 1. Live viewport dimensions (innerWidth / visualViewport / documentElement)
 * 2. window.matchMedia('(orientation: landscape)')
 * 3. window.screen.orientation.type as the final tie-breaker
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
 * React hook that stays reactive to:
 * - resize events
 * - orientationchange events
 * - screen.orientation change
 * - visualViewport resize/scroll (mobile address bar / split-screen)
 * - matchMedia change
 * - visibilitychange, pageshow, and focus lifecycle events
 */
export function useOrientation() {
  const [isLandscape, setIsLandscape] = useState<boolean>(true);
  const [orientationReady, setOrientationReady] = useState<boolean>(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number>(0);

  const check = useCallback(() => {
    const landscape = isLandscapeDevice();
    setIsLandscape(landscape);
    setOrientationReady(true);
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
      window.screen?.orientation?.addEventListener?.('change', debouncedCheck);
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
        window.screen?.orientation?.removeEventListener?.('change', debouncedCheck);
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

  return { isLandscape, orientationReady, isTouch: isTouchDevice() };
}
