export interface LadderItem {
  id: string;
  start: number; // Kotak bawah
  end: number;   // Kotak atas
  color?: string;
}

export interface SnakeItem {
  id: string;
  head: number;  // Kotak kepala (atas)
  tail: number;  // Kotak ekor (bawah)
  color: string;
  patternColor: string;
  curveFactor: number; // Variasi lekukan gelombang ular
}

export interface SnakesAndLaddersConfig {
  ladders: LadderItem[];
  snakes: SnakeItem[];
  map: Record<number, number>; // Mapping kotak -> tujuan
}

const SNAKE_PALETTES = [
  { color: '#15803d', patternColor: '#86efac' }, // Hijau
  { color: '#b91c1c', patternColor: '#fde047' }, // Merah-Kuning
  { color: '#1d4ed8', patternColor: '#93c5fd' }, // Biru-Putih
  { color: '#c2410c', patternColor: '#fed7aa' }, // Oranye
  { color: '#7e22ce', patternColor: '#f5d0fe' }, // Ungu
  { color: '#0f766e', patternColor: '#99f6e4' }, // Toska
];

// Konversi nomor kotak (1-100) ke koordinat persentase X, Y papan 10x10 (Boustrophedon)
export function getTileCoordinates(tileNumber: number): { x: number; y: number } {
  const rowFromBottom = Math.floor((tileNumber - 1) / 10);
  const rowFromTop = 9 - rowFromBottom;

  let col = 0;
  if (rowFromBottom % 2 === 0) {
    // Genap: Kiri ke Kanan (1-10, 21-30, dst)
    col = (tileNumber - 1) % 10;
  } else {
    // Ganjil: Kanan ke Kiri (11-20, 31-40, dst)
    col = 9 - ((tileNumber - 1) % 10);
  }

  // Ambil titik tengah kotak dalam skala 0 - 100%
  return {
    x: (col + 0.5) * 10,
    y: (rowFromTop + 0.5) * 10,
  };
}

// Generator acak prosedural agar tiap game memiliki ular dan tangga yang selalu berbeda
export function generateRandomSnakesAndLadders(): SnakesAndLaddersConfig {
  const ladders: LadderItem[] = [];
  const snakes: SnakeItem[] = [];
  const map: Record<number, number> = {};
  const occupiedTiles = new Set<number>([1, 100]); // Kotak start & finish tidak boleh ada kepala/ekor

  const numLadders = 6;
  const numSnakes = 6;

  // 1. Generate Tangga Acak
  let ladderAttempts = 0;
  while (ladders.length < numLadders && ladderAttempts < 150) {
    ladderAttempts++;
    const startRow = Math.floor(Math.random() * 7); // Baris 0 - 6 (kotak 2 - 70)
    const endRow = startRow + Math.floor(Math.random() * 3) + 2; // Naik 2-4 baris ke atas

    if (endRow >= 10) continue;

    const start = (startRow * 10) + (Math.floor(Math.random() * 10) + 1);
    const end = (endRow * 10) + (Math.floor(Math.random() * 10) + 1);

    if (start >= end || occupiedTiles.has(start) || occupiedTiles.has(end)) continue;

    occupiedTiles.add(start);
    occupiedTiles.add(end);
    map[start] = end;

    ladders.push({
      id: `ladder-${start}-${end}`,
      start,
      end,
      color: '#1e293b'
    });
  }

  // 2. Generate Ular Acak
  let snakeAttempts = 0;
  while (snakes.length < numSnakes && snakeAttempts < 150) {
    snakeAttempts++;
    const headRow = Math.floor(Math.random() * 7) + 3; // Baris 3 - 9 (kotak 31 - 99)
    const tailRow = headRow - (Math.floor(Math.random() * 3) + 2); // Turun 2-4 baris ke bawah

    if (tailRow < 0) continue;

    const head = (headRow * 10) + (Math.floor(Math.random() * 10) + 1);
    const tail = (tailRow * 10) + (Math.floor(Math.random() * 10) + 1);

    if (head <= tail || head === 100 || occupiedTiles.has(head) || occupiedTiles.has(tail)) continue;

    occupiedTiles.add(head);
    occupiedTiles.add(tail);
    map[head] = tail;

    const palette = SNAKE_PALETTES[snakes.length % SNAKE_PALETTES.length];
    snakes.push({
      id: `snake-${head}-${tail}`,
      head,
      tail,
      color: palette.color,
      patternColor: palette.patternColor,
      curveFactor: (Math.random() > 0.5 ? 1 : -1) * (15 + Math.random() * 15)
    });
  }

  return { ladders, snakes, map };
}
