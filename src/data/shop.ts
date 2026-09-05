import type { ShopItem } from '@/types/game';

/**
 * Katalog shop — harga seimbang supaya pemain selalu punya "uang yg cukup"
 * via koin awal + bonus jawaban benar / menang ronde.
 */
export const STARTING_COINS = 150;

export const COIN_REWARDS = {
  correctMove: 5,
  winRound: 50,
  dailyBonus: 20,
};

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'hint_plus',
    name: 'Hint +1',
    description: 'Tambah 1 hint untuk ronde berjalan.',
    price: 30,
    icon: '💡',
    effect: 'Menambah jatah hint +1',
    category: 'powerup',
  },
  {
    id: 'extra_roll',
    name: 'Bonus Koin x2 (1 ronde)',
    description: 'Gandakan koin jawaban benar selama 1 ronde.',
    price: 60,
    icon: '🪙',
    effect: 'Koin jawaban benar x2',
    category: 'powerup',
  },
  {
    id: 'shield',
    name: 'Shield Anti-Stun',
    description: 'Kebal 1x stun di mode Race.',
    price: 45,
    icon: '🛡️',
    effect: 'Menahan 1x stun',
    category: 'powerup',
  },
  {
    id: 'avatar_gold',
    name: 'Ring Emas Avatar',
    description: 'Bingkai emas di daftar pemain & minimap.',
    price: 80,
    icon: '👑',
    effect: 'Kosmetik eksklusif',
    category: 'cosmetic',
  },
  {
    id: 'trail_fire',
    name: 'Jejak Api Minimap',
    description: 'Token kamu meninggalkan jejak api di minimap.',
    price: 70,
    icon: '🔥',
    effect: 'Kosmetik minimap',
    category: 'cosmetic',
  },
  {
    id: 'radar',
    name: 'Radar Map',
    description: 'Minimap menampilkan nama semua pemain.',
    price: 50,
    icon: '📡',
    effect: 'Info tambahan di map',
    category: 'utility',
  },
  {
    id: 'teleport',
    name: 'Teleport Acak (Ular Tangga)',
    description: 'Simpan & pakai kapan saja: maju 1–6 langkah.',
    price: 90,
    icon: '🌀',
    effect: 'Item sekali pakai',
    category: 'utility',
  },
  {
    id: 'coffee',
    name: 'Kopi Fokus',
    description: 'Animasi halus + bonus 10 koin instan.',
    price: 25,
    icon: '☕',
    effect: '+10 koin instan',
    category: 'utility',
  },
];

export const getShopItem = (id: string): ShopItem | undefined =>
  SHOP_ITEMS.find((i) => i.id === id);
