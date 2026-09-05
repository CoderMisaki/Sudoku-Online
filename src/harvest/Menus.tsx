"use client";
// All game menu panels: inventory, map, quests, journal, relationships, skills,
// crafting, cooking, house, shop, rancher, upgrade, community, museum, festival, help, settings.
import React, { useMemo, useState } from 'react';
import { X, Minus, Plus, ChevronRight } from 'lucide-react';
import { useHarvestStore } from './store';
import { UIApi } from './api';
import { audio } from './audio';
import { makeItemIcon } from './sprites';
import { MenuId } from './types';
import type { DeviceClass } from './orientation';
import { WorldMap } from './WorldMap';
import { PlayersPanel } from './PlayersPanel';

export function Menus({ api, device }: { api: UIApi; device: DeviceClass }) {
  const menu = useHarvestStore((s) => s.menu);
  const setMenu = useHarvestStore((s) => s.setMenu);
  if (!menu) return null;
  // The map is a full-screen modal on phones so it is actually usable by touch.
  const fullScreen = device === 'mobile' && (menu === 'map' || menu === 'inventory' || menu === 'players');
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center pointer-events-auto"
      style={{
        padding: fullScreen ? 0 : undefined,
        paddingTop: `calc(env(safe-area-inset-top) + ${fullScreen ? 0 : 8}px)`,
        paddingBottom: `calc(env(safe-area-inset-bottom) + ${fullScreen ? 0 : 8}px)`,
        paddingLeft: `calc(env(safe-area-inset-left) + ${fullScreen ? 0 : 8}px)`,
        paddingRight: `calc(env(safe-area-inset-right) + ${fullScreen ? 0 : 8}px)`,
      }}
    >
      <div className="absolute inset-0 bg-black/45 backdrop-blur-[2px]" onClick={() => { audio.play('close'); setMenu(null); }} />
      <div
        className={`relative bg-[#0f1a2c]/97 border border-white/15 shadow-2xl flex flex-col overflow-hidden ${
          fullScreen ? 'w-full h-full rounded-none' : 'w-[min(96vw,760px)] max-h-[92dvh] rounded-3xl'
        }`}
      >
        <MenuHeader menu={menu} onClose={() => { audio.play('close'); setMenu(null); }} />
        <div className={`flex-1 min-h-0 ${menu === 'map' ? 'overflow-hidden p-2 sm:p-3' : 'overflow-y-auto p-3 sm:p-4'}`}>
          <MenuContent menu={menu} api={api} device={device} />
        </div>
      </div>
    </div>
  );
}

const TITLES: Record<string, string> = {
  inventory: 'Inventory', map: 'Peta Dunia', players: 'Pemain Online', quests: 'Quest', journal: 'Koleksi & Journal',
  relationships: 'Hubungan', skills: 'Skill', crafting: 'Crafting', cooking: 'Memasak',
  settings: 'Pengaturan', house: 'Rumahku', shop: 'Toko Desa', rancher: 'Ranch',
  upgrade: 'Tempa Alat', community: 'Proyek Komunitas', museum: 'Museum', festival: 'Festival', help: 'Bantuan',
};

function MenuHeader({ menu, onClose }: { menu: MenuId; onClose: () => void }) {
  const isMap = menu === 'map';
  return (
    <div className={`flex items-center justify-between px-4 py-3 border-b border-white/10 ${isMap ? '' : 'bg-white/[0.03]'}`}>
      <h2 className="font-bold text-white text-base tracking-wide">{TITLES[menu || 'help'] || 'Menu'}</h2>
      <button onClick={onClose} className="p-1.5 rounded-xl bg-white/5 hover:bg-white/15 text-white/70 hover:text-white cursor-pointer transition-colors">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function MenuContent({ menu, api, device }: { menu: MenuId; api: UIApi; device: DeviceClass }) {
  switch (menu) {
    case 'inventory': return <InventoryPanel api={api} />;
    case 'map': return <WorldMap api={api} device={device} />;
    case 'players': return <PlayersPanel />;
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

// ── shared bits ──
function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'ok' | 'lack' | 'default' }) {
  const cls = tone === 'ok' ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/30' : tone === 'lack' ? 'bg-red-400/10 text-red-300 border-red-300/20' : 'bg-white/5 text-white/70 border-white/10';
  return <span className={`px-2 py-0.5 rounded-lg text-[10px] font-semibold border ${cls}`}>{children}</span>;
}

// ── Inventory ──
/** Item category → user-facing tab. Derived from the server's item defs. */
const CAT_TABS: { id: string; label: string; cats: string[] }[] = [
  { id: 'all', label: 'Semua', cats: [] },
  { id: 'tools', label: 'Tools', cats: ['tool'] },
  { id: 'seeds', label: 'Seeds', cats: ['seed'] },
  { id: 'crops', label: 'Crops', cats: ['crop'] },
  { id: 'fish', label: 'Fish', cats: ['fish'] },
  { id: 'mining', label: 'Mining', cats: ['mineral'] },
  { id: 'materials', label: 'Materials', cats: ['forage', 'product', 'fert', 'bait', 'insect'] },
  { id: 'food', label: 'Food', cats: ['meal'] },
  { id: 'furniture', label: 'Furniture', cats: ['furniture'] },
  { id: 'quest', label: 'Quest', cats: ['special'] },
];

const CAT_LABEL: Record<string, string> = {
  tool: 'Tool', seed: 'Seed', crop: 'Crop', fish: 'Fish', mineral: 'Mining',
  forage: 'Material', product: 'Material', fert: 'Material', bait: 'Material',
  insect: 'Material', meal: 'Food', furniture: 'Furniture', special: 'Quest Item',
};

const MAX_STACK = 99;

function InventoryPanel({ api }: { api: UIApi }) {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  const prices = useHarvestStore((s) => s.prices);
  const selected = useHarvestStore((s) => s.selectedItem);
  const setSelectedItem = useHarvestStore((s) => s.setSelectedItem);
  const toast = useHarvestStore((s) => s.toast);
  const [tab, setTab] = useState('all');
  const [detail, setDetail] = useState<string | null>(null);

  const items = useMemo(() => {
    if (!me || !defs) return [];
    const active = CAT_TABS.find((t) => t.id === tab);
    return me.inv.filter((it) => {
      const def = defs.items[it.id];
      if (!def) return false;
      if (!active || active.cats.length === 0) return true;
      return active.cats.includes(def.cat);
    });
  }, [me, defs, tab]);

  if (!me || !defs) return null;

  const usedSlots = me.inv.length;
  const capacityPct = Math.min(100, (usedSlots / me.invMax) * 100);

  const equip = (id: string) => {
    setSelectedItem(id);
    api.select(id);
    audio.play('click');
  };

  // Every mutation below is a *request*. The server validates and the resulting
  // 'inv'/'gold' events update the UI — the client never mutates gold/inventory.
  const use = (id: string) => {
    const def = defs.items[id];
    if (!def) return;
    if (def.cat === 'meal') { api.action('eat', { item: id }); audio.play('cook'); return; }
    if (def.cat === 'tool' || def.cat === 'seed' || def.cat === 'fert' || def.cat === 'bait') {
      equip(id);
      toast('info', `${def.name} dipilih — arahkan lalu tekan Aksi.`);
      return;
    }
    if (def.cat === 'furniture') { api.action('place', { item: id }); return; }
    toast('info', `${def.name} bisa dijual di Toko atau diberikan sebagai hadiah.`);
  };

  const discard = (id: string, qty: number) => {
    const def = defs.items[id];
    if (def?.cat === 'tool') { toast('warn', 'Alat tidak bisa dibuang.'); return; }
    api.transact('drop', { item: id, qty });
    audio.play('click');
    setDetail(null);
  };

  const detailDef = detail ? defs.items[detail] : null;
  const detailSlot = detail ? me.inv.find((i) => i.id === detail) : null;

  return (
    <div className="space-y-3">
      {/* capacity */}
      <div className="flex items-center gap-2">
        <span className="text-[11px] text-white/60 shrink-0">Slot {usedSlots}/{me.invMax}</span>
        <div className="flex-1 h-1.5 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${capacityPct}%`, background: capacityPct > 90 ? '#ef4444' : '#34d399' }} />
        </div>
        <span className="text-[11px] font-bold text-amber-300 shrink-0 tabular-nums">{me.gold.toLocaleString('id-ID')} G</span>
      </div>

      {/* category tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {CAT_TABS.map((t) => {
          const count = t.cats.length === 0
            ? me.inv.length
            : me.inv.filter((i) => t.cats.includes(defs.items[i.id]?.cat || '')).length;
          return (
            <button
              key={t.id}
              onClick={() => { audio.play('click'); setTab(t.id); }}
              className={`px-2.5 py-1 rounded-xl text-[10px] font-bold whitespace-nowrap cursor-pointer transition-colors shrink-0 ${
                tab === t.id ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-white/55 hover:bg-white/10'
              }`}
            >
              {t.label} {count > 0 && <span className="opacity-60">{count}</span>}
            </button>
          );
        })}
      </div>

      {/* grid */}
      {items.length === 0 ? (
        <p className="text-[11px] text-white/40 italic py-6 text-center">Tidak ada item di kategori ini.</p>
      ) : (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
          {items.map((it) => {
            const def = defs.items[it.id];
            const active = selected === it.id;
            const full = it.qty >= MAX_STACK;
            return (
              <button
                key={it.id}
                onClick={() => { audio.play('click'); setDetail(detail === it.id ? null : it.id); }}
                className={`relative flex flex-col items-center gap-1 rounded-2xl border p-2 cursor-pointer transition-all active:scale-95 ${
                  active ? 'bg-emerald-400/15 border-emerald-300/60 shadow-[0_0_10px_rgba(52,211,153,0.3)]'
                    : detail === it.id ? 'bg-sky-400/10 border-sky-300/50'
                    : 'bg-white/[0.04] border-white/10 hover:bg-white/[0.09]'
                }`}
                title={def.name}
              >
                <img src={makeItemIcon(def.cat, def.color, it.id)} alt={def.name} className="w-9 h-9" draggable={false} />
                <span className="text-[9px] text-white/80 truncate w-full text-center">{def.name}</span>
                <span className={`text-[9px] font-mono ${full ? 'text-amber-300' : 'text-white/50'}`}>x{it.qty}</span>
                {active && <span className="absolute top-1 right-1 text-[8px] text-emerald-300">✔</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* detail / actions */}
      {detailDef && detailSlot && (
        <div className="rounded-2xl border border-white/12 bg-white/[0.04] p-3 space-y-2">
          <div className="flex items-start gap-3">
            <img src={makeItemIcon(detailDef.cat, detailDef.color, detail!)} alt="" className="w-11 h-11 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-white truncate">{detailDef.name}</p>
              <div className="flex flex-wrap gap-1 mt-1">
                <Chip>{CAT_LABEL[detailDef.cat] || detailDef.cat}</Chip>
                <Chip>Jumlah {detailSlot.qty}/{MAX_STACK}</Chip>
                {prices[detail!] && <Chip tone="ok">Jual {prices[detail!].sell} G</Chip>}
                {prices[detail!] && <Chip>Beli {prices[detail!].buy} G</Chip>}
                {detailDef.rare && <Chip tone="ok">Langka ✨</Chip>}
              </div>
              {detailDef.buff && (
                <p className="text-[10px] text-emerald-300 mt-1">+{detailDef.buff.stam} stamina · speed ×{detailDef.buff.speed}</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => use(detail!)} className="px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-[11px] font-bold cursor-pointer active:scale-95 transition-transform">
              {detailDef.cat === 'meal' ? 'Makan' : detailDef.cat === 'furniture' ? 'Letakkan' : 'Gunakan'}
            </button>
            {(detailDef.cat === 'tool' || detailDef.cat === 'seed' || detailDef.cat === 'fert' || detailDef.cat === 'bait') && (
              <button onClick={() => equip(detail!)} className="px-3 py-1.5 rounded-xl bg-sky-500/25 border border-sky-300/35 text-sky-200 text-[11px] font-bold cursor-pointer active:scale-95 transition-transform">
                Quick Slot
              </button>
            )}
            {detailDef.cat !== 'tool' && (
              <>
                <button onClick={() => discard(detail!, 1)} className="px-3 py-1.5 rounded-xl bg-white/8 border border-white/12 text-white/70 text-[11px] font-bold cursor-pointer active:scale-95 transition-transform">
                  Buang 1
                </button>
                {detailSlot.qty > 1 && (
                  <button onClick={() => discard(detail!, detailSlot.qty)} className="px-3 py-1.5 rounded-xl bg-rose-500/20 border border-rose-300/30 text-rose-200 text-[11px] font-bold cursor-pointer active:scale-95 transition-transform">
                    Buang semua ({detailSlot.qty})
                  </button>
                )}
              </>
            )}
            <button onClick={() => setDetail(null)} className="px-3 py-1.5 rounded-xl bg-white/5 text-white/50 text-[11px] font-bold cursor-pointer">Tutup</button>
          </div>
        </div>
      )}

      <div className="text-[11px] text-white/45 bg-white/[0.03] rounded-xl p-3 space-y-1">
        <p><b className="text-white/70">Tips:</b> Klik item untuk detail, harga, dan aksi.</p>
        <p>Benih & alat: pilih → tekan tombol Aksi. Makanan: langsung dimakan (buff stamina).</p>
        <p>Hasil panen / ikan / mineral: jual di <b className="text-white/70">Fen</b> (village plaza).</p>
      </div>
    </div>
  );
}

// ── Quests ──
function QuestsPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const [tab, setTab] = useState<'active' | 'board'>('active');
  if (!defs || !me) return null;
  const allDefs = Object.values(defs.quests).flat();
  const active = me.quests.active.map((id) => allDefs.find((q) => q.id === id)).filter(Boolean);
  const available = allDefs.filter((q) => !me.quests.active.includes(q.id) && !me.quests.done.includes(q.id) && !q.id.startsWith('main_') && !q.id.startsWith('hidden_'));
  const progressDone = (q: NonNullable<(typeof allDefs)[number]>) => q.objectives.every((o, i) => Math.min(o.count, me.quests.progress[`${q.id}:${i}`] || 0) >= o.count);
  const accept = (id: string) => { api.action('quest_accept', { qid: id }); audio.play('quest'); };
  const turnin = (id: string) => { api.action('quest_turnin', { qid: id }); audio.play('quest'); };
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        {(['active', 'board'] as const).map((t) => (
          <button key={t} onClick={() => { audio.play('click'); setTab(t); }} className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${tab === t ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
            {t === 'active' ? `Aktif (${active.length})` : 'Papan Quest'}
          </button>
        ))}
      </div>
      {tab === 'active' ? (
        <div className="space-y-2">
          {active.length === 0 && <p className="text-xs text-white/45 italic">Tidak ada quest aktif. Cek papan quest di village! (ikon 📋)</p>}
          {active.map((q) => {
            return (
              <div key={q!.id} className={`rounded-2xl border p-3 ${progressDone(q!) ? 'border-emerald-300/40 bg-emerald-400/[0.07]' : 'border-white/10 bg-white/[0.03]'}`}>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h3 className="font-bold text-white text-sm">{q!.name}</h3>
                    <p className="text-[11px] text-white/60">{q!.desc}</p>
                  </div>
                  {progressDone(q!) && (
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
  const list = (tab === 'fish' ? defs.fish.map((f) => ({ id: f.id, name: f.name, cat: 'fish', color: f.color }))
    : tab === 'recipes' ? defs.recipes.map((r) => ({ id: r.id, name: r.name, cat: 'recipe', color: '#f2c94c' }))
    : tab === 'animals' ? [['cow', 'Cow'], ['chicken', 'Chicken'], ['sheep', 'Sheep'], ['goat', 'Goat'], ['horse', 'Horse'], ['cat', 'Cat'], ['dog', 'Dog']].map(([id, name]) => ({ id, name, cat: 'animal', color: '#e8e0d4' }))
    : Object.entries(defs.items).filter(([, it]) => (tab === 'crops' ? it.cat === 'crop' : it.cat === 'mineral' || it.cat === 'insect')).map(([itId, it]) => ({ id: itId, name: it.name, cat: it.cat, color: it.color })));
  const gotSet = new Set(
    tab === 'crops' ? Object.keys(me.journal.crops || {}) : tab === 'fish' ? Object.keys(me.journal.fish || {})
      : tab === 'minerals' ? Object.keys(me.journal.minerals || {}) : tab === 'insects' ? Object.keys(me.journal.insects || {})
      : tab === 'recipes' ? Object.keys(me.journal.recipes || {}) : Object.keys(me.journal.animals || {})
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {(['crops', 'fish', 'minerals', 'insects', 'recipes', 'animals'] as const).map((t) => (
          <button key={t} onClick={() => { audio.play('click'); setTab(t); }} className={`px-2.5 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer capitalize transition-colors ${tab === t ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}>
            {t} {cats[t].got}/{cats[t].ids.length}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
        {list.map((it) => {
          const got = gotSet.has(it.id);
          return (
            <div key={it.id} className={`rounded-xl border p-1.5 flex flex-col items-center gap-1 ${got ? 'border-emerald-300/40 bg-emerald-400/[0.06]' : 'border-white/10 bg-white/[0.02] opacity-60'}`}>
              <img src={makeItemIcon(it.cat === 'recipe' ? 'meal' : it.cat, it.color, it.id)} className="w-8 h-8 grayscale-0" alt={it.name} />
              <span className="text-[9px] text-white/75 text-center leading-tight truncate w-full">{got ? it.name : '???'}</span>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-white/45">Museum Tilly menghitung koleksimu — bawa temuan langka ke desa untuk pameran! 🏛</p>
    </div>
  );
}

// ── Relationships ──
function RelationshipsPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const [sel, setSel] = useState<string | null>(null);
  const [giftOpen, setGiftOpen] = useState(false);
  if (!defs || !me) return null;
  const npcs = defs.npcs.filter((n) => ['npc_mae', 'npc_lu', 'npc_iris', 'npc_art'].includes(n.id)).concat(defs.npcs.filter((n) => !['npc_mae', 'npc_lu', 'npc_iris', 'npc_art'].includes(n.id)));
  const selDef = defs.npcs.find((n) => n.id === sel);
  const likes = sel ? defs.likes[sel] : null;
  const rel = sel ? me.rel[sel] : null;
  const giftItems = me.inv.filter((i) => ['forage', 'crop', 'fish', 'meal', 'insect'].includes(defs.items[i.id]?.cat || ''));
  return (
    <div className="grid sm:grid-cols-[220px_1fr] gap-3">
      <div className="space-y-1.5">
        {npcs.map((n) => {
          const r = me.rel[n.id];
          const candidate = ['npc_mae', 'npc_lu', 'npc_iris', 'npc_art'].includes(n.id);
          return (
            <button key={n.id} onClick={() => { audio.play('click'); setSel(n.id); setGiftOpen(false); }} className={`w-full text-left rounded-xl border px-3 py-2 flex items-center gap-2 cursor-pointer transition-colors ${sel === n.id ? 'border-emerald-300/50 bg-emerald-400/10' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.07]'}`}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: n.color }} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold text-white truncate">{n.name} {me.spouse === n.id && <span className="text-pink-300">💍</span>} {candidate && <span className="text-[9px] text-violet-300">Kandidat</span>}</p>
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
            <p className="text-[10px] text-white/40">NPC punya jadwal & hubungan satu sama lain. Hati 8+ membuka lamaran (perlu Blossom/emerald).</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Skills ──
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
        const next = sk.xp >= 40; // next level progress display
        const curLevelXp = 40 * Math.pow(sk.level, 1.7);
        const need = 40 * Math.pow(sk.level + 1, 1.7);
        const pct = Math.min(100, Math.round(((sk.xp - 0) / (need - curLevelXp + 1)) * 100));
        void next;
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

// ── Crafting / Cooking ──
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
        <button onClick={() => { audio.play('click'); setShowLocked(!showLocked); }} className="px-2.5 py-1 rounded-xl bg-white/5 text-white/60 text-[10px] font-bold cursor-pointer hover:bg-white/10">
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
                className={`shrink-0 px-4 py-2 rounded-xl text-xs font-bold transition-colors cursor-pointer ${enabled ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950' : 'bg-white/5 text-white/30 cursor-not-allowed'}`}
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

// ── Settings ──
function SettingsPanel({ api }: { api: UIApi }) {
  const settings = useHarvestStore((s) => s.settings);
  const setSettings = useHarvestStore((s) => s.setSettings);
  const setMenu = useHarvestStore((s) => s.setMenu);
  const [confirmLeave, setConfirmLeave] = useState(false);
  return (
    <div className="space-y-4">
      <Row label="Musik">
        <input type="range" min={0} max={1} step={0.05} value={settings.music} onChange={(e) => { const v = Number(e.target.value); setSettings({ music: v }); audio.setMusicVolume(v); }} className="w-40 accent-emerald-400" />
      </Row>
      <Row label="SFX">
        <input type="range" min={0} max={1} step={0.05} value={settings.sfx} onChange={(e) => { const v = Number(e.target.value); setSettings({ sfx: v }); audio.setSfxVolume(v); audio.play('click'); }} className="w-40 accent-emerald-400" />
      </Row>
      <Row label="Grafik">
        <div className="flex gap-1.5">
          {(['high', 'low'] as const).map((q) => (
            <button key={q} onClick={() => { audio.play('click'); setSettings({ quality: q }); api.getEngine()?.setQuality(q); }} className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${settings.quality === q ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-white/60'}`}>
              {q === 'high' ? 'High 🔥' : 'Low (hemat baterai)'}
            </button>
          ))}
        </div>
      </Row>
      <Row label="FPS counter">
        <button onClick={() => { audio.play('click'); setSettings({ showFps: !settings.showFps }); }} className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${settings.showFps ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-white/60'}`}>
          {settings.showFps ? 'ON' : 'OFF'}
        </button>
      </Row>
      <button onClick={() => { audio.play('click'); setMenu('help'); }} className="w-full px-3 py-2.5 rounded-xl bg-white/5 hover:bg-white/10 text-white/80 text-xs font-bold cursor-pointer border border-white/10 transition-colors">
        🎮 Bantuan Kontrol & Tips
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

// ── House ──
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
            className={`px-3 py-2 rounded-xl text-xs font-bold transition-colors ${house.level >= 4 ? 'bg-white/5 text-white/30 cursor-not-allowed' : canUp ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 cursor-pointer' : 'bg-white/10 text-white/50 cursor-pointer'}`}
          >
            {house.level >= 4 ? 'MAX' : `Upgrade ${gold}G + ${wood} kayu + ${stone} batu`}
          </button>
        </div>
        {house.level < 4 && !canUp && <p className="text-[10px] text-amber-300/80 mt-1">Butuh: {gold}G ({me.gold}) · kayu {wood} · batu {stone}</p>}
        <p className="text-[10px] text-white/45 mt-1.5">{hasBed ? '🛏 Tidur di rumah dimungkinkan.' : '🛏 Belum ada bed — tidur di penginapan Elder Ash.'} {hasKitchen ? '🍲 Dapur mudah diakses.' : ''} {hasBench ? '🛠 Workbench siap.' : ''}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => { audio.play('open'); setPlaceOpen(!placeOpen); }} className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-300/30 text-emerald-200 text-xs font-bold cursor-pointer hover:bg-emerald-500/25 transition-colors">
          + Tempatkan Furnitur ({furItems.length} tersedia)
        </button>
        <button onClick={() => { audio.play('open'); api.action('house_upgrade', {}); }} className="px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white/70 text-xs font-bold cursor-pointer hover:bg-white/10 transition-colors">
          🔨 Perluas (lihat kebutuhan)
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

// ── Shop ──
function ShopPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const prices = useHarvestStore((s) => s.prices);
  const [tab, setTab] = useState<'buy' | 'sell'>('buy');
  const [qty, setQty] = useState<Record<string, number>>({});
  if (!defs || !me) return null;
  const buyIds = Object.keys(prices).filter((id) => ['seed', 'fert', 'bait'].includes(defs.items[id]?.cat || ''));
  const sellIds = me.inv.map((i) => i.id).filter((id) => defs.items[id]?.cat !== 'tool' && defs.items[id]?.cat !== 'furniture' && defs.items[id]?.cat !== 'seed');
  // Buy/sell are *requests* carrying an idempotency key: a double click can
  // never charge twice. Gold and inventory only change when the server says so.
  const buy = (id: string) => {
    const n = qty[id] || 1;
    const price = (prices[id]?.buy || 0) * n;
    if (me.gold < price) { useHarvestStore.getState().toast('warn', 'Tidak cukup uang.'); return; }
    api.transact('buy', { item: id, qty: n });
    audio.play('buy');
  };
  const sell = (id: string) => {
    const owned = me.inv.find((i) => i.id === id)?.qty || 0;
    const n = Math.min(qty[id] || 1, owned);
    if (n < 1) { useHarvestStore.getState().toast('warn', 'Item tidak dimiliki.'); return; }
    api.transact('sell', { item: id, qty: n });
    audio.play('sell');
  };
  const ownedOf = (id: string) => me.inv.find((i) => i.id === id)?.qty || 0;
  const qtyPicker = (id: string) => (
    <div className="flex items-center gap-1">
      <button onClick={() => { audio.play('click'); setQty((q) => ({ ...q, [id]: Math.max(1, (q[id] || 1) - 1) })); }} className="w-6 h-6 rounded-lg bg-white/10 text-white/70 flex items-center justify-center cursor-pointer"><Minus className="w-3 h-3" /></button>
      <span className="text-[11px] font-bold text-white w-6 text-center">{qty[id] || 1}</span>
      <button onClick={() => { audio.play('click'); setQty((q) => ({ ...q, [id]: Math.min(99, (q[id] || 1) + 1) })); }} className="w-6 h-6 rounded-lg bg-white/10 text-white/70 flex items-center justify-center cursor-pointer"><Plus className="w-3 h-3" /></button>
    </div>
  );
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-white/55">Harga dinamis — supply & demand harian mengubah harga semua player! 💹</p>
      <div className="flex gap-1.5">
        {(['buy', 'sell'] as const).map((t) => (
          <button key={t} onClick={() => { audio.play('click'); setTab(t); }} className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer ${tab === t ? 'bg-emerald-500 text-emerald-950' : 'bg-white/5 text-white/60'}`}>
            {t === 'buy' ? 'Beli (Fen)' : 'Jual'}
          </button>
        ))}
      </div>
      {tab === 'buy' ? (
        <div className="space-y-1.5">
          {buyIds.map((id) => {
            const def = defs.items[id];
            const price = prices[id]?.buy || 0;
            const cost = price * (qty[id] || 1);
            const canAfford = me.gold >= cost;
            return (
              <div key={id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <img src={makeItemIcon(def.cat, def.color, id)} className="w-8 h-8" alt="" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{def.name} <span className="text-[9px] text-amber-300">G {price}</span></p>
                  <p className="text-[9px] text-white/45">Jual kembali G {prices[id]?.sell || 0} · Dimiliki {ownedOf(id)}</p>
                </div>
                {qtyPicker(id)}
                <button onClick={() => buy(id)} disabled={!canAfford} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold shrink-0 ${canAfford ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 cursor-pointer' : 'bg-white/5 text-white/30 cursor-not-allowed'}`}>
                  Beli {cost}G
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-1.5">
          {sellIds.length === 0 && <p className="text-[11px] text-white/45 italic">Tidak ada item yang bisa dijual. Panen & pancing dulu!</p>}
          {sellIds.map((id) => {
            const def = defs.items[id];
            const price = prices[id]?.sell || 0;
            const cost = price * (qty[id] || 1);
            return (
              <div key={id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <img src={makeItemIcon(def.cat, def.color, id)} className="w-8 h-8" alt="" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-white truncate">{def.name} ×{me.inv.find((i) => i.id === id)?.qty || 0}</p>
                  <p className="text-[9px] text-amber-300">G {price}/pcs</p>
                </div>
                {qtyPicker(id)}
                <button onClick={() => sell(id)} className="px-3 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-amber-950 text-[11px] font-bold shrink-0 cursor-pointer">
                  Jual {cost}G
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Rancher ──
function RancherPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  if (!defs || !me) return null;
  const maxAnimals = 4 + me.house.level * 3;
  return (
    <div className="space-y-3">
      <p className="text-[11px] text-white/55">Briar menjual hewan. Hewan butuh makan (turnip/carrot), petik hasilnya tiap hari, rawat kebahagiaan & beri makan. Chick bisa menetas! 🐣</p>
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
                className={`mt-2 w-full px-3 py-1.5 rounded-xl text-[11px] font-bold ${canBuy ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 cursor-pointer' : 'bg-white/5 text-white/30 cursor-not-allowed'}`}
              >
                {me.animals.length >= maxAnimals ? `Kandang penuh (${me.animals.length}/${maxAnimals})` : me.gold < a.price ? 'Gold kurang' : 'Beli'}
              </button>
            </div>
          );
        })}
      </div>
      <p className="text-[11px] text-white/45">Hewan kamu: {me.animals.length}/{maxAnimals} · Pet & Feed lewat tombol Aksi di dekat hewan.</p>
      <div className="space-y-1.5">
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

// ── Tool upgrade ──
function UpgradePanel({ api }: { api: UIApi }) {
  const me = useHarvestStore((s) => s.me);
  const defs = useHarvestStore((s) => s.defs);
  if (!me || !defs) return null;
  const tools = ['tool_hoe', 'tool_can', 'tool_sickle', 'tool_axe', 'tool_pick', 'tool_rod', 'tool_net'];
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-white/55">Ren menempa alat lebih kuat: kurangi stamina & kebutuhan kedalaman tambang.</p>
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
              <div className="flex gap-1 mt-0.5">{Array.from({ length: 5 }).map((_, i) => <span key={i} className={`w-4 h-1.5 rounded-full ${i < lvl ? 'bg-emerald-400' : 'bg-white/10'}`} />)}</div>
            </div>
            {lvl >= 5 ? <span className="text-[10px] text-emerald-300 font-bold">MAX</span> : (
              <button
                onClick={() => { api.action('upgrade_tool', { tool }); audio.play('craft'); }}
                disabled={!can}
                className={`px-3 py-1.5 rounded-xl text-[10px] font-bold shrink-0 ${can ? 'bg-emerald-500 hover:bg-emerald-400 text-emerald-950 cursor-pointer' : 'bg-white/5 text-white/35 cursor-not-allowed'}`}
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

// ── Community ──
function CommunityPanel({ api }: { api: UIApi }) {
  const defs = useHarvestStore((s) => s.defs);
  const me = useHarvestStore((s) => s.me);
  const community = useHarvestStore((s) => s.worldMeta.community);
  const [open, setOpen] = useState<string | null>(null);
  if (!defs || !me) return null;
  return (
    <div className="space-y-2">
      <p className="text-[11px] text-white/55">Semua pemain berkontribusi — saat target tercapai, perubahan benar-benar muncul di dunia! 🌉</p>
      {defs.projects.map((p) => {
        const st = community?.[p.id];
        const done = st?.done || false;
        const contrib = st?.contributions || {};
        const isOpen = open === p.id;
        const canAny = Object.keys(p.needs).some((it) => (me.inv.find((i) => i.id === it)?.qty || 0) > 0);
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
                {Object.entries(p.needs).map(([it, need]) => {
                  const have = me.inv.find((i) => i.id === it)?.qty || 0;
                  void need;
                  return (
                    <div key={it} className="flex items-center gap-2">
                      <span className="text-[10px] text-white/65 flex-1">{defs.items[it]?.name} ({have} punya)</span>
                      <button
                        onClick={() => { api.action('contribute', { project: p.id, item: it, qty: Math.min(5, Math.max(1, have)) }); audio.play('craft'); }}
                        disabled={have <= 0}
                        className={`px-2.5 py-1 rounded-lg text-[10px] font-bold ${have > 0 ? 'bg-emerald-500/80 text-emerald-950 cursor-pointer' : 'bg-white/5 text-white/30 cursor-not-allowed'}`}
                      >
                        +1
                      </button>
                    </div>
                  );
                })}
                {!canAny && <p className="text-[10px] text-white/40 italic">Kumpulkan material dulu (tembok pohon, tambang batu/fiber).</p>}
              </div>
            )}
          </div>
        );
      })}
      <p className="text-[10px] text-white/40">Sumbangan juga menaikkan quest &quot;Community: Road to the Harbor&quot; (perlu pemain lain dekat untuk poin multiplayer).</p>
    </div>
  );
}

// ── Museum ──
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
        <p className="text-[11px] text-white/55 mt-1">Koleksi kamu: {totals.items}/{totalDefs}. Buka Journal untuk melihat detail per kategori.</p>
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
        <p className="text-[10px] text-white/40 mt-2">Menemukan item pertama kali otomatis tercatat di journal & museum.</p>
      </div>
    </div>
  );
}

// ── Festival ──
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
  if (!meta.festival.def) {
    return <p className="text-[11px] text-white/50 italic">Festival sedang disiapkan... buka lagi sebentar lagi.</p>;
  }
  const f = meta.festival.def;
  const pts = me.stats.festivalPoints || 0;
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-fuchsia-300/40 bg-gradient-to-r from-fuchsia-500/15 to-violet-500/15 p-3">
        <h3 className="text-sm font-black text-white">🎪 {f.name} — SEDANG BERLANGSUNG!</h3>
        <p className="text-[11px] text-white/70 mt-1">{festivTypeLabel(f.type)}</p>
        <p className="text-[11px] text-amber-300 font-bold mt-1">Poin kamu: {pts}</p>
      </div>
      <button onClick={() => { audio.play('open'); setMenu('map'); }} className="w-full px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold text-white/80 cursor-pointer transition-colors">
        🗺 Menuju lokasi festival (plaza desa)
      </button>
      <p className="text-[10px] text-white/45">Pemenang festival mendapat Gold + Golden Apple. Kerjakan bersama teman!</p>
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

// ── Help ──
function HelpPanel() {
  return (
    <div className="space-y-3 text-[11px] text-white/70 leading-relaxed">
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <h3 className="font-bold text-white text-xs mb-2">🎮 Kontrol</h3>
        <ul className="space-y-1">
          <li><b>PC:</b> WASD / panah = gerak · Shift = lari · E/Space = aksi · I = inventory · M = peta · Q = quest</li>
          <li><b>Mobile:</b> joystick kiri, tombol aksi besar kanan, drag di layar untuk zoom (pinch)</li>
          <li>1–8: quick bar · Esc: tutup menu · C: crafting · J: journal</li>
        </ul>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <h3 className="font-bold text-white text-xs mb-2">🌾 Farm Loop</h3>
        <p>Olah tanah → tanam benih (pilih benih di inventory) → siram harian → panen → jual/tukar → craft & masak → quest & hadiah NPC → festival.</p>
      </div>
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
        <h3 className="font-bold text-white text-xs mb-2">🎣 Fitur</h3>
        <p>Memancing (tap saat zona hijau), tambang perkedalaman, hewan ternak, rumah & furnitur, musim & cuaca, malam & tidur, ekonomi dinamis, proyek komunitas multiplayer, musim festival.</p>
      </div>
      <p className="text-[10px] text-white/40">World persisten: keluar lalu kembali — farm & progress tetap ada. Koneksi putus otomatis reconnect.</p>
    </div>
  );
}
