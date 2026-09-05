import { create } from 'zustand';
import {
  ConnectionStatus, Screen, PlayerState, Defs, InteractionHint, UiToast, ChatLine,
  DialogueState, MenuId, EventMsg, WorldState,
} from './types';

const MAX_TOASTS = 5;

interface HarvestState {
  status: ConnectionStatus;
  screen: Screen;
  errorMsg: string;
  roomCode: string;
  userId: string;
  userName: string;
  me: PlayerState | null;
  defs: Defs | null;
  prices: Record<string, { buy: number; sell: number }>;
  worldMeta: {
    timeMin: number; day: number; season: string; weather: string;
    community: WorldState['community'] | null;
    festival: WorldState['festival'];
  };
  playersShort: Record<string, { id: string; name: string; online: boolean }>;
  interaction: InteractionHint;
  menu: MenuId;
  dialogue: DialogueState | null;
  toasts: UiToast[];
  chat: ChatLine[];
  settings: { music: number; sfx: number; quality: 'high' | 'low'; showFps: boolean };
  fps: number;
  mine: { active: boolean; depth: number; S: number; grid: number[]; ores: Record<string, string> } | null;
  festivalBanner: { name: string } | null;
  wasInGame: boolean;
  fishing: { phase: 'idle' | 'cast' | 'bite'; startAt: number; biteAt: number };
  selectedItem: string | null;
  chatOpen: boolean;

  setStatus: (s: ConnectionStatus) => void;
  setScreen: (s: Screen) => void;
  setError: (m: string) => void;
  setSession: (room: string, userId: string, userName: string) => void;
  applySnapshot: (me: PlayerState, defs: Defs, world: WorldState, prices?: Record<string, { buy: number; sell: number }>) => void;
  applyEvent: (e: EventMsg['e']) => void;
  applySnapMeta: (timeMax: number, day: number, season: string, weather: string) => void;
  setInteraction: (h: InteractionHint) => void;
  setMenu: (m: MenuId) => void;
  setDialogue: (d: DialogueState | null) => void;
  toast: (kind: UiToast['kind'], msg: string) => void;
  dismissToast: (id: number) => void;
  pushChat: (line: ChatLine) => void;
  setSettings: (p: Partial<HarvestState['settings']>) => void;
  setFps: (fps: number) => void;
  setMine: (m: HarvestState['mine']) => void;
  setPlayersShort: (list: { id: string; name: string; online: boolean }[]) => void;
  setFishing: (f: HarvestState['fishing']) => void;
  setSelectedItem: (id: string | null) => void;
  setChatOpen: (open: boolean) => void;
  reset: () => void;
}

let toastId = 1;
let chatId = 1;

const initialMeta = { timeMin: 6 * 60, day: 1, season: 'spring', weather: 'sunny', community: null, festival: { active: false, def: null } };

export const useHarvestStore = create<HarvestState>((set, get) => ({
  status: 'connecting',
  screen: 'orientation',
  errorMsg: '',
  roomCode: '',
  userId: '',
  userName: '',
  me: null,
  defs: null,
  prices: {},
  worldMeta: initialMeta,
  playersShort: {},
  interaction: { kind: null, label: '', x: 0, y: 0 },
  menu: null,
  dialogue: null,
  toasts: [],
  chat: [],
  settings: { music: 0.5, sfx: 0.8, quality: 'high', showFps: false },
  fps: 60,
  mine: null,
  festivalBanner: null,
  wasInGame: false,
  fishing: { phase: 'idle', startAt: 0, biteAt: 0 },
  selectedItem: null,
  chatOpen: false,

  setStatus: (s) => set({ status: s }),
  setScreen: (s) => set({ screen: s }),
  setError: (m) => set({ errorMsg: m, screen: 'error' }),
  setSession: (room, userId, userName) => set({ roomCode: room, userId, userName }),

  applySnapshot: (me, defs, world, prices) => set((st) => ({
    me,
    defs,
    prices: prices || st.prices,
    worldMeta: {
      timeMin: world.time,
      day: world.day,
      season: world.season,
      weather: world.weather,
      community: world.community,
      festival: world.festival,
    },
    screen: me.char ? 'game' : 'creator',
    status: 'ready',
    wasInGame: me.char ? true : st.wasInGame,
  })),

  applySnapMeta: (timeMin, day, season, weather) => set((st) => ({
    worldMeta: { ...st.worldMeta, timeMin, day, season, weather },
  })),

  applyEvent: (e) => {
    const st = get();
    const type = typeof e.type === 'string' ? e.type : '';
    const update: Partial<HarvestState> = {};
    const patchMe = (fn: (m: PlayerState) => PlayerState) => {
      if (st.me) update.me = fn(st.me);
    };
    switch (type) {
      case 'inv': patchMe((m) => ({ ...m, inv: e.inv as PlayerState['inv'] })); break;
      case 'gold': patchMe((m) => ({ ...m, gold: e.gold as number })); break;
      case 'stamina': patchMe((m) => ({ ...m, stamina: e.value as number })); break;
      case 'skills': patchMe((m) => ({ ...m, skills: e.skills as PlayerState['skills'] })); break;
      case 'tools': patchMe((m) => ({ ...m, toolLevels: e.toolLevels as PlayerState['toolLevels'] })); break;
      case 'buff': patchMe((m) => ({ ...m, buffs: e.buffs as PlayerState['buffs'], stamina: e.stamina as number })); break;
      case 'house': patchMe((m) => ({ ...m, house: e.house as PlayerState['house'] })); break;
      case 'animals': patchMe((m) => ({ ...m, animals: e.animals as PlayerState['animals'] })); break;
      case 'animal_update': patchMe((m) => ({ ...m, animals: e.animals as PlayerState['animals'] })); break;
      case 'quest_update': {
        patchMe((m) => {
          const quests = { ...m.quests };
          if (typeof e.questId === 'string') {
            if (e.active) {
              if (!quests.active.includes(e.questId)) quests.active = [...quests.active, e.questId];
            }
            quests.progress = { ...quests.progress, ...(e.progress as Record<string, number>) };
          } else {
            quests.active = (e.active as string[]) || quests.active;
            quests.progress = { ...(e.progress as Record<string, number>) };
          }
          return { ...m, quests };
        });
        break;
      }
      case 'quest_complete': {
        patchMe((m) => ({
          ...m,
          quests: { ...m.quests, done: m.quests.done.includes(e.questId as string) ? m.quests.done : [...m.quests.done, e.questId as string] },
          gold: e.gold as number,
        }));
        st.toast('quest', `Quest selesai! (+${(e.reward as { gold: number }).gold} G)`);
        break;
      }
      case 'levelup': {
        patchMe((m) => {
          const skills = { ...m.skills };
          const sk = { ...skills[e.skill as string] };
          sk.level = e.level as number;
          skills[e.skill as string] = sk;
          return { ...m, skills };
        });
        st.toast('success', `Level up — ${st.defs?.skills?.[e.skill as string] || e.skill} Lv ${e.level}!`);
        break;
      }
      case 'notify': st.toast((e.kind as UiToast['kind']) === 'warn' ? 'warn' : (e.kind as UiToast['kind']) || 'info', e.msg as string); break;
      case 'dialogue': set({ dialogue: { npcId: e.npc as string, lines: e.lines as string[], heartGain: e.heartGain as number, hearts: e.hearts as number, canShop: !!e.canShop, canGift: !!e.canGift } }); break;
      case 'gift_result': {
        patchMe((m) => {
          const rel = { ...m.rel };
          rel[e.npc as string] = { ...rel[e.npc as string], hearts: e.hearts as number };
          return { ...m, rel };
        });
        st.toast('heart', e.line as string);
        break;
      }
      case 'can_propose': st.toast('heart', `${st.defs?.npcs?.find(n => n.id === e.npc)?.name || 'Seseorang'} menerima lamaranmu!`); break;
      case 'marriage': st.toast('heart', `${e.name} menikah dengan ${e.npc}! 💍`); break;
      case 'chat': set({ chat: [...st.chat.slice(-49), { id: chatId++, playerId: e.playerId as string, name: e.name as string, text: e.text as string, ts: e.ts as number }] }); break;
      case 'weather': update['worldMeta'] = { ...st.worldMeta, weather: e.weather as string }; break;
      case 'time': update['worldMeta'] = { ...st.worldMeta, timeMin: e.time as number, day: e.day as number, season: e.season as string }; break;
      case 'season': update['worldMeta'] = { ...st.worldMeta, season: e.season as string }; break;
      case 'festival': {
        update['worldMeta'] = { ...st.worldMeta, festival: { active: !!e.active, def: e.def ? { id: (e.def as { id: string }).id, name: (e.def as { name: string }).name, type: (e.def as { type: string }).type } : null } };
        update['festivalBanner'] = e.active ? { name: (e.def as { name: string }).name } : null;
        break;
      }
      case 'community': {
        const community = { ...(st.worldMeta.community || {}) };
        if (community[e.id as string]) community[e.id as string] = { contributions: e.contributions as Record<string, number>, done: !!e.done };
        update['worldMeta'] = { ...st.worldMeta, community };
        break;
      }
      case 'community_done': st.toast('world', 'Proyek komunitas selesai! World berubah untuk semua pemain.'); break;
      case 'mine_enter': set({ mine: { active: true, depth: e.depth as number, S: e.S as number, grid: e.grid as number[], ores: e.ores as Record<string, string> } }); break;
      case 'mine_exit': set({ mine: null }); break;
      case 'fish_start': set({ fishing: { phase: 'cast', startAt: Date.now(), biteAt: Date.now() + (e.biteIn as number) } }); break;
      case 'fish_bite': set({ fishing: { phase: 'bite', startAt: Date.now(), biteAt: Date.now() } }); break;
      case 'fish_result':
      case 'fish_cancel': set({ fishing: { phase: 'idle', startAt: 0, biteAt: 0 } }); break;
      case 'mine_break': {
        const m = st.mine;
        if (m) {
          const ores = { ...m.ores };
          delete ores[`${e.x},${e.y}`];
          set({ mine: { ...m, ores } });
        }
        break;
      }
      case 'slept': st.toast('sleep', 'Kamu bangun segar!'); update['worldMeta'] = { ...st.worldMeta, timeMin: e.time as number, day: e.day as number }; break;
      case 'gain': {
        const items = e.items as Record<string, number>;
        const names = Object.entries(items).map(([id, q]) => `${st.defs?.items?.[id]?.name || id} x${q}`);
        if (names.length) st.toast('success', `+ ${names.join(', ')}`);
        break;
      }
      case 'fish_result': {
        const caught = !!e.caught;
        const fish = e.fish as { name: string };
        st.toast(caught ? 'fish' : 'info', caught ? `🎣 ${fish.name} berhasil dipancing!` : 'Ikan lolos! Coba lagi.');
        break;
      }
      case 'legendary_catch': st.toast('festival', `✨ ${e.name} menangkap ${e.fish}!`); break;
      case 'shop_sold': {
        const price = e.price as number;
        st.toast(price >= 0 ? 'info' : 'success', `${st.defs?.items?.[e.item as string]?.name || e.item} x${e.qty} → ${Math.abs(price)} G`);
        break;
      }
      case 'festival_pts': st.toast('festival', `Poin festival: ${e.points}`); break;
      case 'rain_watered': st.toast('info', 'Hujan menyirami tanamanmu!'); break;
      case 'house_upgrade_visual': st.toast('craft', `Rumah ${e.name || 'seseorang'} naik ke Lv ${e.level}!`); break;
      case 'join': st.toast('info', `${e.name} bergabung ke dunia!`); break;
      case 'leave': st.toast('info', `${e.name} pergi.`); break;
      default: break;
    }
    if (Object.keys(update).length) set(update);
  },

  setInteraction: (h) => set((s) => (s.interaction.kind === h.kind && s.interaction.label === h.label ? s : { interaction: h })),
  setMenu: (m) => set({ menu: m }),
  setDialogue: (d) => set({ dialogue: d }),
  toast: (kind, msg) => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts.slice(-(MAX_TOASTS - 1)), { id, kind, msg }] }));
    setTimeout(() => get().dismissToast(id), 4200);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter(t => t.id !== id) })),
  pushChat: (line) => set((s) => ({ chat: [...s.chat.slice(-49), line] })),
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setFps: (fps) => set({ fps }),
  setMine: (m) => set({ mine: m }),
  setPlayersShort: (list) => set({ playersShort: Object.fromEntries(list.map(p => [p.id, p])) }),
  setFishing: (f) => set({ fishing: f }),
  setSelectedItem: (id) => set({ selectedItem: id }),
  setChatOpen: (open) => set({ chatOpen: open }),
  reset: () => set({
    status: 'connecting', screen: 'orientation', errorMsg: '', me: null, defs: null, prices: {},
    worldMeta: initialMeta, playersShort: {}, interaction: { kind: null, label: '', x: 0, y: 0 },
    menu: null, dialogue: null, toasts: [], chat: [], mine: null, festivalBanner: null, wasInGame: false,
    fishing: { phase: 'idle', startAt: 0, biteAt: 0 }, selectedItem: null, chatOpen: false,
  }),
}));
