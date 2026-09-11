"use client";
// All game menu panels: inventory, map, quests, journal, relationships, skills,
// crafting, cooking, house, shop, rancher, upgrade, community, museum, festival, help, settings.
import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  X, Minus, Plus, ChevronRight, MapPin, ZoomIn, ZoomOut, RotateCcw,
  Package, MessageCircle, Sparkles, Check, Trash2, ArrowRightLeft,
} from 'lucide-react';
import { useHarvestStore } from './store';
import { UIApi } from './api';
import { audio } from './audio';
import { makeItemIcon, rleDecode } from './sprites';
import { MenuId, TILE } from './types';

export function Menus({ api }: { api: UIApi }) {
  const menu = useHarvestStore((s) => s.menu);
  const setMenu = useHarvestStore((s) => s.setMenu);
  if (!menu) return null;

  const isMap = menu === 'map';

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center p-2 sm:p-4 pointer-events-auto select-none">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={() => { audio.play('close'); setMenu(null); }}
      />
      <div
        className={`relative ${
          isMap ? 'w-[min(96vw,960px)] h-[min(92dvh,700px)]' : 'w-[min(96vw,780px)] max-h-[92dvh]'
        } overflow-hidden rounded-3xl bg-[#0f1a2c]/98 border border-white/15 shadow-2xl flex flex-col`}
      >
        <MenuHeader menu={menu} onClose={() => { audio.play('close'); setMenu(null); }} />
        <div className={`flex-1 overflow-y-auto ${isMap ? 'p-2 sm:p-3 overflow-hidden flex flex-col' : 'p-3 sm:p-4'}`}>
          <MenuContent menu={menu} api={api} />
        </div>
      </div>
    </div>
  );
}

const TITLES: Record<string, string> = {
  inventory: 'Inventory & Ransel',
  map: 'Peta Dunia Realtime',
  quests: 'Quest & Misi',
  journal: 'Koleksi & Journal',
  relationships: 'Hubungan & Pemain',
  skills: 'Skill & Keahlian',
  crafting: 'Crafting & Perkakas',
  cooking: 'Dapur & Masakan',
  settings: 'Pengaturan Game',
  house: 'Rumah & Furnitur',
  shop: 'Toko Desa Fen',
  rancher: 'Ranch & Hewan Ternak',
  upgrade: 'Tempa Alat Ren',
  community: 'Proyek Komunitas',
  museum: 'Museum Sejarah',
  festival: 'Festival & Acara',
  help: 'Panduan & Bantuan',
};

function MenuHeader({ menu, onClose }: { menu: MenuId; onClose: () => void }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/[0.03]">
      <h2 className="font-bold text-white text-sm sm:text-base tracking-wide flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-emerald-400" />
        {TITLES[menu || 'help'] || 'Menu'}
      </h2>
      <button
        onClick={onClose}
        className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white/70 hover:text-white cursor-pointer transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function MenuContent({ menu, api }: { menu: MenuId; api: UIApi }) {
  switch (menu) {
    case 'inventory': return <InventoryPanel api={api} />;
    case 'map': return <MapPanel api={api} />;
    case 'quests': return <QuestsPanel api={api} />;
    case 'journal': return <JournalPanel />;
    case 'relationships': return <RelationshipsPanel api={api} />;
    case 'skills': return <SkillsPanel />;
    case 'crafting': return <RecipePanel api={api} kind="craft" />;
    case 'cooking': return <RecipePanel api={api} kind="cook" />;
    case 'settings': return <SettingsPanel api={api} />;
    case 'house': return <HousePanel api={api} />;
    case 'shop': return <ShopPanel api={api} />;
    case 'rancher': return <RancherPanel api={api} />;
    case 'upgrade': return <UpgradePanel api={api} />;
    case 'community': return <CommunityPanel api={api} />;
    case 'museum': return <MuseumPanel />;
    case 'festival': return <FestivalPanel />;
    case 'help': return <HelpPanel />;
    default: return null;
  }
}

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'ok' | 'lack' | 'default' }) {
  const cls =
    tone === 'ok'
      ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/30'
      : tone === 'lack'
      ? 'bg-red-400/10 text-red-300 border-red-300/20'
      : 'bg-white/5 text-white/70 border-white/10';
  return <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${cls}`}>{children}</span>;
}

// ── Inventory Panel with Categories, Inspector & Actions ──
type InvCategory = 'all' | 'tool' | 'seed' | 'crop' | 'fish' | 'mineral' | 'forage' | 'meal' | 'furniture' | 'misc';

const CATEGORY_TABS: { id: InvCategory; label: string }[] = [
  { id: 'all', label: 'Semua' },
  { id: 'tool', label: 'Alat' },
  { id: 'seed', label: 'Benih' },
  { id: 'crop', label: 'Tanaman' },
  { id: 'fish', label: 'Ikan' },
  { id: 'mineral', label: 'Mining' },
  { id: 'forage', label: 'Material' },
  { id: 'meal', label: 'Makanan' },
  { id: 'furniture', label: 'Furnitur' },
  { id: 'misc', label: 'Lainnya' },
];

function InventoryPanel({ api }: { api: UIApi }) {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  const prices = useHarvestStore((s) => s.prices);
  const selectedItem = useHarvestStore((s) => s.selectedItem);
  const setSelectedItem = useHarvestStore((s) => s.setSelectedItem);
  const toast = useHarvestStore((s) => s.toast);

  const [activeCat, setActiveCat] = useState<InvCategory>('all');
  const [inspectedId, setInspectedId] = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop] = useState(false);

  const inv = me?.inv;
  const defsItems = defs?.items;

  const filteredSlots = useMemo(() => {
    if (!inv || !defsItems) return [];
    return inv.filter((it) => {
      const def = defsItems[it.id];
      if (!def) return false;
      if (activeCat === 'all') return true;
      if (activeCat === 'misc') {
        return ['special', 'fert', 'bait', 'insect'].includes(def.cat);
      }
      return def.cat === activeCat;
    });
  }, [inv, defsItems, activeCat]);

  if (!me || !defs) return null;

  const currentInspected = inspectedId ? me.inv.find((i) => i.id === inspectedId) : null;
  const inspectedDef = inspectedId ? defs.items[inspectedId] : null;

  const handleSelectOrEquip = (id: string) => {
    setSelectedItem(id);
    api.select(id);
    audio.play('click');
    toast('info', `${defs.items[id]?.name || id} dipilih untuk digunakan.`);
  };

  const handleEat = (id: string) => {
    api.action('eat', { item: id });
    audio.play('cook');
  };

  const handleSplit = (id: string) => {
    api.action('split', { item: id });
    audio.play('click');
  };

  const handleDrop = (id: string) => {
    api.action('drop', { item: id, qty: 1 });
    audio.play('close');
    setConfirmDrop(false);
  };

  return (
    <div className="space-y-3">
      {/* categories tab bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
        {CATEGORY_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { audio.play('click'); setActiveCat(tab.id); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap cursor-pointer transition-colors ${
              activeCat === tab.id
                ? 'bg-emerald-500 text-emerald-950 shadow-sm'
                : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="grid md:grid-cols-[1fr_260px] gap-3">
        {/* inventory grid */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] text-white/50">
            <span>Kapasitas Ransel: <b className="text-white/80">{me.inv.length}/{me.invMax}</b></span>
            <span>Maks Stack: <b>99 pcs</b></span>
          </div>
          <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-6 gap-2 max-h-72 overflow-y-auto p-1">
            {filteredSlots.map((it) => {
              const def = defs.items[it.id];
              if (!def) return null;
              const isSelected = selectedItem === it.id;
              const isInspected = inspectedId === it.id;
              return (
                <button
                  key={it.id}
                  onClick={() => {
                    audio.play('click');
                    setInspectedId(it.id);
                    setConfirmDrop(false);
                  }}
                  className={`relative flex flex-col items-center gap-1 rounded-2xl border p-2 cursor-pointer transition-all active:scale-95 ${
                    isInspected
                      ? 'bg-emerald-400/25 border-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.4)]'
                      : isSelected
                      ? 'bg-emerald-400/10 border-emerald-300/40'
                      : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.09]'
                  }`}
                  title={def.name}
                >
                  <img src={makeItemIcon(def.cat, def.color, it.id)} alt={def.name} className="w-8 h-8" draggable={false} />
                  <span className="text-[9px] text-white/80 truncate w-full text-center">{def.name}</span>
                  <span className="text-[9px] text-white/50 font-mono">x{it.qty}</span>
                  {isSelected && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400" />
                  )}
                </button>
              );
            })}
            {filteredSlots.length === 0 && (
              <p className="col-span-full py-8 text-center text-xs text-white/40 italic">
                Kategori ini masih kosong.
              </p>
            )}
          </div>
        </div>

        {/* item inspector / action panel */}
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex flex-col justify-between">
          {inspectedDef && currentInspected ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  <img src={makeItemIcon(inspectedDef.cat, inspectedDef.color, currentInspected.id)} className="w-9 h-9" alt="" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="font-bold text-sm text-white truncate">{inspectedDef.name}</h4>
                  <p className="text-[10px] text-emerald-300 capitalize">{inspectedDef.cat}</p>
                </div>
              </div>

              <div className="space-y-1 text-[11px] text-white/70 bg-white/[0.02] rounded-xl p-2 border border-white/5">
                <div className="flex justify-between">
                  <span className="text-white/40">Jumlah:</span>
                  <span className="font-mono font-bold text-white">{currentInspected.qty} pcs</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Harga Beli:</span>
                  <span className="font-mono text-amber-300">{prices[currentInspected.id]?.buy || inspectedDef.value} G</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/40">Harga Jual:</span>
                  <span className="font-mono text-emerald-300">{prices[currentInspected.id]?.sell || Math.round(inspectedDef.value * 0.6)} G</span>
                </div>
                {inspectedDef.buff && (
                  <div className="text-[10px] text-sky-300 pt-1 border-t border-white/5">
                    +{inspectedDef.buff.stam} Stamina ({inspectedDef.buff.duration}d)
                  </div>
                )}
              </div>

              {/* Action buttons */}
              <div className="space-y-1.5 pt-1">
                {inspectedDef.cat === 'meal' ? (
                  <button
                    onClick={() => handleEat(currentInspected.id)}
                    className="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Makan / Pulihkan Stamina
                  </button>
                ) : (
                  <button
                    onClick={() => handleSelectOrEquip(currentInspected.id)}
                    className="w-full py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" /> Pilih / Gunakan
                  </button>
                )}

                {currentInspected.qty > 1 && (
                  <button
                    onClick={() => handleSplit(currentInspected.id)}
                    className="w-full py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5 border border-white/10"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" /> Pisahkan Stack
                  </button>
                )}

                {inspectedDef.cat !== 'tool' && (
                  <div>
                    {!confirmDrop ? (
                      <button
                        onClick={() => setConfirmDrop(true)}
                        className="w-full py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-red-300 font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5 border border-red-400/20"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Buang Item
                      </button>
                    ) : (
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleDrop(currentInspected.id)}
                          className="flex-1 py-1.5 rounded-xl bg-red-500 hover:bg-red-400 text-white font-bold text-xs cursor-pointer"
                        >
                          Yakin Buang?
                        </button>
                        <button
                          onClick={() => setConfirmDrop(false)}
                          className="px-2 py-1.5 rounded-xl bg-white/10 text-white/70 text-xs font-bold cursor-pointer"
                        >
                          Batal
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center p-4 text-white/40 space-y-1">
              <Package className="w-8 h-8 opacity-30" />
              <p className="text-xs">Klik salah satu item untuk melihat detail dan aksi.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Interactive Realtime World Map ──
const MAP_COLORS: Record<number, string> = {
  [TILE.grass]: '#5a9942',
  [TILE.path]: '#a3845b',
  [TILE.soil]: '#7d4a25',
  [TILE.water]: '#2e75b6',
  [TILE.sand]: '#d9c28f',
  [TILE.rock]: '#7a7a82',
  [TILE.forest]: '#3b692e',
  [TILE.flower]: '#8cb859',
  [TILE.mountain]: '#736b63',
  [TILE.plaza]: '#b8a691',
};

function MapPanel({ api }: { api: UIApi }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const terrainCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  const meta = useHarvestStore((s) => s.worldMeta);
  const playersShort = useHarvestStore((s) => s.playersShort);

  const [zoom, setZoom] = useState(1.8);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });

  const worldState = api.getEngine()?.getWorldState() || null;
  const W = worldState?.size[0] || 224;
  const H = worldState?.size[1] || 224;

  // Render static terrain once into offscreen canvas
  useEffect(() => {
    if (!worldState?.tileRLE) return;
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const ctx = off.getContext('2d');
    if (!ctx) return;

    const grid = rleDecode(worldState.tileRLE, W * H);
    const imgData = ctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const tile = grid[i];
      const hex = MAP_COLORS[tile] || '#000000';
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      imgData.data[i * 4] = r;
      imgData.data[i * 4 + 1] = g;
      imgData.data[i * 4 + 2] = b;
      imgData.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);

    // Draw static landmarks (Farm boundaries, Village Center, Mine Door, Bridge, Pier)
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1;
    ctx.strokeRect(worldState.farmArea.x0, worldState.farmArea.y0, worldState.farmArea.x1 - worldState.farmArea.x0, worldState.farmArea.y1 - worldState.farmArea.y0);

    terrainCanvasRef.current = off;
  }, [worldState?.tileRLE, W, H, worldState?.farmArea]);

  // Center pan on player
  const centerOnPlayer = useCallback(() => {
    if (!me || !containerRef.current) return;
    const cw = containerRef.current.clientWidth;
    const ch = containerRef.current.clientHeight;
    setPan({
      x: cw / 2 - me.x * zoom,
      y: ch / 2 - me.y * zoom,
    });
  }, [me, zoom]);

  useEffect(() => {
    centerOnPlayer();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drag pan handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.2 : -0.2;
    setZoom((z) => Math.max(0.8, Math.min(4.0, z + delta)));
  };

  // Realtime Render Loop
  useEffect(() => {
    let raf = 0;
    const render = () => {
      const cv = canvasRef.current;
      const host = containerRef.current;
      if (!cv || !host) return;

      if (cv.width !== host.clientWidth || cv.height !== host.clientHeight) {
        cv.width = host.clientWidth;
        cv.height = host.clientHeight;
      }

      const ctx = cv.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, cv.width, cv.height);

      ctx.save();
      ctx.translate(pan.x, pan.y);
      ctx.scale(zoom, zoom);

      // 1. Draw static cached terrain
      if (terrainCanvasRef.current) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(terrainCanvasRef.current, 0, 0);
      }

      // 2. Draw Landmarks & POIs
      if (worldState) {
        ctx.font = '6px sans-serif';
        ctx.textAlign = 'center';

        // Farm Area
        ctx.fillText('🌾 Farm', worldState.farmArea.x0 + 12, worldState.farmArea.y0 + 10);
        // Village Square
        ctx.fillText('🏘 Plaza Desa', worldState.villageCenter.x, worldState.villageCenter.y);
        // Mine Entrance
        ctx.fillText('⛏ Tambang', worldState.mineDoor.x, worldState.mineDoor.y - 2);
        // Bridge
        ctx.fillText('🌉 Jembatan', worldState.bridge.x, worldState.bridge.y - 2);
        // Secret Grove
        ctx.fillText('🌸 Secret Grove', 110, 35);
        // Beach Pier
        ctx.fillText('🏖 Pantai & Dermaga', 180, 190);

        // Festival Marker if active
        if (meta.festival.active) {
          const t = Date.now() / 300;
          const pulse = Math.sin(t) * 2;
          ctx.fillStyle = 'rgba(217, 70, 239, 0.4)';
          ctx.beginPath();
          ctx.arc(worldState.villageCenter.x, worldState.villageCenter.y, 8 + pulse, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#f472b6';
          ctx.fillText('🎪 FESTIVAL!', worldState.villageCenter.x, worldState.villageCenter.y - 8);
        }
      }

      // 3. Draw NPCs
      if (defs?.npcs) {
        for (const def of defs.npcs) {
          const npcState = worldState?.npcs?.[def.id];
          const nx = npcState?.x ?? def.home[0];
          const ny = npcState?.y ?? def.home[1];

          ctx.fillStyle = def.color || '#a855f7';
          ctx.beginPath();
          ctx.arc(nx, ny, 2, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#ffffff';
          ctx.font = '4.5px sans-serif';
          ctx.fillText(def.name, nx, ny - 3);
        }
      }

      // 4. Draw Remote Players
      const remotePlayers = api.getEngine()?.getRemotePositions() || [];
      for (const p of remotePlayers) {
        if (p.id === me?.id) continue;
        ctx.fillStyle = '#f59e0b';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 0.5;
        ctx.stroke();

        ctx.fillStyle = '#fef08a';
        ctx.font = 'bold 5px sans-serif';
        ctx.fillText(p.name || 'Pemain', p.x, p.y - 4);
      }

      // 5. Draw Own Player (Distinct Pulsing Marker)
      const myPos = api.getEngine()?.getMyPos() || (me ? { x: me.x, y: me.y, dir: me.dir } : null);
      if (myPos) {
        const t = Date.now() / 250;
        const pulse = Math.sin(t) * 1.5;

        // Halo
        ctx.fillStyle = 'rgba(56, 189, 248, 0.35)';
        ctx.beginPath();
        ctx.arc(myPos.x, myPos.y, 4.5 + pulse, 0, Math.PI * 2);
        ctx.fill();

        // Marker core
        ctx.fillStyle = '#0284c7';
        ctx.beginPath();
        ctx.arc(myPos.x, myPos.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Heading Direction Pointer
        const rad = myPos.dir === 0 ? -Math.PI / 2 : myPos.dir === 1 ? 0 : myPos.dir === 2 ? Math.PI / 2 : Math.PI;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(myPos.x + Math.cos(rad) * 5, myPos.y + Math.sin(rad) * 5);
        ctx.lineTo(myPos.x + Math.cos(rad + 2.4) * 2.5, myPos.y + Math.sin(rad + 2.4) * 2.5);
        ctx.lineTo(myPos.x + Math.cos(rad - 2.4) * 2.5, myPos.y + Math.sin(rad - 2.4) * 2.5);
        ctx.closePath();
        ctx.fill();

        // Player Name Label
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 5.5px sans-serif';
        ctx.fillText(`Kamu (${me?.username || 'Player'})`, myPos.x, myPos.y - 6);
      }

      ctx.restore();
      raf = requestAnimationFrame(render);
    };

    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [pan, zoom, worldState, me, defs, meta, playersShort, api]);

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      <div
        ref={containerRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={handleWheel}
        className="flex-1 w-full rounded-2xl overflow-hidden border border-white/10 bg-[#070d18] relative touch-none cursor-grab active:cursor-grabbing shadow-inner min-h-[300px]"
      >
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full block" />

        {/* Map overlay controls */}
        <div className="absolute top-3 right-3 flex flex-col gap-1.5 pointer-events-auto">
          <button
            onClick={() => setZoom((z) => Math.min(4.0, z + 0.3))}
            className="w-9 h-9 rounded-xl bg-[#0f1a2c]/90 border border-white/20 text-white flex items-center justify-center hover:bg-white/10 cursor-pointer shadow-lg"
            title="Zoom In"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => setZoom((z) => Math.max(0.8, z - 0.3))}
            className="w-9 h-9 rounded-xl bg-[#0f1a2c]/90 border border-white/20 text-white flex items-center justify-center hover:bg-white/10 cursor-pointer shadow-lg"
            title="Zoom Out"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <button
            onClick={centerOnPlayer}
            className="w-9 h-9 rounded-xl bg-emerald-500 text-emerald-950 font-bold flex items-center justify-center hover:bg-emerald-400 cursor-pointer shadow-lg"
            title="Pusatkan ke Karakter"
          >
            <MapPin className="w-4 h-4" />
          </button>
          <button
            onClick={() => { setZoom(1.8); centerOnPlayer(); }}
            className="w-9 h-9 rounded-xl bg-[#0f1a2c]/90 border border-white/20 text-white flex items-center justify-center hover:bg-white/10 cursor-pointer shadow-lg"
            title="Reset Peta"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        {/* Legend bar */}
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-1 text-[10px] text-white/70 bg-[#0f1a2c]/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 pointer-events-none">
          <span>🔵 Kamu</span> · <span>🟠 Pemain Lain</span> · <span>🟣 Warga Desa</span> · <span>🌾 Farm</span> · <span>🏘 Plaza</span> · <span>⛏ Tambang</span> · <span>🏖 Pantai</span>
        </div>
      </div>
    </div>
  );
}

// ── Quests Panel ──
function QuestsPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const [tab, setTab] = useState<'active' | 'board'>('active');

  if (!defs || !me) return null;
  const allDefs = Object.values(defs.quests).flat();
  const active = me.quests.active.map((id) => allDefs.find((q) => q.id === id)).filter(Boolean);
  const available = allDefs.filter(
    (q) => !me.quests.active.includes(q.id) && !me.quests.done.includes(q.id) && !q.id.startsWith('main_') && !q.id.startsWith('hidden_')
  );

  const progressDone = (q: NonNullable<(typeof allDefs)[number]>) =>
    q.objectives.every((o, i) => Math.min(o.count, me.quests.progress[`${q.id}:${i}`] || 0) >= o.count);

  const accept = (id: string) => { api.action('quest_accept', { qid: id }); audio.play('quest'); };
  const turnin = (id: string) => { api.action('quest_turnin', { qid: id }); audio.play('quest'); };

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['active', 'board'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { audio.play('click'); setTab(t); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
              tab === t ? 'bg-emerald-500 text-emerald-950 shadow-sm' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {t === 'active' ? `Aktif (${active.length})` : 'Papan Quest'}
          </button>
        ))}
      </div>

      {tab === 'active' ? (
        <div className="space-y-2">
          {active.length === 0 && <p className="text-xs text-white/45 italic">Tidak ada quest aktif. Cek papan quest di village! (ikon 📋)</p>}
          {active.map((q) => {
            const isDone = progressDone(q!);
            return (
              <div key={q!.id} className={`rounded-2xl border p-3 ${isDone ? 'border-emerald-300/40 bg-emerald-400/[0.07]' : 'border-white/10 bg-white/[0.03]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-white text-sm">{q!.name}</h3>
                    <p className="text-[11px] text-white/60">{q!.desc}</p>
                  </div>
                  {isDone && (
                    <button onClick={() => turnin(q!.id)} className="shrink-0 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs font-bold cursor-pointer transition-colors">
                      Klaim Reward
                    </button>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {q!.objectives.map((o, i) => {
                    const cur = Math.min(o.count, me.quests.progress[`${q!.id}:${i}`] || 0);
                    return <Chip key={i} tone={cur >= o.count ? 'ok' : 'default'}>{o.kind}: {cur}/{o.count}</Chip>;
                  })}
                  <Chip>+{q!.reward.gold} G</Chip>
                  {q!.reward.items && Object.entries(q!.reward.items).map(([it, n]) => <Chip key={it}>+{n} {defs.items[it]?.name || it}</Chip>)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {available.length === 0 && <p className="text-xs text-white/45 italic">Semua quest NPC sudah diambil. Selesaikan & berinteraksi dengan villager untuk quest baru.</p>}
          {available.map((q) => (
            <div key={q!.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="font-bold text-white text-sm">{q!.name}</h3>
                <p className="text-[11px] text-white/60 truncate">{q!.desc}</p>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {q!.objectives.map((o, i) => <Chip key={i}>{o.kind} ×{o.count}</Chip>)}
                  <Chip>+{q!.reward.gold} G</Chip>
                </div>
              </div>
              <button onClick={() => accept(q!.id)} className="shrink-0 px-3 py-1.5 rounded-xl bg-violet-500/80 hover:bg-violet-400 text-white text-xs font-bold cursor-pointer transition-colors flex items-center gap-1">
                Terima <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
          <button onClick={() => setMenu('community')} className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/80 text-xs font-bold cursor-pointer transition-colors">
            🤝 Quest komunitas → Proyek Komunitas
          </button>
        </div>
      )}
    </div>
  );
}

// ── Journal ──
function JournalPanel() {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  const [tab, setTab] = useState<'crops' | 'fish' | 'minerals' | 'insects' | 'recipes' | 'animals'>('crops');

  if (!defs || !me) return null;
  const cats: Record<string, { ids: string[]; got: number }> = {
    crops: { ids: Object.keys(defs.crops), got: Object.keys(me.journal.crops || {}).length },
    fish: { ids: defs.fish.map((f) => f.id), got: Object.keys(me.journal.fish || {}).length },
    minerals: { ids: Object.keys(defs.items).filter((i) => defs.items[i].cat === 'mineral'), got: Object.keys(me.journal.minerals || {}).length },
    insects: { ids: Object.keys(defs.items).filter((i) => defs.items[i].cat === 'insect'), got: Object.keys(me.journal.insects || {}).length },
    recipes: { ids: defs.recipes.map((r) => r.id), got: Object.keys(me.journal.recipes || {}).length },
    animals: { ids: ['cow', 'chicken', 'sheep', 'goat', 'horse', 'cat', 'dog'], got: Object.keys(me.journal.animals || {}).length },
  };

  const list =
    tab === 'fish'
      ? defs.fish.map((f) => ({ id: f.id, name: f.name, cat: 'fish', color: f.color }))
      : tab === 'recipes'
      ? defs.recipes.map((r) => ({ id: r.id, name: r.name, cat: 'recipe', color: '#f2c94c' }))
      : tab === 'animals'
      ? [['cow', 'Cow'], ['chicken', 'Chicken'], ['sheep', 'Sheep'], ['goat', 'Goat'], ['horse', 'Horse'], ['cat', 'Cat'], ['dog', 'Dog']].map(([id, name]) => ({ id, name, cat: 'animal', color: '#e8e0d4' }))
      : Object.entries(defs.items)
          .filter(([, it]) => (tab === 'crops' ? it.cat === 'crop' : it.cat === 'mineral' || it.cat === 'insect'))
          .map(([itId, it]) => ({ id: itId, name: it.name, cat: it.cat, color: it.color }));

  const gotSet = new Set(
    tab === 'crops'
      ? Object.keys(me.journal.crops || {})
      : tab === 'fish'
      ? Object.keys(me.journal.fish || {})
      : tab === 'minerals'
      ? Object.keys(me.journal.minerals || {})
      : tab === 'insects'
      ? Object.keys(me.journal.insects || {})
      : tab === 'recipes'
      ? Object.keys(me.journal.recipes || {})
      : Object.keys(me.journal.animals || {})
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(['crops', 'fish', 'minerals', 'insects', 'recipes', 'animals'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { audio.play('click'); setTab(t); }}
            className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer capitalize transition-colors ${
              tab === t ? 'bg-emerald-500 text-emerald-950 shadow-sm' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {t} {cats[t].got}/{cats[t].ids.length}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {list.map((it) => {
          const got = gotSet.has(it.id);
          return (
            <div
              key={it.id}
              className={`rounded-xl border p-1.5 flex flex-col items-center gap-1 ${
                got ? 'border-emerald-300/40 bg-emerald-400/[0.06]' : 'border-white/10 bg-white/[0.02] opacity-60'
              }`}
            >
              <img src={makeItemIcon(it.cat === 'recipe' ? 'meal' : it.cat, it.color, it.id)} className="w-8 h-8" alt={it.name} />
              <span className="text-[9px] text-white/75 text-center leading-tight truncate w-full">{got ? it.name : '???'}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-white/45">Museum Tilly menghitung koleksimu — bawa temuan langka ke desa untuk pameran! 🏛</p>
    </div>
  );
}

// ── Relationships & Players Panel ──
function RelationshipsPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const playersShort = useHarvestStore((s) => s.playersShort);
  const setActiveChatTab = useHarvestStore((s) => s.setActiveChatTab);
  const setChatOpen = useHarvestStore((s) => s.setChatOpen);
  const setMenu = useHarvestStore((s) => s.setMenu);

  const [tab, setTab] = useState<'npcs' | 'players'>('npcs');
  const [sel, setSel] = useState<string | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);

  if (!defs || !me) return null;

  const npcs = defs.npcs;
  const selDef = defs.npcs.find((n) => n.id === sel);
  const likes = sel ? defs.likes[sel] : null;
  const rel = sel ? me.rel[sel] : null;
  const giftItems = me.inv.filter((i) => ['forage', 'crop', 'fish', 'meal', 'insect'].includes(defs.items[i.id]?.cat || ''));

  const onlinePlayers = Object.values(playersShort).filter((p) => p.id !== me.id);

  const startPrivateChat = (playerId: string) => {
    setActiveChatTab(playerId);
    setChatOpen(true);
    setMenu(null);
    audio.play('click');
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button
          onClick={() => { audio.play('click'); setTab('npcs'); }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
            tab === 'npcs' ? 'bg-emerald-500 text-emerald-950 shadow-sm' : 'bg-white/5 text-white/60 hover:bg-white/10'
          }`}
        >
          Warga Desa ({npcs.length})
        </button>
        <button
          onClick={() => { audio.play('click'); setTab('players'); }}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
            tab === 'players' ? 'bg-emerald-500 text-emerald-950 shadow-sm' : 'bg-white/5 text-white/60 hover:bg-white/10'
          }`}
        >
          Pemain Lain ({onlinePlayers.length})
        </button>
      </div>

      {tab === 'npcs' ? (
        <div className="grid sm:grid-cols-[220px_1fr] gap-3">
          <div className="space-y-1.5 max-h-72 overflow-y-auto">
            {npcs.map((n) => {
              const r = me.rel[n.id];
              const candidate = ['npc_mae', 'npc_lu', 'npc_iris', 'npc_art'].includes(n.id);
              return (
                <button
                  key={n.id}
                  onClick={() => { audio.play('click'); setSel(n.id); setGiftOpen(false); }}
                  className={`w-full text-left rounded-xl border px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors ${
                    sel === n.id ? 'border-emerald-300/50 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: n.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-white truncate">
                      {n.name} {me.spouse === n.id && <span className="text-pink-300">💍</span>} {candidate && <span className="text-[9px] text-violet-300">Kandidat</span>}
                    </p>
                    <p className="text-[10px] text-white/50">{n.role}</p>
                  </div>
                  <div className="text-[10px] text-pink-300 shrink-0">♥{r?.hearts || 0}/10</div>
                </button>
              );
            })}
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            {!selDef ? (
              <p className="text-xs text-white/45 italic">Pilih villager untuk melihat detail. Ngobrol setiap hari & beri hadiah untuk menaikkan hati.</p>
            ) : (
              <div className="space-y-3">
                <div>
                  <h3 className="font-bold text-white">{selDef.name} — {selDef.role}</h3>
                  <p className="text-[11px] text-white/55">♥ {rel?.hearts || 0}/10 {me.spouse === selDef.id && '· Pasanganmu 💍'}</p>
                  <div className="mt-1 h-2 rounded-full bg-white/10 overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-pink-400 to-rose-400 transition-all" style={{ width: `${(rel?.hearts || 0) * 10}%` }} />
                  </div>
                </div>
                {likes && (
                  <div className="flex flex-wrap gap-1.5">
                    {likes.like.slice(0, 4).map((it) => <Chip key={it} tone="ok">Suka: {defs.items[it]?.name || it}</Chip>)}
                    {likes.dislike.slice(0, 3).map((it) => <Chip key={it} tone="lack">Tidak suka: {defs.items[it]?.name || it}</Chip>)}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => { audio.play('open'); setGiftOpen(!giftOpen); }} className="px-3 py-1.5 rounded-xl bg-pink-500/20 border border-pink-300/30 text-pink-200 text-xs font-bold cursor-pointer hover:bg-pink-500/30 transition-colors">
                    🎁 Beri Hadiah
                  </button>
                  {!me.spouse && ['npc_mae', 'npc_lu', 'npc_iris', 'npc_art'].includes(selDef.id) && (rel?.hearts || 0) >= 8 && (
                    <button onClick={() => { api.action('propose', { npc: selDef.id }); audio.play('gift'); }} className="px-3 py-1.5 rounded-xl bg-violet-500/30 border border-violet-300/40 text-violet-200 text-xs font-bold cursor-pointer hover:bg-violet-500/40 transition-colors animate-pulse">
                      💍 Lamar!
                    </button>
                  )}
                  {me.spouse === selDef.id && <Chip tone="ok">Spouse memberimu hadiah pagi ☀</Chip>}
                </div>
                {giftOpen && (
                  <div className="grid grid-cols-4 sm:grid-cols-5 gap-2 pt-1">
                    {giftItems.length === 0 && <p className="col-span-full text-[11px] text-white/45 italic">Tidak ada item untuk hadiah.</p>}
                    {giftItems.map((it) => (
                      <button key={it.id} onClick={() => { api.action('gift', { npc: selDef.id, item: it.id }); setGiftOpen(false); audio.play('gift'); }} className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-1.5 flex flex-col items-center cursor-pointer transition-colors">
                        <img src={makeItemIcon(defs.items[it.id].cat, defs.items[it.id].color, it.id)} className="w-7 h-7" alt="" />
                        <span className="text-[9px] text-white/70 mt-0.5">x{it.qty}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {onlinePlayers.length === 0 && (
            <p className="text-xs text-white/45 italic py-6 text-center">
              Belum ada pemain lain yang terhubung ke world ini.
            </p>
          )}
          {onlinePlayers.map((p) => (
            <div key={p.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className={`w-2.5 h-2.5 rounded-full ${p.online ? 'bg-emerald-400 animate-pulse' : 'bg-white/20'}`} />
                <div>
                  <h4 className="font-bold text-sm text-white">{p.name || 'Pemain'}</h4>
                  <p className="text-[10px] text-white/50">{p.online ? 'Online di world' : 'Offline'}</p>
                </div>
              </div>
              <button
                onClick={() => startPrivateChat(p.id)}
                className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow-sm transition-colors"
              >
                <MessageCircle className="w-3.5 h-3.5" /> Kirim Pesan Pribadi
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Skills Panel ──
function SkillsPanel() {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  if (!me || !defs) return null;

  const PERKS: Record<string, string[]> = {
    farming: ['Lv2: pupuk otomatis di alat Lv3+', 'Lv4: panen kadang 2x', 'Lv5: mutasi Golden Leaf lebih sering'],
    fishing: ['Level menambah skor tangkapan', 'Rod Lv+ menaikkan peluang'],
    mining: ['Lv+ membuka kedalaman lebih dalam', 'Pickaxe Lv+ untuk ore langka'],
    cooking: ['Lv5: Energy Tonic', 'Masakan berkualitas = buff lebih lama'],
    crafting: ['Membuka resep alat & furnitur', 'Lv3: Kitchen & Workbench'],
    foraging: ['Lv+ spawn langka lebih sering', 'Chop & petik lebih hemat stamina'],
    animal: ['Hewan lebih bahagia', 'Breeding ayam lebih sering'],
    social: ['Dialog memberi lebih banyak hati', 'Quest reward lebih besar'],
    exploration: ['Membuka petunjuk rahasia di peta'],
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {Object.entries(me.skills).map(([id, sk]) => {
        const curLevelXp = 40 * Math.pow(sk.level, 1.7);
        const need = 40 * Math.pow(sk.level + 1, 1.7);
        const pct = Math.min(100, Math.round(((sk.xp - 0) / (need - curLevelXp + 1)) * 100));
        return (
          <div key={id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-white">{defs.skills[id] || id}</span>
              <span className="text-[10px] font-bold text-emerald-300">Lv {sk.level}</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div className="h-full bg-emerald-400/80 transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-[10px] text-white/45 mt-1">{sk.xp}/{Math.round(need)} XP</p>
            <ul className="mt-1.5 space-y-0.5">
              {(PERKS[id] || []).slice(0, 3).map((p, i) => (
                <li key={i} className="text-[10px] text-white/55">· {p}</li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ── Recipe Panel (Crafting / Cooking) ──
function RecipePanel({ api, kind }: { api: UIApi; kind: 'craft' | 'cook' }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const meta = useHarvestStore((s) => s.worldMeta);
  const [showLocked, setShowLocked] = useState(false);

  if (!defs || !me) return null;
  const recipes = defs.recipes.filter((r) => r.kind === kind);
  const shown = showLocked ? recipes : recipes.filter((r) => (me.skills[r.unlock.skill]?.level || 0) >= r.unlock.level);

  const make = (id: string) => {
    api.action(kind === 'craft' ? 'craft' : 'cook', { recipe: id });
    audio.play(kind === 'craft' ? 'craft' : 'cook');
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] text-white/50">{kind === 'craft' ? 'Rakit alat, furnitur & pupuk.' : 'Masak makanan untuk stamina & buff.'}</p>
        <button
          onClick={() => { audio.play('click'); setShowLocked(!showLocked); }}
          className="px-2.5 py-1 rounded-xl bg-white/5 text-white/60 text-[10px] font-bold cursor-pointer hover:bg-white/10"
        >
          {showLocked ? 'Sembunyikan terkunci' : 'Tampilkan semua'}
        </button>
      </div>
      <div className="space-y-2">
        {shown.map((r) => {
          const outDef = defs.items[r.out];
          const needOk = Object.entries(r.needs).every(([it, n]) => (me.inv.find((i) => i.id === it)?.qty || 0) >= n);
          const lvOk = (me.skills[r.unlock.skill]?.level || 0) >= r.unlock.level;
          const enabled = needOk && lvOk;
          const lacks: string[] = [];
          if (!lvOk) lacks.push(`Butuh ${defs.skills[r.unlock.skill]} Lv ${r.unlock.level}`);
          if (!needOk) Object.entries(r.needs).forEach(([it, n]) => { const have = me.inv.find((i) => i.id === it)?.qty || 0; if (have < n) lacks.push(`${defs.items[it]?.name || it} ${have}/${n}`); });
          return (
            <div key={r.id} className={`rounded-2xl border p-3 flex items-center gap-3 ${enabled ? 'border-emerald-300/30 bg-emerald-400/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}>
              <div className="shrink-0">
                <img src={makeItemIcon(outDef.cat === 'seed' ? 'seed' : outDef.cat, outDef.color, r.out)} className="w-10 h-10" alt="" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white">{r.name} {r.rare && <span className="text-[9px] text-amber-300">★LANGKA</span>}</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(r.needs).map(([it, n]) => {
                    const have = me.inv.find((i) => i.id === it)?.qty || 0;
                    return <Chip key={it} tone={have >= n ? 'ok' : 'lack'}>{defs.items[it]?.name || it} {have}/{n}</Chip>;
                  })}
                </div>
                {lacks.length > 0 && <p className="text-[10px] text-red-300/80 mt-1">{lacks.join(' · ')}</p>}
              </div>
              <button
                onClick={() => make(r.id)}
                disabled={!enabled}
                className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
                  enabled ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950' : 'bg-white/5 text-white/30 cursor-not-allowed'
                }`}
              >
                {kind === 'craft' ? 'Craft' : 'Masak'}
              </button>
            </div>
          );
        })}
        {shown.length === 0 && <p className="text-xs text-white/45 italic">Belum ada resep terbuka. Naikkan level skill.</p>}
      </div>
      {kind === 'cook' && (
        <p className="text-[11px] text-white/45">Memasak bisa dilakukan di dapur rumah (Kitchen) atau di dekat Chef Coral desa.</p>
      )}
      {kind === 'craft' && (
        <p className="text-[11px] text-white/45">Alat & furnitur bisa dibuat di dekat Blacksmith Ren atau dari Workbench rumahmu. Musim: {meta.season}</p>
      )}
    </div>
  );
}

// ── Settings Panel ──
function SettingsPanel({ api }: { api: UIApi }) {
  const settings = useHarvestStore((s) => s.settings);
  const setSettings = useHarvestStore((s) => s.setSettings);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const [confirmLeave, setConfirmLeave] = useState(false);

  return (
    <div className="space-y-4">
      <Row label="Musik">
        <input type="range" min={0} max={1} step={0.05} value={settings.music} onChange={(e) => { const v = Number(e.target.value); setSettings({ music: v }); audio.setMusicVolume(v); }} className="w-40 accent-emerald-400 cursor-pointer" />
      </Row>
      <Row label="SFX">
        <input type="range" min={0} max={1} step={0.05} value={settings.sfx} onChange={(e) => { const v = Number(e.target.value); setSettings({ sfx: v }); audio.setSfxVolume(v); audio.play('click'); }} className="w-40 accent-emerald-400 cursor-pointer" />
      </Row>
      <Row label="Kualitas Grafik">
        <div className="flex gap-1.5">
          {(['high', 'low'] as const).map((q) => (
            <button key={q} onClick={() => { audio.play('click'); setSettings({ quality: q }); api.getEngine()?.setQuality(q); }} className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${settings.quality === q ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-white/60'}`}>
              {q === 'high' ? 'Tinggi 🔥' : 'Hemat Daya'}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Indikator FPS">
        <button onClick={() => { audio.play('click'); setSettings({ showFps: !settings.showFps }); }} className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${settings.showFps ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-white/60'}`}>
          {settings.showFps ? 'Aktif' : 'Mati'}
        </button>
      </Row>
      <button onClick={() => { audio.play('click'); setMenu('help'); }} className="w-full px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 text-xs font-bold cursor-pointer border border-white/10 transition-colors">
        🎮 Panduan Kontrol & Tips Bermain
      </button>
      <div className="pt-2 border-t border-white/10">
        {!confirmLeave ? (
          <button onClick={() => { audio.play('warn'); setConfirmLeave(true); }} className="px-4 py-2 rounded-xl bg-red-500/15 border border-red-400/30 text-red-300 text-xs font-bold cursor-pointer hover:bg-red-500/25 transition-colors">
            Keluar dari World
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-white/60">Yakin keluar? Progress tersimpan otomatis di server.</span>
            <button onClick={() => api.leave()} className="px-3 py-1.5 rounded-xl bg-red-500 text-white text-xs font-bold cursor-pointer">Ya, keluar</button>
            <button onClick={() => { audio.play('close'); setConfirmLeave(false); setMenu(null); }} className="px-3 py-1.5 rounded-xl bg-white/10 text-white/80 text-xs font-bold cursor-pointer">Batal</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-bold text-white/80">{label}</span>
      {children}
    </div>
  );
}

// ── House Panel ──
function HousePanel({ api }: { api: UIApi }) {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  const [placeOpen, setPlaceOpen] = useState(false);

  if (!me || !defs) return null;
  const house = me.house;
  const cap = 4 + house.level * 4;
  const furItems = me.inv.filter((i) => defs.items[i.id]?.cat === 'furniture');

  const upgrade = () => { api.action('house_upgrade', {}); audio.play('craft'); };
  const place = (item: string) => { api.action('place', { item, x: 0, y: 0 }); audio.play('craft'); setPlaceOpen(false); };
  const remove = (id: string) => { api.action('remove_furn', { id }); audio.play('close'); };

  const gold = 500 + house.level * 400;
  const wood = 15 + house.level * 10;
  const stone = 8 + house.level * 6;
  const hasKitchen = house.furniture.some((f) => f.item === 'furn_kitchen');
  const hasBench = house.furniture.some((f) => f.item === 'furn_bench');
  const hasBed = house.furniture.some((f) => f.item === 'furn_bed');
  const canUp = me.gold >= gold && (me.inv.find((i) => i.id === 'wood')?.qty || 0) >= wood && (me.inv.find((i) => i.id === 'stone')?.qty || 0) >= stone;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-bold text-white text-sm">🏠 {me.farmName || 'Farm'} — Lv {house.level}</h3>
            <p className="text-[11px] text-white/55">Furnitur {house.furniture.length}/{cap} · Kapasitas inventory {me.invMax} slot</p>
          </div>
          <button
            onClick={upgrade}
            disabled={house.level >= 4}
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
              house.level >= 4 ? 'bg-white/5 text-white/30 cursor-not-allowed' : canUp ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 cursor-pointer' : 'bg-white/10 text-white/50 cursor-pointer'
            }`}
          >
            {house.level >= 4 ? 'MAX' : `Upgrade ${gold}G + ${wood} kayu + ${stone} batu`}
          </button>
        </div>
        {house.level < 4 && !canUp && <p className="text-[10px] text-amber-300/80 mt-1">Butuh: {gold}G ({me.gold}) · kayu {wood} · batu {stone}</p>}
        <p className="text-[10px] text-white/45 mt-1.5">
          {hasBed ? '🛏 Tidur di rumah dimungkinkan.' : '🛏 Belum ada bed — tidur di penginapan Elder Ash.'} {hasKitchen ? '🍲 Dapur mudah diakses.' : ''} {hasBench ? '🛠 Workbench siap.' : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => { audio.play('open'); setPlaceOpen(!placeOpen); }} className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-bold cursor-pointer hover:bg-emerald-500/25 transition-colors">
          + Tempatkan Furnitur ({furItems.length} tersedia)
        </button>
      </div>

      {placeOpen && (
        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {furItems.length === 0 && <p className="col-span-full text-[11px] text-white/45 italic">Craft furnitur dulu (Workbench / Ren).</p>}
          {furItems.map((it) => (
            <button key={it.id} onClick={() => place(it.id)} className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 p-2 flex flex-col items-center cursor-pointer transition-colors">
              <img src={makeItemIcon('furniture', defs.items[it.id].color, it.id)} className="w-8 h-8" alt="" />
              <span className="text-[9px] text-white/70 mt-1">{defs.items[it.id].name}</span>
              <span className="text-[8px] text-white/45">x{it.qty}</span>
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1.5">
        <p className="text-[11px] font-bold text-white/70">Dalam rumah ({house.furniture.length}):</p>
        {house.furniture.length === 0 && <p className="text-[11px] text-white/40 italic">Rumah masih kosong. Tempatkan furnitur.</p>}
        {house.furniture.map((f) => (
          <div key={f.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5">
            <span className="text-[11px] text-white/80 flex items-center gap-2">
              <img src={makeItemIcon('furniture', defs.items[f.item]?.color || '#999', f.item)} className="w-5 h-5" alt="" />
              {defs.items[f.item]?.name || f.item}
            </span>
            <div className="flex gap-1.5">
              {f.item === 'furn_kitchen' && <button onClick={() => { audio.play('open'); useHarvestStore.getState().setMenu('cooking'); }} className="px-2 py-1 rounded-lg bg-white/10 text-white/70 text-[10px] font-bold cursor-pointer hover:bg-white/20">Masak</button>}
              {f.item === 'furn_bench' && <button onClick={() => { audio.play('open'); useHarvestStore.getState().setMenu('crafting'); }} className="px-2 py-1 rounded-lg bg-white/10 text-white/70 text-[10px] font-bold cursor-pointer hover:bg-white/20">Craft</button>}
              {f.item === 'furn_bed' && <button onClick={() => { api.action('sleep', {}); audio.play('sleep'); }} className="px-2 py-1 rounded-lg bg-white/10 text-white/70 text-[10px] font-bold cursor-pointer hover:bg-white/20">Tidur</button>}
              {f.item === 'furn_chest' && <span className="px-2 py-1 rounded-lg bg-emerald-400/10 text-emerald-300 text-[10px] font-bold">+Kapasitas</span>}
              <button onClick={() => remove(f.id)} className="px-2 py-1 rounded-lg bg-red-400/10 text-red-300 text-[10px] font-bold cursor-pointer hover:bg-red-400/20">Hapus</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Shop Panel ──
function ShopPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const prices = useHarvestStore((s) => s.prices);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState<Record<string, number>>({});

  if (!defs || !me) return null;
  const buyIds = Object.keys(prices).filter((id) => ['seed', 'fert', 'bait'].includes(defs.items[id]?.cat || ''));
  const sellIds = me.inv
    .map((i) => i.id)
    .filter((id) => defs.items[id]?.cat !== 'tool' && defs.items[id]?.cat !== 'furniture' && defs.items[id]?.cat !== 'seed');

  const buy = (id: string) => {
    const n = qty[id] || 1;
    api.action('buy', { item: id, qty: n });
    audio.play('buy');
  };

  const sell = (id: string) => {
    const n = Math.min(qty[id] || 1, me.inv.find((i) => i.id === id)?.qty || 1);
    api.action('sell', { item: id, qty: n });
    audio.play('sell');
  };

  const qtyPicker = (id: string, max = 99) => (
    <div className="flex items-center gap-1">
      <button
        onClick={() => { audio.play('click'); setQty((q) => ({ ...q, [id]: Math.max(1, (q[id] || 1) - 1) })); }}
        className="w-6 h-6 rounded-lg bg-white/10 text-white/70 flex items-center justify-center cursor-pointer hover:bg-white/20"
      >
        <Minus className="w-3 h-3" />
      </button>
      <span className="text-[11px] font-bold text-white w-6 text-center">{qty[id] || 1}</span>
      <button
        onClick={() => { audio.play('click'); setQty((q) => ({ ...q, [id]: Math.min(max, (q[id] || 1) + 1) })); }}
        className="w-6 h-6 rounded-lg bg-white/10 text-white/70 flex items-center justify-center cursor-pointer hover:bg-white/20"
      >
        <Plus className="w-3 h-3" />
      </button>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-white/55">Harga dinamis — supply & demand harian mengubah harga pasar!</p>
        <span className="text-xs font-bold text-amber-300">Gold: {me.gold.toLocaleString('id-ID')} G</span>
      </div>
      <div className="flex gap-1.5">
        {(['buy', 'sell'] as const).map((t) => (
          <button
            key={t}
            onClick={() => { audio.play('click'); setTab(t); }}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
              tab === t ? 'bg-emerald-500 text-emerald-950 shadow-sm' : 'bg-white/5 text-white/60 hover:bg-white/10'
            }`}
          >
            {t === 'buy' ? 'Beli Barang (Fen)' : `Jual Hasil Panen (${sellIds.length})`}
          </button>
        ))}
      </div>

      {tab === 'buy' ? (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {buyIds.map((id) => {
            const def = defs.items[id];
            const price = prices[id]?.buy || 0;
            const cost = price * (qty[id] || 1);
            const canAfford = me.gold >= cost;
            const owned = me.inv.find((i) => i.id === id)?.qty || 0;
            return (
              <div key={id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <img src={makeItemIcon(def.cat, def.color, id)} className="w-8 h-8" alt="" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {def.name} <span className="text-[9px] text-amber-300 font-mono">({price} G)</span>
                  </p>
                  <p className="text-[9px] text-white/45">Dimiliki: {owned} pcs</p>
                </div>
                {qtyPicker(id, 99)}
                <button
                  onClick={() => buy(id)}
                  disabled={!canAfford}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-bold shrink-0 transition-colors ${
                    canAfford ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 cursor-pointer shadow-sm' : 'bg-white/5 text-white/30 cursor-not-allowed'
                  }`}
                >
                  Beli {cost}G
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
          {sellIds.length === 0 && (
            <p className="text-[11px] text-white/45 italic py-6 text-center">
              Tidak ada item yang bisa dijual saat ini. Panen tanaman, tangkap ikan, atau tambang mineral terlebih dahulu!
            </p>
          )}
          {sellIds.map((id) => {
            const def = defs.items[id];
            const price = prices[id]?.sell || 0;
            const owned = me.inv.find((i) => i.id === id)?.qty || 1;
            const currentQty = Math.min(qty[id] || 1, owned);
            const cost = price * currentQty;
            return (
              <div key={id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <img src={makeItemIcon(def.cat, def.color, id)} className="w-8 h-8" alt="" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">
                    {def.name} <span className="text-white/50">×{owned}</span>
                  </p>
                  <p className="text-[9px] text-amber-300 font-mono">{price} G / pcs</p>
                </div>
                {qtyPicker(id, owned)}
                <button
                  onClick={() => sell(id)}
                  className="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 text-[11px] font-bold shrink-0 cursor-pointer shadow-sm transition-colors"
                >
                  Jual +{cost}G
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Rancher Panel ──
function RancherPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  if (!defs || !me) return null;

  const maxAnimals = 4 + me.house.level * 3;

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-white/55">Briar menjual hewan ternak. Rawat hewanmu, beri makan, dan petik hasilnya setiap hari! 🐣</p>
      <div className="grid sm:grid-cols-2 gap-2">
        {Object.entries(defs.animals).map(([type, a]) => {
          const owned = me.animals.filter((x) => x.type === type).length;
          const canBuy = me.gold >= a.price && me.animals.length < maxAnimals;
          return (
            <div key={type} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white">{a.name} <span className="text-[9px] text-white/45">(kamu punya {owned})</span></span>
                <span className="text-[10px] text-amber-300 font-bold">G {a.price}</span>
              </div>
              <p className="text-[10px] text-white/55 mt-0.5">{a.product ? `Hasil: ${defs.items[a.product]?.name}` : 'Hewan peliharaan (sahabat)'} · tiap {a.produceDays || '—'} hari</p>
              <button
                onClick={() => { api.action('buy_animal', { type }); audio.play('buy'); }}
                disabled={!canBuy}
                className={`mt-2 w-full px-3 py-1.5 rounded-xl text-[11px] font-bold ${
                  canBuy ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 cursor-pointer shadow-sm' : 'bg-white/5 text-white/30 cursor-not-allowed'
                }`}
              >
                {me.animals.length >= maxAnimals ? `Kandang penuh (${me.animals.length}/${maxAnimals})` : me.gold < a.price ? 'Gold kurang' : 'Beli'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-white/45">Hewan kamu: {me.animals.length}/{maxAnimals} · Pet & Feed lewat tombol Aksi di dekat hewan.</p>
      <div className="space-y-1.5 max-h-40 overflow-y-auto">
        {me.animals.map((an) => {
          const def = defs.animals[an.type];
          return (
            <div key={an.id} className="flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px]">
              <span className="text-white/80 font-bold">{def?.name} &quot;{an.name}&quot; <span className="text-white/40 font-normal">({an.personality})</span></span>
              <span className="flex gap-2 text-[10px]">
                <span className={an.hunger > 70 ? 'text-red-300' : 'text-emerald-300'}>🍽 {Math.round(an.hunger)}</span>
                <span className={an.happiness < 40 ? 'text-red-300' : 'text-lime-300'}>♥ {Math.round(an.happiness)}</span>
                <span className="text-white/50">hari {an.ageDays}</span>
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Tool Upgrade Panel ──
function UpgradePanel({ api }: { api: UIApi }) {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  if (!me || !defs) return null;

  const tools = ['tool_hoe', 'tool_can', 'tool_sickle', 'tool_axe', 'tool_pick', 'tool_rod', 'tool_net'];

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-white/55">Ren menempa perkakas menjadi lebih efisien dan kuat untuk menembus tambang dalam.</p>
      {tools.map((tool) => {
        const lvl = me.toolLevels[tool] || 1;
        const cost = Math.round(150 * Math.pow(1.8, lvl - 1));
        const ore = lvl >= 4 ? 'gem_sapphire' : lvl >= 3 ? 'ore_gold' : 'ore_iron';
        const have = me.inv.find((i) => i.id === ore)?.qty || 0;
        const can = me.gold >= cost && have >= lvl && lvl < 5;
        return (
          <div key={tool} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
            <img src={makeItemIcon('tool', defs.items[tool]?.color || '#c08a4e', tool)} className="w-8 h-8" alt="" />
            <div className="flex-1">
              <p className="text-xs font-bold text-white">{defs.items[tool]?.name}</p>
              <div className="flex gap-1 mt-0.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <span key={i} className={`w-4 h-1.5 rounded-full ${i < lvl ? 'bg-emerald-400' : 'bg-white/10'}`} />
                ))}
              </div>
            </div>
            {lvl >= 5 ? (
              <span className="text-[10px] text-emerald-300 font-bold">MAX</span>
            ) : (
              <button
                onClick={() => { api.action('upgrade_tool', { tool }); audio.play('craft'); }}
                disabled={!can}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-bold shrink-0 transition-colors ${
                  can ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 cursor-pointer shadow-sm' : 'bg-white/5 text-white/35 cursor-not-allowed'
                }`}
              >
                {cost}G + {lvl}× {defs.items[ore]?.name} ({have})
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Community Projects ──
function CommunityPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const community = useHarvestStore((s) => s.worldMeta.community);
  const [open, setOpen] = useState<string | null>(null);

  if (!defs || !me) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-white/55">Semua pemain berkontribusi material — saat target tercapai, perubahan nyata muncul di dunia! 🌉</p>
      {defs.projects.map((p) => {
        const st = community?.[p.id];
        const done = st?.done || false;
        const contrib = st?.contributions || {};
        const isOpen = open === p.id;
        return (
          <div key={p.id} className={`rounded-2xl border p-3 ${done ? 'border-emerald-300/50 bg-emerald-400/[0.07]' : 'border-white/10 bg-white/[0.03]'}`}>
            <button onClick={() => { audio.play('click'); setOpen(isOpen ? null : p.id); }} className="w-full flex items-center justify-between cursor-pointer">
              <div className="text-left">
                <p className="text-xs font-bold text-white">{done ? '✅' : '📋'} {p.name}</p>
                <p className="text-[10px] text-white/50">{p.desc}</p>
              </div>
              <ChevronRight className={`w-4 h-4 text-white/40 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
            </button>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(p.needs).map(([it, need]) => (
                <Chip key={it} tone={(contrib[it] || 0) >= need ? 'ok' : 'default'}>{defs.items[it]?.name}: {contrib[it] || 0}/{need}</Chip>
              ))}
            </div>
            {isOpen && !done && (
              <div className="mt-2 space-y-1.5">
                {Object.entries(p.needs).map(([it]) => {
                  const have = me.inv.find((i) => i.id === it)?.qty || 0;
                  return (
                    <div key={it} className="flex items-center gap-2">
                      <span className="text-[10px] text-white/65 flex-1">{defs.items[it]?.name} ({have} punya)</span>
                      <button
                        onClick={() => { api.action('contribute', { project: p.id, item: it, qty: Math.min(5, Math.max(1, have)) }); audio.play('craft'); }}
                        disabled={have <= 0}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${
                          have > 0 ? 'bg-emerald-500/80 text-emerald-950 cursor-pointer shadow-sm' : 'bg-white/5 text-white/30 cursor-not-allowed'
                        }`}
                      >
                        +1
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Museum Panel ──
function MuseumPanel() {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  if (!me || !defs) return null;

  const totals = {
    items: Object.keys(me.journal.crops || {}).length + Object.keys(me.journal.forage || {}).length + Object.keys(me.journal.items || {}).length,
    fish: Object.keys(me.journal.fish || {}).length,
    minerals: Object.keys(me.journal.minerals || {}).length,
    insects: Object.keys(me.journal.insects || {}).length,
  };
  const totalDefs = Object.values(defs.items).filter((i) => ['crop', 'fish', 'mineral', 'insect', 'forage'].includes(i.cat)).length;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <h3 className="text-sm font-bold text-white">🏛 Museum Tilly</h3>
        <p className="text-[11px] text-white/55 mt-1">Koleksi temuan kamu: {totals.items}/{totalDefs}. Temukan ragam hayati dunia ini.</p>
        <div className="grid grid-cols-3 gap-2 mt-2 text-center">
          {[
            { label: 'Ikan', val: totals.fish, max: defs.fish.length },
            { label: 'Mineral', val: totals.minerals, max: Object.keys(defs.items).filter((i) => defs.items[i].cat === 'mineral').length },
            { label: 'Serangga', val: totals.insects, max: Object.keys(defs.items).filter((i) => defs.items[i].cat === 'insect').length },
          ].map((x) => (
            <div key={x.label} className="rounded-xl bg-white/[0.04] border border-white/10 py-2">
              <p className="text-lg font-black text-emerald-300">{x.val}<span className="text-[10px] text-white/40">/{x.max}</span></p>
              <p className="text-[10px] text-white/55">{x.label}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Festival Panel ──
function FestivalPanel() {
  const meta = useHarvestStore((s) => s.worldMeta);
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const setMenu = useHarvestStore((s) => s.setMenu);

  if (!defs || !me) return null;

  if (!meta.festival.active) {
    const next = defs.festivals.find((f) => f.season === meta.season && f.day >= meta.day) || defs.festivals[0];
    const inDays = next ? ((next.day - meta.day + 7) % 7) : 0;
    return (
      <div className="space-y-3">
        <p className="text-[11px] text-white/55">Tidak ada festival aktif sekarang.</p>
        {next && (
          <div className="rounded-2xl border border-white/10 bg-gradient-to-r from-fuchsia-500/10 to-violet-500/10 p-3">
            <h3 className="text-sm font-bold text-white">🎪 Festival berikutnya: {next.name}</h3>
            <p className="text-[11px] text-white/60 mt-1">{inDays === 0 ? 'Hari ini!' : `Dalam ${inDays} hari (musim ${next.season})`} — persiapkan barang & undang teman.</p>
            <p className="text-[10px] text-white/45 mt-1">Jenis: {festivTypeLabel(next.type)}</p>
          </div>
        )}
      </div>
    );
  }

  const f = meta.festival.def;
  const pts = me.stats.festivalPoints || 0;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-fuchsia-300/40 bg-gradient-to-r from-fuchsia-500/15 to-violet-500/15 p-3">
        <h3 className="text-sm font-black text-white">🎪 {f?.name || 'Festival'} — SEDANG BERLANGSUNG!</h3>
        <p className="text-[11px] text-white/70 mt-1">{f ? festivTypeLabel(f.type) : 'Kegiatan di plaza desa.'}</p>
        <p className="text-[11px] text-amber-300 font-bold mt-1">Poin kamu: {pts}</p>
      </div>
      <button onClick={() => { audio.play('open'); setMenu('map'); }} className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/80 cursor-pointer transition-colors">
        🗺 Lihat lokasi festival di peta dunia
      </button>
    </div>
  );
}

function festivTypeLabel(t: string): string {
  const map: Record<string, string> = {
    collect: 'Kumpulkan item festival di plaza desa (klik tombol Aksi saat dekat)!',
    fish: 'Turnamen memancing: tangkap ikan sebanyak-banyaknya selama festival!',
    cook: 'Lomba memasak: masak hidangan di dekat Chef Coral!',
    give: 'Hadiah spesial: beri hadiah ke villager saat festival!',
    donate: 'Festival panen: sumbangkan hasil panen di plaza!',
    animal: 'Festival hewan: rawat & petik hasil hewanmu!',
  };
  return map[t] || 'Ikuti kegiatan di plaza desa!';
}

// ── Help Panel ──
function HelpPanel() {
  return (
    <div className="space-y-3 text-[11px] text-white/70 leading-relaxed">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <h3 className="font-bold text-white text-xs mb-2">🎮 Kontrol Desktop / Keyboard</h3>
        <ul className="space-y-1">
          <li><b>WASD / Tombol Panah:</b> Bergerak</li>
          <li><b>Shift:</b> Lari (Sprint)</li>
          <li><b>E / Spasi / Enter:</b> Aksi & Interaksi (Olah tanah, Tanam, Siram, Panen, Petik, Tebang, Bicara)</li>
          <li><b>I / Tab:</b> Buka Ransel / Inventory</li>
          <li><b>M:</b> Buka Peta Dunia Realtime</li>
          <li><b>Q:</b> Quest & Misi</li>
          <li><b>C:</b> Menu Crafting</li>
          <li><b>1 – 8:</b> Pilih Slot Cepat</li>
          <li><b>Enter:</b> Buka Chat Publik / Privat</li>
          <li><b>Esc:</b> Tutup Menu & Dialog</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <h3 className="font-bold text-white text-xs mb-2">📱 Kontrol Mobile & Tablet</h3>
        <ul className="space-y-1">
          <li><b>Virtual Joystick (Kiri Bawah):</b> Analog 360° untuk navigasi pergerakan</li>
          <li><b>Tombol Aksi Besar (Kanan Bawah):</b> Interaksi kontekstual otomatis</li>
          <li><b>Tombol Cepat:</b> Sprint, Chat, Emote, Peta & Inventory selalu siap di jangkauan jempol</li>
        </ul>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <h3 className="font-bold text-white text-xs mb-2">🌾 Siklus Permainan Open World</h3>
        <p>
          Olah tanah dengan Hoe → Tanam benih → Siram setiap hari → Panen → Jual di toko Fen atau masak resep stamina → Bangun hubungan dengan warga desa → Selesaikan proyek komunitas bersama teman → Hadiri festival musiman!
        </p>
      </div>
    </div>
  );
}
