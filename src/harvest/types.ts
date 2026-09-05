// Harvest Moon — client-side protocol & shared types.
// The server is the single source of truth; these types mirror its JSON.

export type ConnectionStatus =
  | 'connecting'
  | 'hello'
  | 'ready'
  | 'reconnecting'
  | 'lost'
  | 'closed'
  | 'connected'
  | 'error';

export type Screen = 'orientation' | 'loading' | 'error' | 'creator' | 'game';

export interface CharDef {
  name: string;
  farmName: string;
  gender: 'male' | 'female' | 'nonbinary';
  hair: string;
  hairColor: string;
  skin: string;
  eye: string;
  eyeStyle: string;
  outfit: string;
  outfitColor: string;
  shoes: string;
  accessory: string;
}

export interface InvSlot { id: string; qty: number; }

export interface Skill { xp: number; level: number; }

export interface RelEntry {
  hearts: number;
  talkedDay: number;
  giftedDay: number;
  questDay: number;
}

export interface FurnitureItem { id: string; item: string; x: number; y: number; }

export interface AnimalState {
  id: string;
  type: string;
  name: string;
  x: number;
  y: number;
  hunger: number;
  happiness: number;
  health: number;
  friendship: number;
  ageDays: number;
  produceAt: number;
  personality: string;
}

export interface PlayerState {
  id: string;
  username: string;
  farmName: string;
  char: CharDef | null;
  x: number;
  y: number;
  dir: number;
  anim: string;
  sprint: boolean;
  gold: number;
  stamina: number;
  maxStamina: number;
  inv: InvSlot[];
  invMax: number;
  skills: Record<string, Skill>;
  quests: {
    active: string[];
    done: string[];
    progress: Record<string, number>;
  };
  journal: Record<string, Record<string, boolean>>;
  rel: Record<string, RelEntry>;
  spouse: string | null;
  house: { level: number; furniture: FurnitureItem[] };
  buffs: { id: string; expiresAt: number; speed: number }[];
  stats: Record<string, number>;
  animals: AnimalState[];
  toolLevels: Record<string, number>;
}

export interface ItemDef {
  name: string;
  cat: 'tool' | 'crop' | 'seed' | 'forage' | 'fish' | 'mineral' | 'product' | 'meal' | 'furniture' | 'fert' | 'bait' | 'insect' | 'special';
  value: number;
  color: string;
  rare?: boolean;
  buff?: { stam: number; speed: number; duration: number };
}

export interface CropDef {
  id: string;
  seed: string;
  season: string;
  days: number;
  value: number;
  colors: string[];
  rare?: boolean;
}

export interface FishDef {
  id: string;
  name: string;
  rarity: number;
  zones: string[];
  seasons: string[];
  times: string[];
  value: number;
  need: number;
  color: string;
  legendary?: boolean;
}

export interface RecipeDef {
  id: string;
  kind: 'cook' | 'craft';
  name: string;
  out: string;
  needs: Record<string, number>;
  unlock: { skill: string; level: number };
  rare?: boolean;
}

export interface NpcDef {
  id: string;
  name: string;
  role: string;
  color: string;
  home: [number, number];
  work: [number, number];
}

export interface NpcState { id: string; x: number; y: number; anim: string; state: string; }

export interface QuestDef {
  id: string;
  name: string;
  desc: string;
  objectives: { kind: string; count: number }[];
  reward: { gold: number; items?: Record<string, number> };
}

export interface ProjectDef {
  id: string;
  name: string;
  needs: Record<string, number>;
  desc: string;
}

export interface Defs {
  items: Record<string, ItemDef>;
  crops: Record<string, CropDef>;
  fish: FishDef[];
  recipes: RecipeDef[];
  npcs: NpcDef[];
  likes: Record<string, { like: string[]; dislike: string[] }>;
  animals: Record<string, { name: string; price: number; product: string | null; produceDays: number; color: string }>;
  festivals: { id: string; name: string; season: string; day: number; type: string }[];
  projects: ProjectDef[];
  quests: Record<string, QuestDef[]>;
  skills: Record<string, string>;
  seasons: string[];
  shops: string[];
}

export interface WorldState {
  size: [number, number];
  tileRLE: string;
  mineDoor: { x: number; y: number };
  bridge: { x: number; y: number };
  villageCenter: { x: number; y: number };
  farmArea: { x0: number; y0: number; x1: number; y1: number };
  time: number;
  day: number;
  season: string;
  weather: string;
  npcs: Record<string, NpcState>;
  crops: Record<string, { crop: string; stage: number; water: number; grow: number; fert: number; quality: number }>;
  tilled: Record<string, { water: number; fert: number; quality: number }>;
  forage: Record<string, { item: string; respawnAt: number }>;
  trees: Record<string, { left: number; respawnAt: number }>;
  community: Record<string, { contributions: Record<string, number>; done: boolean }>;
  mine: { depth: number; maxDepth: number };
  festival: {
    active: boolean;
    def: { id: string; name: string; type: string } | null;
    items?: { x: number; y: number; item: string }[];
  };
}

export interface SnapshotMsg {
  t: 'snapshot';
  world: WorldState;
  me: PlayerState;
  players: PlayerState[];
  defs: Defs;
  prices: Record<string, { buy: number; sell: number }>;
  serverTime: number;
}

export interface SnapMsg {
  t: 'snap';
  time: number;
  day: number;
  season: string;
  weather: string;
  players: [string, number, number, number, string, number, number][];
  npcs: [string, number, number, string, string][];
  /** id → display name, so the map/chat can label remote players. */
  names?: [string, string][];
  /** server timestamp (ms) */
  st?: number;
  /** last input sequence the server accepted from THIS client */
  ack?: number;
  /** authoritative position of THIS client */
  mx?: number;
  my?: number;
}

export interface EventMsg {
  t: 'event';
  e: Record<string, unknown> & { type: string };
}

export interface HelloAck {
  t: 'hello_ack';
  player: PlayerState | null;
  needsCreation: boolean;
}

export interface ErrMsg { t: 'err'; code: string; msg: string; }

export type ServerMsg = SnapshotMsg | SnapMsg | EventMsg | HelloAck | ErrMsg | { t: 'pong'; ts: number };

export type ClientMsg =
  | { t: 'hello'; room: string; userId: string; username: string }
  | { t: 'create'; char: CharDef; farmName: string }
  | { t: 'move'; x: number; y: number; dir: number; anim: string; sprint: boolean; seq: number }
  | { t: 'action'; a: string; actionId?: string; [k: string]: unknown }
  | { t: 'chat'; text: string; channel?: ChatChannel; to?: string }
  | { t: 'emote'; emote: string }
  | { t: 'ping'; ts: number }
  | { t: 'req_state' };

export interface InteractionHint {
  kind: 'till' | 'plant' | 'water' | 'harvest' | 'chop' | 'forage' | 'fish' | 'talk' | 'pet' | 'collect' | 'mine' | 'exit' | 'door' | 'quest' | 'shop' | 'sleep' | 'gift' | 'festival' | 'grove' | null;
  label: string;
  x: number;
  y: number;
  extra?: Record<string, unknown>;
}

export interface UiToast { id: number; kind: 'info' | 'success' | 'warn' | 'quest' | 'heart' | 'fish' | 'craft' | 'festival' | 'world' | 'animal' | 'sleep'; msg: string; }

export type ChatChannel = 'public' | 'private';

export interface ChatLine {
  id: string;
  channel: ChatChannel;
  playerId: string;
  name: string;
  text: string;
  ts: number;
  /** private only */
  targetPlayerId?: string;
  targetName?: string;
  /** local echo not yet confirmed by the server */
  pending?: boolean;
}

/** A private conversation with one other player. */
export interface Conversation {
  peerId: string;
  peerName: string;
  unread: number;
  lastTs: number;
}

export interface DialogueState {
  npcId: string;
  lines: string[];
  heartGain: number;
  hearts: number;
  canShop: boolean;
  canGift: boolean;
}

export type MenuId =
  | 'inventory' | 'map' | 'players' | 'quests' | 'journal' | 'relationships' | 'skills'
  | 'crafting' | 'cooking' | 'settings' | 'house' | 'shop' | 'rancher' | 'upgrade'
  | 'community' | 'museum' | 'festival' | 'mine' | 'help' | null;

export const TILE = { grass: 0, path: 1, soil: 2, water: 3, sand: 4, rock: 5, forest: 6, flower: 7, mountain: 8, plaza: 9 } as const;
