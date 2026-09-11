"use client";
// In-game HUD: top bar, quickbar, touch controls, dialogue, public & private chat, fishing, minimap.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MapIcon, Package, ListChecks, BookOpen, Heart, Settings, Wrench,
  Home as HomeIcon, Users, MessageCircle, X, Send, Coins, Clock, Sun, CloudRain, CloudSnow,
  CloudFog, Wind, Flame, CloudLightning, Zap, Lock, Globe,
} from 'lucide-react';
import { useHarvestStore } from './store';
import { UIApi, getQuickSlots } from './api';
import { audio } from './audio';
import { makeItemIcon } from './sprites';
import { detectDeviceType, DeviceType } from './input';
import type { MenuId } from './types';

function fmtTime(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const SEASON_LABEL: Record<string, string> = {
  spring: 'Musim Semi',
  summer: 'Musim Panas',
  autumn: 'Musim Gugur',
  winter: 'Musim Dingin',
};

const WEATHER_ICON: Record<string, { icon: React.ReactNode; label: string }> = {
  sunny: { icon: <Sun className="w-3.5 h-3.5 text-amber-300" />, label: 'Cerah' },
  rain: { icon: <CloudRain className="w-3.5 h-3.5 text-sky-300" />, label: 'Hujan' },
  storm: { icon: <CloudLightning className="w-3.5 h-3.5 text-violet-300" />, label: 'Badai' },
  fog: { icon: <CloudFog className="w-3.5 h-3.5 text-slate-300" />, label: 'Berkabut' },
  snow: { icon: <CloudSnow className="w-3.5 h-3.5 text-blue-200" />, label: 'Salju' },
  wind: { icon: <Wind className="w-3.5 h-3.5 text-emerald-300" />, label: 'Angin' },
  heatwave: { icon: <Flame className="w-3.5 h-3.5 text-orange-400" />, label: 'Panas' },
};

export function HudLayer({ api }: { api: UIApi }) {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  const meta = useHarvestStore((s) => s.worldMeta);
  const playersShort = useHarvestStore((s) => s.playersShort);
  const menu = useHarvestStore((s) => s.menu);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const interaction = useHarvestStore((s) => s.interaction);
  const status = useHarvestStore((s) => s.status);
  const mine = useHarvestStore((s) => s.mine);
  const selectedItem = useHarvestStore((s) => s.selectedItem);
  const chatOpen = useHarvestStore((s) => s.chatOpen);
  const setChatOpen = useHarvestStore((s) => s.setChatOpen);
  const unreadPrivate = useHarvestStore((s) => s.unreadPrivate);
  const festivalBanner = useHarvestStore((s) => s.festivalBanner);

  const [deviceType, setDeviceType] = useState<DeviceType>(() => detectDeviceType());
  useEffect(() => {
    const onResize = () => setDeviceType(detectDeviceType());
    window.addEventListener('resize', onResize, { passive: true });
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const totalUnreadPrivate = useMemo(() => {
    return Object.values(unreadPrivate).reduce((acc, count) => acc + count, 0);
  }, [unreadPrivate]);

  const weather = WEATHER_ICON[meta.weather] || WEATHER_ICON.sunny;
  const slots = useMemo(() => getQuickSlots(me, defs), [me, defs]);

  if (!me) return null;
  return (
    <div
      className="absolute inset-0 pointer-events-none z-20 font-sans"
      style={{
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* top bar */}
      <div className="absolute top-2 left-2 right-2 sm:top-3 sm:left-3 sm:right-3 flex items-start justify-between gap-2">
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="pointer-events-auto flex items-center gap-1.5 bg-[#0d1826]/85 backdrop-blur rounded-2xl px-3 py-1.5 border border-white/10 shadow-lg">
            <Clock className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
            <span className="font-mono font-bold text-sm text-white tabular-nums">{fmtTime(meta.timeMin)}</span>
            <span className="text-white/40 text-[10px] hidden xs:inline">|</span>
            <span className="text-[10px] text-white/75 hidden sm:inline">{SEASON_LABEL[meta.season] || meta.season} · Hari {meta.day}</span>
            <span className="flex items-center gap-1 ml-1 text-[10px] text-white/80">{weather.icon}{weather.label}</span>
          </div>
          <div className="pointer-events-auto flex items-center gap-1.5 bg-[#0d1826]/85 backdrop-blur rounded-2xl px-3 py-1.5 border border-white/10 shadow-lg w-fit max-w-full overflow-hidden">
            <Coins className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="font-mono font-bold text-white text-sm tabular-nums">{me.gold.toLocaleString('id-ID')}</span>
            <div className="w-20 sm:w-28 h-2 rounded-full bg-white/10 overflow-hidden ml-1">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (me.stamina / me.maxStamina) * 100)}%`,
                  background: me.stamina < 25 ? '#ef4444' : '#34d399',
                }}
              />
            </div>
            <span className="text-[10px] text-white/60 tabular-nums w-8 sm:w-9">{Math.round(me.stamina)}/{me.maxStamina}</span>
            <Zap className="w-3 h-3 text-emerald-300 shrink-0" />
          </div>
        </div>

        {/* right controls row */}
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1 sm:gap-1.5">
            <span className="text-[10px] text-white/70 bg-[#0d1826]/70 rounded-full px-2 py-1 border border-white/10 hidden md:inline-flex items-center gap-1">
              <Users className="w-3 h-3 text-emerald-300" /> {Object.keys(playersShort).length} pemain
            </span>
            <HudButton title="World Map (M)" active={menu === 'map'} onClick={() => { audio.play('click'); setMenu(menu === 'map' ? null : 'map'); }}>
              <MapIcon className="w-4 h-4" />
            </HudButton>
            <HudButton title="Inventory (I)" active={menu === 'inventory'} onClick={() => { audio.play('click'); setMenu(menu === 'inventory' ? null : 'inventory'); }}>
              <Package className="w-4 h-4" />
            </HudButton>
            <HudButton title="Quests (Q)" active={menu === 'quests'} onClick={() => { audio.play('click'); setMenu(menu === 'quests' ? null : 'quests'); }}>
              <ListChecks className="w-4 h-4" />
            </HudButton>
            <HudButton title="Journal (J)" active={menu === 'journal'} onClick={() => { audio.play('click'); setMenu(menu === 'journal' ? null : 'journal'); }}>
              <BookOpen className="w-4 h-4" />
            </HudButton>
            <HudButton title="Relationships (P)" active={menu === 'relationships'} onClick={() => { audio.play('click'); setMenu(menu === 'relationships' ? null : 'relationships'); }}>
              <Heart className="w-4 h-4" />
            </HudButton>
            <HudButton title="Crafting (C)" active={menu === 'crafting'} onClick={() => { audio.play('click'); setMenu(menu === 'crafting' ? null : 'crafting'); }}>
              <Wrench className="w-4 h-4" />
            </HudButton>
            <HudButton title="House" active={menu === 'house'} onClick={() => { audio.play('click'); setMenu(menu === 'house' ? null : 'house'); }}>
              <HomeIcon className="w-4 h-4" />
            </HudButton>
            <HudButton title="Settings (N)" active={menu === 'settings'} onClick={() => { audio.play('click'); setMenu(menu === 'settings' ? null : 'settings'); }}>
              <Settings className="w-4 h-4" />
            </HudButton>
          </div>
          <FpsBadge />
          {(status === 'reconnecting' || status === 'recovering') && (
            <div className="bg-amber-500/90 text-amber-950 text-[10px] font-bold px-2.5 py-1 rounded-full animate-pulse">
              ⚠ Reconnecting...
            </div>
          )}
          {festivalBanner && (
            <div className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white text-[10px] font-bold px-2.5 py-1 rounded-full animate-bounce">
              🎪 {festivalBanner.name} — SEDANG BERLANGSUNG!
            </div>
          )}
        </div>
      </div>

      {/* quest tracker (left, under top bar) */}
      {me.quests.active.length > 0 && (
        <div className="absolute left-2 top-24 sm:top-28 max-w-[40vw] pointer-events-none space-y-1">
          {me.quests.active.slice(0, 2).map((qid) => {
            const q = defs && Object.values(defs.quests).flat().find((x) => x.id === qid);
            if (!q) return null;
            const prog = q.objectives.map((o, i) => Math.min(o.count, me.quests.progress[`${qid}:${i}`] || 0) === o.count)
              .every((ok) => ok);
            return (
              <div key={qid} className={`bg-[#0d1826]/80 backdrop-blur border rounded-xl px-2.5 py-1.5 text-[10px] shadow-lg border-white/10 ${prog ? 'border-emerald-400/40 text-emerald-200' : 'text-white/85'}`}>
                <div className="font-bold truncate">{q.name}</div>
                <div className="text-white/55 truncate">{q.objectives.map((o, i) => `${Math.min(o.count, me.quests.progress[`${qid}:${i}`] || 0)}/${o.count} ${o.kind}`).join(' · ')}</div>
                {prog && <div className="text-emerald-300 font-bold">✔ Siap diklaim (Papan Quest)</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* bottom quickbar */}
      <div className="absolute bottom-2 left-1/2 -translate-x-1/2 pointer-events-auto">
        <div className="flex items-end gap-1 sm:gap-1.5 bg-[#0d1826]/85 backdrop-blur rounded-2xl p-1.5 border border-white/10 shadow-xl">
          {slots.map((itemId, i) => {
            const def = itemId ? defs?.items?.[itemId] : null;
            const active = itemId && itemId === selectedItem;
            return (
              <button
                key={i}
                disabled={!itemId}
                onClick={() => { if (itemId) { audio.play('click'); api.select(itemId); } }}
                className={`w-9 h-9 sm:w-11 sm:h-11 rounded-xl border-2 flex items-center justify-center transition-all cursor-pointer relative ${
                  active ? 'border-emerald-300 bg-emerald-400/20 scale-105 shadow-[0_0_12px_rgba(52,211,153,0.5)]' : 'border-white/15 bg-white/5 hover:bg-white/10'
                } ${!itemId ? 'opacity-30 cursor-default' : ''}`}
                title={def?.name || 'Kosong'}
              >
                {def && itemId && <img src={makeItemIcon(def.cat, def.color, itemId)} alt={def.name} className="w-6 h-6 sm:w-7 sm:h-7" draggable={false} />}
                {itemId && slotQty(me, itemId) > 1 && (
                  <span className="absolute -bottom-1 -right-1 text-[8px] sm:text-[9px] font-bold bg-white/90 text-slate-900 rounded px-0.5">
                    {slotQty(me, itemId)}
                  </span>
                )}
                <span className="absolute -top-1 -left-1 text-[8px] text-white/40">{i + 1}</span>
              </button>
            );
          })}
          <div className="w-px self-stretch bg-white/10 mx-0.5" />
          <button
            onClick={() => { audio.play('click'); api.select(null); api.getEngine()?.setMoveVector(0, 0); setMenu('inventory'); }}
            className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl border-2 border-dashed border-white/20 bg-white/5 hover:bg-white/10 flex items-center justify-center text-[9px] text-white/60 cursor-pointer"
            title="Buka Inventory (I)"
          >
            <Package className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* touch controls: mobile/tablet analog joystick (bottom-left) */}
      {(deviceType === 'mobile' || deviceType === 'tablet') && (
        <div className="absolute bottom-4 left-4 pointer-events-auto">
          <Joystick api={api} isTablet={deviceType === 'tablet'} />
        </div>
      )}

      {/* bottom-right action controls */}
      <div className="absolute bottom-4 right-4 pointer-events-auto flex items-end gap-2">
        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={() => { audio.play('click'); setChatOpen(!chatOpen); }}
            className="relative w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#0d1826]/85 border border-white/15 text-white/80 flex items-center justify-center cursor-pointer active:scale-95 transition-transform shadow-lg"
            title="Chat (Enter)"
          >
            <MessageCircle className="w-5 h-5" />
            {totalUnreadPrivate > 0 && (
              <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[9px] font-bold w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                {totalUnreadPrivate}
              </span>
            )}
          </button>
          <button
            onClick={() => { api.emote('cheer'); audio.play('emote'); }}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#0d1826]/85 border border-white/15 text-white/80 flex items-center justify-center cursor-pointer active:scale-95 transition-transform shadow-lg"
            title="Emote"
          >
            <span className="text-lg">🎉</span>
          </button>
          <SprintButton api={api} />
        </div>

        <div className="flex flex-col items-center gap-1.5">
          <button
            onClick={() => { audio.play('open'); setMenu('map'); }}
            className="w-10 h-10 sm:w-11 sm:h-11 rounded-2xl bg-[#0d1826]/85 border border-white/15 text-white/80 flex items-center justify-center cursor-pointer active:scale-95 transition-transform shadow-lg"
            title="Map (M)"
          >
            <MapIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => { api.interact(); }}
            className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 border-4 border-emerald-200/40 shadow-[0_4px_16px_rgba(16,185,129,0.45)] flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-transform"
            title={interaction.label || 'Interact (E)'}
          >
            <span className="text-[9px] sm:text-[10px] font-black text-emerald-950 uppercase tracking-wide leading-tight text-center px-1">
              {mine ? (interaction.kind === 'exit' ? 'KELUAR' : 'TAMBANG') : (interaction.label || 'Aksi')}
            </span>
            <span className="text-[7px] text-emerald-950/70 font-mono">[E]</span>
          </button>
        </div>
      </div>

      {/* fishing UI */}
      <FishingUI api={api} />

      {/* dialogue */}
      <DialogBox api={api} />

      {/* public & private chat panel */}
      <ChatPanel api={api} />

      {/* mine info badge */}
      {mine && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-[#0d1826]/85 border border-white/10 rounded-2xl px-4 py-2 text-white text-xs font-bold shadow-lg">
          ⛏ Tambang Kedalaman {mine.depth} · Bergerak dengan joystick / WASD
        </div>
      )}
    </div>
  );
}

function SprintButton({ api }: { api: UIApi }) {
  const [on, setOn] = useState(false);
  return (
    <button
      onClick={() => {
        const v = !on;
        setOn(v);
        audio.play('click');
        api.getEngine()?.setSprintTouch(v);
      }}
      className={`w-10 h-10 sm:w-11 sm:h-11 rounded-2xl border flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-all shadow-lg ${
        on ? 'bg-emerald-400/30 border-emerald-300/60 text-emerald-200' : 'bg-[#0d1826]/85 border-white/15 text-white/70'
      }`}
      title="Sprint (Shift di PC)"
    >
      <span className="text-[9px] font-black">RUN</span>
      <span className="text-[7px] opacity-70 font-mono">Shift</span>
    </button>
  );
}

function slotQty(me: NonNullable<ReturnType<typeof useHarvestStore.getState>['me']>, itemId: string) {
  return me.inv.filter((i) => i.id === itemId).reduce((s, i) => s + i.qty, 0);
}

function FpsBadge() {
  const show = useHarvestStore((s) => s.settings.showFps);
  const fps = useHarvestStore((s) => s.fps);
  const setFps = useHarvestStore((s) => s.setFps);
  useEffect(() => {
    if (!show) return;
    let count = 0;
    let last = performance.now();
    let raf = 0;
    const loop = () => {
      count++;
      const now = performance.now();
      if (now - last >= 1000) {
        setFps(Math.round((count * 1000) / (now - last)));
        count = 0;
        last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [show, setFps]);
  if (!show) return null;
  return <div className="text-[10px] font-mono text-emerald-300 bg-[#0d1826]/70 rounded px-1.5 py-0.5 border border-white/10">{fps} FPS</div>;
}

function HudButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl border flex items-center justify-center cursor-pointer transition-all active:scale-90 ${
        active ? 'bg-emerald-400/25 border-emerald-300/50 text-emerald-200 shadow-md' : 'bg-[#0d1826]/85 border-white/10 text-white/75 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

// ── Virtual Analog Joystick with Deadzone and Pointer Capture ──
function Joystick({ api, isTablet }: { api: UIApi; isTablet: boolean }) {
  const [active, setActive] = useState(false);
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const pidRef = useRef<number | null>(null);

  const handle = (e: React.PointerEvent, up = false) => {
    const base = baseRef.current;
    if (!base) return;
    const rect = base.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const maxRadius = rect.width / 2.2;
    const dx = up ? 0 : (e.clientX - cx) / maxRadius;
    const dy = up ? 0 : (e.clientY - cy) / maxRadius;
    const len = Math.hypot(dx, dy);

    // Dead zone check (0.08)
    const deadZone = 0.08;
    let nx = 0;
    let ny = 0;
    if (len > deadZone && !up) {
      const mag = Math.min(1, (len - deadZone) / (1 - deadZone));
      nx = (dx / len) * mag;
      ny = (dy / len) * mag;
    }

    if (knobRef.current) {
      knobRef.current.style.transform = `translate(${nx * maxRadius * 0.75}px, ${ny * maxRadius * 0.75}px)`;
    }

    // screen y → world z (up = -z)
    api.move(nx, -ny);
  };

  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    setActive(true);
    pidRef.current = e.pointerId;
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    handle(e);
  };

  const up = (e: React.PointerEvent) => {
    if (pidRef.current !== e.pointerId) return;
    setActive(false);
    pidRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    handle(e, true);
  };

  const cancel = () => {
    setActive(false);
    pidRef.current = null;
    api.move(0, 0);
    if (knobRef.current) knobRef.current.style.transform = 'translate(0,0)';
  };

  const sizeClass = isTablet ? 'w-36 h-36' : 'w-28 h-28 sm:w-32 sm:h-32';
  const knobSizeClass = isTablet ? 'w-16 h-16' : 'w-12 h-12 sm:w-14 sm:h-14';

  return (
    <div
      ref={baseRef}
      onPointerDown={down}
      onPointerMove={(e) => { if (pidRef.current === e.pointerId) handle(e); }}
      onPointerUp={up}
      onPointerCancel={cancel}
      className={`${sizeClass} rounded-full border-2 flex items-center justify-center touch-none cursor-grab active:cursor-grabbing transition-colors select-none ${
        active ? 'bg-emerald-400/20 border-emerald-300/60 shadow-[0_0_20px_rgba(52,211,153,0.3)]' : 'bg-[#0d1826]/75 border-white/20'
      }`}
    >
      <div
        ref={knobRef}
        className={`${knobSizeClass} rounded-full bg-gradient-to-b from-emerald-300 to-emerald-500 shadow-xl border-2 border-white/40 pointer-events-none`}
      />
    </div>
  );
}

// ── Dialogue ──
type NpcAction = { label: string; menu: MenuId } | { label: string; sleep: true } | null;
function npcAction(npcId: string): NpcAction {
  switch (npcId) {
    case 'npc_merch': return { label: 'Buka Toko', menu: 'shop' };
    case 'npc_ren': return { label: 'Tempa Alat', menu: 'upgrade' };
    case 'npc_chef': return { label: 'Masak Makanan', menu: 'cooking' };
    case 'npc_ranch': return { label: 'Beli Hewan', menu: 'rancher' };
    case 'npc_curator': return { label: 'Museum', menu: 'museum' };
    case 'npc_mayor': return { label: 'Tidur / Istirahat', sleep: true };
    default: return null;
  }
}

function DialogBox({ api }: { api: UIApi }) {
  const dialogue = useHarvestStore((s) => s.dialogue);
  const setDialogue = useHarvestStore((s) => s.setDialogue);
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const [giftOpen, setGiftOpen] = useState(false);

  if (!dialogue) return null;
  const npc = defs?.npcs?.find((n) => n.id === dialogue.npcId);
  const action = npcAction(dialogue.npcId);
  const giftItems = (me?.inv || []).filter((i) => {
    const def = defs?.items[i.id];
    return def && def.cat !== 'tool' && def.cat !== 'furniture';
  });

  const doGift = (item: string) => {
    audio.play('gift');
    api.action('gift', { npc: dialogue.npcId, item });
    setGiftOpen(false);
  };

  const close = () => {
    audio.play('close');
    setGiftOpen(false);
    setDialogue(null);
  };

  return (
    <div className="pointer-events-auto absolute bottom-20 left-1/2 -translate-x-1/2 w-[min(94vw,560px)] z-30">
      <div className="rounded-3xl bg-[#0f1a2c]/95 border-2 border-white/15 backdrop-blur-xl shadow-2xl overflow-hidden">
        <div className="p-4 sm:p-5 flex items-start gap-3">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-bold text-white shadow-inner shrink-0"
            style={{ background: npc?.color || '#3b82f6' }}
          >
            {npc?.name?.[0] || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                {npc?.name || 'Penduduk'}
                <span className="text-[10px] text-white/50 font-normal">({npc?.role || 'Warga'})</span>
              </h3>
              <div className="flex items-center gap-0.5 text-pink-400 text-xs">
                {'♥'.repeat(Math.min(10, dialogue.hearts || 0))}
                <span className="text-white/40 text-[10px] ml-1">{dialogue.hearts || 0}/10</span>
              </div>
            </div>
            <div className="mt-2 space-y-1 text-xs text-white/90 leading-relaxed max-h-24 overflow-y-auto">
              {dialogue.lines.map((l, i) => (
                <p key={i}>{l}</p>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white/[0.04] border-t border-white/10 px-4 py-2.5 flex items-center gap-2 flex-wrap">
          {dialogue.canGift && (
            <button
              onClick={() => { audio.play('click'); setGiftOpen(!giftOpen); }}
              className="px-3 py-1.5 rounded-xl bg-pink-500/20 border border-pink-400/40 text-pink-200 text-xs font-bold cursor-pointer hover:bg-pink-500/30 transition-colors"
            >
              🎁 Beri Hadiah
            </button>
          )}
          {action && (
            <button
              onClick={() => {
                audio.play('open');
                if ('sleep' in action && action.sleep) {
                  api.action('sleep', {});
                } else if ('menu' in action) {
                  setMenu(action.menu);
                }
                setDialogue(null);
              }}
              className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-300/30 text-emerald-200 text-xs font-bold cursor-pointer hover:bg-emerald-500/30 transition-colors"
            >
              {action.label}
            </button>
          )}
          <div className="flex-1" />
          <button
            onClick={close}
            className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-white/80 text-xs font-bold cursor-pointer hover:bg-white/20 transition-colors"
          >
            Tutup (Esc)
          </button>
        </div>

        {giftOpen && (
          <div className="border-t border-white/10 px-4 py-3 max-h-32 overflow-y-auto grid grid-cols-3 sm:grid-cols-4 gap-2">
            {giftItems.length === 0 && <p className="col-span-full text-xs text-white/50 italic">Tidak ada item untuk diberikan.</p>}
            {giftItems.map((it) => {
              const def = defs?.items[it.id];
              const like = defs?.likes?.[dialogue.npcId];
              const liked = like?.like.includes(it.id);
              const disliked = like?.dislike.includes(it.id);
              return (
                <button
                  key={it.id}
                  onClick={() => doGift(it.id)}
                  className={`relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 px-1 border cursor-pointer transition-all active:scale-95 ${
                    liked ? 'border-emerald-300/50 bg-emerald-400/10' : disliked ? 'border-red-300/40 bg-red-400/10' : 'border-white/10 bg-white/5 hover:bg-white/10'
                  }`}
                >
                  {def && <img src={makeItemIcon(def.cat, def.color, it.id)} className="w-7 h-7" alt={def.name} />}
                  <span className="text-[9px] text-white/80 truncate w-full text-center">{def?.name || it.id}</span>
                  <span className="text-[8px] text-white/50">x{it.qty}{liked ? ' ❤' : disliked ? ' ✖' : ''}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Public & Private Realtime Chat ──
function ChatPanel({ api }: { api: UIApi }) {
  const chatOpen = useHarvestStore((s) => s.chatOpen);
  const setChatOpen = useHarvestStore((s) => s.setChatOpen);
  const chat = useHarvestStore((s) => s.chat);
  const activeChatTab = useHarvestStore((s) => s.activeChatTab);
  const setActiveChatTab = useHarvestStore((s) => s.setActiveChatTab);
  const unreadPrivate = useHarvestStore((s) => s.unreadPrivate);
  const playersShort = useHarvestStore((s) => s.playersShort);
  const me = useHarvestStore((s) => s.me);
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Filter messages based on active tab
  const filteredChat = useMemo(() => {
    if (activeChatTab === 'public') {
      return chat.filter((c) => c.channel === 'public');
    }
    return chat.filter(
      (c) =>
        c.channel === 'private' &&
        ((c.playerId === activeChatTab && c.targetPlayerId === me?.id) ||
         (c.playerId === me?.id && c.targetPlayerId === activeChatTab))
    );
  }, [chat, activeChatTab, me?.id]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [filteredChat.length, chatOpen, activeChatTab]);

  const send = () => {
    const t = text.trim().slice(0, 200);
    if (!t) return;
    if (activeChatTab === 'public') {
      api.sendChat(t, 'public');
    } else {
      api.sendChat(t, 'private', activeChatTab);
    }
    setText('');
  };

  const otherPlayers = useMemo(() => {
    return Object.values(playersShort).filter((p) => p.id !== me?.id && p.online);
  }, [playersShort, me?.id]);

  if (!chatOpen) {
    if (chat.length === 0) return null;
    const lastMsg = chat[chat.length - 1];
    return (
      <button
        onClick={() => { audio.play('open'); setChatOpen(true); }}
        className="pointer-events-auto absolute bottom-24 left-3 bg-[#0d1826]/85 border border-white/10 rounded-2xl px-3 py-1.5 text-[10px] text-white/80 backdrop-blur cursor-pointer hover:bg-[#0d1826]/95 max-w-[240px] truncate shadow-lg flex items-center gap-1.5"
      >
        {lastMsg.channel === 'private' ? <Lock className="w-3 h-3 text-pink-300 shrink-0" /> : <Globe className="w-3 h-3 text-emerald-300 shrink-0" />}
        <span className="font-bold text-white/90">{lastMsg.name}:</span>
        <span className="truncate">{lastMsg.text}</span>
      </button>
    );
  }

  return (
    <div className="pointer-events-auto absolute bottom-24 left-3 w-[min(88vw,400px)] h-72 rounded-3xl bg-[#0f1a2c]/95 backdrop-blur-xl border border-white/15 shadow-2xl flex flex-col overflow-hidden z-30">
      {/* chat header with channel tabs */}
      <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between bg-white/[0.02]">
        <div className="flex items-center gap-1 overflow-x-auto max-w-[80%] py-0.5">
          <button
            onClick={() => setActiveChatTab('public')}
            className={`px-2.5 py-1 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer ${
              activeChatTab === 'public' ? 'bg-emerald-500 text-emerald-950 shadow-sm' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            <Globe className="w-3 h-3" /> Public
          </button>
          {otherPlayers.map((p) => {
            const unread = unreadPrivate[p.id] || 0;
            return (
              <button
                key={p.id}
                onClick={() => setActiveChatTab(p.id)}
                className={`px-2 py-1 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors cursor-pointer relative shrink-0 ${
                  activeChatTab === p.id ? 'bg-pink-500 text-white shadow-sm' : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}
              >
                <Lock className="w-3 h-3" /> {p.name || 'Pemain'}
                {unread > 0 && (
                  <span className="bg-red-500 text-white text-[8px] font-bold px-1 rounded-full">
                    {unread}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <button
          onClick={() => { audio.play('close'); setChatOpen(false); }}
          className="text-white/50 hover:text-white cursor-pointer p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* chat messages list */}
      <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-2">
        {filteredChat.length === 0 && (
          <p className="text-[11px] text-white/40 italic py-4 text-center">
            {activeChatTab === 'public' ? 'Belum ada pesan public. Sapa dunia! 🌾' : 'Belum ada pesan privat dengan pemain ini.'}
          </p>
        )}
        {filteredChat.map((m) => {
          const isMe = m.playerId === me?.id;
          return (
            <div key={m.id} className={`text-[11px] leading-snug flex flex-col ${isMe ? 'items-end' : 'items-start'}`}>
              <div className="flex items-center gap-1 text-[9px] text-white/40 mb-0.5">
                <span className="font-bold text-emerald-300">{m.name}</span>
                {m.channel === 'private' && <span className="text-pink-300 text-[8px]">🔒 Privat</span>}
                <span>{new Date(m.ts).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}</span>
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-2xl max-w-[85%] break-words ${
                  isMe
                    ? 'bg-emerald-500 text-emerald-950 font-medium rounded-tr-none'
                    : m.channel === 'private'
                    ? 'bg-pink-500/20 border border-pink-400/30 text-white rounded-tl-none'
                    : 'bg-white/10 text-white rounded-tl-none'
                }`}
              >
                {m.text}
              </div>
            </div>
          );
        })}
      </div>

      {/* chat input bar */}
      <div className="p-2 border-t border-white/10 flex gap-1.5 bg-white/[0.02]">
        <input
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 200))}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
          placeholder={activeChatTab === 'public' ? 'Tulis pesan publik...' : 'Pesan pribadi...'}
          className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-300/50"
        />
        <button
          onClick={send}
          className="w-9 h-8 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 flex items-center justify-center cursor-pointer transition-colors shadow-md"
        >
          <Send className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Fishing ──
function FishingUI({ api }: { api: UIApi }) {
  const fishing = useHarvestStore((s) => s.fishing);
  const [pos, setPos] = useState(0);
  const [zone, setZone] = useState<[number, number]>([50, 90]);
  const [done, setDone] = useState<null | 'ok' | 'fail' | 'wait'>(null);
  const rafRef = useRef(0);
  const startRef = useRef(0);

  useEffect(() => {
    const reset = () => {
      cancelAnimationFrame(rafRef.current);
      requestAnimationFrame(() => { setPos(0); setDone(null); });
    };
    if (fishing.phase !== 'bite') {
      reset();
      return () => cancelAnimationFrame(rafRef.current);
    }
    startRef.current = performance.now();
    requestAnimationFrame(() => {
      const zoneShift = Math.random() * 55 - 45;
      setZone([50 + zoneShift, 72 + zoneShift]);
      setDone(null);
    });
    const tick = (now: number) => {
      const p = ((now - startRef.current) / 2600) % 1;
      setPos(p * 100);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    const timeout = setTimeout(() => { setDone('fail'); }, 3200);
    return () => { cancelAnimationFrame(rafRef.current); clearTimeout(timeout); };
  }, [fishing.phase, fishing.biteAt]);

  if (fishing.phase === 'idle') return null;
  if (fishing.phase === 'cast') {
    return (
      <div className="absolute bottom-32 left-1/2 -translate-x-1/2 pointer-events-none bg-[#0d1826]/85 border border-white/10 rounded-full px-4 py-1.5 text-xs text-white/80 animate-pulse shadow-lg">
        🎣 Menunggu ikan menggigit...
      </div>
    );
  }
  const center = zone[0];
  const inZone = pos >= zone[0] && pos <= zone[1];
  const tap = () => {
    if (done) return;
    const dist = Math.abs(pos - center);
    const score = Math.max(0, Math.round(100 - dist * 2.4));
    setDone(score >= 60 ? 'ok' : 'fail');
    api.action('fish_catch', { score });
    setTimeout(() => useHarvestStore.getState().setFishing({ phase: 'idle', startAt: 0, biteAt: 0 }), 900);
  };
  return (
    <div className="absolute bottom-36 sm:bottom-32 left-1/2 -translate-x-1/2 w-[min(88vw,420px)] pointer-events-auto z-30">
      <div className="bg-[#101a2e]/95 border border-white/15 rounded-3xl p-4 shadow-2xl backdrop-blur-xl">
        <p className="text-[10px] text-white/70 mb-2 text-center font-bold tracking-wide">⚡ TAP SAAT MARKER DI ZONA HIJAU!</p>
        <button onClick={tap} className="w-full h-11 rounded-2xl bg-white/5 border border-white/10 relative overflow-hidden cursor-pointer active:scale-98 transition-transform">
          <div className="absolute inset-y-0" style={{ left: `${zone[0]}%`, width: `${zone[1] - zone[0]}%`, background: inZone ? 'rgba(52,211,153,0.5)' : 'rgba(52,211,153,0.18)' }} />
          <div className={`absolute top-0 bottom-0 w-6 -ml-3 rounded-full transition-colors ${inZone ? 'bg-emerald-400 shadow-[0_0_12px_#34d399]' : 'bg-white/70'}`} style={{ left: `${pos}%` }} />
          <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white/80">TAP!</div>
        </button>
        {done === 'ok' && <p className="text-center text-emerald-300 text-xs font-bold mt-2">✨ GHAP! Mantap!</p>}
        {done === 'fail' && <p className="text-center text-red-300 text-xs font-bold mt-2">😢 Ikan kabur!</p>}
      </div>
    </div>
  );
}

// ── Toasts ──
export function Toasts() {
  const toasts = useHarvestStore((s) => s.toasts);
  const dismiss = useHarvestStore((s) => s.dismissToast);
  const colors: Record<string, string> = {
    info: 'bg-sky-500/90 text-sky-950', success: 'bg-emerald-500/90 text-emerald-950',
    warn: 'bg-amber-500/90 text-amber-950', quest: 'bg-violet-500/90 text-violet-50',
    heart: 'bg-pink-500/90 text-pink-50', fish: 'bg-cyan-500/90 text-cyan-950',
    craft: 'bg-orange-500/90 text-orange-50', festival: 'bg-fuchsia-500/90 text-fuchsia-50',
    world: 'bg-indigo-500/90 text-indigo-50', animal: 'bg-lime-500/90 text-lime-950', sleep: 'bg-blue-500/90 text-blue-50',
  };
  return (
    <div className="absolute top-16 sm:top-20 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1.5 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto ${colors[t.kind] || colors.info} text-[11px] font-bold px-3.5 py-1.5 rounded-full shadow-lg animate-[toastIn_0.25s_ease-out] max-w-[80vw] truncate cursor-pointer transition-transform active:scale-95`}
        >
          {t.msg}
        </button>
      ))}
    </div>
  );
}
