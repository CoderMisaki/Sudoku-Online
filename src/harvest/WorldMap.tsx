"use client";
// Realtime world map.
//
// Two canvases are stacked:
//   1. terrain — painted ONCE per world (static, expensive),
//   2. markers — repainted on an rAF loop reading live engine positions.
// This means player movement never re-renders React and never repaints terrain.
//
// All coordinates come from the same WorldEngine world grid, so the map is a true
// projection of the world — nothing is randomised.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Minus, Plus } from 'lucide-react';
import { useHarvestStore } from './store';
import { rleDecode } from './sprites';
import type { UIApi } from './api';
import type { DeviceClass } from './orientation';

const MAP_COLORS: Record<number, string> = {
  0: '#4a7c3f', 1: '#a89070', 2: '#7a5230', 3: '#3f7ea8', 4: '#d9c89a',
  5: '#7d7d7d', 6: '#2f5c2b', 7: '#8fae52', 8: '#5c5c5c', 9: '#c2b280',
};

interface Poi { x: number; y: number; icon: string; label: string; tone: string; }

export function WorldMap({ api, device }: { api: UIApi; device: DeviceClass }) {
  const terrainRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);

  const me = useHarvestStore((s) => s.me);
  const meta = useHarvestStore((s) => s.worldMeta);
  const defs = useHarvestStore((s) => s.defs);
  const playersShort = useHarvestStore((s) => s.playersShort);
  const userId = useHarvestStore((s) => s.userId);

  const world = api.getEngine()?.getWorldState() || null;
  const W = world?.size[0] || 224;
  const H = world?.size[1] || 224;

  const [zoom, setZoom] = useState(device === 'mobile' ? 1.4 : 1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [follow, setFollow] = useState(true);

  // Keep view transform in a ref too, so the rAF loop reads fresh values without
  // being re-created (which would otherwise restart the loop every frame).
  const viewRef = useRef({ zoom, pan, follow });
  useEffect(() => { viewRef.current = { zoom, pan, follow }; }, [zoom, pan, follow]);

  // Live names for markers, kept in a ref (updated 10Hz) to avoid re-renders.
  const namesRef = useRef<Record<string, string>>({});
  useEffect(() => {
    const map: Record<string, string> = {};
    for (const p of Object.values(playersShort)) map[p.id] = p.name;
    namesRef.current = map;
  }, [playersShort]);

  const pois = useMemo<Poi[]>(() => {
    if (!world) return [];
    const list: Poi[] = [
      { x: world.villageCenter.x, y: world.villageCenter.y, icon: '🏘', label: 'Desa', tone: '#fbbf24' },
      { x: world.mineDoor.x, y: world.mineDoor.y, icon: '⛏', label: 'Tambang', tone: '#a1a1aa' },
      { x: world.farmArea.x0 + 24, y: world.farmArea.y0 + 30, icon: '🌾', label: 'Farm', tone: '#86efac' },
      { x: world.bridge.x, y: world.bridge.y, icon: '🌉', label: 'Jembatan', tone: '#93c5fd' },
    ];
    // NPCs / shops from the authoritative defs.
    for (const npc of defs?.npcs || []) {
      const isShop = defs?.shops?.includes(npc.id);
      list.push({
        x: npc.work[0], y: npc.work[1],
        icon: isShop ? '🛒' : '👤',
        label: npc.name,
        tone: npc.color || '#c4b5fd',
      });
    }
    if (meta.festival.active) {
      list.push({ x: 120, y: 132, icon: '🎪', label: 'Festival', tone: '#f0abfc' });
    }
    return list;
  }, [world, defs, meta.festival.active]);

  // ── static terrain: painted once per world ──
  useEffect(() => {
    const cv = terrainRef.current;
    if (!cv || !world) return;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const grid = rleDecode(world.tileRLE, W * H);
    const img = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const col = MAP_COLORS[grid[i]] || '#000000';
      img.data[i * 4] = parseInt(col.slice(1, 3), 16);
      img.data[i * 4 + 1] = parseInt(col.slice(3, 5), 16);
      img.data[i * 4 + 2] = parseInt(col.slice(5, 7), 16);
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [world, W, H]);

  // ── live marker layer ──
  useEffect(() => {
    const cv = markerRef.current;
    const wrap = wrapRef.current;
    if (!cv || !wrap) return;

    const draw = () => {
      const rect = wrap.getBoundingClientRect();
      const cssW = Math.max(1, Math.floor(rect.width));
      const cssH = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cv.width !== cssW * dpr || cv.height !== cssH * dpr) {
        cv.width = cssW * dpr; cv.height = cssH * dpr;
        cv.style.width = `${cssW}px`; cv.style.height = `${cssH}px`;
      }
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);

      const engine = api.getEngine();
      const view = viewRef.current;
      // Base scale fits the whole world; zoom multiplies it.
      const base = Math.min(cssW / W, cssH / H);
      const scale = base * view.zoom;

      // Player world position straight from the engine (same coords as the world).
      const myPos = engine?.getMyPosition();
      const myX = myPos ? myPos.x : (me?.x ?? W / 2);
      const myY = myPos ? myPos.y : (me?.y ?? H / 2);
      const myDir = myPos ? myPos.dir : (me?.dir ?? 2);

      // Center on the player when following, otherwise on the world + pan.
      const cx = view.follow ? myX : W / 2 - view.pan.x / scale;
      const cy = view.follow ? myY : H / 2 - view.pan.y / scale;
      const offX = cssW / 2 - cx * scale + (view.follow ? view.pan.x : 0);
      const offY = cssH / 2 - cy * scale + (view.follow ? view.pan.y : 0);

      const toScreen = (wx: number, wy: number) => [offX + wx * scale, offY + wy * scale] as const;

      // Position the static terrain image under the markers with the same transform.
      const terrain = terrainRef.current;
      if (terrain) {
        terrain.style.transformOrigin = '0 0';
        terrain.style.transform = `translate(${offX}px, ${offY}px) scale(${scale})`;
      }

      // POIs
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const p of pois) {
        const [sx, sy] = toScreen(p.x, p.y);
        if (sx < -20 || sy < -20 || sx > cssW + 20 || sy > cssH + 20) continue; // cull
        ctx.font = '13px system-ui, sans-serif';
        ctx.fillText(p.icon, sx, sy);
      }

      // Remote players — live positions from the engine's interpolated rigs.
      const remotes = engine?.getRemotePositions() || [];
      ctx.font = 'bold 9px system-ui, sans-serif';
      for (const r of remotes) {
        if (r.id === userId) continue;
        const [sx, sy] = toScreen(r.x, r.y);
        if (sx < -30 || sy < -30 || sx > cssW + 30 || sy > cssH + 30) continue;
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.stroke();
        const name = namesRef.current[r.id];
        if (name) {
          ctx.fillStyle = 'rgba(0,0,0,0.6)';
          const tw = ctx.measureText(name).width;
          ctx.fillRect(sx - tw / 2 - 3, sy - 20, tw + 6, 12);
          ctx.fillStyle = '#fde68a';
          ctx.fillText(name, sx, sy - 14);
        }
      }

      // Own marker + heading cone, drawn last so it is always on top.
      const [mx, my] = toScreen(myX, myY);
      const dir = myDir;
      const ang = dir === 0 ? -Math.PI / 2 : dir === 1 ? 0 : dir === 2 ? Math.PI / 2 : Math.PI;
      ctx.beginPath();
      ctx.moveTo(mx, my);
      ctx.arc(mx, my, 16, ang - 0.45, ang + 0.45);
      ctx.closePath();
      ctx.fillStyle = 'rgba(56,189,248,0.28)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, Math.PI * 2);
      ctx.fillStyle = '#0ea5e9';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#ffffff';
      ctx.stroke();

      const myName = me?.username || 'Kamu';
      ctx.font = 'bold 10px system-ui, sans-serif';
      const tw = ctx.measureText(myName).width;
      ctx.fillStyle = 'rgba(2,132,199,0.85)';
      ctx.fillRect(mx - tw / 2 - 4, my - 24, tw + 8, 13);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(myName, mx, my - 17);

      rafRef.current = requestAnimationFrame(draw);
    };

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [api, W, H, pois, me, userId]);

  // ── pan gesture ──
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX; d.y = e.clientY;
    setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    if (dragRef.current?.id === e.pointerId) dragRef.current = null;
  }, []);

  const centerOnPlayer = () => { setPan({ x: 0, y: 0 }); setFollow(true); };

  return (
    <div className="flex flex-col gap-2 h-full min-h-0">
      <div className="flex items-center gap-1.5 flex-wrap shrink-0">
        <span className="text-[10px] text-white/55 flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-sky-500 inline-block" /> Kamu</span>
        <span className="text-[10px] text-white/55 flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Pemain lain</span>
        <div className="flex-1" />
        <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.35).toFixed(2)))} aria-label="Perkecil" className="w-8 h-8 rounded-xl bg-white/8 hover:bg-white/15 text-white/80 flex items-center justify-center cursor-pointer"><Minus className="w-3.5 h-3.5" /></button>
        <span className="text-[10px] text-white/60 tabular-nums w-9 text-center">{zoom.toFixed(1)}×</span>
        <button onClick={() => setZoom((z) => Math.min(6, +(z + 0.35).toFixed(2)))} aria-label="Perbesar" className="w-8 h-8 rounded-xl bg-white/8 hover:bg-white/15 text-white/80 flex items-center justify-center cursor-pointer"><Plus className="w-3.5 h-3.5" /></button>
        <button
          onClick={centerOnPlayer}
          aria-label="Pusatkan ke pemain"
          className={`h-8 px-2.5 rounded-xl flex items-center gap-1 text-[10px] font-bold cursor-pointer transition-colors ${follow ? 'bg-emerald-500 text-emerald-950' : 'bg-white/8 text-white/75 hover:bg-white/15'}`}
        >
          <Crosshair className="w-3.5 h-3.5" /> Ikuti
        </button>
      </div>

      <div
        ref={wrapRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => { setZoom((z) => Math.max(0.6, Math.min(6, z * (e.deltaY > 0 ? 0.9 : 1.1)))); }}
        className="relative flex-1 min-h-[180px] rounded-2xl overflow-hidden border border-white/10 bg-[#0a1220] cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
      >
        <canvas ref={terrainRef} className="absolute top-0 left-0 pointer-events-none" style={{ imageRendering: 'pixelated' }} />
        <canvas ref={markerRef} className="absolute inset-0 pointer-events-none" />
      </div>

      <p className="text-[10px] text-white/40 shrink-0">Seret untuk geser · cubit/scroll untuk zoom · posisi diperbarui realtime dari server.</p>
    </div>
  );
}
