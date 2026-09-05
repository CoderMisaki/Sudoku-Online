import {
  ArrowCoord,
  ArrowDirection,
  ArrowObject,
  ArrowPuzzleState,
  ArrowPuzzleVariant,
  Difficulty,
} from '../types/game';

// ─────────────────────────────────────────────────────────────────────────────
// ATURAN MAIN — ARROW PUZZLE MASTER (ARROW REMOVAL PUZZLE)
// ─────────────────────────────────────────────────────────────────────────────
// Papan berisi kumpulan ARROW: jalur tebal berbentuk garis / siku / U / zig-zag
// yang ujungnya memiliki kepala panah. Pemain mengetuk sebuah arrow:
//   • Bila seluruh lintasan di depan arrow (sampai tepi papan) bebas dari arrow
//     lain, arrow meluncur mengikuti arah panahnya, keluar papan, lalu DIHAPUS.
//   • Bila ada arrow lain yang menghalangi lintasannya, arrow TIDAK bergerak
//     (blocked) dan pemain terkena penalti.
// Tujuan: keluarkan SEMUA arrow. Urutan bebas selama tidak terhalang.
//
// Arrow bergerak sebagai satu benda kaku: setiap sel yang ditempatinya bergeser
// bersama ke arah keluar. Karena itu "lintasan" (sweep) = gabungan semua sel di
// depan setiap sel tubuh arrow hingga tepi papan.
//
// PENILAIAN (Classic maupun Competition):
//   • Arrow keluar   : +10 poin
//   • Tap terhalang  : -5, lalu -10, -20, -40, ... (kelipatan 2x saat beruntun,
//                      dibatasi -80 per tap). Tap sukses mereset hitungan.
// ─────────────────────────────────────────────────────────────────────────────

/** Indeks arah: 0 = Atas, 1 = Kanan, 2 = Bawah, 3 = Kiri. */
export const ARROW_DIRS = [
  { dr: -1, dc: 0, glyph: '↑', name: 'Atas' },
  { dr: 0, dc: 1, glyph: '→', name: 'Kanan' },
  { dr: 1, dc: 0, glyph: '↓', name: 'Bawah' },
  { dr: 0, dc: -1, glyph: '←', name: 'Kiri' },
] as const;

/** Arah berlawanan: Atas<->Bawah, Kanan<->Kiri. */
export const OPPOSITE_DIR: ArrowDirection[] = [2, 3, 0, 1];

export const ARROW_CORRECT_POINTS = 10;
export const ARROW_WRONG_BASE_PENALTY = 5;
/** Penalti salah beruntun dibatasi supaya skor tidak jebol ke angka tak masuk akal. */
export const ARROW_WRONG_MAX_PENALTY = 80;
/** Bonus finis mode Competition (sama seperti bonus juara Sudoku Competition). */
export const ARROW_FINISH_BONUS = [100, 60, 30];
export const ARROW_FINISH_BONUS_DEFAULT = 10;
/** Bonus tim saat puzzle Classic dituntaskan bersama. */
export const ARROW_TEAM_BONUS = 50;

export interface ArrowDifficultyConfig {
  /** Ukuran papan (sel per sisi). */
  size: number;
  /** Jumlah arrow yang ditargetkan. */
  arrowCount: number;
  /** Panjang jalur arrow (jumlah sel) minimum & maksimum. */
  minLength: number;
  maxLength: number;
  /** Peluang jalur berbelok di tiap langkah pembentukan (0..1). */
  turnChance: number;
  /** Peluang arrow baru sengaja ditaruh di lintasan arrow lain (menciptakan blocking). */
  blockBias: number;
  /** Rasio maksimum arrow yang langsung bebas di awal (0..1). */
  maxFreeRatio: number;
  /** Minimal jumlah arrow yang terhalang di awal. */
  minBlocked: number;
  label: string;
  description: string;
}

export type ArrowDifficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'evil';

export const ARROW_DIFFICULTY: Record<ArrowDifficulty, ArrowDifficultyConfig> = {
  easy: {
    size: 6, arrowCount: 5, minLength: 2, maxLength: 4, turnChance: 0.35, blockBias: 0.55,
    maxFreeRatio: 0.7, minBlocked: 1,
    label: 'Easy', description: 'Sedikit arrow, jalur pendek, blocking sederhana',
  },
  medium: {
    size: 7, arrowCount: 8, minLength: 2, maxLength: 5, turnChance: 0.4, blockBias: 0.65,
    maxFreeRatio: 0.55, minBlocked: 3,
    label: 'Medium', description: 'Lebih banyak arrow, dependency mulai bercabang',
  },
  hard: {
    size: 8, arrowCount: 11, minLength: 3, maxLength: 6, turnChance: 0.45, blockBias: 0.75,
    maxFreeRatio: 0.45, minBlocked: 5,
    label: 'Hard', description: 'Papan padat, rantai dependency bercabang',
  },
  expert: {
    size: 9, arrowCount: 14, minLength: 3, maxLength: 7, turnChance: 0.5, blockBias: 0.8,
    maxFreeRatio: 0.4, minBlocked: 7,
    label: 'Expert', description: 'Banyak arrow panjang, blocking kompleks',
  },
  evil: {
    size: 10, arrowCount: 18, minLength: 3, maxLength: 8, turnChance: 0.5, blockBias: 0.85,
    maxFreeRatio: 0.35, minBlocked: 10,
    label: 'Evil', description: 'Papan sangat padat, dependency panjang — tetap 100% solvable',
  },
};

const ARROW_DIFFICULTY_KEYS: readonly ArrowDifficulty[] = ['easy', 'medium', 'hard', 'expert', 'evil'];

export function isArrowDifficulty(value: string): value is ArrowDifficulty {
  return (ARROW_DIFFICULTY_KEYS as readonly string[]).includes(value);
}

/**
 * Petakan Difficulty apa pun ke salah satu tingkat Arrow Puzzle.
 * '3x3'/'8x8' milik Tic Tac Toe dipetakan ke medium.
 */
export function normalizeArrowDifficulty(difficulty: Difficulty | undefined): ArrowDifficulty {
  if (difficulty && isArrowDifficulty(difficulty)) return difficulty;
  return 'medium';
}

export function getArrowConfig(difficulty: Difficulty | undefined): ArrowDifficultyConfig {
  return ARROW_DIFFICULTY[normalizeArrowDifficulty(difficulty)];
}

// ─────────────────────────────────────────────────────────────────────────────
// RNG deterministik — seed yang sama selalu menghasilkan puzzle yang sama,
// sehingga semua pemain Competition mendapat papan identik tanpa server.
// ─────────────────────────────────────────────────────────────────────────────

export function hashSeedString(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Seed papan Competition: roomId + tingkat kesulitan + ronde (startedAt). */
export function buildArrowSeed(roomId: string, difficulty: Difficulty | undefined, round: number | string = 0): string {
  const cfg = getArrowConfig(difficulty);
  return `arrow:${roomId || 'solo'}:${cfg.label}:${round}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// GEOMETRI & COLLISION ENGINE
// ─────────────────────────────────────────────────────────────────────────────

export const coordKey = (row: number, col: number) => `${row}:${col}`;

export const inBounds = (size: number, row: number, col: number) =>
  row >= 0 && row < size && col >= 0 && col < size;

/** Sel kepala panah (elemen terakhir dari `cells`). */
export function getArrowHead(arrow: ArrowObject): ArrowCoord {
  return arrow.cells[arrow.cells.length - 1];
}

/**
 * Lintasan (sweep) arrow: semua sel di depan SETIAP sel tubuh arrow hingga tepi
 * papan, tidak termasuk sel arrow itu sendiri. Arrow bergerak sebagai benda kaku,
 * jadi seluruh area ini harus kosong supaya arrow bisa keluar.
 */
export function getArrowSweep(arrow: ArrowObject, size: number): ArrowCoord[] {
  const own = new Set(arrow.cells.map((c) => coordKey(c.row, c.col)));
  const seen = new Set<string>();
  const out: ArrowCoord[] = [];
  const { dr, dc } = ARROW_DIRS[arrow.direction];
  for (const cell of arrow.cells) {
    let r = cell.row + dr;
    let c = cell.col + dc;
    while (inBounds(size, r, c)) {
      const key = coordKey(r, c);
      if (!own.has(key) && !seen.has(key)) {
        seen.add(key);
        out.push({ row: r, col: c });
      }
      r += dr;
      c += dc;
    }
  }
  return out;
}

/**
 * Jarak (dalam sel) yang harus ditempuh arrow sampai SELURUH tubuhnya berada di
 * luar papan. Dipakai renderer untuk animasi keluar.
 */
export function getArrowExitDistance(arrow: ArrowObject, size: number): number {
  const { dr, dc } = ARROW_DIRS[arrow.direction];
  let max = 0;
  for (const cell of arrow.cells) {
    let steps = 0;
    let r = cell.row;
    let c = cell.col;
    while (inBounds(size, r, c)) {
      r += dr;
      c += dc;
      steps++;
    }
    if (steps > max) max = steps;
  }
  return max;
}

/** Validasi geometri satu arrow: sel berurutan (tetangga 4-arah), tak tumpang-tindih, dalam papan. */
export function isValidArrowGeometry(arrow: ArrowObject, size: number): boolean {
  if (!arrow.cells || arrow.cells.length === 0) return false;
  const seen = new Set<string>();
  for (let i = 0; i < arrow.cells.length; i++) {
    const c = arrow.cells[i];
    if (!inBounds(size, c.row, c.col)) return false;
    const key = coordKey(c.row, c.col);
    if (seen.has(key)) return false;
    seen.add(key);
    if (i > 0) {
      const p = arrow.cells[i - 1];
      if (Math.abs(p.row - c.row) + Math.abs(p.col - c.col) !== 1) return false;
    }
  }
  // Sel tepat di belakang kepala harus segaris dengan arah keluar supaya kepala
  // panah "keluar" dari batang, bukan menyamping.
  if (arrow.cells.length >= 2) {
    const head = getArrowHead(arrow);
    const prev = arrow.cells[arrow.cells.length - 2];
    const { dr, dc } = ARROW_DIRS[arrow.direction];
    if (prev.row + dr !== head.row || prev.col + dc !== head.col) return false;
  }
  return true;
}

/** Peta sel -> id arrow untuk sekumpulan arrow aktif. */
export function buildOccupancy(arrows: ArrowObject[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of arrows) for (const c of a.cells) map.set(coordKey(c.row, c.col), a.id);
  return map;
}

/** Id arrow-arrow lain (aktif) yang berada di lintasan `arrow`. */
export function findBlockers(arrow: ArrowObject, activeArrows: ArrowObject[], size: number): string[] {
  const occupancy = buildOccupancy(activeArrows.filter((a) => a.id !== arrow.id));
  const blockers = new Set<string>();
  for (const cell of getArrowSweep(arrow, size)) {
    const id = occupancy.get(coordKey(cell.row, cell.col));
    if (id) blockers.add(id);
  }
  return Array.from(blockers);
}

export function isArrowFree(arrow: ArrowObject, activeArrows: ArrowObject[], size: number): boolean {
  return findBlockers(arrow, activeArrows, size).length === 0;
}

/**
 * Solver: berulang kali keluarkan arrow yang bebas. Karena menghapus arrow tidak
 * pernah MENGHALANGI arrow lain (monoton), urutan greedy apa pun tuntas jika
 * puzzle memang solvable. Mengembalikan urutan solusi, atau null bila deadlock.
 */
export function solveArrowPuzzle(arrows: ArrowObject[], size: number): string[] | null {
  let active = [...arrows];
  const order: string[] = [];
  while (active.length > 0) {
    const free = active.find((a) => isArrowFree(a, active, size));
    if (!free) return null;
    order.push(free.id);
    active = active.filter((a) => a.id !== free.id);
  }
  return order;
}

// ─────────────────────────────────────────────────────────────────────────────
// GENERATOR PUZZLE — konstruksi terbalik yang menjamin solvable
// ─────────────────────────────────────────────────────────────────────────────
// Arrow ditaruh satu per satu. Syarat penempatan: arrow baru tidak menimpa arrow
// lama DAN lintasannya bebas dari semua arrow lama. Dengan begitu arrow yang
// dipasang paling akhir pasti bisa keluar duluan, lalu yang sebelumnya, dst.
// Supaya puzzle menantang, kepala/tubuh arrow baru sengaja dibias agar berada
// di lintasan arrow lama (menciptakan blocking + rantai dependency).
// ─────────────────────────────────────────────────────────────────────────────

interface BuildResult {
  arrows: ArrowObject[];
  solutionOrder: string[];
  initiallyFree: number;
}

function pickWeighted<T>(items: T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)];
}

/**
 * Bentuk jalur dari kepala ke belakang: segmen pertama segaris dengan arah
 * keluar, lalu random-walk dengan belokan 90° (tanpa balik arah / tabrak diri).
 */
function growArrowBody(
  head: ArrowCoord,
  direction: ArrowDirection,
  length: number,
  size: number,
  free: (r: number, c: number) => boolean,
  turnChance: number,
  rand: () => number
): ArrowCoord[] | null {
  const cells: ArrowCoord[] = [head];
  const used = new Set<string>([coordKey(head.row, head.col)]);
  // Bergerak "mundur" dari kepala: arah pertama = lawan arah keluar.
  let walkDir: ArrowDirection = OPPOSITE_DIR[direction];
  let straightRun = 0;

  while (cells.length < length) {
    const cur = cells[cells.length - 1];
    const options: ArrowDirection[] = [];
    const perpendicular: ArrowDirection[] = walkDir === 0 || walkDir === 2 ? [1, 3] : [0, 2];

    // Segmen tepat di belakang kepala wajib lurus minimal 1 sel.
    const mayTurn = cells.length >= 2 && (rand() < turnChance || straightRun >= 3);
    const ordered: ArrowDirection[] = mayTurn
      ? [...(rand() < 0.5 ? perpendicular : [...perpendicular].reverse()), walkDir]
      : [walkDir, ...(rand() < 0.5 ? perpendicular : [...perpendicular].reverse())];

    for (const d of ordered) {
      const nr = cur.row + ARROW_DIRS[d].dr;
      const nc = cur.col + ARROW_DIRS[d].dc;
      if (!inBounds(size, nr, nc)) continue;
      if (used.has(coordKey(nr, nc))) continue;
      if (!free(nr, nc)) continue;
      options.push(d);
    }
    if (options.length === 0) break;

    const chosen = options[0];
    straightRun = chosen === walkDir ? straightRun + 1 : 0;
    walkDir = chosen;
    const nr = cur.row + ARROW_DIRS[chosen].dr;
    const nc = cur.col + ARROW_DIRS[chosen].dc;
    cells.push({ row: nr, col: nc });
    used.add(coordKey(nr, nc));
  }

  if (cells.length < 2) return null;
  // Simpan urutan ekor -> kepala.
  return cells.reverse();
}

function buildAttempt(cfg: ArrowDifficultyConfig, rand: () => number): BuildResult | null {
  const { size } = cfg;
  const placed: ArrowObject[] = [];
  const occupied = new Set<string>();
  const free = (r: number, c: number) => !occupied.has(coordKey(r, c));

  let failures = 0;
  const maxFailures = 900;

  while (placed.length < cfg.arrowCount && failures < maxFailures) {
    // Kumpulkan sel-sel lintasan arrow lama (kandidat untuk menghalangi mereka).
    const sweepCells: ArrowCoord[] = [];
    if (placed.length > 0 && rand() < cfg.blockBias) {
      for (const a of placed) {
        for (const c of getArrowSweep(a, size)) if (free(c.row, c.col)) sweepCells.push(c);
      }
    }

    let anchor: ArrowCoord;
    if (sweepCells.length > 0) {
      anchor = pickWeighted(sweepCells, rand);
    } else {
      anchor = { row: Math.floor(rand() * size), col: Math.floor(rand() * size) };
      if (!free(anchor.row, anchor.col)) {
        failures++;
        continue;
      }
    }

    const direction = Math.floor(rand() * 4) as ArrowDirection;
    const targetLen = cfg.minLength + Math.floor(rand() * (cfg.maxLength - cfg.minLength + 1));
    const body = growArrowBody(anchor, direction, targetLen, size, free, cfg.turnChance, rand);
    if (!body || body.length < Math.min(cfg.minLength, 2)) {
      failures++;
      continue;
    }

    const candidate: ArrowObject = { id: `a${placed.length + 1}`, cells: body, direction };
    if (!isValidArrowGeometry(candidate, size)) {
      failures++;
      continue;
    }

    // Syarat kunci: lintasan arrow baru harus bebas dari SEMUA arrow lama.
    if (!isArrowFree(candidate, [...placed, candidate], size)) {
      failures++;
      continue;
    }

    placed.push(candidate);
    for (const c of body) occupied.add(coordKey(c.row, c.col));
  }

  if (placed.length < Math.max(3, Math.floor(cfg.arrowCount * 0.75))) return null;

  const solutionOrder = solveArrowPuzzle(placed, size);
  if (!solutionOrder) return null; // secara teori mustahil, tetap dijaga

  const initiallyFree = placed.filter((a) => isArrowFree(a, placed, size)).length;
  return { arrows: placed, solutionOrder, initiallyFree };
}

/** Hasil generator termasuk solution order internal (JANGAN dibroadcast ke pemain). */
export interface GeneratedArrowPuzzle {
  state: ArrowPuzzleState;
  /** Urutan penyelesaian valid — hanya untuk verifikasi engine/test. */
  solutionOrder: string[];
}

function emptyState(
  boardId: string,
  seed: string,
  size: number,
  arrows: ArrowObject[],
  variant: ArrowPuzzleVariant,
  difficulty: ArrowDifficulty
): ArrowPuzzleState {
  return {
    boardId,
    seed,
    size,
    arrows,
    variant,
    difficulty,
    removedArrowIds: [],
    playerRemoved: {},
    wrongStreak: {},
    winnerId: null,
    winners: [],
    completed: false,
    revision: 1,
    lastMove: null,
  };
}

/**
 * Buat puzzle Arrow Removal.
 * `seed` yang sama + difficulty yang sama = puzzle identik (deterministik).
 */
export function generateArrowPuzzleDetailed(
  difficulty: Difficulty | undefined,
  variant: ArrowPuzzleVariant,
  seed: string
): GeneratedArrowPuzzle {
  const cfg = getArrowConfig(difficulty);
  const difficultyKey = normalizeArrowDifficulty(difficulty);

  let best: BuildResult | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 40; attempt++) {
    const rand = mulberry32(hashSeedString(`${seed}#${attempt}`));
    const built = buildAttempt(cfg, rand);
    if (!built) continue;

    const blocked = built.arrows.length - built.initiallyFree;
    const freeRatio = built.initiallyFree / built.arrows.length;
    const meetsCount = built.arrows.length >= cfg.arrowCount;
    const meetsBlocked = blocked >= Math.min(cfg.minBlocked, built.arrows.length - 1);
    const meetsFree = built.initiallyFree >= 1 && freeRatio <= cfg.maxFreeRatio;

    if (meetsCount && meetsBlocked && meetsFree) {
      return {
        state: emptyState(
          `ap-${hashSeedString(seed).toString(36)}-${attempt}`,
          seed,
          cfg.size,
          built.arrows,
          variant,
          difficultyKey
        ),
        solutionOrder: built.solutionOrder,
      };
    }

    // Simpan kandidat terbaik sebagai cadangan (tetap solvable).
    const score = built.arrows.length * 2 + blocked - (built.initiallyFree === 0 ? 100 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = built;
    }
  }

  if (best && best.initiallyFree > 0) {
    return {
      state: emptyState(
        `ap-${hashSeedString(seed).toString(36)}-best`,
        seed,
        cfg.size,
        best.arrows,
        variant,
        difficultyKey
      ),
      solutionOrder: best.solutionOrder,
    };
  }

  // Fallback ekstrem (praktis tidak pernah terjadi): tiga arrow dengan rantai jelas.
  const size = cfg.size;
  const fallback: ArrowObject[] = [
    { id: 'a1', cells: [{ row: 1, col: 0 }, { row: 1, col: 1 }], direction: 1 },
    { id: 'a2', cells: [{ row: 3, col: 3 }, { row: 2, col: 3 }], direction: 0 },
    { id: 'a3', cells: [{ row: 0, col: 4 }, { row: 0, col: 5 }], direction: 1 },
  ];
  return {
    state: emptyState(`ap-fallback-${hashSeedString(seed).toString(36)}`, seed, size, fallback, variant, difficultyKey),
    solutionOrder: solveArrowPuzzle(fallback, size) ?? [],
  };
}

export function generateArrowPuzzle(
  difficulty: Difficulty | undefined,
  variant: ArrowPuzzleVariant,
  seed: string
): ArrowPuzzleState {
  return generateArrowPuzzleDetailed(difficulty, variant, seed).state;
}

// ─────────────────────────────────────────────────────────────────────────────
// PEMBACAAN STATE
// ─────────────────────────────────────────────────────────────────────────────

/** Id arrow yang sudah keluar untuk pemain ini (Classic: papan bersama). */
export function getRemovedArrowIds(state: ArrowPuzzleState, userId: string): string[] {
  if (state.variant === 'classic') return state.removedArrowIds ?? [];
  return state.playerRemoved?.[userId] ?? [];
}

/** Arrow yang masih ada di papan pemain ini. */
export function getActiveArrows(state: ArrowPuzzleState, userId: string): ArrowObject[] {
  const removed = new Set(getRemovedArrowIds(state, userId));
  return state.arrows.filter((a) => !removed.has(a.id));
}

export function getArrowById(state: ArrowPuzzleState, arrowId: string): ArrowObject | undefined {
  return state.arrows.find((a) => a.id === arrowId);
}

/** Id arrow-arrow aktif yang menghalangi `arrowId` di papan pemain ini. */
export function getArrowBlockers(state: ArrowPuzzleState, userId: string, arrowId: string): string[] {
  const arrow = getArrowById(state, arrowId);
  if (!arrow) return [];
  return findBlockers(arrow, getActiveArrows(state, userId), state.size);
}

export function isArrowMovable(state: ArrowPuzzleState, userId: string, arrowId: string): boolean {
  const removed = getRemovedArrowIds(state, userId);
  if (removed.includes(arrowId)) return false;
  if (!getArrowById(state, arrowId)) return false;
  return getArrowBlockers(state, userId, arrowId).length === 0;
}

/** Semua arrow yang saat ini bisa dikeluarkan pemain. */
export function getMovableArrowIds(state: ArrowPuzzleState, userId: string): string[] {
  const active = getActiveArrows(state, userId);
  return active.filter((a) => isArrowFree(a, active, state.size)).map((a) => a.id);
}

export function isArrowPuzzleFinished(state: ArrowPuzzleState, userId: string): boolean {
  return getActiveArrows(state, userId).length === 0;
}

export function getArrowProgress(state: ArrowPuzzleState, userId: string): number {
  const total = Math.max(1, state.arrows.length);
  const done = getRemovedArrowIds(state, userId).length;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function getArrowWrongStreak(state: ArrowPuzzleState, userId: string): number {
  return state.wrongStreak?.[userId] ?? 0;
}

/**
 * Penalti untuk tap terhalang ke-N secara beruntun: 5, 10, 20, 40, 80 (maks).
 * `wrongNumber` = 1 untuk kesalahan pertama, 2 untuk kesalahan kedua, dst.
 */
export function getArrowWrongPenalty(wrongNumber: number): number {
  if (wrongNumber <= 0) return 0;
  const raw = ARROW_WRONG_BASE_PENALTY * Math.pow(2, wrongNumber - 1);
  return Math.min(ARROW_WRONG_MAX_PENALTY, raw);
}

/** Penalti yang akan diterima pemain kalau dia salah sekali lagi sekarang. */
export function getArrowNextPenalty(state: ArrowPuzzleState, userId: string): number {
  return getArrowWrongPenalty(getArrowWrongStreak(state, userId) + 1);
}

export interface ArrowTapEvaluation {
  correct: boolean;
  reason: string;
  blockers: string[];
}

export function evaluateArrowTap(state: ArrowPuzzleState, userId: string, arrowId: string): ArrowTapEvaluation {
  const arrow = getArrowById(state, arrowId);
  if (!arrow) return { correct: false, reason: 'Arrow tidak dikenal', blockers: [] };
  if (getRemovedArrowIds(state, userId).includes(arrowId)) {
    return { correct: false, reason: 'Arrow itu sudah keluar', blockers: [] };
  }
  const blockers = getArrowBlockers(state, userId, arrowId);
  if (blockers.length === 0) return { correct: true, reason: 'Arrow meluncur keluar!', blockers };
  return {
    correct: false,
    reason: blockers.length === 1 ? 'Terhalang arrow lain' : `Terhalang ${blockers.length} arrow lain`,
    blockers,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PENERAPAN LANGKAH (dipakai pengirim & penerima broadcast supaya identik)
// ─────────────────────────────────────────────────────────────────────────────

export interface ArrowMoveResult {
  state: ArrowPuzzleState;
  /** Perubahan poin untuk `userId` (sudah termasuk bonus finis / bonus tim). */
  scoreDelta: number;
  correct: boolean;
  /** Poin yang berkurang khusus karena tap terhalang (0 bila sukses). */
  penalty: number;
  /** Pemain ini baru saja mengeluarkan arrow terakhirnya. */
  justFinished: boolean;
  /** Puzzle Classic baru saja tuntas dikerjakan bersama. */
  justCompleted: boolean;
  /** Peringkat finis di mode Competition (null bila belum finis / mode Classic). */
  rank: number | null;
  reason: string;
  blockers: string[];
}

export interface ApplyArrowMoveOptions {
  /** Tanpa poin & tanpa penalti (dipakai tombol Auto / All). */
  silentScore?: boolean;
}

export function applyArrowMove(
  state: ArrowPuzzleState,
  userId: string,
  arrowId: string,
  username = '',
  options: ApplyArrowMoveOptions = {}
): ArrowMoveResult {
  const noop = (reason: string): ArrowMoveResult => ({
    state,
    scoreDelta: 0,
    correct: false,
    penalty: 0,
    justFinished: false,
    justCompleted: false,
    rank: null,
    reason,
    blockers: [],
  });

  if (state.variant === 'classic' && state.completed) return noop('Puzzle sudah selesai');
  if (isArrowPuzzleFinished(state, userId)) return noop('Puzzle sudah selesai');

  const evaluation = evaluateArrowTap(state, userId, arrowId);
  // Tap ke arrow yang sudah tidak ada (double tap / paket ganda) -> abaikan total.
  if (!evaluation.correct && evaluation.blockers.length === 0) return noop(evaluation.reason);

  const removedBefore = getRemovedArrowIds(state, userId);
  const wrongStreak = { ...state.wrongStreak };
  let scoreDelta = 0;
  let penalty = 0;
  let removedAfter = removedBefore;
  let justFinished = false;
  let justCompleted = false;
  let rank: number | null = null;

  if (evaluation.correct) {
    removedAfter = [...removedBefore, arrowId];
    wrongStreak[userId] = 0;
    if (!options.silentScore) scoreDelta += ARROW_CORRECT_POINTS;
    justFinished = removedAfter.length >= state.arrows.length;
  } else if (!options.silentScore) {
    wrongStreak[userId] = (wrongStreak[userId] ?? 0) + 1;
    penalty = getArrowWrongPenalty(wrongStreak[userId]);
    scoreDelta -= penalty;
  }

  const lastMove = {
    arrowId,
    userId,
    username,
    correct: evaluation.correct,
    timestamp: Date.now(),
  };

  if (state.variant === 'classic') {
    const completed = justFinished;
    if (completed) {
      scoreDelta += ARROW_TEAM_BONUS;
      justCompleted = true;
    }
    return {
      state: {
        ...state,
        removedArrowIds: removedAfter,
        wrongStreak,
        completed,
        winnerId: completed ? userId : state.winnerId,
        revision: (state.revision ?? 0) + 1,
        lastMove,
      },
      scoreDelta,
      correct: evaluation.correct,
      penalty,
      justFinished,
      justCompleted,
      rank: null,
      reason: evaluation.reason,
      blockers: evaluation.blockers,
    };
  }

  // COMPETITION — papan per pemain, tidak mempengaruhi pemain lain.
  const winners = [...(state.winners ?? [])];
  if (justFinished && !winners.includes(userId)) {
    winners.push(userId);
    rank = winners.length;
    const bonus = rank <= ARROW_FINISH_BONUS.length ? ARROW_FINISH_BONUS[rank - 1] : ARROW_FINISH_BONUS_DEFAULT;
    scoreDelta += bonus;
  }

  return {
    state: {
      ...state,
      playerRemoved: { ...state.playerRemoved, [userId]: removedAfter },
      wrongStreak,
      winners,
      winnerId: justFinished && !state.winnerId ? userId : state.winnerId,
      revision: (state.revision ?? 0) + 1,
      lastMove,
    },
    scoreDelta,
    correct: evaluation.correct,
    penalty,
    justFinished,
    justCompleted: false,
    rank,
    reason: evaluation.reason,
    blockers: evaluation.blockers,
  };
}

/** Puzzle baru dengan identitas & ronde berbeda, siap dipakai untuk "Next Game". */
export function createArrowRound(
  difficulty: Difficulty | undefined,
  variant: ArrowPuzzleVariant,
  seed: string,
  previousRevision = 0
): ArrowPuzzleState {
  const fresh = generateArrowPuzzle(difficulty, variant, seed);
  return {
    ...fresh,
    revision: Math.max(fresh.revision, previousRevision + 1),
  };
}

/** Apakah objek ini state Arrow Removal yang valid (menolak state format lama START/GOAL). */
export function isValidArrowPuzzleState(value: unknown): value is ArrowPuzzleState {
  if (!value || typeof value !== 'object') return false;
  const s = value as Partial<ArrowPuzzleState>;
  return (
    typeof s.size === 'number' &&
    Array.isArray(s.arrows) &&
    s.arrows.every(
      (a) =>
        a &&
        typeof a.id === 'string' &&
        Array.isArray(a.cells) &&
        typeof a.direction === 'number'
    ) &&
    Array.isArray(s.removedArrowIds) &&
    typeof s.playerRemoved === 'object'
  );
}
