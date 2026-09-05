"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/utils/cn';
import type { MoveDir } from '@/hooks/useUnifiedControls';

interface VirtualJoystickProps {
  /** Langkah diskrit (navigasi sel/kursor). */
  onMove: (dir: MoveDir) => void;
  /** Vektor analog kontinu -1..1 (gerakan avatar bebas). */
  onAnalog?: (x: number, y: number) => void;
  className?: string;
  size?: number;
}

const STEP_THRESHOLD = 0.45;
/** Jeda antar langkah diskrit saat stick ditahan (ms) — terasa smooth di mobile. */
const STEP_INTERVAL_MS = 170;

/**
 * Analog / joystick untuk mobile & tab.
 * - Sentuh & seret: knob mengikuti jari (maks radius), vektor analog realtime.
 * - Lewati ambang: memicu langkah diskrit berulang (atas/bawah/kiri/kanan).
 * - Mendukung sentuhan multi-jari + mouse (untuk testing di desktop).
 */
export const VirtualJoystick: React.FC<VirtualJoystickProps> = ({
  onMove,
  onAnalog,
  className,
  size = 128,
}) => {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const [active, setActive] = useState(false);
  const pointerIdRef = useRef<number | null>(null);
  const vecRef = useRef({ x: 0, y: 0 });
  const lastStepRef = useRef(0);
  const lastDirRef = useRef<MoveDir | null>(null);
  const rafRef = useRef<number>(0);
  const onMoveRef = useRef(onMove);
  const onAnalogRef = useRef(onAnalog);

  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);
  useEffect(() => {
    onAnalogRef.current = onAnalog;
  }, [onAnalog]);

  const radius = size / 2;
  const knobRadius = size * 0.22;
  const maxDist = radius - knobRadius - 6;

  // Loop: saat stick ditahan melewati ambang, kirim langkah diskrit berulang.
  useEffect(() => {
    const loop = (now: number) => {
      const { x, y } = vecRef.current;
      const mag = Math.hypot(x, y);
      if (pointerIdRef.current !== null && mag > STEP_THRESHOLD) {
        const absX = Math.abs(x);
        const absY = Math.abs(y);
        const dir: MoveDir = absX > absY ? (x > 0 ? 'right' : 'left') : y > 0 ? 'down' : 'up';
        if (now - lastStepRef.current >= STEP_INTERVAL_MS || lastDirRef.current !== dir) {
          lastStepRef.current = now;
          lastDirRef.current = dir;
          try {
            onMoveRef.current(dir);
          } catch {}
          // Haptic ringan bila didukung
          try {
            (navigator as Navigator & { vibrate?: (p: number) => void }).vibrate?.(8);
          } catch {}
        }
      }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const setVector = useCallback(
    (dx: number, dy: number) => {
      const dist = Math.hypot(dx, dy);
      const clamped = dist > maxDist ? maxDist / (dist || 1) : 1;
      const cx = dx * clamped;
      const cy = dy * clamped;
      setKnob({ x: cx, y: cy });
      const nx = maxDist > 0 ? cx / maxDist : 0;
      const ny = maxDist > 0 ? cy / maxDist : 0;
      vecRef.current = { x: nx, y: ny };
      try {
        onAnalogRef.current?.(nx, ny);
      } catch {}
    },
    [maxDist]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      const base = baseRef.current;
      if (!base || pointerIdRef.current !== null) return;
      pointerIdRef.current = e.pointerId;
      try {
        base.setPointerCapture(e.pointerId);
      } catch {}
      setActive(true);
      const rect = base.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      lastStepRef.current = 0;
      lastDirRef.current = null;
      setVector(dx, dy);
    },
    [setVector]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      const base = baseRef.current;
      if (!base) return;
      const rect = base.getBoundingClientRect();
      const dx = e.clientX - (rect.left + rect.width / 2);
      const dy = e.clientY - (rect.top + rect.height / 2);
      setVector(dx, dy);
    },
    [setVector]
  );

  const endPointer = useCallback(
    (e: React.PointerEvent) => {
      if (pointerIdRef.current !== e.pointerId) return;
      pointerIdRef.current = null;
      setActive(false);
      setKnob({ x: 0, y: 0 });
      vecRef.current = { x: 0, y: 0 };
      lastDirRef.current = null;
      try {
        onAnalogRef.current?.(0, 0);
      } catch {}
    },
    []
  );

  return (
    <div className={cn('flex flex-col items-center gap-1.5 select-none', className)}>
      <div
        ref={baseRef}
        role="slider"
        aria-label="Joystick analog — seret untuk bergerak"
        aria-valuemin={-100}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.hypot(knob.x, knob.y) / (maxDist || 1) * 100)}
        aria-valuetext={active ? 'aktif' : 'netral'}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        className={cn(
          'relative rounded-full border-2 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-foreground',
          'bg-card/80 backdrop-blur-sm touch-none cursor-pointer',
          active ? 'border-foreground shadow-lg' : 'border-border shadow-md'
        )}
        style={{ width: size, height: size, touchAction: 'none' }}
      >
        {/* Crosshair arah */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
          <div className="absolute w-[2px] h-[70%] bg-border rounded" />
          <div className="absolute h-[2px] w-[70%] bg-border rounded" />
        </div>
        {/* Label arah */}
        <span className="absolute top-1 left-1/2 -translate-x-1/2 text-[10px] text-secondary pointer-events-none">▲</span>
        <span className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] text-secondary pointer-events-none">▼</span>
        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-[10px] text-secondary pointer-events-none">◀</span>
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-secondary pointer-events-none">▶</span>

        {/* Knob */}
        <div
          className={cn(
            'absolute rounded-full shadow-md transition-[background-color] duration-150 flex items-center justify-center',
            active ? 'bg-foreground' : 'bg-secondary/60'
          )}
          style={{
            width: knobRadius * 2,
            height: knobRadius * 2,
            left: radius - knobRadius + knob.x,
            top: radius - knobRadius + knob.y,
          }}
        >
          <div className={cn('w-2 h-2 rounded-full', active ? 'bg-background' : 'bg-background/70')} />
        </div>
      </div>
      <span className="text-[11px] text-secondary font-medium">Analog • seret untuk gerak</span>
    </div>
  );
};
