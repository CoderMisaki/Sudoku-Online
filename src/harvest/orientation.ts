"use client";
// Authoritative multi-layered orientation detection and responsive lifecycle hooks.
import { useEffect, useState, useCallback, useRef } from 'react';

/**
 * Authoritative function to check if the current viewport/device is in landscape mode.
 * Evaluates multiple layers:
 * 1. window.matchMedia('(orientation: landscape)')
 * 2. window.innerWidth > window.innerHeight
 * 3. window.screen.orientation.type if available
 * 4. document.documentElement dimensions fallback
 */
export function isLandscapeDevice(): boolean {
  if (typeof window === 'undefined') return true;

  const w = window.innerWidth || document.documentElement?.clientWidth || 0;
  const h = window.innerHeight || document.documentElement?.clientHeight || 0;

  // Layer 1: screen.orientation.type
  try {
    const screenType = window.screen?.orientation?.type;
    if (typeof screenType === 'string') {
      if (screenType.startsWith('landscape') && w >= h * 0.95) return true;
      if (screenType.startsWith('portrait') && h > w) return false;
    }
  } catch {}

  // Layer 2: window.matchMedia('(orientation: landscape)')
  try {
    if (typeof window.matchMedia === 'function') {
      const mql = window.matchMedia('(orientation: landscape)');
      if (mql && typeof mql.matches === 'boolean') {
        if (mql.matches && w >= h) return true;
        if (!mql.matches && h > w) return false;
      }
    }
  } catch {}

  // Layer 3: innerWidth vs innerHeight direct dimension comparison
  if (w > 0 && h > 0) {
    return w > h;
  }

  return true;
}

/**
 * React hook that stays reactive to:
 * - resize events
 * - orientationchange events
 * - screen.orientation change
 * - matchMedia change
 * - visibilitychange, pageshow, and focus lifecycle events
 */
export function useOrientation() {
  const [isLandscape, setIsLandscape] = useState<boolean>(() => isLandscapeDevice());
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
    // Set orientationReady in requestAnimationFrame to avoid synchronous setState during render
    const initialRaf = requestAnimationFrame(() => {
      setOrientationReady(true);
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

    // 3. resize & orientationchange
    window.addEventListener('resize', debouncedCheck, { passive: true });
    window.addEventListener('orientationchange', debouncedCheck, { passive: true });

    // 4. Mobile app lifecycle
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
      window.removeEventListener('resize', debouncedCheck);
      window.removeEventListener('orientationchange', debouncedCheck);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', debouncedCheck);
      window.removeEventListener('focus', debouncedCheck);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      cancelAnimationFrame(rafRef.current);
    };
  }, [debouncedCheck]);

  return { isLandscape, orientationReady };
}
