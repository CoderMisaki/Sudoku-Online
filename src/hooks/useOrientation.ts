"use client";

import { useCallback, useEffect, useState } from 'react';
import type { DeviceKind, ScreenOrientationKind } from '@/types/game';

export interface OrientationState {
  orientation: ScreenOrientationKind;
  isLandscape: boolean;
  isPortrait: boolean;
  angle: number;
  width: number;
  height: number;
  device: DeviceKind;
  /** true di layar sentuh (mobile/tab). Dipakai memilih joystick vs keyboard. */
  isTouch: boolean;
  /** Minta fullscreen + kunci landscape bila didukung (tidak pernah melempar error). */
  requestLandscape: () => Promise<boolean>;
}

function readOrientation(): { orientation: ScreenOrientationKind; angle: number; width: number; height: number } {
  if (typeof window === 'undefined') {
    return { orientation: 'unknown', angle: 0, width: 0, height: 0 };
  }
  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;

  // 1) screen.orientation (paling akurat di mobile modern)
  try {
    const so = window.screen?.orientation;
    if (so?.type) {
      const t = so.type;
      if (t.startsWith('landscape')) return { orientation: 'landscape', angle: so.angle ?? 90, width: w, height: h };
      if (t.startsWith('portrait')) return { orientation: 'portrait', angle: so.angle ?? 0, width: w, height: h };
    }
  } catch {}

  // 2) matchMedia (fallback tablet/desktop)
  try {
    if (window.matchMedia?.('(orientation: landscape)').matches) {
      return { orientation: 'landscape', angle: 90, width: w, height: h };
    }
    if (window.matchMedia?.('(orientation: portrait)').matches) {
      return { orientation: 'portrait', angle: 0, width: w, height: h };
    }
  } catch {}

  // 3) fallback rasio dimensi — SELALU memberi jawaban agar game tidak "stuck unknown"
  if (w > 0 && h > 0) {
    return { orientation: w >= h ? 'landscape' : 'portrait', angle: w >= h ? 90 : 0, width: w, height: h };
  }
  return { orientation: 'unknown', angle: 0, width: w, height: h };
}

function readDevice(width: number, isTouch: boolean): DeviceKind {
  if (typeof window === 'undefined') return 'desktop';
  // Tablet: layar sentuh + lebar menengah, atau iPadOS (touch + Mac UA)
  const coarse = (() => {
    try {
      return window.matchMedia?.('(pointer: coarse)').matches ?? false;
    } catch {
      return false;
    }
  })();
  const touchCapable = isTouch || coarse || navigator.maxTouchPoints > 0;
  if (!touchCapable) return 'desktop';
  if (width >= 768 && width <= 1280) return 'tablet';
  if (width > 1280) return 'desktop';
  return 'mobile';
}

/**
 * Hook orientasi robust — tidak pernah memblokir game.
 * Membaca landscape/portrait dari 3 sumber (screen.orientation, matchMedia,
 * rasio w/h) + mendengar resize, orientationchange, dan perubahan screen.orientation.
 */
export function useOrientation(): OrientationState {
  const [snap, setSnap] = useState(() => readOrientation());
  const [isTouch, setIsTouch] = useState(false);

  useEffect(() => {
    const detectTouch = () => {
      const t =
        'ontouchstart' in window ||
        navigator.maxTouchPoints > 0 ||
        (() => {
          try {
            return window.matchMedia?.('(pointer: coarse)').matches ?? false;
          } catch {
            return false;
          }
        })();
      setIsTouch(t);
    };
    detectTouch();

    const update = () => setSnap(readOrientation());
    // Baca ulang setelah rotasi selesai (mobile butuh jeda layout)
    const updateDelayed = () => {
      update();
      window.setTimeout(update, 250);
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', updateDelayed);
    try {
      window.screen?.orientation?.addEventListener('change', updateDelayed);
    } catch {}
    // visualViewport berubah saat keyboard/zoom mobile
    try {
      window.visualViewport?.addEventListener('resize', update);
    } catch {}

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', updateDelayed);
      try {
        window.screen?.orientation?.removeEventListener('change', updateDelayed);
      } catch {}
      try {
        window.visualViewport?.removeEventListener('resize', update);
      } catch {}
    };
  }, []);

  const requestLandscape = useCallback(async (): Promise<boolean> => {
    try {
      // Fullscreen dulu (syarat screen.orientation.lock di Chrome Android)
      const el = document.documentElement as HTMLElement & {
        requestFullscreen?: () => Promise<void>;
      };
      if (document.fullscreenElement == null && typeof el.requestFullscreen === 'function') {
        try {
          await el.requestFullscreen();
        } catch {}
      }
      const so = window.screen?.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> };
      if (typeof so?.lock === 'function') {
        try {
          await so.lock('landscape');
          setSnap(readOrientation());
          return true;
        } catch {
          // lock ditolak (iOS/desktop) — bukan error fatal
        }
      }
    } catch {}
    setSnap(readOrientation());
    return readOrientation().orientation === 'landscape';
  }, []);

  const device = readDevice(snap.width, isTouch);

  return {
    orientation: snap.orientation,
    isLandscape: snap.orientation === 'landscape',
    isPortrait: snap.orientation === 'portrait',
    angle: snap.angle,
    width: snap.width,
    height: snap.height,
    device,
    isTouch,
    requestLandscape,
  };
}
