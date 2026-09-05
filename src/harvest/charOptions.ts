// Character creation options — must mirror the server-side validator.
import { CharDef } from './types';

export const GENDERS: { id: CharDef['gender']; label: string; icon: string }[] = [
  { id: 'male', label: 'Male', icon: '♂' },
  { id: 'female', label: 'Female', icon: '♀' },
  { id: 'nonbinary', label: 'Non-binary', icon: '⚧' },
];

export const HAIR_STYLES = [
  { id: 'short', label: 'Short' },
  { id: 'long', label: 'Long' },
  { id: 'ponytail', label: 'Ponytail' },
  { id: 'bun', label: 'Bun' },
  { id: 'curly', label: 'Curly' },
  { id: 'spiky', label: 'Spiky' },
  { id: 'bob', label: 'Bob' },
  { id: 'bald', label: 'Bald' },
];

export const HAIR_COLORS = ['#3b2a1e', '#5a4632', '#8a6a3f', '#c08a4e', '#e8c37b', '#b7354f', '#7b4fa0', '#3b82f6', '#4caf7d', '#e8e8e8'];
export const SKIN_TONES = ['#f6d7b0', '#f2c9a0', '#e0ac69', '#c68642', '#a06a3c', '#7b4f2e', '#5d3a23', '#f8e7d0'];
export const EYE_COLORS = ['#3b82f6', '#5a4632', '#4caf7d', '#f2c94c', '#8b5cf6', '#e05b4b', '#4aa3df', '#9aa0a6'];
export const OUTFITS = [
  { id: 'overall', label: 'Overalls' },
  { id: 'apron', label: 'Apron' },
  { id: 'jacket', label: 'Jacket' },
  { id: 'robe', label: 'Robe' },
  { id: 'shirt', label: 'Shirt' },
  { id: 'dress', label: 'Dress' },
];
export const OUTFIT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16', '#6b4f2a', '#9aa0a6'];
export const SHOES = [
  { id: 'boots', label: 'Boots' },
  { id: 'sandals', label: 'Sandals' },
  { id: 'sneakers', label: 'Sneakers' },
  { id: 'clogs', label: 'Clogs' },
];
export const EYE_STYLES = [
  { id: 'round', label: 'Round' },
  { id: 'smile', label: 'Smiley' },
  { id: 'sharp', label: 'Sharp' },
  { id: 'big', label: 'Big' },
];
export const ACCESSORIES = [
  { id: 'none', label: 'None' },
  { id: 'hat', label: 'Straw Hat' },
  { id: 'scarf', label: 'Scarf' },
  { id: 'bandana', label: 'Bandana' },
  { id: 'glasses', label: 'Glasses' },
  { id: 'flower', label: 'Flower' },
];

export const DEFAULT_CHAR: CharDef = {
  name: '',
  farmName: '',
  gender: 'nonbinary',
  hair: 'short',
  hairColor: '#5a4632',
  skin: '#f2c9a0',
  eye: '#3b82f6',
  eyeStyle: 'round',
  outfit: 'overall',
  outfitColor: '#3b82f6',
  shoes: 'boots',
  accessory: 'none',
};

export function sanitizeName(raw: string, max: number): string {
  return String(raw || '')
    .replace(/[<>{}[\]\\|/:"'`~^]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

export function validateChar(c: CharDef): string | null {
  if (!c.name.trim()) return 'Nama karakter wajib diisi.';
  if (c.name.trim().length < 2) return 'Nama terlalu pendek (min 2 huruf).';
  if (!/^[a-zA-Z0-9 _-]+$/.test(c.name)) return 'Nama hanya boleh huruf, angka, spasi, - dan _.';
  if (!c.farmName.trim()) return 'Nama farm wajib diisi.';
  if (!/^[a-zA-Z0-9 _'-]+$/.test(c.farmName)) return 'Nama farm tidak valid.';
  return null;
}
