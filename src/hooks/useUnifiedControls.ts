"use client";

import { useCallback, useEffect, useRef } from 'react';

export type MoveDir = 'up' | 'down' | 'left' | 'right';

export interface UnifiedControlsOptions {
  /** Dipanggil tiap langkah navigasi dari joystick / D-pad mobile. */
  onMove: (dir: MoveDir) => void;
  /**
   * Dipanggil untuk langkah keyboard (WASD/panah PC). Bila tidak diisi,
   * keyboard memakai `onMove`. Dipisah agar tidak double-fire dengan handler
   * keyboard milik papan (Sudoku 2D/3D sudah menangani seleksi sel sendiri).
   */
  onKeyMove?: (dir: MoveDir) => void;
  /** Dipanggil saat joystick analog bergerak (vektor -1..1). Untuk gerakan bebas/avatar. */
  onAnalog?: (x: number, y: number) => void;
  /** Nonaktifkan (mis. spectator / modal terbuka). */
  disabled?: boolean;
  /** Interval auto-repeat saat tombol ditahan (ms). Default 140. */
  repeatMs?: number;
}

const KEY_TO_DIR: Record<string, MoveDir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
};

/**
 * Kontrol terpadu PC + Mobile/Tab:
 * - PC: WASD + Arrow keys (dengan auto-repeat halus saat ditahan, via rAF).
 * - Mobile/Tab: dipicu dari VirtualJoystick / D-pad lewat `move()` yang diekspos.
 *
 * Abaikan input saat fokus di input/textarea/select/contenteditable atau chat.
 */
export function useUnifiedControls({ onMove, onKeyMove, onAnalog, disabled, repeatMs = 140 }: UnifiedControlsOptions) {
  const onMoveRef = useRef(onMove);
  const onKeyMoveRef = useRef(onKeyMove);
  const onAnalogRef = useRef(onAnalog);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);
  useEffect(() => {
    onKeyMoveRef.current = onKeyMove;
  }, [onKeyMove]);
  useEffect(() => {
    onAnalogRef.current = onAnalog;
  }, [onAnalog]);

  const disabledRef = useRef(Boolean(disabled));
  useEffect(() => {
    disabledRef.current = Boolean(disabled);
  }, [disabled]);

  const heldRef = useRef<Map<string, number>>(new Map());
  const rafRef = useRef<number>(0);
  const lastTickRef = useRef<number>(0);

  const isTypingTarget = useCallback((e: KeyboardEvent): boolean => {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.closest('input, textarea, select, [contenteditable="true"]')) return true;
    // Chat textarea punya id khusus — jangan bajak Enter/ WASD saat mengetik
    if (t.id === 'chat-textarea' || t.id === 'chat-input') return true;
    return false;
  }, []);

  // Loop repeat halus: selama tombol ditahan, kirim langkah tiap repeatMs.
  useEffect(() => {
    const loop = (now: number) => {
      if (!disabledRef.current && heldRef.current.size > 0) {
        if (now - lastTickRef.current >= repeatMs) {
          lastTickRef.current = now;
          // Prioritas: tombol yang paling baru ditekan
          let latestKey = '';
          let latestAt = -1;
          heldRef.current.forEach((at, key) => {
            if (at >= latestAt) {
              latestAt = at;
              latestKey = key;
            }
          });
          const dir = KEY_TO_DIR[latestKey];
          if (dir) {
            try {
              (onKeyMoveRef.current ?? onMoveRef.current)(dir);
            } catch {}
          }
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [repeatMs]);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (disabledRef.current) return;
      if (isTypingTarget(e)) return;
      const dir = KEY_TO_DIR[e.key];
      if (!dir) return;
      // Panah selalu preventDefault (anti-scroll); WASD hanya bila bukan di field teks
      if (e.key.startsWith('Arrow')) e.preventDefault();
      if (e.repeat) return; // repeat diurus rAF loop agar konsisten
      heldRef.current.set(e.key, performance.now());
      lastTickRef.current = performance.now();
      try {
        (onKeyMoveRef.current ?? onMoveRef.current)(dir);
      } catch {}
    };
    const up = (e: KeyboardEvent) => {
      heldRef.current.delete(e.key);
    };
    const blur = () => heldRef.current.clear();

    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [isTypingTarget]);

  /** Dipakai VirtualJoystick / D-pad mobile: langkah diskrit. */
  const move = useCallback((dir: MoveDir) => {
    if (disabledRef.current) return;
    try {
      onMoveRef.current(dir);
    } catch {}
  }, []);

  /** Dipakai VirtualJoystick analog: vektor bebas -1..1. */
  const analog = useCallback((x: number, y: number) => {
    if (disabledRef.current) return;
    try {
      onAnalogRef.current?.(x, y);
    } catch {}
  }, []);

  return { move, analog };
}
