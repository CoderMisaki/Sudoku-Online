/**
 * Harvest Moon — realtime open-world farming & life simulation
 * AUTHORITATIVE GAME SERVER (zero runtime dependencies).
 *
 * - WebSocket protocol over the Next.js HTTP server (same origin, /ws/harvest).
 * - Worlds are keyed by room code; up to 16 players per world.
 * - Server = source of truth: inventory, gold, crops, quests, economy, skills,
 *   animals, housing, community projects. Clients only send inputs.
 * - Persistent: worlds + players are saved to disk (server/data) and reloaded.
 * - Deterministic world generation from the room code seed.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, 'data');
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const nowMs = () => Date.now();
const uid = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);

// ─────────────────────────────────────────────────────────────────────────────
// Game data (single source of truth — also streamed to clients)
// ─────────────────────────────────────────────────────────────────────────────
const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
const SEASON_DAYS = 7; // demo pace: 7 game days per season
const DAY_REAL_SECONDS = 600; // 10 real minutes per game day
const GAME_MIN_PER_REAL_SEC = 1440 / DAY_REAL_SECONDS; // 2.4 game min per real sec

const ITEMS = {
  tool_hoe:    { name: 'Hoe',          cat: 'tool',     value: 0,  color: '#c08a4e' },
  tool_can:    { name: 'Watering Can', cat: 'tool',     value: 0,  color: '#4aa3df' },
  tool_sickle: { name: 'Sickle',       cat: 'tool',     value: 0,  color: '#b9c2cc' },
  tool_axe:    { name: 'Axe',          cat: 'tool',     value: 0,  color: '#8a6a3f' },
  tool_pick:   { name: 'Pickaxe',      cat: 'tool',     value: 0,  color: '#7c6f64' },
  tool_rod:    { name: 'Fishing Rod',  cat: 'tool',     value: 0,  color: '#6b4f2a' },
  tool_net:    { name: 'Bug Net',      cat: 'tool',     value: 0,  color: '#4caf7d' },

  seed_turnip:   { name: 'Turnip Seeds',   cat: 'seed', value: 8,  color: '#e8d9c0' },
  seed_potato:   { name: 'Potato Seeds',   cat: 'seed', value: 12, color: '#d9b380' },
  seed_tomato:   { name: 'Tomato Seeds',   cat: 'seed', value: 16, color: '#e05b4b' },
  seed_corn:     { name: 'Corn Seeds',     cat: 'seed', value: 20, color: '#f2d24b' },
  seed_pumpkin:  { name: 'Pumpkin Seeds',  cat: 'seed', value: 30, color: '#ef8e3b' },
  seed_strawberry: { name: 'Strawberry Seeds', cat: 'seed', value: 26, color: '#e74f6f' },
  seed_melon:    { name: 'Melon Seeds',    cat: 'seed', value: 34, color: '#7fbf5f' },
  seed_carrot:   { name: 'Carrot Seeds',   cat: 'seed', value: 10, color: '#ef8e3b' },

  crop_turnip:   { name: 'Turnip',       cat: 'crop', value: 20,  color: '#e8d9c0' },
  crop_potato:   { name: 'Potato',       cat: 'crop', value: 28,  color: '#d9b380' },
  crop_tomato:   { name: 'Tomato',       cat: 'crop', value: 36,  color: '#e05b4b' },
  crop_corn:     { name: 'Corn',         cat: 'crop', value: 45,  color: '#f2d24b' },
  crop_pumpkin:  { name: 'Pumpkin',      cat: 'crop', value: 70,  color: '#ef8e3b' },
  crop_strawberry: { name: 'Strawberry', cat: 'crop', value: 60,  color: '#e74f6f' },
  crop_melon:    { name: 'Melon',        cat: 'crop', value: 85,  color: '#7fbf5f' },
  crop_carrot:   { name: 'Carrot',       cat: 'crop', value: 26,  color: '#ef8e3b' },
  crop_goldleaf: { name: 'Golden Leaf',  cat: 'crop', value: 500, color: '#f2c94c', rare: true },

  berry:      { name: 'Sun Berry',     cat: 'forage', value: 12, color: '#e05b4b' },
  herb:       { name: 'Meadow Herb',   cat: 'forage', value: 10, color: '#5fbf6f' },
  mushroom:   { name: 'Forest Mushroom', cat: 'forage', value: 15, color: '#b2704a' },
  flower_spring: { name: 'Blossom',    cat: 'forage', value: 14, color: '#f0a8c8' },
  flower_summer: { name: 'Sun Lily',   cat: 'forage', value: 14, color: '#f2d24b' },
  flower_autumn: { name: 'Maple Bloom', cat: 'forage', value: 14, color: '#ef8e3b' },
  shell:      { name: 'Sea Shell',     cat: 'forage', value: 8,  color: '#e8d9c0' },
  branch:     { name: 'Branch',        cat: 'forage', value: 4,  color: '#8a6a3f' },
  stone:      { name: 'Stone',         cat: 'forage', value: 3,  color: '#9aa0a6' },
  wood:       { name: 'Wood',          cat: 'forage', value: 12, color: '#a5714a' },
  fiber:      { name: 'Fiber',         cat: 'forage', value: 5,  color: '#c9b98a' },
  resin:      { name: 'Tree Resin',    cat: 'forage', value: 18, color: '#d9a05b' },
  honey:      { name: 'Honey',         cat: 'forage', value: 30, color: '#f2c94c' },
  crystal:    { name: 'Sky Crystal',   cat: 'forage', value: 120, color: '#a5d8ff', rare: true },
  artifact_bowl: { name: 'Ancient Bowl', cat: 'forage', value: 220, color: '#cbb89a', rare: true },
  artifact_coin: { name: 'Old Coin',     cat: 'forage', value: 90,  color: '#f2c94c', rare: true },

  ore_copper: { name: 'Copper Ore',    cat: 'mineral', value: 14, color: '#d98e5b' },
  ore_iron:   { name: 'Iron Ore',      cat: 'mineral', value: 26, color: '#9aa0a6' },
  ore_gold:   { name: 'Gold Ore',      cat: 'mineral', value: 55, color: '#f2c94c' },
  gem_emerald: { name: 'Emerald',      cat: 'mineral', value: 160, color: '#4caf7d' },
  gem_ruby:    { name: 'Ruby',         cat: 'mineral', value: 180, color: '#e05b4b' },
  gem_sapphire:{ name: 'Sapphire',     cat: 'mineral', value: 200, color: '#4aa3df' },
  gem_diamond: { name: 'Diamond',      cat: 'mineral', value: 320, color: '#d7e8f7', rare: true },

  milk:     { name: 'Milk',  cat: 'product', value: 45,  color: '#f2f2f2' },
  egg:      { name: 'Egg',   cat: 'product', value: 25,  color: '#ffe9c9' },
  wool:     { name: 'Wool',  cat: 'product', value: 60,  color: '#e8e0d4' },
  cheese:   { name: 'Cheese', cat: 'product', value: 110, color: '#f2d86b' },
  mayo:     { name: 'Mayo',  cat: 'product', value: 95,  color: '#fdf3d0' },
  feather:  { name: 'Feather', cat: 'product', value: 15, color: '#e8e0d4' },

  butterfly: { name: 'Butterfly',   cat: 'insect', value: 18, color: '#f0a8c8' },
  firefly:   { name: 'Firefly',     cat: 'insect', value: 22, color: '#f2d24b' },
  beetle:    { name: 'Stag Beetle', cat: 'insect', value: 30, color: '#5a4632' },
  dragonfly: { name: 'Dragonfly',   cat: 'insect', value: 26, color: '#4aa3df' },

  fert_basic: { name: 'Basic Fertilizer', cat: 'fert', value: 25, color: '#9a7b4f' },
  fert_rich:  { name: 'Rich Fertilizer',  cat: 'fert', value: 60, color: '#6b4f2a' },
  bait_worm:  { name: 'Worm',        cat: 'bait', value: 5,  color: '#c98a6b' },
  bait_grub:  { name: 'Glow Grub',   cat: 'bait', value: 20, color: '#a5d8ff' },

  pie:       { name: 'Berry Pie',     cat: 'meal', value: 90,  color: '#f0a8c8', buff: { stam: 40, speed: 0, duration: 30 } },
  soup:      { name: 'Mushroom Soup', cat: 'meal', value: 80,  color: '#b2704a', buff: { stam: 30, speed: 0, duration: 30 } },
  salad:     { name: 'Garden Salad',  cat: 'meal', value: 70,  color: '#7fbf5f', buff: { stam: 35, speed: 0, duration: 30 } },
  stew:      { name: 'Harvest Stew',  cat: 'meal', value: 150, color: '#d98e5b', buff: { stam: 70, speed: 0, duration: 45 } },
  omelette:  { name: 'Meadow Omelette', cat: 'meal', value: 85, color: '#f2d24b', buff: { stam: 50, speed: 0, duration: 30 } },
  cheese_plate: { name: 'Cheese Plate', cat: 'meal', value: 120, color: '#f2d86b', buff: { stam: 45, speed: 0, duration: 30 } },
  fish_sushi: { name: 'Lake Sushi',   cat: 'meal', value: 130, color: '#a5d8ff', buff: { stam: 55, speed: 0, duration: 30 } },
  fish_grill: { name: 'Grilled Fish', cat: 'meal', value: 110, color: '#d98e5b', buff: { stam: 45, speed: 0, duration: 30 } },
  berry_juice: { name: 'Berry Juice', cat: 'meal', value: 60,  color: '#e74f6f', buff: { stam: 25, speed: 0.1, duration: 60 } },
  energy_tonic: { name: 'Energy Tonic', cat: 'meal', value: 200, color: '#a5d8ff', buff: { stam: 100, speed: 0, duration: 60 } },
  golden_bread: { name: 'Golden Bread', cat: 'meal', value: 260, color: '#f2c94c', buff: { stam: 120, speed: 0.15, duration: 90 }, rare: true },
  honey_tea: { name: 'Honey Tea',    cat: 'meal', value: 95,  color: '#f2c94c', buff: { stam: 35, speed: 0.05, duration: 60 } },

  furn_bed:   { name: 'Bed',      cat: 'furniture', value: 300, color: '#8a6a3f' },
  furn_chest: { name: 'Chest',    cat: 'furniture', value: 220, color: '#9a7b4f' },
  furn_kitchen: { name: 'Kitchen', cat: 'furniture', value: 450, color: '#c9b98a' },
  furn_bench: { name: 'Workbench', cat: 'furniture', value: 380, color: '#8a6a3f' },
  furn_lamp:  { name: 'Lamp',     cat: 'furniture', value: 120, color: '#f2d24b' },
  furn_plant: { name: 'Plant Pot', cat: 'furniture', value: 90,  color: '#4caf7d' },
  furn_rug:   { name: 'Rug',      cat: 'furniture', value: 110, color: '#e05b4b' },
  furn_table: { name: 'Table',    cat: 'furniture', value: 160, color: '#a5714a' },
  furn_chair: { name: 'Chair',    cat: 'furniture', value: 80,  color: '#a5714a' },

  golden_apple: { name: 'Golden Apple', cat: 'special', value: 1000, color: '#f2c94c', rare: true },
};

const CROPS = {
  crop_turnip: { id: 'crop_turnip', seed: 'seed_turnip', season: 'spring', days: 4, value: 20, colors: ['#8fae57', '#9cba5c', '#a8c465', '#b8d06f', '#c3d877'] },
  crop_potato: { id: 'crop_potato', seed: 'seed_potato', season: 'spring', days: 5, value: 28, colors: ['#7f9e4e', '#8aa854', '#94b25b', '#9ebc61', '#a9c066'] },
  crop_tomato: { id: 'crop_tomato', seed: 'seed_tomato', season: 'summer', days: 5, value: 36, colors: ['#6f9e4e', '#7aa855', '#85b25c', '#e05b4b', '#e05b4b'] },
  crop_corn:   { id: 'crop_corn',   seed: 'seed_corn',   season: 'summer', days: 6, value: 45, colors: ['#7fae4e', '#8fb957', '#a0c460', '#b0cf6a', '#f2d24b'] },
  crop_pumpkin:{ id: 'crop_pumpkin', seed: 'seed_pumpkin', season: 'autumn', days: 7, value: 70, colors: ['#6f9e4e', '#7aa855', '#ef8e3b', '#ef8e3b', '#ef8e3b'] },
  crop_strawberry: { id: 'crop_strawberry', seed: 'seed_strawberry', season: 'spring', days: 4, value: 60, colors: ['#6f9e4e', '#7aa855', '#85b25c', '#e74f6f', '#e74f6f'] },
  crop_melon:  { id: 'crop_melon',  seed: 'seed_melon',  season: 'summer', days: 8, value: 85, colors: ['#6f9e4e', '#7aa855', '#85b25c', '#8fbf62', '#7fbf5f'] },
  crop_carrot: { id: 'crop_carrot', seed: 'seed_carrot', season: 'winter', days: 4, value: 26, colors: ['#6f9e4e', '#7aa855', '#85b25c', '#ef8e3b', '#ef8e3b'] },
  crop_goldleaf: { id: 'crop_goldleaf', seed: 'crop_goldleaf_seed', season: 'spring', days: 9, value: 500, colors: ['#c9b98a', '#d4c291', '#dfcba0', '#f2c94c', '#f2c94c'], rare: true },
};

const FISH = [
  { id: 'fish_sardine',  name: 'Sand Sardine',  rarity: 1, zones: ['beach'],        seasons: ['spring', 'summer', 'autumn'], times: ['day'],        value: 12, need: 55, color: '#9cc4e0' },
  { id: 'fish_bass',     name: 'River Bass',    rarity: 1, zones: ['river'],        seasons: ['spring', 'summer', 'autumn'], times: ['day'],        value: 16, need: 55, color: '#7fb2d5' },
  { id: 'fish_koi',      name: 'Koi',           rarity: 2, zones: ['lake'],         seasons: ['spring', 'summer'],            times: ['day'],        value: 34, need: 62, color: '#f28c6b' },
  { id: 'fish_shrimp',   name: 'Prawn',         rarity: 1, zones: ['beach'],        seasons: ['summer'],                      times: ['day', 'night'], value: 18, need: 50, color: '#f2b48a' },
  { id: 'fish_trout',    name: 'Rainbow Trout', rarity: 2, zones: ['river'],        seasons: ['spring', 'autumn'],            times: ['day'],        value: 38, need: 64, color: '#a5d8ff' },
  { id: 'fish_catfish',  name: 'Catfish',       rarity: 2, zones: ['river', 'lake'], seasons: ['autumn', 'winter'],         times: ['night'],      value: 42, need: 66, color: '#8a6a3f' },
  { id: 'fish_salmon',   name: 'Salmon',        rarity: 3, zones: ['river'],        seasons: ['autumn'],                      times: ['day', 'night'], value: 70, need: 72, color: '#f2a08c' },
  { id: 'fish_eel',      name: 'Eel',           rarity: 3, zones: ['river', 'lake'], seasons: ['summer', 'autumn'],         times: ['night'],      value: 78, need: 74, color: '#5a7a4a' },
  { id: 'fish_glowfish', name: 'Glowfish',      rarity: 3, zones: ['lake'],         seasons: ['summer'],                      times: ['night'],      value: 85, need: 76, color: '#a5d8ff' },
  { id: 'fish_pike',     name: 'Pike',          rarity: 3, zones: ['river'],        seasons: ['winter'],                      times: ['day'],        value: 90, need: 78, color: '#9aa0a6' },
  { id: 'fish_squid',    name: 'Squid',         rarity: 4, zones: ['beach'],        seasons: ['winter'],                      times: ['night'],      value: 140, need: 82, color: '#cbb8d8' },
  { id: 'fish_crab',     name: 'Moon Crab',     rarity: 4, zones: ['beach', 'lake'], seasons: ['summer'],                    times: ['night'],      value: 150, need: 84, color: '#e07a5f' },
  { id: 'fish_rainbow',  name: 'Rainbow Carp',  rarity: 4, zones: ['lake'],         seasons: ['spring'],                      times: ['day'],        value: 160, need: 86, color: '#f0a8c8' },
  { id: 'fish_angler',   name: 'Deep Angler',   rarity: 5, zones: ['lake'],         seasons: ['winter'],                      times: ['night'],      value: 260, need: 90, color: '#4a5a6a' },
  { id: 'fish_moon',     name: 'Moonlight Fish', rarity: 5, zones: ['river', 'lake'], seasons: ['autumn'],                   times: ['night'],      value: 300, need: 92, color: '#cbb8d8' },
  { id: 'fish_legend',   name: 'The Everglow',  rarity: 5, zones: ['beach'],        seasons: ['summer'],                      times: ['day'],        value: 800, need: 95, color: '#f2c94c', legendary: true },
];

const RECIPES = [
  // Cooking
  { id: 'rec_pie',    kind: 'cook',  name: 'Berry Pie',     out: 'pie',        needs: { berry: 2, egg: 1, crop_turnip: 1 }, unlock: { skill: 'cooking', level: 1 } },
  { id: 'rec_soup',   kind: 'cook',  name: 'Mushroom Soup', out: 'soup',       needs: { mushroom: 2, crop_potato: 1 },      unlock: { skill: 'cooking', level: 1 } },
  { id: 'rec_salad',  kind: 'cook',  name: 'Garden Salad',  out: 'salad',      needs: { crop_tomato: 2, herb: 1 },          unlock: { skill: 'cooking', level: 2 } },
  { id: 'rec_stew',   kind: 'cook',  name: 'Harvest Stew',  out: 'stew',       needs: { crop_pumpkin: 1, crop_carrot: 1, milk: 1 }, unlock: { skill: 'cooking', level: 3 } },
  { id: 'rec_omel',   kind: 'cook',  name: 'Meadow Omelette', out: 'omelette', needs: { egg: 2, mushroom: 1 },             unlock: { skill: 'cooking', level: 2 } },
  { id: 'rec_cheese', kind: 'cook',  name: 'Cheese Plate',  out: 'cheese_plate', needs: { cheese: 1, crop_tomato: 1 },     unlock: { skill: 'cooking', level: 3 } },
  { id: 'rec_sushi',  kind: 'cook',  name: 'Lake Sushi',    out: 'fish_sushi', needs: { fish_salmon: 1, crop_carrot: 1 },  unlock: { skill: 'cooking', level: 4 } },
  { id: 'rec_grill',  kind: 'cook',  name: 'Grilled Fish',  out: 'fish_grill', needs: { fish_bass: 1, herb: 1 },            unlock: { skill: 'cooking', level: 2 } },
  { id: 'rec_juice',  kind: 'cook',  name: 'Berry Juice',   out: 'berry_juice', needs: { berry: 3 },                        unlock: { skill: 'cooking', level: 3 } },
  { id: 'rec_tonic',  kind: 'cook',  name: 'Energy Tonic',  out: 'energy_tonic', needs: { honey: 1, branch: 2, crystal: 1 }, unlock: { skill: 'cooking', level: 5 } },
  { id: 'rec_bread',  kind: 'cook',  name: 'Golden Bread',  out: 'golden_bread', needs: { crop_goldleaf: 1, egg: 2, honey: 2 }, unlock: { skill: 'cooking', level: 6 }, rare: true },
  { id: 'rec_tea',    kind: 'cook',  name: 'Honey Tea',     out: 'honey_tea',  needs: { honey: 1, herb: 1 },                unlock: { skill: 'cooking', level: 1 } },
  // Crafting
  { id: 'rec_axe',    kind: 'craft', name: 'Axe',           out: 'tool_axe',   needs: { wood: 8, stone: 4 },                unlock: { skill: 'crafting', level: 1 } },
  { id: 'rec_pick',   kind: 'craft', name: 'Pickaxe',       out: 'tool_pick',  needs: { wood: 6, stone: 6 },                unlock: { skill: 'crafting', level: 1 } },
  { id: 'rec_rod',    kind: 'craft', name: 'Fishing Rod',   out: 'tool_rod',   needs: { branch: 5, fiber: 6 },              unlock: { skill: 'crafting', level: 1 } },
  { id: 'rec_net',    kind: 'craft', name: 'Bug Net',       out: 'tool_net',   needs: { branch: 3, fiber: 8 },              unlock: { skill: 'crafting', level: 1 } },
  { id: 'rec_bed',    kind: 'craft', name: 'Bed',           out: 'furn_bed',   needs: { wood: 12, wool: 1 },                unlock: { skill: 'crafting', level: 2 } },
  { id: 'rec_chest',  kind: 'craft', name: 'Chest',         out: 'furn_chest', needs: { wood: 15, ore_iron: 2 },            unlock: { skill: 'crafting', level: 2 } },
  { id: 'rec_kitchen',kind: 'craft', name: 'Kitchen',       out: 'furn_kitchen', needs: { wood: 20, stone: 12, ore_iron: 4 }, unlock: { skill: 'crafting', level: 3 } },
  { id: 'rec_bench',  kind: 'craft', name: 'Workbench',     out: 'furn_bench', needs: { wood: 18, stone: 8 },              unlock: { skill: 'crafting', level: 3 } },
  { id: 'rec_lamp',   kind: 'craft', name: 'Lamp',          out: 'furn_lamp',  needs: { wood: 4, crystal: 1 },              unlock: { skill: 'crafting', level: 2 } },
  { id: 'rec_plant',  kind: 'craft', name: 'Plant Pot',     out: 'furn_plant', needs: { wood: 3, fiber: 3 },                unlock: { skill: 'crafting', level: 1 } },
  { id: 'rec_rug',    kind: 'craft', name: 'Rug',           out: 'furn_rug',   needs: { fiber: 8 },                         unlock: { skill: 'crafting', level: 1 } },
  { id: 'rec_table',  kind: 'craft', name: 'Table',         out: 'furn_table', needs: { wood: 10 },                         unlock: { skill: 'crafting', level: 1 } },
  { id: 'rec_chair',  kind: 'craft', name: 'Chair',         out: 'furn_chair', needs: { wood: 6 },                          unlock: { skill: 'crafting', level: 1 } },
  { id: 'rec_fert',   kind: 'craft', name: 'Basic Fertilizer', out: 'fert_basic', needs: { fiber: 4, stone: 2 },            unlock: { skill: 'farming', level: 2 } },
  { id: 'rec_fertrich', kind: 'craft', name: 'Rich Fertilizer', out: 'fert_rich', needs: { fert_basic: 2, crop_pumpkin: 1 }, unlock: { skill: 'farming', level: 5 } },
];

const NPCS = [
  { id: 'npc_mae',    name: 'Mae',       role: 'farmer',     home: [112, 120], work: [118, 132], color: '#8ba84e' },
  { id: 'npc_ren',    name: 'Ren',       role: 'blacksmith', home: [104, 128], work: [103, 119], color: '#7c6f64' },
  { id: 'npc_lu',     name: 'Luma',      role: 'fisher',     home: [150, 84],  work: [160, 72],  color: '#4aa3df' },
  { id: 'npc_chef',   name: 'Coral',     role: 'chef',       home: [108, 138], work: [120, 133], color: '#e05b4b' },
  { id: 'npc_iris',   name: 'Iris',      role: 'librarian',  home: [116, 126], work: [117, 134], color: '#8b5cf6' },
  { id: 'npc_baker',  name: 'Wren',      role: 'baker',      home: [122, 122], work: [124, 133], color: '#d9a05b' },
  { id: 'npc_art',    name: 'Pip',       role: 'artist',     home: [130, 124], work: [128, 146], color: '#ec4899' },
  { id: 'npc_doc',    name: 'Sol',       role: 'doctor',     home: [134, 120], work: [134, 133], color: '#84cc16' },
  { id: 'npc_ranch',  name: 'Briar',     role: 'rancher',    home: [140, 118], work: [96, 160],  color: '#a5714a' },
  { id: 'npc_merch',  name: 'Fen',       role: 'merchant',   home: [146, 122], work: [138, 138], color: '#f2c94c' },
  { id: 'npc_curator',name: 'Tilly',     role: 'curator',    home: [110, 134], work: [111, 141], color: '#cbb8d8' },
  { id: 'npc_elder',  name: 'Ash',       role: 'elder',      home: [126, 138], work: [120, 145], color: '#bdc3c7' },
];
const NPC_LIKES = {
  npc_mae:    { like: ['crop_turnip', 'crop_tomato', 'fert_basic'],  dislike: ['fish_legend'] },
  npc_ren:    { like: ['ore_gold', 'gem_diamond', 'stone'],          dislike: ['flower_spring'] },
  npc_lu:     { like: ['fish_salmon', 'fish_koi', 'bait_grub'],     dislike: ['wool'] },
  npc_chef:   { like: ['cheese', 'pie', 'honey'],                    dislike: ['crystal'] },
  npc_iris:   { like: ['flower_spring', 'berry_juice', 'honey_tea'], dislike: ['ore_copper'] },
  npc_baker:  { like: ['egg', 'golden_bread', 'berry'],              dislike: ['fish_squid'] },
  npc_art:    { like: ['flower_autumn', 'gem_emerald', 'shell'],     dislike: ['branch'] },
  npc_doc:    { like: ['herb', 'mushroom', 'energy_tonic'],          dislike: ['fish_squid'] },
  npc_ranch:  { like: ['wool', 'milk', 'egg'],                       dislike: ['artifact_coin'] },
  npc_merch:  { like: ['gem_sapphire', 'honey', 'golden_apple'],     dislike: ['stone'] },
  npc_curator:{ like: ['artifact_bowl', 'artifact_coin', 'crystal'],dislike: ['branch'] },
  npc_elder:  { like: ['honey_tea', 'crop_goldleaf'],                dislike: ['beetle'] },
};

const ANIMALS = {
  cow:    { name: 'Cow',    price: 1200, product: 'milk',    produceDays: 1, color: '#f2f2f2' },
  chicken:{ name: 'Chicken', price: 350,  product: 'egg',     produceDays: 1, color: '#fdf3d0' },
  sheep:  { name: 'Sheep',  price: 900,  product: 'wool',    produceDays: 2, color: '#e8e0d4' },
  goat:   { name: 'Goat',   price: 800,  product: 'milk',    produceDays: 1, color: '#d9cbb4' },
  horse:  { name: 'Horse',  price: 2500, product: null,      produceDays: 0, color: '#8a6a3f' },
  cat:    { name: 'Cat',    price: 600,  product: null,      produceDays: 0, color: '#f0a8c8' },
  dog:    { name: 'Dog',    price: 600,  product: null,      produceDays: 0, color: '#d9b380' },
};

const FESTIVALS = [
  { id: 'fes_flower',  name: 'Flower Festival',     season: 'spring', day: 4, type: 'collect' },
  { id: 'fes_fishing', name: 'Fishing Tournament',  season: 'summer', day: 4, type: 'fish' },
  { id: 'fes_harvest', name: 'Harvest Festival',    season: 'autumn', day: 4, type: 'donate' },
  { id: 'fes_cooking', name: 'Cooking Competition', season: 'autumn', day: 6, type: 'cook' },
  { id: 'fes_animal',  name: 'Animal Festival',     season: 'winter', day: 4, type: 'animal' },
  { id: 'fes_winter',  name: 'Winter Festival',     season: 'winter', day: 7, type: 'give' },
  { id: 'fes_treasure', name: 'Treasure Hunt',      season: 'spring', day: 6, type: 'collect' },
  { id: 'fes_night',   name: 'Night Festival',      season: 'summer', day: 7, type: 'give' },
];

const SKILLS = ['farming', 'fishing', 'mining', 'cooking', 'crafting', 'foraging', 'animal', 'social', 'exploration'];
const SKILL_NAMES = {
  farming: 'Farming', fishing: 'Fishing', mining: 'Mining', cooking: 'Cooking', crafting: 'Crafting',
  foraging: 'Foraging', animal: 'Animal Care', social: 'Social', exploration: 'Exploration',
};

const QUESTS = {
  main: [
    { id: 'main_1', name: 'A New Beginning', desc: 'Till 1 soil tile and plant a seed.', objectives: [{ kind: 'till', count: 1 }, { kind: 'plant', count: 1 }], reward: { gold: 100, items: { seed_turnip: 5 } } },
    { id: 'main_2', name: 'The First Harvest', desc: 'Harvest 3 crops.', objectives: [{ kind: 'harvest', count: 3 }], reward: { gold: 150, items: { fert_basic: 2 } } },
    { id: 'main_3', name: 'Tools of the Trade', desc: 'Craft a Fishing Rod or Axe.', objectives: [{ kind: 'craft', count: 1 }], reward: { gold: 200, items: { bait_worm: 5 } } },
    { id: 'main_4', name: 'River Friends', desc: 'Catch 3 fish.', objectives: [{ kind: 'fish', count: 3 }], reward: { gold: 300, items: { seed_strawberry: 5 } } },
    { id: 'main_5', name: 'Heart of the Village', desc: 'Reach 3 hearts with any villager.', objectives: [{ kind: 'social', count: 3 }], reward: { gold: 500, items: { furn_lamp: 1 } } },
    { id: 'main_6', name: 'Into the Mines', desc: 'Mine 5 ores.', objectives: [{ kind: 'mine', count: 5 }], reward: { gold: 700, items: { ore_gold: 3, gem_sapphire: 1 } } },
  ],
  hidden: [
    { id: 'hidden_1', name: 'Secret Garden', desc: 'Find the hidden grove north of the forest.', objectives: [{ kind: 'explore_grove', count: 1 }], reward: { gold: 250, items: { crystal: 1 } } },
    { id: 'hidden_2', name: 'Night Angler', desc: 'Catch a fish at night.', objectives: [{ kind: 'fish_night', count: 1 }], reward: { gold: 300, items: { bait_grub: 3 } } },
    { id: 'hidden_3', name: 'Storm Harvester', desc: 'Harvest a crop during a storm.', objectives: [{ kind: 'harvest_storm', count: 1 }], reward: { gold: 350, items: { crop_goldleaf: 1 } } },
  ],
  daily: [
    { id: 'daily_forage', name: 'Daily: Forest Gifts', desc: 'Collect 3 foraged items.', objectives: [{ kind: 'forage', count: 3 }], reward: { gold: 80, items: { berry: 2 } } },
    { id: 'daily_water',  name: 'Daily: Green Thumb',  desc: 'Water 5 crops.', objectives: [{ kind: 'water', count: 5 }], reward: { gold: 60, items: { fert_basic: 1 } } },
    { id: 'daily_chop',   name: 'Daily: Woodcutter',   desc: 'Chop 3 trees.', objectives: [{ kind: 'chop', count: 3 }], reward: { gold: 70, items: { wood: 3 } } },
  ],
  weekly: [
    { id: 'weekly_harvest', name: 'Weekly: Bumper Crop', desc: 'Harvest 20 crops.', objectives: [{ kind: 'harvest', count: 20 }], reward: { gold: 400, items: { seed_pumpkin: 5 } } },
  ],
  multi: [
    { id: 'multi_1', name: 'Community: Road to the Harbor', desc: 'Contribute to a community project with another player nearby.', objectives: [{ kind: 'multi_contribute', count: 1 }], reward: { gold: 250 } },
  ],
};

const COMMUNITY_PROJECTS = [
  { id: 'cp_bridge',  name: 'Kelp Bridge',    needs: { wood: 20, stone: 10, fiber: 10 }, desc: 'Connects the village to the east bank.' },
  { id: 'cp_townhall',name: 'Town Hall',      needs: { wood: 40, stone: 30, ore_iron: 10 }, desc: 'The heart of village life.' },
  { id: 'cp_market',  name: 'Market Plaza',   needs: { wood: 35, stone: 25, fiber: 15 }, desc: 'Lowers shop prices for everyone.' },
  { id: 'cp_park',    name: 'Sunny Park',     needs: { wood: 25, flower_spring: 10, flower_summer: 10, flower_autumn: 10 }, desc: 'Flowers bloom across the village.' },
  { id: 'cp_harbor',  name: 'Harbor',         needs: { wood: 50, stone: 40, ore_iron: 15 }, desc: 'A dock where rare fish appear.' },
];

const SEASON_WEATHER = {
  spring: [['sunny', 60], ['rain', 25], ['fog', 10], ['wind', 5]],
  summer: [['sunny', 55], ['rain', 15], ['storm', 15], ['heatwave', 15]],
  autumn: [['sunny', 45], ['rain', 25], ['wind', 20], ['fog', 10]],
  winter: [['sunny', 30], ['snow', 45], ['storm', 10], ['fog', 15]],
};

const WORLD_W = 224;
const WORLD_H = 224;
const TILE = { grass: 0, path: 1, soil: 2, water: 3, sand: 4, rock: 5, forest: 6, flower: 7, mountain: 8, plaza: 9 };

// ─────────────────────────────────────────────────────────────────────────────
// World generation (deterministic from room seed) — server is the source of
// truth; the same RLE grid is shipped to clients.
// ─────────────────────────────────────────────────────────────────────────────
function generateTiles(roomCode) {
  const rng = mulberry32(hashSeed('tiles:' + roomCode));
  const g = new Uint8Array(WORLD_W * WORLD_H);
  const set = (x, y, v) => {
    if (x >= 0 && y >= 0 && x < WORLD_W && y < WORLD_H) g[y * WORLD_W + x] = v;
  };
  const fillRect = (x0, y0, x1, y1, v) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, v);
  };
  const fillCircle = (cx, cy, r, v) => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (dist2(x, y, cx, cy) <= r * r) set(x, y, v);
      }
    }
  };
  // Base: forest west, grass east
  fillRect(0, 0, WORLD_W - 1, WORLD_H - 1, TILE.grass);
  // Forest west & north-west
  for (let i = 0; i < 2600; i++) {
    const x = Math.floor(rng() * 92);
    const y = Math.floor(rng() * 96);
    if (rng() < 0.7) set(x, y, TILE.forest);
  }
  for (let i = 0; i < 900; i++) {
    const x = Math.floor(rng() * 60);
    const y = 96 + Math.floor(rng() * 40);
    set(x, y, TILE.forest);
  }
  // Mountain north-east
  for (let i = 0; i < 2200; i++) {
    const x = 168 + Math.floor(rng() * (WORLD_W - 168));
    const y = Math.floor(rng() * 64);
    set(x, y, TILE.mountain);
  }
  // River band across middle (y ~ 66..76), flows from west to east into lake
  for (let y = 66; y <= 76; y++) {
    const off = Math.round(Math.sin((y - 66) * 0.9) * 2);
    for (let x = 0; x < 190 + off; x++) {
      set(x + Math.max(0, off), y, TILE.water);
    }
  }
  // River bank smoothing: sand strips
  for (let x = 0; x < 192; x++) {
    set(x, 65, TILE.sand);
    set(x, 77, TILE.sand);
  }
  // Lake (east, near beach)
  fillCircle(175, 30, 22, TILE.water);
  fillCircle(160, 40, 16, TILE.water);
  fillCircle(178, 46, 18, TILE.water);
  // Beach south-east coast
  for (let i = 0; i < 1800; i++) {
    const x = 150 + Math.floor(rng() * (WORLD_W - 150));
    const y = 96 + Math.floor(rng() * (WORLD_H - 96));
    if (x > 178 || y > 150) set(x, y, TILE.sand);
  }
  // Ocean bottom-right corner (deep water edge)
  fillCircle(198, 196, 40, TILE.water);
  fillCircle(214, 178, 26, TILE.water);
  // Village plaza (center)
  fillCircle(120, 132, 12, TILE.plaza);
  fillRect(112, 122, 130, 142, TILE.path);
  // Farm area south-west — soil plots for players
  fillRect(30, 128, 92, 200, TILE.soil);
  // Paths
  fillRect(100, 128, 100, 146, TILE.path); // west road to farm
  fillRect(100, 128, 118, 130, TILE.path);
  fillRect(120, 104, 130, 120, TILE.path); // north road to lake/forest
  fillRect(104, 104, 130, 104, TILE.path);
  fillRect(60, 104, 104, 106, TILE.path);
  fillRect(60, 104, 62, 128, TILE.path);
  fillRect(120, 144, 140, 144, TILE.path); // to beach
  fillRect(138, 144, 140, 160, TILE.path);
  // Flower meadows
  fillCircle(150, 120, 6, TILE.flower);
  fillCircle(96, 92, 5, TILE.flower);
  fillCircle(66, 120, 5, TILE.flower);
  // Rocks scattered (non-walkable)
  for (let i = 0; i < 320; i++) {
    const x = Math.floor(rng() * WORLD_W);
    const y = Math.floor(rng() * WORLD_H);
    if (g[y * WORLD_W + x] === TILE.grass || g[y * WORLD_W + x] === TILE.flower) set(x, y, TILE.rock);
  }
  // Keep village clear
  fillCircle(120, 132, 14, TILE.plaza);
  fillRect(112, 122, 130, 142, TILE.path);
  // Secret grove entrance (north center, hidden by forest)
  fillCircle(96, 24, 9, TILE.flower);
  // Mine entrance markers (tile 8 has a door at fixed position)
  const mineDoor = { x: 180, y: 70 };
  set(mineDoor.x, mineDoor.y, TILE.path);
  // Bridge points across river (community project target)
  const bridge = { x: 120, y: 71 }; // buildable center
  set(bridge.x, bridge.y - 6, TILE.path);
  set(bridge.x, bridge.y + 6, TILE.path);
  return { grid: g, mineDoor, bridge, villageCenter: { x: 120, y: 132 }, farmArea: { x0: 30, y0: 128, x1: 92, y1: 200 } };
}

function rleEncode(grid) {
  let out = '';
  let run = 0;
  let prev = grid[0];
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i];
    if (v === prev && run < 255) run++;
    else {
      out += String.fromCharCode(prev, run);
      prev = v; run = 1;
    }
  }
  out += String.fromCharCode(prev, run);
  return out;
}
function rleDecode(str) {
  const grid = new Uint8Array(WORLD_W * WORLD_H);
  let i = 0, p = 0;
  while (i < str.length && p < grid.length) {
    const v = str.charCodeAt(i++);
    const run = str.charCodeAt(i++);
    for (let k = 0; k < run && p < grid.length; k++) grid[p++] = v;
  }
  return grid;
}

// Mine generation
function generateMineDepth(roomCode, depth) {
  const rng = mulberry32(hashSeed('mine:' + roomCode + ':' + depth));
  const S = 26;
  const g = new Uint8Array(S * S).fill(1); // 1 = wall
  for (let y = 1; y < S - 1; y++) {
    for (let x = 1; x < S - 1; x++) {
      // carve organic tunnels
      const n = Math.sin(x * 1.7 + depth) + Math.cos(y * 1.3 + depth * 2) + rng() * 2;
      g[y * S + x] = n > 0.4 ? 0 : 1;
    }
  }
  // guarantee connectivity: carve a snaking main tunnel
  let cx = 1, cy = Math.floor(S / 2);
  for (let x = 1; x < S - 1; x++) {
    for (let y = Math.max(1, cy - 2); y <= Math.min(S - 2, cy + 2); y++) g[y * S + x] = 0;
    if (rng() < 0.4) cy = clamp(cy + (rng() < 0.5 ? 1 : -1), 3, S - 4);
  }
  g[cy * S + 1] = 0; // entrance
  const ores = {};
  const rarities = depth <= 1 ? ['ore_copper'] : depth === 2 ? ['ore_copper', 'ore_iron'] : depth === 3 ? ['ore_iron', 'ore_gold'] : depth === 4 ? ['ore_gold', 'gem_emerald'] : depth === 5 ? ['ore_gold', 'gem_sapphire', 'gem_ruby'] : ['gem_diamond', 'gem_ruby', 'ore_gold'];
  const count = 18 + depth * 8;
  for (let i = 0; i < count; i++) {
    const x = 1 + Math.floor(rng() * (S - 2));
    const y = 1 + Math.floor(rng() * (S - 2));
    if (g[y * S + x] === 0 && !(x === 1 && Math.abs(y - cy) <= 2)) {
      const ore = rarities[Math.floor(rng() * rarities.length)];
      ores[x + ',' + y] = ore;
    }
  }
  return { S, grid: g, ores, entryY: cy };
}

// ─────────────────────────────────────────────────────────────────────────────
// Player state factory
// ─────────────────────────────────────────────────────────────────────────────
function makePlayer(id, username) {
  return {
    id, username,
    farmName: '',
    char: null, // set after character creation
    x: 120, y: 148, dir: 2, anim: 'idle', sprint: false,
    gold: 250,
    stamina: 100, maxStamina: 100,
    inv: [], // [{id, qty}] max 36 slots
    invMax: 36,
    tool: 'none',
    skills: Object.fromEntries(SKILLS.map(s => [s, { xp: 0, level: 1 }])),
    quests: { active: [], done: [], progress: {}, roled: null, rolledOn: 0 },
    journal: { items: {}, fish: {}, insects: {}, crops: {}, recipes: {}, minerals: {}, animals: {} },
    rel: Object.fromEntries(NPCS.map(n => [n.id, { hearts: 0, talkedDay: -1, giftedDay: -1, questDay: -1 }])),
    spouse: null,
    house: { level: 1, furniture: [] }, // furniture: [{id, item, x, y}]
    buffs: [], // [{id, expiresAt, stam, speed}]
    stats: { harvested: 0, fished: 0, mined: 0, crafted: 0, cooked: 0, foraged: 0, talked: 0, gifted: 0, donated: 0, festivalPoints: 0, totalEarned: 0 },
    animals: [],
    toolLevels: { tool_hoe: 1, tool_can: 1, tool_sickle: 1, tool_axe: 1, tool_pick: 1, tool_rod: 1, tool_net: 1 },
    lastSeen: nowMs(),
    createdAt: nowMs(),
    lastSleepDay: -1,
    fishing: null,
    dailyTasks: null,
    nextGiftBonusAt: 0,
    pendingDialogue: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// World state factory
// ─────────────────────────────────────────────────────────────────────────────
function makeWorld(roomCode) {
  const tilesInfo = generateTiles(roomCode);
  const world = {
    roomCode,
    createdAt: nowMs(),
    time: 6 * 60, // game minutes since 00:00, start 06:00
    day: 1,
    season: 'spring',
    weather: 'sunny',
    weatherUntil: 0,
    tiles: tilesInfo,
    tileRLE: rleEncode(tilesInfo.grid),
    crops: {},       // key "x,y" -> {crop, stage, water, grow, fert, plantedAt, owner, dry}
    tilled: {},      // key "x,y" -> {water, fert, quality, tilledAt}
    forage: {},      // key "x,y" -> {item, respawnAt}
    trees: {},       // key "x,y" -> {left, respawnAt}
    npcs: Object.fromEntries(NPCS.map(n => [n.id, { id: n.id, x: n.home[0], y: n.home[1], anim: 'idle', state: 'home' }])),
    animals: [],     // wild animals + one farm demo herd? owned animals per-player
    fishByZone: {},  // logged catches per zone/day for tournament
    economy: { day: 0, bought: {}, sold: {}, priceBoost: {} },
    community: Object.fromEntries(COMMUNITY_PROJECTS.map(p => [p.id, { contributions: Object.fromEntries(Object.keys(p.needs).map(k => [k, 0])), done: false }])),
    mine: { depth: 1, maxDepth: 6, levels: {} },
    festival: { active: false, def: null, endsAt: 0, scores: {}, items: {}, startedByDay: -1 },
    spawnTotals: {},  // antispam counter
    tick: 0,
    timerUnlocked: false,
  };
  // Pre-fill some forage & trees deterministically
  const rng = mulberry32(hashSeed('spawns:' + roomCode));
  const grid = tilesInfo.grid;
  let tries = 0;
  while (Object.keys(world.forage).length < 140 && tries < 12000) {
    tries++;
    const x = Math.floor(rng() * WORLD_W);
    const y = Math.floor(rng() * WORLD_H);
    const t = grid[y * WORLD_W + x];
    if (t === TILE.forest && world.forage[x + ',' + y] === undefined) {
      const item = rng() < 0.5 ? 'berry' : rng() < 0.6 ? 'mushroom' : 'branch';
      world.forage[x + ',' + y] = { item, respawnAt: 0 };
    } else if (t === TILE.flower && world.forage[x + ',' + y] === undefined) {
      const item = x > 140 ? 'flower_summer' : x < 70 ? 'flower_autumn' : 'flower_spring';
      world.forage[x + ',' + y] = { item, respawnAt: 0 };
    } else if (t === TILE.sand && world.forage[x + ',' + y] === undefined) {
      world.forage[x + ',' + y] = { item: 'shell', respawnAt: 0 };
    } else if (t === TILE.grass && rng() < 0.02 && world.forage[x + ',' + y] === undefined) {
      world.forage[x + ',' + y] = { item: rng() < 0.5 ? 'herb' : 'fiber', respawnAt: 0 };
    }
  }
  while (Object.keys(world.trees).length < 90 && tries < 22000) {
    tries++;
    const x = Math.floor(rng() * 260);
    const y = Math.floor(rng() * 260);
    if (x >= WORLD_W || y >= WORLD_H) continue;
    const t = grid[y * WORLD_W + x];
    if (t === TILE.forest && world.trees[x + ',' + y] === undefined) {
      world.trees[x + ',' + y] = { left: 3, respawnAt: 0 };
    }
  }
  return world;
}

// ─────────────────────────────────────────────────────────────────────────────
// Character validation (mirrors the creator options)
// ─────────────────────────────────────────────────────────────────────────────
const CHAR_HAIR = ['short', 'long', 'ponytail', 'bun', 'curly', 'spiky', 'bob', 'bald'];
const CHAR_GENDERS = ['male', 'female', 'nonbinary'];
const CHAR_OUTFITS = ['overall', 'apron', 'jacket', 'robe', 'shirt', 'dress'];
const CHAR_SHOES = ['boots', 'sandals', 'sneakers', 'clogs'];
const CHAR_ACCESSORIES = ['none', 'hat', 'scarf', 'bandana', 'glasses', 'flower'];
const safeName = (s, max) => String(s || '').replace(/[<>{}[\]\\|/:"'`~^]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
function validateChar(char, farmName) {
  if (!char || typeof char !== 'object') return null;
  const res = {
    name: safeName(char.name, 16),
    farmName: safeName(farmName, 24),
    gender: CHAR_GENDERS.includes(char.gender) ? char.gender : 'nonbinary',
    hair: CHAR_HAIR.includes(char.hair) ? char.hair : 'short',
    hairColor: String(char.hairColor || '#5a4632').slice(0, 9),
    skin: String(char.skin || '#f2c9a0').slice(0, 9),
    eye: String(char.eye || '#3b82f6').slice(0, 9),
    eyeStyle: String(char.eyeStyle || 'round').slice(0, 12),
    outfit: CHAR_OUTFITS.includes(char.outfit) ? char.outfit : 'shirt',
    outfitColor: String(char.outfitColor || '#3b82f6').slice(0, 9),
    shoes: CHAR_SHOES.includes(char.shoes) ? char.shoes : 'boots',
    accessory: CHAR_ACCESSORIES.includes(char.accessory) ? char.accessory : 'none',
  };
  if (!res.name || !res.farmName) return null;
  return res;
}

// ─────────────────────────────────────────────────────────────────────────────
// Minimal RFC6455 WebSocket implementation (no external deps)
// ─────────────────────────────────────────────────────────────────────────────
class WS {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.alive = true;
    this.sendQueue = [];
    socket.on('data', (chunk) => this._onData(chunk));
    socket.on('close', () => { this.alive = false; this.onclose && this.onclose(); });
    socket.on('error', () => { this.alive = false; });
    socket.on('end', () => { this.alive = false; this.onclose && this.onclose(); });
    this.keepAlive = setInterval(() => {
      if (!this.alive) return;
      this._sendFrame(0x9, Buffer.alloc(0));
    }, 25000);
    this.keepAlive.unref();
  }
  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const b0 = this.buffer[0], b1 = this.buffer[1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let off = 2;
      if (len === 126) {
        if (this.buffer.length < 4) return;
        len = this.buffer.readUInt16BE(2); off = 4;
      } else if (len === 127) {
        if (this.buffer.length < 10) return;
        const big = this.buffer.readBigUInt64BE(2);
        if (big > 1_000_000n) { this.close(1009); return; }
        len = Number(big); off = 10;
      }
      let maskKey = null;
      if (masked) {
        if (this.buffer.length < off + 4) return;
        maskKey = this.buffer.subarray(off, off + 4); off += 4;
      }
      if (this.buffer.length < off + len) return;
      let payload = this.buffer.subarray(off, off + len);
      this.buffer = this.buffer.subarray(off + len);
      if (masked) {
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ maskKey[i & 3];
        payload = out;
      }
      if (!fin) continue; // no fragmentation support needed for small messages
      if (opcode === 0x1) this.onmessage && this.onmessage(payload.toString('utf8'));
      else if (opcode === 0x8) { this.close(1000); return; }
      else if (opcode === 0x9) this._sendFrame(0xA, payload);
    }
  }
  _sendFrame(opcode, payload) {
    if (!this.alive) return;
    try {
      const len = payload.length;
      let header;
      if (len < 126) {
        header = Buffer.from([0x80 | opcode, len]);
      } else if (len < 65536) {
        header = Buffer.alloc(4);
        header[0] = 0x80 | opcode; header[1] = 126;
        header.writeUInt16BE(len, 2);
      } else {
        header = Buffer.alloc(10);
        header[0] = 0x80 | opcode; header[1] = 127;
        header.writeBigUInt64BE(BigInt(len), 2);
      }
      this.socket.write(Buffer.concat([header, payload]));
    } catch {}
  }
  send(obj) {
    if (!this.alive) return;
    try { this._sendFrame(0x1, Buffer.from(JSON.stringify(obj))); } catch {}
  }
  close(code = 1000) {
    try { this._sendFrame(0x8, Buffer.alloc(2).writeUInt16BE ? Buffer.from([code >> 8, code & 0xff]) : Buffer.alloc(0)); } catch {}
    try { this.socket.end(); } catch {}
    this.alive = false;
  }
  destroy() {
    clearInterval(this.keepAlive);
    try { this.socket.destroy(); } catch {}
    this.alive = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HarvestServer
// ─────────────────────────────────────────────────────────────────────────────
export class HarvestServer {
  constructor() {
    this.worlds = new Map(); // key: roomCode
    this.connections = new Set(); // WS
    this.clients = new Map(); // WS -> {player, roomCode, peer}
    this.tickTimer = null;
    this.saveTimer = null;
    this.startedAt = nowMs();
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  attach(httpServer) {
    this.httpServer = httpServer;
    this.tickTimer = setInterval(() => this.tick(), 100);
    this.saveTimer = setInterval(() => this.saveAll(true), 20000);
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }
  stop() {
    clearInterval(this.tickTimer);
    clearInterval(this.saveTimer);
    this.saveAll(true);
  }
  handleUpgrade(req, socket, head) {
    const key = (req.headers['sec-websocket-key'] || '').trim();
    if (!key) { socket.destroy(); return; }
    const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    socket.setNoDelay(true);
    const peer = new WS(socket);
    this.connections.add(peer);
    peer.onmessage = (raw) => {
      try {
        const msg = JSON.parse(raw);
        this.onMessage(peer, msg);
      } catch (err) {
        console.error('[harvest] bad message', err);
      }
    };
    peer.onclose = () => this.onClose(peer);
  }

  // ── room/world access ──
  getWorld(roomCode) {
    let w = this.worlds.get(roomCode);
    if (!w) {
      w = this.loadWorld(roomCode) || makeWorld(roomCode);
      this.worlds.set(roomCode, w);
    }
    return w;
  }

  // ── persistence ──
  saveFile(roomCode) { return path.join(DATA_DIR, 'world-' + roomCode.replace(/[^A-Z0-9]/gi, '').toUpperCase() + '.json'); }
  saveAll(force = false) {
    for (const [code, w] of this.worlds) {
      const file = this.saveFile(code);
      try {
        const out = JSON.stringify({ savedAt: nowMs(), world: this.serializeWorldForDisk(w), players: w._players || {} });
        fs.writeFileSync(file + '.tmp', out);
        fs.renameSync(file + '.tmp', file);
      } catch (err) {
        console.error('[harvest] save failed', code, err);
      }
    }
  }
  loadWorld(roomCode) {
    const file = this.saveFile(roomCode);
    if (!fs.existsSync(file)) return null;
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const w = makeWorld(roomCode);
      Object.assign(w, data.world);
      // Rebuild typed grid from RLE (Uint8Array does not survive JSON round-trip).
      if (typeof data.world.tileRLE === 'string') {
        w.tiles.grid = rleDecode(data.world.tileRLE);
      }
      w.tileRLE = data.world.tileRLE || w.tileRLE;
      // restore player map
      w._players = data.players || {};
      // advance world time offline (capped)
      const elapsed = clamp((nowMs() - (data.savedAt || nowMs())) / 1000, 0, 24 * 3600);
      this.advanceTime(w, elapsed * GAME_MIN_PER_REAL_SEC);
      return w;
    } catch (err) {
      console.error('[harvest] load failed', roomCode, err);
      return null;
    }
  }

  serializeWorldForDisk(w) {
    const { _players, ...rest } = w;
    const out = { ...rest, tileRLE: w.tileRLE };
    return out;
  }

  // ── player registry per world ──
  playersOf(w) {
    if (!w._players) w._players = {};
    return w._players;
  }

  // ── message handling ──
  onMessage(peer, msg) {
    if (!msg || typeof msg.t !== 'string') return;
    const client = this.clients.get(peer);
    if (!client) {
      if (msg.t === 'hello') this.onHello(peer, msg);
      return;
    }
    const { player } = client;
    const w = this.getWorld(client.roomCode);
    player.lastSeen = nowMs();
    switch (msg.t) {
      case 'create': this.onCreate(client, msg); break;
      case 'move': this.onMove(client, msg); break;
      case 'action': this.onAction(client, msg); break;
      case 'chat': this.onChat(client, msg); break;
      case 'emote': this.onEmote(client, msg); break;
      case 'ping': peer.send({ t: 'pong', ts: msg.ts }); break;
      case 'req_state': this.sendSnapshot(peer, client, w, true); break;
      default: break;
    }
  }

  onHello(peer, msg) {
    const roomCode = String(msg.room || '').replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
    const userId = String(msg.userId || '').slice(0, 64);
    const username = safeName(msg.username || 'Player', 16).toUpperCase() || 'PLAYER';
    if (!roomCode || !userId) {
      peer.send({ t: 'err', code: 'hello_invalid', msg: 'Invalid session.' });
      peer.close(1008);
      return;
    }
    const w = this.getWorld(roomCode);
    const players = this.playersOf(w);
    // Cap players per world (2–16)
    const online = Array.from(this.clients.values()).filter(c => c.roomCode === roomCode && c.player.id !== userId).length;
    let player = players[userId] || null;
    if (!player && online >= 16) {
      peer.send({ t: 'err', code: 'world_full', msg: 'World ini sudah penuh (maks 16 pemain).' });
      peer.close(1008);
      return;
    }
    if (player) {
      // resume
      player.lastSeen = nowMs();
      peer.send({ t: 'hello_ack', player: this.playerPublicSafe(player, true), needsCreation: false });
    } else {
      player = makePlayer(userId, username);
      players[userId] = player;
      peer.send({ t: 'hello_ack', player: null, needsCreation: true });
    }
    this.clients.set(peer, { roomCode, player, peer });
  }

  onCreate(client, msg) {
    const { player } = client;
    const w = this.getWorld(client.roomCode);
    if (player.char) return; // already created
    const ch = validateChar(msg.char, msg.farmName);
    if (!ch) {
      client.peer.send({ t: 'err', code: 'char_invalid', msg: 'Karakter tidak valid. Periksa nama & preferensi.' });
      return;
    }
    player.char = ch;
    player.farmName = ch.farmName;
    player.username = ch.name.toUpperCase();
    // spawn at farm, find nearest soil tile
    const spawn = this.findSpawn(w, player);
    player.x = spawn.x; player.y = spawn.y;
    // starter kit
    player.inv = [
      { id: 'tool_hoe', qty: 1 },
      { id: 'tool_can', qty: 1 },
      { id: 'seed_turnip', qty: 12 },
      { id: 'seed_potato', qty: 6 },
      { id: 'berry', qty: 3 },
      { id: 'unused', qty: 0 }, // placeholder removed by normalize
    ];
    player.inv = player.inv.filter(i => i.qty > 0);
    this.broadcast(client.roomCode, { t: 'event', e: { type: 'join', playerId: player.id, name: player.username } });
    this.sendWelcome(client, w);
    this.saveAll(true);
  }

  findSpawn(w, player) {
    const grid = w.tiles.grid;
    // farm area center-ish, deterministic by player id length
    const cx = Math.floor(w.tiles.farmArea.x0 + 24);
    const cy = Math.floor(w.tiles.farmArea.y0 + 30);
    for (let r = 0; r < 40; r++) {
      for (let angle = 0; angle < 360; angle += 12) {
        const x = cx + Math.round(Math.cos(angle * Math.PI / 180) * r);
        const y = cy + Math.round(Math.sin(angle * Math.PI / 180) * r);
        if (x > 0 && y > 0 && x < WORLD_W && y < WORLD_H && grid[y * WORLD_W + x] !== TILE.water && grid[y * WORLD_W + x] !== TILE.rock && grid[y * WORLD_W + x] !== TILE.mountain) {
          return { x, y };
        }
      }
    }
    return { x: 70, y: 150 };
  }

  onMove(client, msg) {
    const { player } = client;
    const w = this.getWorld(client.roomCode);
    if (!player.char) return;
    const x = Number(msg.x), y = Number(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const maxStep = (msg.sprint ? 0.85 : 0.5);
    const dx = clamp(x - player.x, -maxStep, maxStep);
    const dy = clamp(y - player.y, -maxStep, maxStep);
    player.x = clamp(player.x + dx, 1, WORLD_W - 2);
    player.y = clamp(player.y + dy, 1, WORLD_H - 2);
    player.dir = Math.round(Number(msg.dir) || 0) % 4;
    player.anim = typeof msg.anim === 'string' ? msg.anim.slice(0, 12) : 'idle';
    player.sprint = Boolean(msg.sprint);
  }

  // ── action router ──
  onAction(client, msg) {
    const { player } = client;
    const w = this.getWorld(client.roomCode);
    if (!player.char) return;
    const a = String(msg.a || '');
    // per-action rate limit
    const now = nowMs();
    player._lastAction = player._lastAction || 0;
    if (now - player._lastAction < 90) return;
    player._lastAction = now;
    try {
      switch (a) {
        case 'till': this.actTill(w, player, msg); break;
        case 'plant': this.actPlant(w, player, msg); break;
        case 'water': this.actWater(w, player, msg); break;
        case 'harvest': this.actHarvest(w, player, msg); break;
        case 'chop': this.actChop(w, player, msg); break;
        case 'forage': this.actForage(w, player, msg); break;
        case 'fish_start': this.actFishStart(w, player, msg); break;
        case 'fish_catch': this.actFishCatch(w, player, msg); break;
        case 'fish_cancel': this.actFishCancel(w, player); break;
        case 'mine_enter': this.actMineEnter(w, player, msg); break;
        case 'mine_exit': this.actMineExit(w, player, msg); break;
        case 'mine_break': this.actMineBreak(w, player, msg); break;
        case 'talk': this.actTalk(w, player, msg); break;
        case 'gift': this.actGift(w, player, msg); break;
        case 'buy': this.actBuy(w, player, msg); break;
        case 'sell': this.actSell(w, player, msg); break;
        case 'craft': this.actCraft(w, player, msg); break;
        case 'cook': this.actCook(w, player, msg); break;
        case 'eat': this.actEat(w, player, msg); break;
        case 'quest_accept': this.actQuestAccept(w, player, msg); break;
        case 'quest_turnin': this.actQuestTurnin(w, player, msg); break;
        case 'contribute': this.actContribute(w, player, msg); break;
        case 'sleep': this.actSleep(w, player); break;
        case 'pet': this.actPet(w, player, msg); break;
        case 'feed': this.actFeed(w, player, msg); break;
        case 'collect_animal': this.actCollectAnimal(w, player, msg); break;
        case 'buy_animal': this.actBuyAnimal(w, player, msg); break;
        case 'place': this.actPlace(w, player, msg); break;
        case 'remove_furn': this.actRemoveFurn(w, player, msg); break;
        case 'house_upgrade': this.actHouseUpgrade(w, player); break;
        case 'upgrade_tool': this.actUpgradeTool(w, player, msg); break;
        case 'propose': this.actPropose(w, player, msg); break;
        case 'equip': this.actEquip(w, player, msg); break;
        case 'buy_seed': this.actBuy(w, player, { item: msg.item, qty: msg.qty || 1 }); break;
        case 'fert': this.actFertilize(w, player, msg); break;
        case 'festival_collect': this.actFestivalCollect(w, player, msg); break;
        default: break;
      }
    } catch (err) {
      console.error('[harvest] action error', a, err);
      client.peer.send({ t: 'err', code: 'action_error', msg: 'Aksi gagal, coba lagi.' });
    }
  }

  // ── helpers: stamina / add / remove ──
  hasStamina(p, cost) { return p.stamina >= cost; }
  useStamina(w, p, cost) {
    if (p.stamina < cost) { this.notify(w, p, 'Aksi butuh stamina!', 'stamina'); return false; }
    p.stamina = clamp(p.stamina - cost, 0, p.maxStamina);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'stamina', value: p.stamina } });
    return true;
  }
  regenStamina(w, p) {
    // +1 per 4s baseline, faster at home during sleep schedule
    if (p.stamina < p.maxStamina) {
      p.stamina = clamp(p.stamina + 0.25, 0, p.maxStamina);
    }
  }
  notify(w, p, msg, kind = 'info') {
    this.sendTo(p.id, w, { t: 'event', e: { type: 'notify', kind, msg } });
  }
  sendTo(playerId, w, obj) {
    for (const c of this.clients.values()) {
      if (c.roomCode === w.roomCode && c.player.id === playerId) c.peer.send(obj);
    }
  }
  broadcast(roomCode, obj, exceptId = null) {
    for (const c of this.clients.values()) {
      if (c.roomCode === roomCode && c.player.id !== exceptId) c.peer.send(obj);
    }
  }

  addItem(w, p, itemId, qty = 1) {
    if (!ITEMS[itemId]) return 0;
    let added = 0;
    const slot = p.inv.find(i => i.id === itemId && i.qty < 99);
    if (slot) {
      const take = Math.min(99 - slot.qty, qty);
      slot.qty += take; added += take;
    }
    if (added < qty && p.inv.length < p.invMax) {
      const take = Math.min(99, qty - added);
      p.inv.push({ id: itemId, qty: take });
      added += take;
    }
    if (added > 0) {
      this.recordJournal(w, p, itemId);
      this.sendTo(p.id, w, { t: 'event', e: { type: 'inv', inv: p.inv } });
    }
    return added;
  }
  hasItem(w, p, itemId, qty = 1) {
    const slot = p.inv.find(i => i.id === itemId);
    return slot && slot.qty >= qty;
  }
  countItem(p, itemId) {
    const slot = p.inv.find(i => i.id === itemId);
    return slot ? slot.qty : 0;
  }
  removeItem(w, p, itemId, qty = 1) {
    const slot = p.inv.find(i => i.id === itemId);
    if (!slot || slot.qty < qty) return false;
    slot.qty -= qty;
    if (slot.qty <= 0) p.inv = p.inv.filter(i => i.qty > 0);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'inv', inv: p.inv } });
    return true;
  }
  recordJournal(w, p, itemId) {
    const item = ITEMS[itemId];
    if (!item) return;
    if (item.cat === 'crop') { p.journal.crops[itemId] = true; p.journal.items[itemId] = true; }
    else if (item.cat === 'fish') { p.journal.fish[itemId] = true; p.journal.items[itemId] = true; }
    else if (item.cat === 'insect') { p.journal.insects[itemId] = true; p.journal.items[itemId] = true; }
    else if (item.cat === 'mineral') { p.journal.minerals[itemId] = true; p.journal.items[itemId] = true; }
    else p.journal.items[itemId] = true;
  }

  addXp(w, p, skill, amount) {
    if (!p.skills[skill]) return;
    const s = p.skills[skill];
    s.xp += amount;
    let leveled = false;
    while (s.xp >= this.xpForLevel(s.level + 1)) {
      s.level++; leveled = true;
      this.sendTo(p.id, w, { t: 'event', e: { type: 'levelup', skill, level: s.level } });
    }
    if (leveled) this.checkUnlocks(w, p);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'skills', skills: p.skills } });
  }
  xpForLevel(level) { return Math.floor(40 * Math.pow(level, 1.7)); }
  checkUnlocks(w, p) {
    // auto-unlock recipes on crafting level up is implicit: recipe requires level.
  }

  questProgress(w, p, kind, amount = 1) {
    for (const qid of p.quests.active) {
      const def = this.findQuest(qid);
      if (!def) continue;
      const objIdx = def.objectives.findIndex(o => o.kind === kind);
      if (objIdx < 0) continue;
      const key = qid + ':' + objIdx;
      const cur = p.quests.progress[key] || 0;
      const nxt = Math.min(def.objectives[objIdx].count, cur + amount);
      if (nxt !== cur) {
        p.quests.progress[key] = nxt;
        this.sendTo(p.id, w, { t: 'event', e: { type: 'quest_update', questId: qid, progress: p.quests.progress } });
      }
    }
    // hidden quest triggers
    if (kind === 'explore_grove') this.autoAcceptQuest(w, p, 'hidden_1');
    if (kind === 'fish_night') this.autoAcceptQuest(w, p, 'hidden_2');
    if (kind === 'harvest_storm') this.autoAcceptQuest(w, p, 'hidden_3');
  }
  findQuest(qid) {
    for (const arr of Object.values(QUESTS)) {
      const q = arr.find(x => x.id === qid);
      if (q) return q;
    }
    return null;
  }
  autoAcceptQuest(w, p, qid) {
    if (!p.quests.active.includes(qid) && !p.quests.done.includes(qid)) {
      p.quests.active.push(qid);
      p.quests.progress[qid + ':0'] = p.quests.progress[qid + ':0'] || 0;
      this.sendTo(p.id, w, { t: 'event', e: { type: 'quest_update', questId: qid, active: true, progress: p.quests.progress } });
      this.notify(w, p, `Quest tersembunyi ditemukan: ${this.findQuest(qid).name}!`, 'quest');
    }
  }
  questComplete(w, p, qid) {
    const def = this.findQuest(qid);
    if (!def || p.quests.done.includes(qid)) return;
    p.quests.done.push(qid);
    p.quests.active = p.quests.active.filter(q => q !== qid);
    // idempotent rewards
    if (def.reward.gold) p.gold += def.reward.gold;
    for (const [item, qty] of Object.entries(def.reward.items || {})) {
      this.addItem(w, p, item, qty);
    }
    this.addXp(w, p, 'social', 20);
    p.stats.totalEarned += def.reward.gold || 0;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'quest_complete', questId: qid, reward: def.reward, gold: p.gold } });
    this.notify(w, p, `Quest selesai: ${def.name} (+${def.reward.gold || 0} G)`, 'quest');
    if (qid.startsWith('main_')) {
      const idx = QUESTS.main.findIndex(q => q.id === qid);
      if (idx >= 0 && idx + 1 < QUESTS.main.length) {
        const next = QUESTS.main[idx + 1];
        if (!p.quests.active.includes(next.id) && !p.quests.done.includes(next.id)) {
          p.quests.active.push(next.id);
          p.quests.progress[next.id + ':0'] = 0;
          this.sendTo(p.id, w, { t: 'event', e: { type: 'quest_update', questId: next.id, active: true, progress: p.quests.progress } });
          this.notify(w, p, `Quest baru: ${next.name}`, 'quest');
        }
      }
    }
  }
  rollDailyQuests(w, p) {
    const day = this.dayOf(w);
    if (p.quests.rolledOn === day) return;
    const seeded = mulberry32(hashSeed(p.id + ':daily:' + day));
    const picked = ['daily_forage', 'daily_water', 'daily_chop'];
    for (const qid of picked) {
      const def = this.findQuest(qid);
      if (!def) continue;
      if (!p.quests.active.includes(qid) && !p.quests.done.includes(qid)) {
        p.quests.active.push(qid);
        p.quests.progress[qid + ':0'] = 0;
      }
    }
    if (!p.quests.active.includes('weekly_harvest') && !p.quests.done.includes('weekly_harvest') && this.weekOf(w) !== (p.quests._week || -1)) {
      p.quests.active.push('weekly_harvest');
      p.quests.progress['weekly_harvest:0'] = 0;
      p.quests._week = this.weekOf(w);
    }
    if (!p.quests.active.includes('multi_1') && !p.quests.done.includes('multi_1')) {
      p.quests.active.push('multi_1');
      p.quests.progress['multi_1:0'] = 0;
    }
    p.quests.rolledOn = day;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'quest_update', active: p.quests.active, progress: p.quests.progress } });
  }

  // ── game time ──
  gameMinutes(w) { return w.time; }
  hourOf(w) { return Math.floor(w.time / 60); }
  minuteOf(w) { return w.time % 60; }
  dayOf(w) { return w.day; }
  weekOf(w) { return Math.floor((w.day - 1) / SEASON_DAYS) + 1; }
  seasonOf(w) { return w.season; }

  advanceTime(w, minutes) {
    w.time += minutes;
    while (w.time >= 24 * 60) {
      w.time -= 24 * 60;
      this.onNewDay(w);
    }
  }
  onNewDay(w) {
    w.day++;
    if (w.day > SEASON_DAYS) {
      w.day = 1;
      const idx = SEASONS.indexOf(w.season);
      w.season = SEASONS[(idx + 1) % 4];
      this.broadcast(w.roomCode, { t: 'event', e: { type: 'season', season: w.season } });
      this.notifyAll(w, `Musim baru: ${this.seasonLabel(w.season)}`);
    }
    w.economy.day = 0;
    w.economy.bought = {};
    w.economy.sold = {};
    // daily crop dry-down (unwatered crops regress a bit)
    for (const key of Object.keys(w.crops)) {
      const c = w.crops[key];
      if (c.water <= 0 && c.grow > 0) c.grow = Math.max(0, c.grow - 0.08);
      c.water = Math.max(0, c.water - 1);
    }
    // animals hunger
    for (const p of Object.values(this.playersOf(w))) {
      for (const an of p.animals) {
        an.hunger = clamp((an.hunger || 0) + 18, 0, 100);
        an.happiness = clamp((an.happiness || 70) - (an.hunger > 70 ? 6 : 2), 0, 100);
        if (an.hunger < 40) an.happiness = clamp(an.happiness + 6, 0, 100);
        an.ageDays = (an.ageDays || 0) + 1;
      }
    }
    // forage respawn
    const rng = mulberry32(hashSeed(w.roomCode + ':respawn:' + w.day));
    let c = 0;
    for (const key of Object.keys(w.forage)) { if (c++ > 40) break; }
    const keys = Object.keys(w.forage);
    for (let i = 0; i < keys.length && i < 12; i++) {
      const k = keys[Math.floor(rng() * keys.length)];
      const f = w.forage[k];
      if (f && f.respawnAt > 0) f.respawnAt = 0;
    }
    // festival check
    this.checkFestival(w);
    // economy decay
    for (const k of Object.keys(w.economy.priceBoost)) {
      w.economy.priceBoost[k] = Math.max(0, (w.economy.priceBoost[k] || 0) - 0.3);
    }
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'time', day: w.day, time: w.time, season: w.season } });
    this.saveAll(true);
  }

  checkFestival(w) {
    const day = w.day;
    const def = FESTIVALS.find(f => f.season === w.season && f.day === day);
    if (def && w.festival.startedByDay !== day) {
      w.festival.startedByDay = day;
      w.festival.active = true;
      w.festival.def = def;
      w.festival.endsAt = Date.now() + 16 * 60 * 1000; // 16 real minutes of activity
      w.festival.scores = mmap();
      w.festival.items = {};
      // spawn festival items for collect-type festivals
      if (def.type === 'collect') {
        const rng = mulberry32(hashSeed(w.roomCode + ':fest:' + day));
        for (let i = 0; i < 14; i++) {
          const x = 108 + Math.floor(rng() * 24);
          const y = 122 + Math.floor(rng() * 20);
          const k = x + ',' + y;
          if (!w.festival.items[k]) w.festival.items[k] = { item: def.id === 'fes_treasure' ? 'artifact_coin' : 'flower_spring', used: false };
        }
      }
      const itemList = Object.entries(w.festival.items).filter(([, v]) => !v.used).map(([k, v]) => {
        const [x, y] = k.split(',').map(Number);
        return { x, y, item: v.item };
      });
      this.broadcast(w.roomCode, { t: 'event', e: { type: 'festival', active: true, def, items: itemList } });
      this.notifyAll(w, `Festival dimulai: ${def.name}!`);
    }
    if (w.festival.active && w.festival.endsAt > 0 && nowMs() > w.festival.endsAt) {
      this.endFestival(w, w.festival.def);
    }
  }
  endFestival(w, def) {
    if (!def || !w.festival.active) return;
    w.festival.active = false;
    const winners = Object.entries(w.festival.scores || {}).sort((a, b) => b[1] - a[1]).slice(0, 3);
    for (let i = 0; i < winners.length; i++) {
      const p = this.playersOf(w)[winners[i][0]];
      if (!p) continue;
      const prize = i === 0 ? 400 : i === 1 ? 200 : 100;
      p.gold += prize;
      this.addItem(w, p, 'golden_apple', 1);
      this.sendTo(p.id, w, { t: 'event', e: { type: 'gold', gold: p.gold } });
      this.notify(w, p, `Juara festival ${def.name}! Hadiah ${prize} G + Golden Apple.`, 'festival');
    }
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'festival', active: false, def, items: [] } });
  }
  notifyAll(w, msg) {
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'notify', kind: 'world', msg } });
  }
  seasonLabel(s) { return { spring: 'Spring', summer: 'Summer', autumn: 'Autumn', winter: 'Winter' }[s] || s; }

  // ── farming actions ──
  tileAt(w, x, y) {
    if (x < 0 || y < 0 || x >= WORLD_W || y >= WORLD_H) return -1;
    return w.tiles.grid[y * WORLD_W + x];
  }
  inRange(p, x, y, r = 2) { return dist2(p.x, p.y, x, y) <= r * r; }

  actTill(w, p, msg) {
    if (!this.hasItem(w, p, 'tool_hoe')) { this.notify(w, p, 'Kamu butuh Hoe. Beli di Blacksmith.', 'warn'); return; }
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.inRange(p, x, y)) return;
    const t = this.tileAt(w, x, y);
    if (t !== TILE.soil && t !== TILE.grass && t !== TILE.flower) { this.notify(w, p, 'Tanah ini tidak bisa diolah.', 'warn'); return; }
    if (w.tilled[x + ',' + y]) { this.notify(w, p, 'Sudah diolah.', 'info'); return; }
    if (!this.useStamina(w, p, 4)) return;
    const lvl = p.toolLevels.tool_hoe;
    const fert = lvl >= 3 ? 1 : 0;
    w.tilled[x + ',' + y] = { water: 0, fert, quality: lvl >= 4 ? 1.2 : 1, tilledAt: nowMs() };
    this.questProgress(w, p, 'till');
    this.addXp(w, p, 'farming', 3);
    p.stats.harvested = p.stats.harvested; // noop keep
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'tilled', x, y, fert } });
  }
  actPlant(w, p, msg) {
    const x = parseInt(msg.x), y = parseInt(msg.y);
    // Client may send the seed id (`seed_turnip`) OR the crop id (`crop_turnip`).
    const raw = String(msg.crop || msg.seed || '');
    const cropId = raw.startsWith('seed_') ? 'crop_' + raw.slice(5) : raw;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.inRange(p, x, y)) return;
    const key = x + ',' + y;
    const tilled = w.tilled[key];
    if (!tilled) { this.notify(w, p, 'Olah tanah dulu sebelum menanam.', 'warn'); return; }
    if (w.crops[key]) { this.notify(w, p, 'Sudah ada tanaman di sini.', 'warn'); return; }
    const crop = CROPS[cropId];
    if (!crop) return;
    const seed = crop.seed;
    if (!this.hasItem(w, p, seed, 1)) { this.notify(w, p, 'Tidak ada benih.', 'warn'); return; }
    if (crop.season !== w.season && w.season !== 'spring') { this.notify(w, p, `${crop.season} crop ini tidak tumbuh di ${this.seasonLabel(w.season)}.`, 'warn'); return; }
    if (!this.useStamina(w, p, 2)) return;
    this.removeItem(w, p, seed, 1);
    // mutation chance
    const rng = mulberry32(hashSeed(key + ':' + p.id + ':' + w.day));
    const rare = crop.rare ? true : (rng() < 0.01 + (p.skills.farming.level - 1) * 0.001);
    w.crops[key] = {
      crop: rare && !crop.rare ? 'crop_goldleaf' : cropId,
      stage: 0, water: tilled.water, grow: 0, fert: tilled.fert, quality: tilled.quality,
      plantedAt: nowMs(), owner: p.id, dry: false,
    };
    this.questProgress(w, p, 'plant');
    this.addXp(w, p, 'farming', 4);
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'crop', x, y, crop: w.crops[key] } });
  }
  actWater(w, p, msg) {
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.inRange(p, x, y)) return;
    const key = x + ',' + y;
    const crop = w.crops[key];
    if (!crop) { this.notify(w, p, 'Tidak ada tanaman untuk disiram.', 'warn'); return; }
    if (!this.hasItem(w, p, 'tool_can')) { this.notify(w, p, 'Kamu butuh Watering Can.', 'warn'); return; }
    if (!this.useStamina(w, p, 2)) return;
    crop.water = 2;
    this.questProgress(w, p, 'water');
    this.addXp(w, p, 'farming', 2);
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'crop', x, y, crop } });
  }
  actFertilize(w, p, msg) {
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.inRange(p, x, y)) return;
    const key = x + ',' + y;
    const tilled = w.tilled[key];
    if (!tilled) return;
    const fertId = tilled.fert < 1 ? 'fert_basic' : 'fert_rich';
    if (!this.hasItem(w, p, fertId, 1)) { this.notify(w, p, 'Tidak ada pupuk.', 'warn'); return; }
    this.removeItem(w, p, fertId, 1);
    tilled.fert = tilled.fert + (fertId === 'fert_rich' ? 2 : 1);
    this.addXp(w, p, 'farming', 3);
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'tilled', x, y, fert: tilled.fert } });
  }
  actHarvest(w, p, msg) {
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.inRange(p, x, y, 2.2)) return;
    const key = x + ',' + y;
    const crop = w.crops[key];
    if (!crop) { this.notify(w, p, 'Tidak ada hasil di sini.', 'info'); return; }
    const def = CROPS[crop.crop];
    if (crop.stage < def.days) { this.notify(w, p, 'Tanaman belum matang.', 'warn'); return; }
    if (!this.hasItem(w, p, 'tool_sickle')) { this.notify(w, p, 'Kamu butuh Sickle untuk memanen.', 'warn'); return; }
    if (!this.useStamina(w, p, 3)) return;
    let quality = 1;
    if (crop.fert > 0) quality += 0.5;
    if (crop.quality > 1) quality += 0.3;
    if (p.skills.farming.level >= 5) quality += 0.2;
    const count = 1 + (p.skills.farming.level >= 4 ? 1 : 0);
    const item = crop.crop;
    const rng = mulberry32(hashSeed(key + ':' + w.day));
    const yieldQty = count * (rng() < 0.15 ? 2 : 1);
    const got = this.addItem(w, p, item, yieldQty);
    if (got < yieldQty) { this.notify(w, p, 'Inventory penuh!', 'warn'); return; }
    delete w.crops[key];
    if (crop.fert > 1) {
      // richer soil stays
      w.tilled[key] = w.tilled[key] || { water: 0, fert: 0, tilledAt: nowMs() };
    } else if (rng() < 0.35) {
      delete w.tilled[key]; // soil needs re-tilling sometimes
    }
    this.questProgress(w, p, 'harvest');
    if (w.weather === 'storm') this.questProgress(w, p, 'harvest_storm');
    this.addXp(w, p, 'farming', 8);
    p.stats.harvested += yieldQty;
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'crop_removed', x, y } });
    this.sendTo(p.id, w, { t: 'event', e: { type: 'gain', items: { [item]: yieldQty }, gold: 0 } });
  }

  // ── forage / chop ──
  actForage(w, p, msg) {
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.inRange(p, x, y, 2)) return;
    const key = x + ',' + y;
    const f = w.forage[key];
    if (!f || f.respawnAt > nowMs()) { this.notify(w, p, 'Tidak ada yang bisa dipetik.', 'info'); return; }
    if (!this.useStamina(w, p, 2)) return;
    const got = this.addItem(w, p, f.item, 1);
    if (got < 1) return;
    f.respawnAt = nowMs() + 4 * 60 * 1000;
    this.questProgress(w, p, 'forage');
    this.addXp(w, p, 'foraging', 4);
    p.stats.foraged += 1;
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'forage_taken', x, y } });
  }
  actChop(w, p, msg) {
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.inRange(p, x, y, 2.2)) return;
    const key = x + ',' + y;
    const tree = w.trees[key];
    if (!tree || tree.left <= 0) return;
    if (!this.hasItem(w, p, 'tool_axe')) { this.notify(w, p, 'Kamu butuh Axe untuk menebang.', 'warn'); return; }
    if (!this.useStamina(w, p, 4)) return;
    tree.left--;
    const loot = tree.left === 0 ? ['wood', 'wood', 'branch'] : ['wood', 'branch'];
    for (const item of loot) this.addItem(w, p, item, 1);
    this.questProgress(w, p, 'chop');
    this.addXp(w, p, 'foraging', 5);
    p.stats.foraged += 1;
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'tree', x, y, left: tree.left } });
    if (tree.left <= 0) {
      tree.respawnAt = nowMs() + 90 * 60 * 1000;
    }
  }

  // ── fishing ──
  actFishStart(w, p, msg) {
    if (p.fishing) { this.notify(w, p, 'Sedang memancing.', 'info'); return; }
    if (!this.hasItem(w, p, 'tool_rod')) { this.notify(w, p, 'Kamu butuh Fishing Rod. Craft di Workbench.', 'warn'); return; }
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (!this.inRange(p, x, y, 2.4)) return;
    const t = this.tileAt(w, x, y);
    if (t !== TILE.water) { this.notify(w, p, 'Pancing di dekat air.', 'warn'); return; }
    if (!this.useStamina(w, p, 4)) return;
    const zone = this.zoneOf(w, x, y);
    const season = w.season;
    const night = this.hourOf(w) >= 20 || this.hourOf(w) < 5;
    const candidates = FISH.filter(f =>
      f.zones.includes(zone) &&
      f.seasons.includes(season) &&
      f.times.includes(night ? 'night' : 'day')
    );
    if (candidates.length === 0) { this.notify(w, p, 'Tidak ada ikan di sini sekarang.', 'info'); this.staminaRefund(w, p, 4); return; }
    const total = candidates.reduce((s, f) => s + (6 - f.rarity), 0);
    let r = Math.random() * total;
    let chosen = candidates[0];
    for (const f of candidates) { r -= (6 - f.rarity); if (r <= 0) { chosen = f; break; } }
    const biteIn = 2000 + Math.random() * 5000 + (chosen.rarity * 900);
    const bait = this.countItem(p, 'bait_grub') > 0 ? 0.9 : 0;
    p.fishing = { fish: chosen.id, biteAt: nowMs() + biteIn, zone, t0: nowMs() };
    // if player has bait, consume for better odds
    if (bait > 0) {
      this.removeItem(w, p, 'bait_grub', 1);
      p.fishing.bonus = 0.1;
    } else p.fishing.bonus = 0;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'fish_start', biteIn } });
  }
  staminaRefund(w, p, amt) {
    p.stamina = clamp(p.stamina + amt, 0, p.maxStamina);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'stamina', value: p.stamina } });
  }
  actFishCatch(w, p, msg) {
    if (!p.fishing || !p.fishing.bitten) return;
    const f = p.fishing;
    p.fishing = null;
    const def = FISH.find(x => x.id === f.fish);
    if (!def) return;
    const score = clamp(Number(msg.score) || 0, 0, 100);
    const need = def.need - (f.bonus || 0) * 30 - (p.toolLevels.tool_rod - 1) * 4 - (p.skills.fishing.level - 1) * 1.5;
    const caught = score >= need;
    if (caught) {
      this.addItem(w, p, f.fish, 1);
      this.questProgress(w, p, 'fish');
      this.addXp(w, p, 'fishing', 8 + def.rarity * 3);
      p.stats.fished += 1;
      if (def.legendary) {
        this.broadcast(w.roomCode, { t: 'event', e: { type: 'legendary_catch', playerId: p.id, name: p.username, fish: def.name } });
      }
      // festival fishing
      const fes = w.festival;
      if (fes.active && fes.def && fes.def.type === 'fish') {
        fes.scores[p.id] = (fes.scores[p.id] || 0) + 1;
      }
    }
    const total = (w.fishByZone[f.zone] || 0) + 1;
    w.fishByZone[f.zone] = total;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'fish_result', caught, fish: def, score: Math.round(score) } });
  }
  actFishCancel(w, p) {
    if (!p.fishing) return;
    p.fishing = null;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'fish_cancel' } });
  }
  actFestivalCollect(w, p, msg) {
    const fes = w.festival;
    if (!fes.active || !fes.def) { this.notify(w, p, 'Tidak ada festival aktif.', 'info'); return; }
    if (fes.def.type !== 'collect') { this.notify(w, p, 'Festival ini bukan tipe kumpulkan.', 'info'); return; }
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const key = x + ',' + y;
    const it = fes.items[key];
    if (!it || it.used) { this.notify(w, p, 'Benda tidak ada.', 'info'); return; }
    if (!this.inRange(p, x, y, 2)) return;
    it.used = true;
    this.addItem(w, p, it.item, 1);
    fes.scores[p.id] = (fes.scores[p.id] || 0) + 1;
    p.stats.festivalPoints = (p.stats.festivalPoints || 0) + 1;
    this.addXp(w, p, 'foraging', 6);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'festival_collect', x, y, points: fes.scores[p.id] } });
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'festival_item_taken', x, y } });
  }
  actEquip(w, p, msg) {
    const itemId = String(msg.item || 'none');
    if (itemId !== 'none' && !ITEMS[itemId]) return;
    p.equipped = itemId;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'equipped', item: itemId } });
  }
  zoneOf(w, x, y) {
    const t = this.tileAt(w, x, y);
    if (t === TILE.water) {
      if (x > 150 && y < 70) return 'lake';
      if (y > 150 && x > 140) return 'beach';
      return 'river';
    }
    if (t === TILE.sand) return 'beach';
    return 'river';
  }

  // ── mining ──
  actMineEnter(w, p, msg) {
    const dx = parseInt(msg.x), dy = parseInt(msg.y);
    if (Number.isFinite(dx) && Number.isFinite(dy)) {
      if (!this.inRange(p, dx, dy, 3.5)) return;
    }
    const door = w.tiles.mineDoor;
    if (!this.inRange(p, door.x, door.y, 3) && !p._inMine) return;
    const depth = clamp(parseInt(msg.depth) || w.mine.depth, 1, w.mine.maxDepth);
    if (!w.mine.levels[depth]) w.mine.levels[depth] = generateMineDepth(w.roomCode, depth);
    p._inMine = true;
    p._mine = { depth, x: 1, y: w.mine.levels[depth].entryY };
    const lvl = w.mine.levels[depth];
    this.sendTo(p.id, w, { t: 'event', e: { type: 'mine_enter', depth, grid: Array.from(lvl.grid), S: lvl.S, ores: lvl.ores } });
  }
  actMineExit(w, p, msg) {
    if (!p._inMine) return;
    p._inMine = false;
    p._mine = null;
    const door = w.tiles.mineDoor;
    p.x = door.x; p.y = door.y + 1;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'mine_exit' } });
  }
  actMineBreak(w, p, msg) {
    if (!p._inMine) return;
    const x = parseInt(msg.x), y = parseInt(msg.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const lvl = w.mine.levels[p._mine.depth];
    if (!lvl) return;
    if (Math.abs(x - p._mine.x) + Math.abs(y - p._mine.y) > 2) return;
    const key = x + ',' + y;
    if (lvl.grid[y * lvl.S + x] !== 0) return;
    const ore = lvl.ores[key];
    if (!ore) { this.notify(w, p, 'Batu kosong.', 'info'); return; }
    if (!this.hasItem(w, p, 'tool_pick')) { this.notify(w, p, 'Kamu butuh Pickaxe.', 'warn'); return; }
    if (p.toolLevels.tool_pick < Math.ceil(p._mine.depth / 2)) { this.notify(w, p, `Pickaxe level ${Math.ceil(p._mine.depth / 2)} dibutuhkan di kedalaman ini.`, 'warn'); return; }
    if (!this.useStamina(w, p, 5)) return;
    delete lvl.ores[key];
    const counts = ore === 'ore_gold' ? 1 : ore.startsWith('gem_') ? 1 : 2;
    this.addItem(w, p, ore, counts);
    this.questProgress(w, p, 'mine');
    this.addXp(w, p, 'mining', 6 + (ore.startsWith('gem_') ? 6 : 0));
    p.stats.mined += 1;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'mine_break', x, y, ore, depth: p._mine.depth, ores: lvl.ores } });
  }

  // ── NPC interactions ──
  actTalk(w, p, msg) {
    const npcId = String(msg.npc || '');
    const def = NPCS.find(n => n.id === npcId);
    if (!def) return;
    const npc = w.npcs[npcId];
    const d = Math.hypot(p.x - npc.x, p.y - npc.y);
    if (d > 3) { this.notify(w, p, 'Terlalu jauh untuk berbicara.', 'warn'); return; }
    const day = this.dayOf(w);
    const rel = p.rel[npcId];
    let heartGain = 0;
    if (rel.talkedDay !== day) {
      rel.talkedDay = day;
      rel.hearts = clamp(rel.hearts + 1, 0, 10);
      heartGain = 1;
      this.questProgress(w, p, 'social');
      this.addXp(w, p, 'social', 6);
      p.stats.talked += 1;
    }
    const heartLvl = rel.hearts;
    const hour = this.hourOf(w);
    const timeGreet = hour < 6 ? 'Malam masih panjang...' : hour < 12 ? 'Selamat pagi!' : hour < 18 ? 'Selamat siang.' : 'Selamat malam.';
    const weatherLine = w.weather === 'rain' ? 'Hari ini hujan, jangan lupa jas hujan.' : w.weather === 'snow' ? 'Brr, salju turun.' : w.weather === 'storm' ? 'Lebih aman di dalam rumah.' : '';
    const heartLine = heartLvl >= 8 ? 'Kamu selalu membuat hariku cerah.' : heartLvl >= 5 ? 'Rumahmu terasa makin hangat.' : heartLvl >= 2 ? 'Senang melihatmu lagi.' : '';
    const line = `${timeGreet}${weatherLine ? ' ' + weatherLine : ''}${heartLine ? ' ' + heartLine : ''}`;
    const shopLines = {
      npc_merch: 'Selamat datang di toko! Mau belanja?',
      npc_ren: 'Bawa bijih, aku bisa menempa alat untukmu.',
      npc_chef: 'Dapur sudah panas — mau masak atau ikut lomba?',
      npc_ranch: 'Hewan-hewanku sehat berkat perawatanmu.',
      npc_curator: 'Museum menunggu koleksi baru darimu!',
    };
    p.pendingDialogue = { npc: npcId, lines: shopLines[npcId] ? [shopLines[npcId], line] : [line], heartGain, closeable: true };
    this.sendTo(p.id, w, { t: 'event', e: { type: 'dialogue', npc: npcId, lines: p.pendingDialogue.lines, heartGain, hearts: rel.hearts, canShop: ['npc_merch', 'npc_ren', 'npc_chef', 'npc_ranch', 'npc_curator'].includes(npcId), canGift: true } });
  }
  actGift(w, p, msg) {
    const npcId = String(msg.npc || '');
    const itemId = String(msg.item || '');
    if (!NPCS.find(n => n.id === npcId)) return;
    if (!ITEMS[itemId]) return;
    if (!this.countItem(p, itemId)) return;
    const rel = p.rel[npcId];
    if (rel.giftedDay === this.dayOf(w)) { this.notify(w, p, 'Sudah memberi hadiah hari ini.', 'info'); return; }
    this.removeItem(w, p, itemId, 1);
    rel.giftedDay = this.dayOf(w);
    const likes = NPC_LIKES[npcId];
    let gain = 2;
    if (likes.like.includes(itemId)) gain = 6;
    else if (likes.dislike.includes(itemId)) gain = -1;
    rel.hearts = clamp(rel.hearts + gain, 0, 10);
    this.questProgress(w, p, 'gift');
    this.addXp(w, p, 'social', 10 + gain * 2);
    p.stats.gifted += 1;
    p.stats.totalEarned += 0;
    this.sendTo(p.id, w, {
      t: 'event', e: {
        type: 'gift_result', npc: npcId, item: itemId, gain, hearts: rel.hearts,
        line: gain >= 6 ? 'Wah, ini kesukaanku! Terima kasih!' : gain > 0 ? 'Terima kasih!' : 'Eh... terima kasih?',
      }
    });
    if (rel.hearts >= 8 && !p.spouse && ['npc_mae', 'npc_lu', 'npc_iris', 'npc_art'].includes(npcId)) {
      this.sendTo(p.id, w, { t: 'event', e: { type: 'can_propose', npc: npcId } });
    }
  }
  actPropose(w, p, msg) {
    const npcId = String(msg.npc || '');
    const rel = p.rel[npcId];
    if (!rel || rel.hearts < 8 || p.spouse) return;
    if (!this.hasItem(w, p, 'flower_spring', 1) && !this.hasItem(w, p, 'gem_emerald', 1)) {
      this.notify(w, p, 'Butuh Blossom atau Emerald untuk melamar.', 'warn'); return;
    }
    this.removeItem(w, p, this.hasItem(w, p, 'gem_emerald', 1) ? 'gem_emerald' : 'flower_spring', 1);
    p.spouse = npcId;
    this.addXp(w, p, 'social', 50);
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'marriage', playerId: p.id, name: p.username, npc: npcId } });
    this.notify(w, p, `Selamat! Kamu menikah dengan ${NPCS.find(n => n.id === npcId).name}! Spouse memberimu hadiah tiap pagi.`, 'heart');
  }

  // ── economy ──
  priceOf(w, itemId) {
    const item = ITEMS[itemId];
    if (!item) return 0;
    const boost = w.economy.priceBoost[itemId] || 0;
    const demand = w.economy.bought[itemId] || 0;
    const supply = w.economy.sold[itemId] || 0;
    let price = item.value * (1 + boost + demand * 0.004 - supply * 0.003);
    if (w.community.cp_market.done) price *= 0.92;
    return Math.max(1, Math.round(price));
  }
  sellPriceOf(w, itemId) {
    const item = ITEMS[itemId];
    if (!item) return 0;
    const supply = w.economy.sold[itemId] || 0;
    let price = item.value * 0.6 * (1 - supply * 0.004);
    return Math.max(1, Math.round(price));
  }
  actBuy(w, p, msg) {
    const itemId = String(msg.item || '');
    const qty = clamp(parseInt(msg.qty) || 1, 1, 99);
    const item = ITEMS[itemId];
    if (!item || item.cat === 'tool') return;
    if (item.cat === 'meal' || item.cat === 'furniture') return; // only via specific
    const price = this.priceOf(w, itemId) * qty;
    if (p.gold < price) { this.notify(w, p, 'Gold tidak cukup!', 'warn'); return; }
    const space = this.freeSpace(p);
    if (space < qty) { this.notify(w, p, 'Inventory penuh!', 'warn'); return; }
    p.gold -= price;
    this.addItem(w, p, itemId, qty);
    w.economy.bought[itemId] = (w.economy.bought[itemId] || 0) + qty;
    w.economy.priceBoost[itemId] = Math.min(1.5, (w.economy.priceBoost[itemId] || 0) + qty * 0.01);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'gold', gold: p.gold } });
    this.sendTo(p.id, w, { t: 'event', e: { type: 'shop_sold', item: itemId, qty, price } });
  }
  actSell(w, p, msg) {
    const itemId = String(msg.item || '');
    const qty = clamp(parseInt(msg.qty) || 1, 1, 99);
    const item = ITEMS[itemId];
    if (!item || item.cat === 'tool') return;
    if (item.cat === 'furniture') return;
    if (!this.removeItem(w, p, itemId, qty)) { this.notify(w, p, 'Item tidak ada.', 'warn'); return; }
    const price = this.sellPriceOf(w, itemId) * qty;
    p.gold += price;
    w.economy.sold[itemId] = (w.economy.sold[itemId] || 0) + qty;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'gold', gold: p.gold } });
    this.sendTo(p.id, w, { t: 'event', e: { type: 'shop_sold', item: itemId, qty, price: -price } });
  }
  freeSpace(p) {
    let space = 0;
    for (const i of p.inv) space += 99 - i.qty;
    space += (p.invMax - p.inv.length) * 99;
    return space;
  }

  // ── crafting / cooking ──
  actCraft(w, p, msg) {
    const rec = RECIPES.find(r => r.id === msg.recipe && r.kind === 'craft');
    if (!rec) return;
    const sk = p.skills[rec.unlock.skill];
    if (sk.level < rec.unlock.level) { this.notify(w, p, `Butuh ${SKILL_NAMES[rec.unlock.skill]} level ${rec.unlock.level}.`, 'warn'); return; }
    for (const [item, qty] of Object.entries(rec.needs)) {
      if (!this.countItem(p, item) >= qty) { this.notify(w, p, 'Bahan tidak cukup.', 'warn'); return; }
    }
    for (const [item, qty] of Object.entries(rec.needs)) this.removeItem(w, p, item, qty);
    if (!this.addItem(w, p, rec.out, 1)) {
      for (const [item, qty] of Object.entries(rec.needs)) this.addItem(w, p, item, qty);
      this.notify(w, p, 'Inventory penuh!', 'warn'); return;
    }
    this.questProgress(w, p, 'craft');
    this.addXp(w, p, 'crafting', 10);
    p.journal.recipes[rec.id] = true;
    p.stats.crafted += 1;
    this.notify(w, p, `Crafted: ${ITEMS[rec.out].name}`, 'craft');
  }
  actCook(w, p, msg) {
    const rec = RECIPES.find(r => r.id === msg.recipe && r.kind === 'cook');
    if (!rec) return;
    const sk = p.skills[rec.unlock.skill];
    if (sk.level < rec.unlock.level) { this.notify(w, p, `Butuh Cooking level ${rec.unlock.level}.`, 'warn'); return; }
    // cooking requires kitchen furniture or community kitchen: allow if placed kitchen OR village chef proximity for demo of progression
    const hasKitchen = p.house.furniture.some(f => f.item === 'furn_kitchen');
    if (!hasKitchen && !this.npcNear(w, p, 'npc_chef', 6)) {
      this.notify(w, p, 'Masak di dapur rumah (Kitchen) atau di dekat Chef Coral.', 'warn'); return;
    }
    for (const [item, qty] of Object.entries(rec.needs)) {
      if (this.countItem(p, item) < qty) { this.notify(w, p, 'Bahan tidak cukup.', 'warn'); return; }
    }
    for (const [item, qty] of Object.entries(rec.needs)) this.removeItem(w, p, item, qty);
    this.addItem(w, p, rec.out, 1);
    this.questProgress(w, p, 'cook');
    this.addXp(w, p, 'cooking', 12);
    p.journal.recipes[rec.id] = true;
    p.stats.cooked += 1;
    this.notify(w, p, `Masak selesai: ${ITEMS[rec.out].name}`, 'cook');
    const fes = w.festival;
    if (fes.active && fes.def && fes.def.type === 'cook') {
      fes.scores[p.id] = (fes.scores[p.id] || 0) + 1;
      this.sendTo(p.id, w, { t: 'event', e: { type: 'festival_pts', points: fes.scores[p.id] } });
    }
  }
  actEat(w, p, msg) {
    const itemId = String(msg.item || '');
    const item = ITEMS[itemId];
    if (!item || item.cat !== 'meal') return;
    if (!this.removeItem(w, p, itemId, 1)) return;
    const buff = item.buff || { stam: 20, duration: 30 };
    p.stamina = clamp(p.stamina + buff.stam, 0, p.maxStamina);
    p.buffs = p.buffs.filter(b => b.expiresAt > nowMs());
    p.buffs.push({ id: itemId, expiresAt: nowMs() + buff.duration * 1000, speed: buff.speed || 0 });
    this.addXp(w, p, 'cooking', 2);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'buff', buffs: p.buffs, stamina: p.stamina } });
  }
  npcNear(w, p, npcId, r) {
    const npc = w.npcs[npcId];
    return npc && Math.hypot(p.x - npc.x, p.y - npc.y) <= r;
  }

  // ── quests ──
  actQuestAccept(w, p, msg) {
    const qid = String(msg.qid || '');
    const def = this.findQuest(qid);
    if (!def) return;
    if (p.quests.active.includes(qid) || p.quests.done.includes(qid)) return;
    if (qid.startsWith('npc_') && p.rel[qid.slice(4)] == null) return;
    p.quests.active.push(qid);
    for (let i = 0; i < def.objectives.length; i++) p.quests.progress[qid + ':' + i] = 0;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'quest_update', questId: qid, active: true, progress: p.quests.progress } });
  }
  actQuestTurnin(w, p, msg) {
    const qid = String(msg.qid || '');
    if (!p.quests.active.includes(qid)) return;
    const def = this.findQuest(qid);
    if (!def) return;
    for (let i = 0; i < def.objectives.length; i++) {
      if ((p.quests.progress[qid + ':' + i] || 0) < def.objectives[i].count) {
        this.notify(w, p, 'Quest belum selesai.', 'warn'); return;
      }
    }
    this.questComplete(w, p, qid);
  }

  // ── community ──
  actContribute(w, p, msg) {
    const proj = w.community[String(msg.project || '')];
    if (!proj || proj.done) return;
    const item = String(msg.item || '');
    const qty = clamp(parseInt(msg.qty) || 1, 1, 10);
    if (Object.keys(proj.contributions).includes(item)) {
      if (!this.removeItem(w, p, item, qty)) { this.notify(w, p, 'Item tidak ada.', 'warn'); return; }
      proj.contributions[item] += qty;
      this.questProgress(w, p, 'multi_contribute');
      this.addXp(w, p, 'social', 8);
      p.stats.donated += qty;
      const done = Object.entries(COMMUNITY_PROJECTS.find(c => c.id === msg.project).needs).every(([k, n]) => proj.contributions[k] >= n);
      if (done) {
        proj.done = true;
        this.broadcast(w.roomCode, { t: 'event', e: { type: 'community_done', id: msg.project } });
        this.notifyAll(w, `Proyek komunitas selesai: ${COMMUNITY_PROJECTS.find(c => c.id === msg.project).name}!`);
      }
      this.broadcast(w.roomCode, { t: 'event', e: { type: 'community', id: msg.project, contributions: proj.contributions, done: proj.done } });
    }
  }

  // ── sleeping ──
  actSleep(w, p) {
    const day = this.dayOf(w);
    if (p.lastSleepDay === day) { this.notify(w, p, 'Kamu sudah tidur hari ini.', 'info'); return; }
    // require bed or inn (elder)
    const hasBed = p.house.furniture.some(f => f.item === 'furn_bed');
    if (!hasBed && !this.npcNear(w, p, 'npc_elder', 6)) {
      this.notify(w, p, 'Tidur di tempat tidur rumahmu atau di penginapan Elder Ash.', 'warn'); return;
    }
    p.lastSleepDay = day;
    // advance world to next 06:00 (max once per player per day)
    const target = 6 * 60;
    let add = 24 * 60 - w.time + target;
    this.advanceTime(w, add);
    p.stamina = p.maxStamina;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'slept', day: this.dayOf(w), time: w.time } });
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'time', day: w.day, time: w.time, season: w.season } });
    this.notify(w, p, 'Kamu bangun segar pagi ini!', 'sleep');
  }

  // ── animals ──
  actBuyAnimal(w, p, msg) {
    const type = String(msg.type || '');
    const def = ANIMALS[type];
    if (!def) return;
    const count = p.animals.length;
    const maxAnimals = 4 + p.house.level * 3;
    if (count >= maxAnimals) { this.notify(w, p, `Kandang penuh (maks ${maxAnimals}). Upgrade rumah untuk lebih.`, 'warn'); return; }
    if (p.gold < def.price) { this.notify(w, p, 'Gold tidak cukup.', 'warn'); return; }
    p.gold -= def.price;
    const rng = mulberry32(hashSeed(p.id + ':' + type + ':' + p.animals.length));
    p.animals.push({
      id: uid(), type, name: this.animalName(type, rng),
      x: 0, y: 0, hunger: 30, happiness: 80, health: 100, friendship: 0,
      ageDays: 1, lastFed: 0, produceAt: nowMs() + 6 * 60 * 1000,
      personality: ['calm', 'playful', 'shy', 'brave'][Math.floor(rng() * 4)],
    });
    p.journal.animals[type] = true;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'gold', gold: p.gold } });
    this.sendTo(p.id, w, { t: 'event', e: { type: 'animals', animals: p.animals } });
    this.notify(w, p, `${def.name} "${p.animals[p.animals.length - 1].name}" bergabung!`, 'animal');
  }
  animalName(type, rng) {
    const names = {
      cow: ['Mochi', 'Clover', 'Butter', 'Daisy'], chicken: ['Pip', 'Pebble', 'Biscuit', 'Sunny'],
      sheep: ['Cloud', 'Marsh', 'Puff', 'Snow'], goat: ['Nibble', 'Willow', 'Bramble', 'Poppy'],
      horse: ['Storm', 'Ember', 'Maple', 'Arrow'], cat: ['Miso', 'Taro', 'Luna', 'Pepper'],
      dog: ['Biscuit', 'Waffle', 'Oreo', 'Rusty'],
    };
    const arr = names[type] || ['Buddy'];
    return arr[Math.floor(rng() * arr.length)];
  }
  actPet(w, p, msg) {
    const animalId = String(msg.animal || '');
    const an = p.animals.find(x => x.id === animalId);
    if (!an) return;
    if (nowMs() - (an._lastPet || 0) < 30000) return;
    an._lastPet = nowMs();
    an.happiness = clamp(an.happiness + 10, 0, 100);
    an.friendship = clamp(an.friendship + 2, 0, 100);
    this.addXp(w, p, 'animal', 4);
    this.questProgress(w, p, 'pet');
    this.sendTo(p.id, w, { t: 'event', e: { type: 'animal_update', animals: p.animals } });
  }
  actFeed(w, p, msg) {
    const animalId = String(msg.animal || '');
    const an = p.animals.find(x => x.id === animalId);
    if (!an) return;
    if (!this.hasItem(w, p, 'crop_turnip', 1) && !this.hasItem(w, p, 'crop_carrot', 1)) {
      this.notify(w, p, 'Butuh Turnip atau Carrot untuk memberi makan.', 'warn'); return;
    }
    this.removeItem(w, p, this.hasItem(w, p, 'crop_turnip', 1) ? 'crop_turnip' : 'crop_carrot', 1);
    an.hunger = clamp(an.hunger - 45, 0, 100);
    an.happiness = clamp(an.happiness + 12, 0, 100);
    an.friendship = clamp(an.friendship + 3, 0, 100);
    an.lastFed = nowMs();
    this.addXp(w, p, 'animal', 6);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'animal_update', animals: p.animals } });
  }
  actCollectAnimal(w, p, msg) {
    const animalId = String(msg.animal || '');
    const an = p.animals.find(x => x.id === animalId);
    if (!an) return;
    const def = ANIMALS[an.type];
    if (!def.product) { this.notify(w, p, `${def.name} tidak menghasilkan produk.`, 'info'); return; }
    if (an.happiness < 40 || an.hunger > 80) { this.notify(w, p, `${an.name} tidak nyaman — beri makan & perhatikan kebahagiaan.`, 'warn'); return; }
    if (nowMs() < (an.produceAt || 0)) {
      const mins = Math.ceil(((an.produceAt || 0) - nowMs()) / 60000);
      this.notify(w, p, `${an.name} siap menghasilkan dalam ~${mins} menit.`, 'info'); return;
    }
    const rng = mulberry32(hashSeed(an.id + ':' + this.dayOf(w)));
    const product = an.type === 'cow' ? (rng() < 0.2 ? 'cheese' : 'milk') : an.type === 'chicken' ? (rng() < 0.2 ? 'mayo' : 'egg') : an.type === 'goat' ? (rng() < 0.3 ? 'cheese' : 'milk') : def.product;
    this.addItem(w, p, product, 1);
    an.produceAt = nowMs() + (def.produceDays || 1) * (6 * 60 * 1000);
    an.happiness = clamp(an.happiness + 8, 0, 100);
    this.addXp(w, p, 'animal', 8);
    this.questProgress(w, p, 'collect_animal');
    // breeding chance
    if (an.type === 'chicken' && p.animals.filter(x => x.type === 'chicken').length >= 2 && p.animals.length < 4 + p.house.level * 3) {
      if (rng() < 0.12) {
        p.animals.push({
          id: uid(), type: 'chicken', name: this.animalName('chicken', rng),
          x: 0, y: 0, hunger: 30, happiness: 80, health: 100, friendship: 0, ageDays: 1,
          lastFed: 0, produceAt: nowMs() + 12 * 60 * 1000, personality: 'playful',
        });
        this.notify(w, p, 'A chick hatched! 🐣', 'animal');
      }
    }
    this.sendTo(p.id, w, { t: 'event', e: { type: 'animal_update', animals: p.animals } });
    this.sendTo(p.id, w, { t: 'event', e: { type: 'gain', items: { [product]: 1 }, gold: 0 } });
  }

  // ── housing ──
  actPlace(w, p, msg) {
    const item = String(msg.item || '');
    const def = ITEMS[item];
    if (!def || def.cat !== 'furniture') return;
    if (!this.removeItem(w, p, item, 1)) { this.notify(w, p, 'Item tidak ada.', 'warn'); return; }
    const maxFurn = 4 + p.house.level * 4;
    if (p.house.furniture.length >= maxFurn) {
      this.addItem(w, p, item, 1);
      this.notify(w, p, `Rumah penuh (maks ${maxFurn} furnitur).`, 'warn'); return;
    }
    p.house.furniture.push({ id: uid(), item, x: msg.x, y: msg.y });
    this.sendTo(p.id, w, { t: 'event', e: { type: 'house', house: p.house } });
    this.notify(w, p, `Furnitur ditempatkan: ${def.name}`, 'craft');
  }
  actRemoveFurn(w, p, msg) {
    const fid = String(msg.id || '');
    const idx = p.house.furniture.findIndex(f => f.id === fid);
    if (idx < 0) return;
    const f = p.house.furniture[idx];
    p.house.furniture.splice(idx, 1);
    this.addItem(w, p, f.item, 1);
    this.sendTo(p.id, w, { t: 'event', e: { type: 'house', house: p.house } });
  }
  actHouseUpgrade(w, p) {
    const level = p.house.level;
    if (level >= 4) { this.notify(w, p, 'Rumah sudah maksimal.', 'info'); return; }
    const needs = [{ gold: 500 + level * 400 }, { wood: 15 + level * 10 }, { stone: 8 + level * 6 }];
    if (p.gold < needs[0].gold) { this.notify(w, p, 'Gold tidak cukup.', 'warn'); return; }
    if (this.countItem(p, 'wood') < needs[1].wood || this.countItem(p, 'stone') < needs[2].stone) {
      this.notify(w, p, 'Butuh kayu & batu untuk upgrade.', 'warn'); return;
    }
    p.gold -= needs[0].gold;
    this.removeItem(w, p, 'wood', needs[1].wood);
    this.removeItem(w, p, 'stone', needs[2].stone);
    p.house.level = level + 1;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'gold', gold: p.gold } });
    this.sendTo(p.id, w, { t: 'event', e: { type: 'house', house: p.house } });
    this.broadcast(w.roomCode, { t: 'event', e: { type: 'house_upgrade_visual', playerId: p.id, level: p.house.level } });
    this.notify(w, p, `Rumah naik ke level ${p.house.level}!`, 'craft');
  }
  actUpgradeTool(w, p, msg) {
    const tool = String(msg.tool || '');
    if (!p.toolLevels[tool]) return;
    const lvl = p.toolLevels[tool];
    if (lvl >= 5) { this.notify(w, p, 'Alat sudah maksimal (level 5).', 'info'); return; }
    const cost = Math.round(150 * Math.pow(1.8, lvl - 1));
    const ore = lvl >= 4 ? 'gem_sapphire' : lvl >= 3 ? 'ore_gold' : 'ore_iron';
    if (p.gold < cost || this.countItem(p, ore) < lvl) {
      this.notify(w, p, `Butuh ${cost} G dan ${lvl}x ${ITEMS[ore].name}.`, 'warn'); return;
    }
    p.gold -= cost;
    this.removeItem(w, p, ore, lvl);
    p.toolLevels[tool] = lvl + 1;
    this.sendTo(p.id, w, { t: 'event', e: { type: 'gold', gold: p.gold } });
    this.sendTo(p.id, w, { t: 'event', e: { type: 'tools', toolLevels: p.toolLevels } });
    this.addXp(w, p, 'crafting', 10);
    this.notify(w, p, `${ITEMS[tool].name} naik ke level ${lvl + 1}!`, 'craft');
  }

  // ── chat/emote ──
  onChat(client, msg) {
    const text = safeName(msg.text, 200);
    if (!text) return;
    const now = nowMs();
    client.player._lastChat = client.player._lastChat || 0;
    if (now - client.player._lastChat < 350) return;
    client.player._lastChat = now;
    this.broadcast(client.roomCode, {
      t: 'event', e: { type: 'chat', playerId: client.player.id, name: client.player.username, text, ts: now },
    });
  }
  onEmote(client, msg) {
    const emote = String(msg.emote || '').slice(0, 24);
    const ok = ['wave', 'dance', 'cheer', 'laugh', 'sad', 'hearts', 'sleep', 'question'].includes(emote);
    if (!ok) return;
    this.broadcast(client.roomCode, { t: 'event', e: { type: 'emote', playerId: client.player.id, emote } });
  }

  // ── disconnect ──
  onClose(peer) {
    const client = this.clients.get(peer);
    if (!client) { this.connections.delete(peer); return; }
    this.clients.delete(peer);
    this.connections.delete(peer);
    const w = this.worlds.get(client.roomCode);
    if (w) {
      const p = client.player;
      p.lastSeen = nowMs();
      this.broadcast(client.roomCode, { t: 'event', e: { type: 'leave', playerId: p.id, name: p.username } });
    }
  }

  // ── world tick ──
  tick() {
    const t0 = Date.now();
    for (const w of this.worlds.values()) {
      this.worldTick(w);
    }
    // send player snapshots once per tick (10Hz)
    const snapshot = this.buildSnapshots();
    for (const c of this.clients.values()) {
      const data = snapshot.get(c.roomCode);
      if (data) c.peer.send(data);
    }
    void t0;
  }
  buildSnapshots() {
    const map = new Map();
    for (const w of this.worlds.values()) {
      const others = [];
      for (const c of this.clients.values()) {
        if (c.roomCode !== w.roomCode) continue;
        const p = c.player;
        if (!p.char) continue;
        others.push([p.id, +p.x.toFixed(2), +p.y.toFixed(2), p.dir, p.anim, p.sprint ? 1 : 0, c.peer.alive ? 1 : 0]);
      }
      const npcs = [];
      for (const n of NPCS) {
        const nn = w.npcs[n.id];
        npcs.push([n.id, +nn.x.toFixed(1), +nn.y.toFixed(1), nn.anim, nn.state]);
      }
      map.set(w.roomCode, {
        t: 'snap',
        time: Math.floor(w.time), day: w.day, season: w.season, weather: w.weather,
        players: others, npcs,
      });
    }
    return map;
  }
  worldTick(w) {
    // game clock
    this.advanceTime(w, 0.1 * GAME_MIN_PER_REAL_SEC);
    // NPC schedule & movement
    this.updateNPCs(w);
    // crop growth every tick is cheap enough at this scale; use hourly-granularity accumulators
    this.updateCrops(w);
    this.updateAnimals(w);
    this.updateForageRespawn(w);
    this.updateWeather(w);
    this.updateFishing(w);
    this.checkFestival(w);
    // players stamina regen
    for (const p of Object.values(this.playersOf(w))) {
      this.regenStamina(w, p);
      p.buffs = p.buffs.filter(b => b.expiresAt > nowMs());
      // morning spouse gift
      const day = this.dayOf(w);
      if (p.spouse && p._spouseGiftDay !== day) {
        p._spouseGiftDay = day;
        if (w.time >= 6 * 60 && w.time < 7 * 60) {
          this.addItem(w, p, 'honey', 1);
          this.notify(w, p, `${NPCS.find(n => n.id === p.spouse)?.name || 'Spouse'} memberimu Honey pagi ini!`, 'heart');
        }
      }
    }
    w.tick++;
    // periodic save
    if (w.tick % 120 === 0) { /* saveAll handles throttling */ }
  }
  updateWeather(w) {
    if (w.weatherUntil <= Date.now()) {
      const table = SEASON_WEATHER[w.season] || SEASON_WEATHER.spring;
      const total = table.reduce((s, x) => s + x[1], 0);
      let r = Math.random() * total;
      let next = 'sunny';
      for (const [k, p] of table) { r -= p; if (r <= 0) { next = k; break; } }
      w.weather = next;
      w.weatherUntil = Date.now() + (5 + Math.random() * 8) * 60 * 1000;
      this.broadcast(w.roomCode, { t: 'event', e: { type: 'weather', weather: w.weather } });
      if (w.weather === 'rain' || w.weather === 'storm' || w.weather === 'snow') {
        // auto-water crops
        for (const key of Object.keys(w.crops)) {
          const c = w.crops[key];
          if (c.water < 2) c.water = 1;
        }
        this.broadcast(w.roomCode, { t: 'event', e: { type: 'rain_watered' } });
      }
    }
  }
  updateCrops(w) {
    const hour = Math.floor(w.time / 60);
    if (this._lastCropHour === hour) return;
    this._lastCropHour = hour;
    const seasonMul = (season) => ({ spring: 1, summer: 1.15, autumn: 1, winter: 0.55 }[season]);
    const weatherMul = w.weather === 'heatwave' ? 0.8 : 1;
    for (const key of Object.keys(w.crops)) {
      const c = w.crops[key];
      const def = CROPS[c.crop];
      if (!def) continue;
      let grow = 0.1; // base growth per game hour = 2.4/day
      if (c.water > 0) grow *= 1.6;
      grow *= seasonMul(w.season) * weatherMul;
      if (def.season === w.season) grow *= 1.25;
      if (c.fert > 0) grow *= 1.35;
      if (c.fert > 1) grow *= 1.2;
      c.grow += grow;
      if (c.water > 0) c.water = Math.max(0, c.water - 0.5);
      const stage = Math.min(def.days, Math.floor(c.grow));
      if (stage !== c.stage) {
        c.stage = stage;
        this.broadcast(w.roomCode, { t: 'event', e: { type: 'crop', x: +key.split(',')[0], y: +key.split(',')[1], crop: c } });
      }
    }
  }
  updateFishing(w) {
    const now = nowMs();
    for (const c of this.clients.values()) {
      if (c.roomCode !== w.roomCode) continue;
      const p = c.player;
      if (!p.fishing) continue;
      if (!p.fishing.bitten && now >= p.fishing.biteAt) {
        p.fishing.bitten = true;
        p.fishing.expireAt = now + 3500;
        this.sendTo(p.id, w, { t: 'event', e: { type: 'fish_bite', t: now } });
      } else if (p.fishing.bitten && now > (p.fishing.expireAt || now)) {
        p.fishing = null;
        this.sendTo(p.id, w, { t: 'event', e: { type: 'fish_result', caught: false, fish: { name: '—' }, score: 0, timeout: true } });
      }
    }
  }
  updateForageRespawn(w) {
    if (this._lastForageMin === Math.floor(w.time / 10)) return;
    this._lastForageMin = Math.floor(w.time / 10);
    const rng = mulberry32(hashSeed(w.roomCode + ':' + w.time));
    const keys = Object.keys(w.forage);
    if (keys.length === 0) return;
    for (let i = 0; i < 2; i++) {
      const k = keys[Math.floor(rng() * keys.length)];
      const f = w.forage[k];
      if (f && f.respawnAt > 0 && nowMs() > f.respawnAt) {
        f.respawnAt = 0;
        this.broadcast(w.roomCode, { t: 'event', e: { type: 'forage_spawn', key: k, item: f.item } });
      }
    }
  }
  updateAnimals(w) {
    if (this._lastAnimalMin === Math.floor(w.time / 2)) return;
    this._lastAnimalMin = Math.floor(w.time / 2);
    // owned animals: gentle wander + occasional broadcast; player-farm only positions
    for (const c of this.clients.values()) {
      if (c.roomCode !== w.roomCode || !c.player.char) continue;
      const p = c.player;
      for (const an of p.animals) {
        if (an.x === 0 && an.y === 0) {
          an.x = p.x + (Math.random() - 0.5) * 4;
          an.y = p.y + (Math.random() - 0.5) * 4;
        } else {
          an.x += (Math.random() - 0.5) * 0.6;
          an.y += (Math.random() - 0.5) * 0.6;
        }
      }
    }
  }
  updateNPCs(w) {
    if (this._lastNpcMin === Math.floor(w.time / 3)) return;
    this._lastNpcMin = Math.floor(w.time / 3);
    const hour = this.hourOf(w);
    const fes = w.festival;
    for (const def of NPCS) {
      const npc = w.npcs[def.id];
      let targetX = def.home[0], targetY = def.home[1];
      let state = 'home';
      if (fes.active && fes.def && hour >= 12 && hour <= 22) {
        targetX = 120 + [0, 3, -3, 2, -2][Math.abs(hashSeed(def.id)) % 5];
        targetY = 132 + [0, 2, 3, -2][Math.abs(hashSeed(def.id + 'y')) % 4];
        state = 'festival';
      } else if (hour >= 6 && hour < 8) { targetX = def.home[0] + 1; targetY = def.home[1]; state = 'wake'; }
      else if (hour >= 8 && hour < 12) { targetX = def.work[0]; targetY = def.work[1]; state = 'work'; }
      else if (hour >= 12 && hour < 13) { targetX = def.work[0] + ((hashSeed(def.id) % 4) - 2); targetY = def.work[1] + ((hashSeed(def.id + 'a') % 4) - 2); state = 'lunch'; }
      else if (hour >= 13 && hour < 15) { targetX = def.work[0]; targetY = def.work[1]; state = 'work'; }
      else if (hour >= 15 && hour < 18) {
        // activity: wander near village
        targetX = 112 + (hashSeed(def.id + 'act') % 16);
        targetY = 126 + (hashSeed(def.id + 'act2') % 12);
        state = 'activity';
      } else if (hour >= 18 && hour < 21) {
        targetX = 120 + ((hashSeed(def.id + 'soc') % 8) - 4);
        targetY = 134 + ((hashSeed(def.id + 'soc2') % 6) - 3);
        state = 'social';
      } else if (hour >= 21 && hour < 22) { targetX = def.home[0]; targetY = def.home[1]; state = 'home'; }
      else if (hour >= 22 || hour < 6) { state = 'sleep'; }
      // move toward target
      const dx = targetX - npc.x, dy = targetY - npc.y;
      const d = Math.hypot(dx, dy);
      if (d > 0.4) {
        const step = Math.min(0.12, d);
        npc.x += (dx / d) * step;
        npc.y += (dy / d) * step;
        npc.anim = 'walk';
        npc.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
      } else {
        npc.anim = state === 'sleep' ? 'sleep' : 'idle';
        npc.dir = npc.dir || hashSeed(def.id) % 4;
      }
    }
  }

  // ── public player data ──
  playerPublicSafe(p, minimal = false) {
    return {
      id: p.id, username: p.username, farmName: p.farmName, char: p.char,
      x: p.x, y: p.y, dir: p.dir, anim: p.anim, sprint: p.sprint,
      gold: p.gold, stamina: Math.round(p.stamina), maxStamina: p.maxStamina,
      inv: p.inv, invMax: p.invMax,
      skills: p.skills,
      quests: { active: p.quests.active, done: p.quests.done, progress: p.quests.progress },
      journal: p.journal,
      rel: p.rel, spouse: p.spouse,
      house: p.house,
      buffs: p.buffs,
      stats: p.stats,
      animals: p.animals,
      toolLevels: p.toolLevels,
    };
  }
  sendSnapshot(peer, client, w, force = false) {
    void force;
    const p = client.player;
    const defs = {
      items: ITEMS, crops: CROPS, fish: FISH, recipes: RECIPES, npcs: NPCS.map(n => ({
        id: n.id, name: n.name, role: n.role, color: n.color, home: n.home, work: n.work,
      })),
      likes: NPC_LIKES, animals: ANIMALS, festivals: FESTIVALS, projects: COMMUNITY_PROJECTS,
      quests: QUESTS, skills: SKILL_NAMES, seasons: SEASONS,
      shops: ['npc_merch', 'npc_ren', 'npc_chef', 'npc_ranch', 'npc_curator'],
    };
    const prices = this.buildPrices(w);
    const players = [];
    for (const c of this.clients.values()) {
      if (c.roomCode !== w.roomCode || !c.player.char) continue;
      players.push(this.playerPublicSafe(c.player));
    }
    peer.send({
      t: 'snapshot',
      world: {
        size: [WORLD_W, WORLD_H],
        tileRLE: w.tileRLE,
        mineDoor: w.tiles.mineDoor,
        bridge: w.tiles.bridge,
        villageCenter: w.tiles.villageCenter,
        farmArea: w.tiles.farmArea,
        time: Math.floor(w.time), day: w.day, season: w.season, weather: w.weather,
        npcs: Object.fromEntries(NPCS.map(n => [n.id, { id: n.id, x: w.npcs[n.id].x, y: w.npcs[n.id].y, anim: w.npcs[n.id].anim, state: w.npcs[n.id].state }])),
        crops: w.crops, tilled: w.tilled, forage: w.forage, trees: w.trees,
        community: w.community, mine: { depth: w.mine.depth, maxDepth: w.mine.maxDepth },
        festival: w.festival.active
          ? { active: true, def: w.festival.def, items: Object.entries(w.festival.items).filter(([, v]) => !v.used).map(([k, v]) => { const [x, y] = k.split(',').map(Number); return { x, y, item: v.item }; }) }
          : { active: false, def: null, items: [] },
      },
      me: this.playerPublicSafe(p),
      players,
      defs,
      prices,
      serverTime: nowMs(),
    });
  }
  buildPrices(w) {
    const out = {};
    for (const id of Object.keys(ITEMS)) {
      const item = ITEMS[id];
      if (item.cat === 'tool' || item.cat === 'furniture' || item.cat === 'special') continue;
      out[id] = { buy: this.priceOf(w, id), sell: this.sellPriceOf(w, id) };
    }
    return out;
  }
  sendWelcome(client, w) {
    this.sendSnapshot(client.peer, client, w);
  }
}

function mmap() { return Object.create(null); }

const _instances = [];

/**
 * Attach a HarvestServer to an existing HTTP server.
 * The HTTP server must be listening (or will be). Returns the server instance.
 */
export function createHarvestServer(httpServer) {
  const inst = new HarvestServer();
  inst.attach(httpServer);
  _instances.push(inst);
  return inst;
}
