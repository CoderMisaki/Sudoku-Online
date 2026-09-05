"use client";
// Analog virtual joystick for touch devices.
//
// Design notes:
//  - Pointer Events + setPointerCapture: the stick keeps tracking even when the
//    finger slides outside the base, which is the #1 cause of "stuck movement".
//  - Multitouch safe: it only ever follows the ONE pointerId that started on it,
//    so pressing an action button with the other thumb cannot hijack it.
//  - touch-action:none + preventDefault: the page never scrolls while steering.
//  - Zero React state per move: the knob is positioned by direct style writes and
//    the vector goes straight into the InputManager, so steering costs no renders.
import React, { useCallback, useEffect, useRef } from 'react';
import { inputManager } from './input';
import type { DeviceClass } from './orientation';

const SIZES: Record<DeviceClass, { base: number; knob: number }> = {
  mobile: { base: 116, knob: 50 },
  tablet: { base: 156, knob: 66 },
  desktop: { base: 128, knob: 56 },
};

export function Joystick({ device }: { device: DeviceClass }) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pointerIdRef = useRef<number | null>(null);
  const centerRef = useRef({ x: 0, y: 0, r: 1 });

  const size = SIZES[device] || SIZES.mobile;

  const paint = useCallback((nx: number, ny: number, active: boolean) => {
    const knob = knobRef.current;
    const base = baseRef.current;
    if (knob) {
      const travel = size.base * 0.3;
      knob.style.transform = `translate(${nx * travel}px, ${-ny * travel}px)`;
    }
    if (base) {
      base.style.borderColor = active ? 'rgba(110,231,183,0.75)' : 'rgba(255,255,255,0.22)';
      base.style.background = active ? 'rgba(52,211,153,0.18)' : 'rgba(13,24,38,0.7)';
    }
  }, [size.base]);

  const measure = useCallback(() => {
    const base = baseRef.current;
    if (!base) return;
    const r = base.getBoundingClientRect();
    centerRef.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width / 2 };
  }, []);

  const apply = useCallback((clientX: number, clientY: number) => {
    const c = centerRef.current;
    const dx = (clientX - c.x) / c.r;
    // Screen Y grows downward; the game's Y axis grows upward.
    const dy = -(clientY - c.y) / c.r;
    const len = Math.hypot(dx, dy);
    const nx = len > 1 ? dx / len : dx;
    const ny = len > 1 ? dy / len : dy;
    inputManager.setJoystick(nx, ny);
    const f = inputManager.frame;
    paint(f.x, f.y, true);
  }, [paint]);

  const release = useCallback(() => {
    pointerIdRef.current = null;
    inputManager.releaseJoystick();
    paint(0, 0, false);
  }, [paint]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Already steering with another finger — ignore extra touches on the base.
    if (pointerIdRef.current !== null) return;
    e.preventDefault();
    e.stopPropagation();
    pointerIdRef.current = e.pointerId;
    measure();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    apply(e.clientX, e.clientY);
  }, [apply, measure]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    apply(e.clientX, e.clientY);
  }, [apply]);

  const onPointerEnd = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    e.preventDefault();
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    release();
  }, [release]);

  // Safety net: if the pointer is lost in any way the browser does not report
  // (context menu, alert, OS gesture), drop the stick so we never walk forever.
  useEffect(() => {
    const onLost = () => { if (pointerIdRef.current !== null) release(); };
    window.addEventListener('pointercancel', onLost);
    window.addEventListener('blur', onLost);
    window.addEventListener('contextmenu', onLost);
    return () => {
      window.removeEventListener('pointercancel', onLost);
      window.removeEventListener('blur', onLost);
      window.removeEventListener('contextmenu', onLost);
      // Never leave input engaged when the joystick unmounts.
      inputManager.releaseJoystick();
    };
  }, [release]);

  useEffect(() => { measure(); }, [measure, device]);

  return (
    <div
      ref={baseRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onContextMenu={(e) => e.preventDefault()}
      role="application"
      aria-label="Joystick gerak"
      className="rounded-full border-2 flex items-center justify-center select-none"
      style={{
        width: size.base,
        height: size.base,
        touchAction: 'none',
        borderColor: 'rgba(255,255,255,0.22)',
        background: 'rgba(13,24,38,0.7)',
        // Bigger invisible hit area so the thumb does not need to be precise.
        padding: 8,
        margin: -8,
      }}
    >
      <div
        ref={knobRef}
        className="rounded-full bg-gradient-to-b from-emerald-300 to-emerald-500 shadow-lg border-2 border-white/40 pointer-events-none"
        style={{ width: size.knob, height: size.knob, willChange: 'transform' }}
      />
    </div>
  );
}
