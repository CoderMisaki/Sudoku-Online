// Procedural pixel textures & UI icons (no external art assets).
import * as THREE from 'three';

export const PX = 8; // pixels per tile in the ground texture

export function rleDecode(rle: string, len: number): Uint8Array {
  const grid = new Uint8Array(len);
  let p = 0;
  let i = 0;
  while (i + 1 < rle.length && p < len) {
    const v = rle.charCodeAt(i);
    const run = rle.charCodeAt(i + 1);
    i += 2;
    for (let k = 0; k < run && p < len; k++) grid[p++] = v;
  }
  return grid;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function shade(rgb: [number, number, number], f: number): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] * f)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] * f)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] * f)));
  return `rgb(${r},${g},${b})`;
}

const TILE_COLORS: Record<number, string> = {
  0: '#79b356', // grass
  1: '#b3996e', // path
  2: '#8a5a33', // soil
  3: '#3f86c8', // water
  4: '#e6d3a3', // sand
  5: '#8d8d94', // rock
  6: '#4f7d3f', // forest floor
  7: '#79b356', // flower meadow (base = grass)
  8: '#8a8278', // mountain
  9: '#c9b8a3', // plaza
};

export function buildGroundTexture(grid: Uint8Array, W: number, H: number): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = W * PX;
  cv.height = H * PX;
  const c = cv.getContext('2d')!;
  // per-tile base
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = grid[y * W + x];
      const base = TILE_COLORS[t] || TILE_COLORS[0];
      const [r, g, b] = hexToRgb(base);
      const seed = (x * 73856093 ^ y * 19349663) >>> 0;
      const n1 = (seed % 17) / 17;
      const n2 = ((seed >> 5) % 13) / 13;
      const col = shade([r, g, b], 0.92 + n1 * 0.16);
      c.fillStyle = col;
      c.fillRect(x * PX, y * PX, PX, PX);
      // texture details
      if (t === 0 || t === 7) {
        // grass blades
        c.fillStyle = shade([r, g, b], 0.85);
        for (let i = 0; i < 3; i++) {
          const bx = x * PX + ((seed >> (i * 4)) % PX);
          const by = y * PX + ((seed >> (i * 4 + 2)) % PX);
          c.fillRect(bx, by, 1, 2);
        }
        c.fillStyle = shade([r, g, b], 1.15);
        c.fillRect(x * PX + 2, y * PX + 3, 1, 1);
        c.fillRect(x * PX + 5, y * PX + 5, 1, 1);
      } else if (t === 1) {
        c.fillStyle = shade([r, g, b], 0.8 + n2 * 0.2);
        c.fillRect(x * PX + ((seed >> 3) % 5), y * PX + ((seed >> 7) % 5), 2, 1);
      } else if (t === 2) {
        // furrows
        c.fillStyle = shade([r, g, b], 0.75);
        c.fillRect(x * PX, y * PX + 2, PX, 1);
        c.fillRect(x * PX, y * PX + 6, PX, 1);
      } else if (t === 3) {
        // waves
        const w1 = ((seed / 7) % 1) * 4;
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.fillRect(x * PX + w1, y * PX + 1, 3, 1);
        c.fillRect(x * PX + ((w1 + 3) % 7), y * PX + 5, 3, 1);
      } else if (t === 4) {
        c.fillStyle = shade([r, g, b], 0.85);
        c.fillRect(x * PX + (seed % 5), y * PX + (seed % 4), 1, 1);
        c.fillRect(x * PX + 4, y * PX + 5, 1, 1);
      } else if (t === 5) {
        c.fillStyle = shade([r, g, b], 0.8 + n2 * 0.3);
        c.fillRect(x * PX + 1, y * PX + 1, PX - 2, PX - 2);
        c.fillStyle = shade([r, g, b], 1.2);
        c.fillRect(x * PX + 2, y * PX + 2, 2, 2);
      } else if (t === 6) {
        c.fillStyle = shade([r, g, b], 0.85 + n1 * 0.2);
        c.fillRect(x * PX + (seed % 6), y * PX + 2 + (seed % 4), 2, 2);
        c.fillRect(x * PX + 4, y * PX + 5, 1, 1);
      } else if (t === 8) {
        c.fillStyle = shade([r, g, b], 0.78 + n1 * 0.3);
        c.fillRect(x * PX, y * PX, PX, PX);
        c.fillStyle = shade([r, g, b], 1.18);
        c.fillRect(x * PX + 1, y * PX + 1, 2, 2);
      } else if (t === 9) {
        c.fillStyle = shade([r, g, b], 0.9 + n1 * 0.12);
        c.fillRect(x * PX, y * PX, PX, PX);
        if (x % 4 === 0 || y % 4 === 0) {
          c.fillStyle = 'rgba(0,0,0,0.08)';
          c.fillRect(x * PX, y * PX, PX, 1);
          c.fillRect(x * PX, y * PX, 1, PX);
        }
      }
      // flower dots
      if (t === 7) {
        const flowerColors = ['#f0a8c8', '#f2d24b', '#ffffff', '#e05b4b'];
        c.fillStyle = flowerColors[(seed >> 9) % flowerColors.length];
        c.fillRect(x * PX + 3 + ((seed >> 5) % 3), y * PX + 3 + ((seed >> 8) % 3), 2, 2);
      }
    }
  }
  // edges between different tiles
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = grid[y * W + x];
      const isWater = t === 3;
      const right = x + 1 < W ? grid[y * W + x + 1] : t;
      const down = y + 1 < H ? grid[(y + 1) * W + x] : t;
      if (isWater && right !== 3) {
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillRect(x * PX + PX - 1, y * PX, 1, PX);
      }
      if (isWater && down !== 3) {
        c.fillStyle = 'rgba(255,255,255,0.35)';
        c.fillRect(x * PX, y * PX + PX - 1, PX, 1);
      }
      if (!isWater && right === 3) {
        c.fillStyle = 'rgba(0,0,0,0.18)';
        c.fillRect(x * PX + PX - 1, y * PX, 1, PX);
      }
      if (!isWater && down === 3) {
        c.fillStyle = 'rgba(0,0,0,0.18)';
        c.fillRect(x * PX, y * PX + PX - 1, PX, 1);
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function buildOverlayTexture(grid: Uint8Array, W: number, H: number, kind: 'water' | 'tilled' | 'soilGlow'): THREE.CanvasTexture {
  const cv = document.createElement('canvas');
  cv.width = W * PX;
  cv.height = H * PX;
  const c = cv.getContext('2d')!;
  c.clearRect(0, 0, cv.width, cv.height);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = grid[y * W + x];
      if (kind === 'water' && t === 3) {
        const seed = (x * 73856093 ^ y * 19349663) >>> 0;
        c.fillStyle = 'rgba(160,210,255,0.16)';
        c.fillRect(x * PX, y * PX, PX, PX);
        c.fillStyle = 'rgba(255,255,255,0.12)';
        c.fillRect(x * PX + ((seed % 5)), y * PX + 2, 2, 1);
      } else if (kind === 'tilled') {
        // tint overlay for tilled soil handled via separate small meshes; skip here
      }
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ── UI icons (32x32 data-URLs) ──
const iconCache = new Map<string, string>();
export function makeItemIcon(cat: string, color: string, id = ''): string {
  const key = cat + color + id;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 40; cv.height = 40;
  const c = cv.getContext('2d')!;
  const base = color.match(/#[0-9a-fA-F]{6}/) ? color : '#88aa88';
  c.fillStyle = base;
  // silhouette by category
  const draw = (fn: () => void) => { c.save(); c.translate(20, 22); fn(); c.restore(); };
  if (cat === 'tool') {
    draw(() => {
      c.fillStyle = '#5a4632';
      c.fillRect(-2, -12, 4, 18); // handle
      c.fillStyle = base;
      if (id.includes('hoe') || id.includes('pick')) { c.fillRect(-6, -16, 12, 5); }
      else if (id.includes('axe')) { c.beginPath(); c.moveTo(-7, -16); c.lineTo(7, -16); c.lineTo(7, -8); c.closePath(); c.fill(); }
      else if (id.includes('rod')) { c.fillRect(-8, -6, 16, 3); }
      else if (id.includes('can')) { c.fillRect(-6, -16, 12, 12); c.fillRect(-8, -6, 16, 3); }
      else if (id.includes('sickle')) { c.beginPath(); c.arc(3, -10, 8, 0, Math.PI); c.fill(); }
      else { c.fillRect(-7, -16, 14, 5); }
    });
  } else if (cat === 'seed') {
    draw(() => {
      c.fillStyle = base;
      c.beginPath(); c.ellipse(0, 4, 4, 6, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = '#3e7d3e';
      c.fillRect(-1, -8, 3, 12);
      c.fillRect(-5, -6, 10, 3);
      c.fillRect(-4, -11, 3, 5);
      c.fillRect(2, -11, 3, 5);
    });
  } else if (cat === 'crop' || cat === 'forage' && id === 'herb') {
    draw(() => {
      c.fillStyle = base;
      if (id.includes('goldleaf')) { c.fillRect(-1, -12, 3, 12); c.beginPath(); c.ellipse(-4, -8, 5, 3, -0.6, 0, Math.PI * 2); c.fill(); c.beginPath(); c.ellipse(4, -8, 5, 3, 0.6, 0, Math.PI * 2); c.fill(); }
      else {
        c.beginPath(); c.ellipse(0, 0, 7, 9, 0, 0, Math.PI * 2); c.fill();
        c.fillStyle = 'rgba(255,255,255,0.25)';
        c.fillRect(-3, -2, 3, 3);
      }
    });
  } else if (cat === 'fish') {
    draw(() => {
      c.fillStyle = base;
      c.beginPath(); c.ellipse(0, 0, 9, 5, 0, 0, Math.PI * 2); c.fill();
      c.beginPath(); c.moveTo(7, 0); c.lineTo(13, -5); c.lineTo(13, 5); c.closePath(); c.fill();
      c.fillStyle = '#00000055';
      c.fillRect(2, -2, 2, 2);
    });
  } else if (cat === 'mineral' || cat === 'insect') {
    draw(() => {
      c.fillStyle = base;
      c.beginPath(); c.moveTo(-8, 4); c.lineTo(-3, -8); c.lineTo(6, -6); c.lineTo(9, 3); c.lineTo(3, 9); c.lineTo(-6, 8); c.closePath(); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(-4, -3, 3, 2);
    });
  } else if (cat === 'meal') {
    draw(() => {
      c.fillStyle = '#e8e8e8';
      c.beginPath(); c.ellipse(0, 2, 9, 5, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = base;
      c.beginPath(); c.ellipse(0, 1, 7, 3.4, 0, 0, Math.PI * 2); c.fill();
      if (id.includes('bread')) { c.fillStyle = '#f2c94c'; c.fillRect(-4, -4, 8, 4); }
    });
  } else if (cat === 'furniture') {
    draw(() => {
      c.fillStyle = base;
      c.fillRect(-8, -6, 16, 10);
      c.fillRect(-8, -6, 4, 14);
      c.fillRect(4, -6, 4, 14);
    });
  } else if (cat === 'product') {
    draw(() => {
      c.fillStyle = base;
      c.beginPath(); c.ellipse(0, 0, 8, 9, 0, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.15)';
      c.fillRect(-3, -4, 6, 3);
    });
  } else if (cat === 'fert' || cat === 'bait') {
    draw(() => {
      c.fillStyle = '#8a6a3f';
      c.fillRect(-8, 2, 16, 8);
      c.fillStyle = base;
      c.beginPath(); c.moveTo(-5, 2); c.lineTo(5, 2); c.lineTo(2, -8); c.lineTo(-2, -8); c.closePath(); c.fill();
    });
  } else { // special / misc
    draw(() => {
      c.fillStyle = base;
      c.beginPath(); c.arc(0, 0, 9, 0, Math.PI * 2); c.fill();
      c.fillStyle = 'rgba(255,255,255,0.4)';
      c.fillRect(-3, -4, 3, 3);
    });
  }
  const url = cv.toDataURL();
  iconCache.set(key, url);
  return url;
}

export function makeEmojiIcon(symbol: string, bg = '#2a3550'): string {
  const key = 'emo:' + symbol + bg;
  const hit = iconCache.get(key);
  if (hit) return hit;
  const cv = document.createElement('canvas');
  cv.width = 40; cv.height = 40;
  const c = cv.getContext('2d')!;
  c.fillStyle = bg;
  c.beginPath(); c.arc(20, 20, 19, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#ffffff';
  c.font = 'bold 22px Arial';
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(symbol, 20, 22);
  const url = cv.toDataURL();
  iconCache.set(key, url);
  return url;
}
