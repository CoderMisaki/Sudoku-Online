"use client";
// In-game HUD: top bar, quickbar, touch controls, dialogue, chat, fishing, minimap.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Map as MapIcon, Package, ListChecks, BookOpen, Heart, Settings, Wrench,
  Home as HomeIcon, Users, MessageCircle, X, Coins, Clock, Sun, CloudRain, CloudSnow,
  CloudFog, Wind, Flame, CloudLightning, Zap,
} from 'lucide-react';
import { useHarvestStore } from './store';
import { UIApi, getQuickSlots } from './api';
import { audio } from './audio';
import { makeItemIcon } from './sprites';
import type { MenuId } from './types';
import type { DeviceClass } from './orientation';
import { inputManager } from './input';
import { Joystick } from './Joystick';
import { ChatPanel } from './Chat';

function fmtTime(min: number) {
  const h = Math.floor(min / 60) % 24;
  const m = Math.floor(min % 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
const SEASON_LABEL: Record<string, string> = { spring: 'Musim Semi', summer: 'Musim Panas', autumn: 'Musim Gugur', winter: 'Musim Dingin' };
const WEATHER_ICON: Record<string, { icon: React.ReactNode; label: string }> = {
  sunny: { icon: <Sun className="w-3.5 h-3.5 text-amber-300" />, label: 'Cerah' },
  rain: { icon: <CloudRain className="w-3.5 h-3.5 text-sky-300" />, label: 'Hujan' },
  storm: { icon: <CloudLightning className="w-3.5 h-3.5 text-violet-300" />, label: 'Badai' },
  fog: { icon: <CloudFog className="w-3.5 h-3.5 text-slate-300" />, label: 'Berkabut' },
  snow: { icon: <CloudSnow className="w-3.5 h-3.5 text-blue-200" />, label: 'Salju' },
  wind: { icon: <Wind className="w-3.5 h-3.5 text-emerald-300" />, label: 'Angin' },
  heatwave: { icon: <Flame className="w-3.5 h-3.5 text-orange-400" />, label: 'Panas' },
};

export function HudLayer({ api, device }: { api: UIApi; device: DeviceClass }) {
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
  const festivalBanner = useHarvestStore((s) => s.festivalBanner);
  const conversations = useHarvestStore((s) => s.conversations);
  const unread = useMemo(() => Object.values(conversations).reduce((n, c) => n + c.unread, 0), [conversations]);

  // Touch controls only exist on touch hardware; sizes scale with device class.
  const isTouch = device === 'mobile' || device === 'tablet';
  const btn = device === 'tablet' ? 54 : 46;
  const action = device === 'tablet' ? 96 : 76;

  const weather = WEATHER_ICON[meta.weather] || WEATHER_ICON.sunny;
  const slots = useMemo(() => getQuickSlots(me, defs), [me, defs]);
  const inventoryCount = me ? me.inv.reduce((s, i) => s + i.qty, 0) : 0;

  if (!me) return null;
  return (
    <div className="absolute inset-0 pointer-events-none z-20 font-sans">
      {/* top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-start justify-between gap-2"
        style={{
          padding: '8px',
          paddingTop: 'calc(env(safe-area-inset-top) + 8px)',
          paddingLeft: 'calc(env(safe-area-inset-left) + 8px)',
          paddingRight: 'calc(env(safe-area-inset-right) + 8px)',
        }}
      >
        <div className="flex flex-col gap-1.5 min-w-0">
          <div className="pointer-events-auto flex items-center gap-1.5 bg-[#0d1826]/85 backdrop-blur rounded-2xl px-3 py-1.5 border border-white/10 shadow-lg">
            <Clock className="w-3.5 h-3.5 text-emerald-300" />
            <span className="font-mono font-bold text-sm text-white tabular-nums">{fmtTime(meta.timeMin)}</span>
            <span className="text-white/50 text-[10px] hidden xs:inline">|</span>
            <span className="text-[10px] text-white/70">{SEASON_LABEL[meta.season] || meta.season} · Hari {meta.day}</span>
            <span className="flex items-center gap-1 ml-1 text-[10px] text-white/80">{weather.icon}{weather.label}</span>
          </div>
          <div className="pointer-events-auto flex items-center gap-1.5 bg-[#0d1826]/85 backdrop-blur rounded-2xl px-3 py-1.5 border border-white/10 shadow-lg w-fit max-w-full overflow-hidden">
            <Coins className="w-3.5 h-3.5 text-amber-300 shrink-0" />
            <span className="font-mono font-bold text-white text-sm tabular-nums">{me.gold.toLocaleString('id-ID')}</span>
            <div className="w-28 h-2 rounded-full bg-white/10 overflow-hidden ml-1">
              <div className="h-full rounded-full transition-all duration-500" style={{ width: `${Math.min(100, (me.stamina / me.maxStamina) * 100)}%`, background: me.stamina < 25 ? '#ef4444' : '#34d399' }} />
            </div>
            <span className="text-[10px] text-white/60 tabular-nums w-9">{Math.round(me.stamina)}/{me.maxStamina}</span>
            <Zap className="w-3 h-3 text-emerald-300" />
          </div>
        </div>

        {/* right controls row */}
        <div className="pointer-events-auto flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5 flex-wrap justify-end max-w-[62vw]">
            <span className="text-[10px] text-white/70 bg-[#0d1826]/70 rounded-full px-2 py-1 border border-white/10 hidden sm:inline-flex items-center gap-1">
              <Users className="w-3 h-3 text-emerald-300" /> {Object.keys(playersShort).length} pemain
            </span>
            <HudButton title="Pemain & Pesan" active={menu === 'players'} onClick={() => { audio.play('click'); setMenu(menu === 'players' ? null : 'players'); }}>
              <span className="relative flex items-center justify-center">
                <Users className="w-4 h-4" />
                {unread > 0 && <span className="absolute -top-1.5 -right-1.5 bg-rose-500 text-white text-[8px] font-bold rounded-full min-w-3.5 h-3.5 px-0.5 flex items-center justify-center">{unread}</span>}
              </span>
            </HudButton>
            <HudButton title="Minimap" active={menu === 'map'} onClick={() => { audio.play('click'); setMenu(menu === 'map' ? null : 'map'); }}><MapIcon className="w-4 h-4" /></HudButton>
            <HudButton title="Inventory" active={menu === 'inventory'} onClick={() => { audio.play('click'); setMenu(menu === 'inventory' ? null : 'inventory'); }}><Package className="w-4 h-4" /></HudButton>
            <HudButton title="Quests" onClick={() => { audio.play('click'); setMenu(menu === 'quests' ? null : 'quests'); }}><ListChecks className="w-4 h-4" /></HudButton>
            <HudButton title="Journal" onClick={() => { audio.play('click'); setMenu(menu === 'journal' ? null : 'journal'); }}><BookOpen className="w-4 h-4" /></HudButton>
            <HudButton title="Relationships" onClick={() => { audio.play('click'); setMenu(menu === 'relationships' ? null : 'relationships'); }}><Heart className="w-4 h-4" /></HudButton>
            <HudButton title="Crafting" onClick={() => { audio.play('click'); setMenu(menu === 'crafting' ? null : 'crafting'); }}><Wrench className="w-4 h-4" /></HudButton>
            <HudButton title="House" onClick={() => { audio.play('click'); setMenu(menu === 'house' ? null : 'house'); }}><HomeIcon className="w-4 h-4" /></HudButton>
            <HudButton title="Settings" onClick={() => { audio.play('click'); setMenu(menu === 'settings' ? null : 'settings'); }}><Settings className="w-4 h-4" /></HudButton>
          </div>
          <FpsBadge />
          {status === 'reconnecting' && (
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
        <div className="absolute left-2 top-24 sm:top-28 max-w-[46vw] pointer-events-none space-y-1">
          {me.quests.active.slice(0, 2).map((qid) => {
            const q = defs && Object.values(defs.quests).flat().find((x) => x.id === qid);
            if (!q) return null;
            const prog = q.objectives.map((o, i) => Math.min(o.count, me.quests.progress[`${qid}:${i}`] || 0) === o.count)
              .every((ok) => ok);
            return (
              <div key={qid} className={`bg-[#0d1826]/80 backdrop-blur border rounded-xl px-2.5 py-1.5 text-[10px] shadow-lg border-white/10 ${prog ? 'border-emerald-400/40 text-emerald-200' : 'text-white/85'}`}>
                <div className="font-bold truncate">{q.name}</div>
                <div className="text-white/55 truncate">{q.objectives.map((o, i) => `${Math.min(o.count, me.quests.progress[`${qid}:${i}`] || 0)}/${o.count} ${o.kind}`).join(' · ')}</div>
                {prog && <div className="text-emerald-300 font-bold">✔ Kembali ke papan quest</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* bottom quickbar */}
      <div
        className="absolute left-1/2 -translate-x-1/2 pointer-events-auto max-w-[92vw] overflow-x-auto"
        style={{ bottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
      >
        <div className="flex items-end gap-1.5 bg-[#0d1826]/85 backdrop-blur rounded-2xl p-1.5 border border-white/10 shadow-xl">
          {slots.map((itemId, i) => {
            const def = itemId ? defs?.items?.[itemId] : null;
            const active = itemId && itemId === selectedItem;
            return (
              <button
                key={i}
                disabled={!itemId}
                onClick={() => { if (itemId) { audio.play('click'); api.select(itemId); } }}
                className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl border-2 flex items-center justify-center transition-all cursor-pointer relative ${
                  active ? 'border-emerald-300 bg-emerald-400/20 scale-105 shadow-[0_0_12px_rgba(52,211,153,0.5)]' : 'border-white/15 bg-white/5 hover:bg-white/10'
                } ${!itemId ? 'opacity-30 cursor-default' : ''}`}
                title={def?.name || 'Kosong'}
              >
                {def && itemId && <img src={makeItemIcon(def.cat, def.color, itemId)} alt={def.name} className="w-7 h-7" draggable={false} />}
                {itemId && slotQty(me, itemId) > 1 && <span className="absolute -bottom-1 -right-1 text-[9px] font-bold bg-white/90 text-slate-900 rounded px-0.5">{slotQty(me, itemId)}</span>}
                <span className="absolute -top-1 -left-1 text-[8px] text-white/40">{i + 1}</span>
              </button>
            );
          })}
          <div className="w-px self-stretch bg-white/10 mx-0.5" />
          <button
            onClick={() => { audio.play('click'); api.select(null); api.getEngine()?.setMoveVector(0, 0); setMenu('inventory'); }}
            className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl border-2 border-dashed border-white/25 bg-white/5 hover:bg-white/10 flex flex-col items-center justify-center cursor-pointer transition-all"
            title="Buka Inventory"
          >
            <Package className="w-4 h-4 text-white/70" />
            <span className="text-[8px] text-white/50">{inventoryCount}</span>
          </button>
        </div>
      </div>

      {/* ── Touch controls: only on touch devices. Desktop uses the keyboard. ── */}
      {isTouch && (
        <>
          <div
            className="absolute pointer-events-auto"
            style={{ left: 'calc(env(safe-area-inset-left) + 14px)', bottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}
          >
            <Joystick device={device} />
          </div>

          <div
            className="absolute pointer-events-auto flex items-end gap-2"
            style={{ right: 'calc(env(safe-area-inset-right) + 14px)', bottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}
          >
            <div className="flex flex-col gap-2">
              <TouchButton size={btn} label="Chat" onClick={() => { audio.play('click'); setChatOpen(!chatOpen); }}>
                <MessageCircle style={{ width: btn * 0.42, height: btn * 0.42 }} />
              </TouchButton>
              <TouchButton size={btn} label="Inventory" onClick={() => { audio.play('open'); setMenu(menu === 'inventory' ? null : 'inventory'); }}>
                <Package style={{ width: btn * 0.42, height: btn * 0.42 }} />
              </TouchButton>
            </div>
            <div className="flex flex-col gap-2">
              <TouchButton size={btn} label="Emote" onClick={() => { api.emote('cheer'); audio.play('emote'); }}>
                <span style={{ fontSize: btn * 0.42 }}>🎉</span>
              </TouchButton>
              <TouchButton size={btn} label="Map" onClick={() => { audio.play('open'); setMenu(menu === 'map' ? null : 'map'); }}>
                <MapIcon style={{ width: btn * 0.42, height: btn * 0.42 }} />
              </TouchButton>
            </div>
            <div className="flex flex-col items-center gap-2">
              <SprintButton size={btn} />
              <button
                onPointerDown={(e) => { e.preventDefault(); api.interact(); }}
                aria-label={interaction.label || 'Aksi'}
                className="rounded-full bg-gradient-to-b from-emerald-400 to-emerald-600 border-4 border-emerald-200/40 shadow-[0_4px_16px_rgba(16,185,129,0.45)] flex items-center justify-center cursor-pointer active:scale-95 transition-transform touch-none"
                style={{ width: action, height: action }}
              >
                <span className="text-[9px] font-black text-emerald-950 uppercase tracking-wide leading-tight text-center px-1">
                  {mine ? (interaction.kind === 'exit' ? 'KELUAR' : 'TAMBANG') : (interaction.label || 'Aksi')}
                </span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Desktop keyboard hint */}
      {!isTouch && (
        <div
          className="absolute pointer-events-none text-[10px] text-white/40 bg-[#0d1826]/60 rounded-xl px-2.5 py-1.5 border border-white/8 leading-relaxed"
          style={{ left: 'calc(env(safe-area-inset-left) + 12px)', bottom: 'calc(env(safe-area-inset-bottom) + 12px)' }}
        >
          <b className="text-white/65">WASD</b> / <b className="text-white/65">↑←↓→</b> gerak · <b className="text-white/65">Shift</b> lari · <b className="text-white/65">E</b> aksi<br />
          <b className="text-white/65">I</b> inventory · <b className="text-white/65">M</b> peta · <b className="text-white/65">Enter</b> chat
        </div>
      )}

      {/* fishing UI */}
      <FishingUI api={api} />

      {/* dialogue */}
      <DialogBox api={api} />

      {/* chat */}
      <ChatPanel api={api} device={device} />

      {/* mine info */}
      {mine && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-[#0d1826]/85 border border-white/10 rounded-2xl px-4 py-2 text-white text-xs font-bold shadow-lg">
          ⛏ Tambang Kedalaman {mine.depth} · Bergerak dengan joystick / WASD
        </div>
      )}
    </div>
  );
}

/** Sprint toggle. Reflects and drives the shared InputManager, never the engine directly. */
function SprintButton({ size }: { size: number }) {
  const [on, setOn] = useState(() => inputManager.getTouchSprint());
  return (
    <button
      onClick={() => {
        const v = !on;
        setOn(v);
        audio.play('click');
        inputManager.setTouchSprint(v);
      }}
      aria-pressed={on}
      aria-label="Sprint"
      className={`rounded-2xl border flex flex-col items-center justify-center cursor-pointer active:scale-95 transition-all touch-none ${
        on ? 'bg-emerald-400/30 border-emerald-300/60 text-emerald-200' : 'bg-[#0d1826]/85 border-white/15 text-white/70'
      }`}
      style={{ width: size, height: size }}
    >
      <span className="text-[9px] font-black">RUN</span>
    </button>
  );
}

/** Generic touch HUD button with a comfortable tap target. */
function TouchButton({ size, label, onClick, children }: { size: number; label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-2xl bg-[#0d1826]/85 border border-white/15 text-white/80 flex items-center justify-center cursor-pointer active:scale-95 transition-transform touch-none"
      style={{ width: size, height: size }}
    >
      {children}
    </button>
  );
}

function slotQty(me: NonNullable<ReturnType<typeof useHarvestStore.getState>['me']>, itemId: string) {
  const slot = me.inv.find((i) => i.id === itemId);
  return slot ? slot.qty : 0;
}

function FpsBadge() {
  const show = useHarvestStore((s) => s.settings.showFps);
  const [fps, setFps] = useState(60);
  useEffect(() => {
    if (!show) return;
    let frames = 0;
    let last = performance.now();
    let raf = 0;
    const loop = () => {
      frames += 1;
      const now = performance.now();
      if (now - last >= 1000) { setFps(frames); frames = 0; last = now; }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [show]);
  if (!show) return null;
  return (
    <span className={`text-[10px] font-mono font-bold px-2 py-1 rounded-full border ${fps >= 50 ? 'bg-emerald-500/90 text-emerald-950 border-emerald-300' : fps >= 30 ? 'bg-amber-500/90 text-amber-950 border-amber-300' : 'bg-red-500/90 text-white border-red-300'}`}>
      {fps} FPS
    </span>
  );
}

function HudButton({ children, title, onClick, active }: { children: React.ReactNode; title: string; onClick: () => void; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`w-9 h-9 rounded-xl border flex items-center justify-center cursor-pointer transition-all active:scale-90 ${
        active ? 'bg-emerald-400/25 border-emerald-300/50 text-emerald-200' : 'bg-[#0d1826]/85 border-white/10 text-white/75 hover:bg-white/10'
      }`}
    >
      {children}
    </button>
  );
}

// ── Dialogue ──
type NpcAction = { label: string; menu: MenuId } | { label: string; sleep: true } | null;
function npcAction(npcId: string): NpcAction {
  switch (npcId) {
    case 'npc_merch': return { label: '🛒 Toko', menu: 'shop' };
    case 'npc_ren': return { label: '⚒ Tempa Alat', menu: 'upgrade' };
    case 'npc_chef': return { label: '🍲 Masak', menu: 'cooking' };
    case 'npc_ranch': return { label: '🐄 Beli Hewan', menu: 'rancher' };
    case 'npc_curator': return { label: '🏛 Museum', menu: 'museum' };
    case 'npc_elder': return { label: '🛏 Tidur', sleep: true };
    default: return null;
  }
}

function DialogBox({ api }: { api: UIApi }) {
  const dialogue = useHarvestStore((s) => s.dialogue);
  const setDialogue = useHarvestStore((s) => s.setDialogue);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  const [giftOpen, setGiftOpen] = useState(false);

  if (!dialogue) return null;
  const npc = defs?.npcs.find((n) => n.id === dialogue.npcId);
  const action = npcAction(dialogue.npcId);
  const giftItems = me?.inv.filter((i) => (defs?.items[i.id]?.cat === 'forage' || defs?.items[i.id]?.cat === 'crop' || defs?.items[i.id]?.cat === 'fish' || defs?.items[i.id]?.cat === 'meal')) || [];
  const doGift = (item: string) => {
    if (!me || !me.inv.some((i) => i.id === item && i.qty >= 1)) return;
    api.action('gift', { npc: dialogue.npcId, item });
    setGiftOpen(false);
    setDialogue(null);
  };
  const close = () => { audio.play('close'); setGiftOpen(false); setDialogue(null); };
  return (
    <div className="absolute bottom-24 sm:bottom-28 left-1/2 -translate-x-1/2 w-[min(92vw,560px)] pointer-events-auto">
      <div className="bg-[#101a2e]/95 backdrop-blur border border-white/15 rounded-2xl shadow-2xl overflow-hidden">
        <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full" style={{ background: npc?.color || '#8b5cf6' }} />
            <span className="font-bold text-white text-sm">{npc?.name || 'NPC'}</span>
            <span className="text-[10px] text-white/50">♥ {dialogue.hearts}/10</span>
          </div>
          <button onClick={close} className="text-white/50 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
        </div>
        <div className="px-4 py-3 space-y-1.5 max-h-28 overflow-y-auto">
          {dialogue.lines.map((line, i) => (
            <p key={i} className="text-white/85 text-sm leading-snug">{line}</p>
          ))}
        </div>
        <div className="px-4 pb-3 flex flex-wrap gap-2">
          {dialogue.heartGain > 0 && <span className="text-[10px] text-pink-300 bg-pink-400/10 rounded-full px-2 py-1">+{dialogue.heartGain} ♥</span>}
          {dialogue.canGift && (
            <button onClick={() => { audio.play('open'); setGiftOpen(!giftOpen); }} className="px-3 py-1.5 rounded-xl bg-pink-500/20 border border-pink-300/30 text-pink-200 text-xs font-bold cursor-pointer hover:bg-pink-500/30 transition-colors">
              🎁 Beri Hadiah
            </button>
          )}
          {action && (
            <button
              onClick={() => {
                audio.play('open');
                if ('sleep' in action) {
                  if (action.sleep) api.action('sleep', {});
                } else {
                  setMenu(action.menu);
                }
                setDialogue(null);
              }}
              className="px-3 py-1.5 rounded-xl bg-emerald-500/20 border border-emerald-300/30 text-emerald-200 text-xs font-bold cursor-pointer hover:bg-emerald-500/30 transition-colors"
            >
              {action.label}
            </button>
          )}
          {dialogue.canShop && (
            <button onClick={close} className="px-3 py-1.5 rounded-xl bg-white/10 border border-white/15 text-white/80 text-xs font-bold cursor-pointer hover:bg-white/20 transition-colors">
              Sampai jumpa!
            </button>
          )}
          <div className="flex-1" />
          <span className="text-[9px] text-white/35 self-center">Klik untuk menutup dialog (Esc)</span>
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
                <button key={it.id} onClick={() => doGift(it.id)} className={`relative flex flex-col items-center gap-0.5 rounded-xl py-1.5 px-1 border cursor-pointer transition-all active:scale-95 ${liked ? 'border-emerald-300/50 bg-emerald-400/10' : disliked ? 'border-red-300/40 bg-red-400/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}>
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

// ── Fishing ──
function FishingUI({ api }: { api: UIApi }) {
  const fishing = useHarvestStore((s) => s.fishing);
  const [pos, setPos] = useState(0);
  const [zone, setZone] = useState<[number, number]>([50, 90]);
  const [done, setDone] = useState<null | 'ok' | 'fail' | 'wait'>(null);
  const rafRef = useRef(0);
  const startRef = useRef(0);
  useEffect(() => {
    // All state pushes happen inside async callbacks (rAF/timeout) to avoid
    // synchronous setState cascades.
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
      <div className="absolute bottom-32 left-1/2 -translate-x-1/2 pointer-events-none bg-[#0d1826]/85 border border-white/10 rounded-full px-4 py-1.5 text-xs text-white/80 animate-pulse">
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
    <div className="absolute bottom-36 sm:bottom-32 left-1/2 -translate-x-1/2 w-[min(88vw,420px)] pointer-events-auto">
      <div className="bg-[#101a2e]/95 border border-white/15 rounded-2xl p-3 shadow-2xl">
        <p className="text-[10px] text-white/70 mb-1.5 text-center font-bold tracking-wide">⚡ TAP SAAT MARKER DI ZONA HIJAU!</p>
        <button onClick={tap} className="w-full h-10 rounded-xl bg-white/5 border border-white/10 relative overflow-hidden cursor-pointer">
          <div className="absolute inset-y-0" style={{ left: `${zone[0]}%`, width: `${zone[1] - zone[0]}%`, background: inZone ? 'rgba(52,211,153,0.5)' : 'rgba(52,211,153,0.18)' }} />
          <div className={`absolute top-0 bottom-0 w-6 -ml-3 rounded-full transition-colors ${inZone ? 'bg-emerald-400' : 'bg-white/70'}`} style={{ left: `${pos}%` }} />
          <div className="absolute inset-0 flex items-center justify-center text-[10px] text-white/60">TAP!</div>
        </button>
        {done === 'ok' && <p className="text-center text-emerald-300 text-xs font-bold mt-1.5">✨ GHAP! Mantap!</p>}
        {done === 'fail' && <p className="text-center text-red-300 text-xs font-bold mt-1.5">😢 Ikan kabur!</p>}
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
    <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1.5 pointer-events-none">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto ${colors[t.kind] || colors.info} text-[11px] font-bold px-3 py-1.5 rounded-full shadow-lg animate-[toastIn_0.25s_ease-out] max-w-[80vw] truncate cursor-pointer`}
        >
          {t.msg}
        </button>
      ))}
    </div>
  );
}


