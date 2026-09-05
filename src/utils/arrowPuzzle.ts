import {
  ArrowCoord,
  ArrowDirection,
  ArrowPuzzleState,
  ArrowPuzzleVariant,
  Difficulty,
} from '../types/game';

// ─────────────────────────────────────────────────────────────────────────────
// ATURAN MAIN — ARROW PUZZLE MASTER
// ─────────────────────────────────────────────────────────────────────────────
// Setiap kotak berisi satu panah (↑ → ↓ ←) atau berupa tembok.
// Panah pada sebuah kotak menunjuk ke kotak "induk"-nya, jadi sebuah langkah
// dari kotak A ke kotak tetangga B hanya SAH kalau panah B menunjuk balik ke A.
// Pemain berangkat dari START dan harus mencapai GOAL. Karena panah dibentuk
// dari sebuah spanning tree, hanya ada SATU jalur sah START -> GOAL: sisanya
// adalah cabang buntu yang mengecoh.
//
// PENILAIAN (berlaku di mode Classic maupun Competition):
//   • Tap benar  : +10 poin
//   • Tap salah  : -5, lalu -10, -20, -40, ... (kelipatan 2x selama salah
//                  beruntun, dibatasi -80 per tap)
//   • Tap benar menghapus hitungan salah beruntun kembali ke 0.
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
  size: number;
  wallRatio: number;
  label: string;
  description: string;
}

export type ArrowDifficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'evil';

export const ARROW_DIFFICULTY: Record<ArrowDifficulty, ArrowDifficultyConfig> = {
  easy: { size: 5, wallRatio: 0.06, label: 'Easy', description: 'Papan 5×5, jalur pendek & lega' },
  medium: { size: 6, wallRatio: 0.12, label: 'Medium', description: 'Papan 6×6, mulai banyak cabang' },
  hard: { size: 7, wallRatio: 0.16, label: 'Hard', description: 'Papan 7×7, cabang buntu menumpuk' },
  expert: { size: 8, wallRatio: 0.2, label: 'Expert', description: 'Papan 8×8, jalur panjang berkelok' },
  evil: { size: 9, wallRatio: 0.24, label: 'Evil', description: 'Papan 9×9, labirin panah paling kejam' },
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
// GENERATOR PUZZLE
// ─────────────────────────────────────────────────────────────────────────────

const coordKey = (row: number, col: number) => `${row}:${col}`;

function buildAttempt(
  size: number,
  wallRatio: number,
  rand: () => number
): { arrows: (ArrowDirection | null)[][]; start: ArrowCoord; goal: ArrowCoord; path: ArrowCoord[] } | null {
  const idx = (r: number, c: number) => r * size + c;

  // 1) Tebar tembok acak. START (0,0) tidak pernah jadi tembok.
  const blocked: boolean[] = Array(size * size).fill(false);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (r === 0 && c === 0) continue;
      if (rand() < wallRatio) blocked[idx(r, c)] = true;
    }
  }

  // 2) Spanning tree di atas sel terbuka memakai randomized DFS.
  const parent: (number | null)[] = Array(size * size).fill(null);
  const inTree: boolean[] = Array(size * size).fill(false);
  const stack: number[] = [idx(0, 0)];
  inTree[idx(0, 0)] = true;

  while (stack.length > 0) {
    const cur = stack[stack.length - 1];
    const curR = Math.floor(cur / size);
    const curC = cur % size;

    const candidates: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nr = curR + ARROW_DIRS[d].dr;
      const nc = curC + ARROW_DIRS[d].dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const nIdx = idx(nr, nc);
      if (blocked[nIdx] || inTree[nIdx]) continue;
      candidates.push(nIdx);
    }

    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    const pick = candidates[Math.floor(rand() * candidates.length)];
    inTree[pick] = true;
    parent[pick] = cur;
    stack.push(pick);
  }

  // 3) GOAL = sel terjauh dari START di dalam tree (jalur sepanjang mungkin).
  const startIdx = idx(0, 0);
  const depth: number[] = Array(size * size).fill(-1);
  depth[startIdx] = 0;
  const queue: number[] = [startIdx];
  let goalIdx = startIdx;

  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head];
    const curR = Math.floor(cur / size);
    const curC = cur % size;
    if (depth[cur] > depth[goalIdx]) goalIdx = cur;

    for (let d = 0; d < 4; d++) {
      const nr = curR + ARROW_DIRS[d].dr;
      const nc = curC + ARROW_DIRS[d].dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const nIdx = idx(nr, nc);
      if (parent[nIdx] !== cur || depth[nIdx] !== -1) continue;
      depth[nIdx] = depth[cur] + 1;
      queue.push(nIdx);
    }
  }

  if (goalIdx === startIdx) return null; // puzzle degenerate

  // 4) Telusuri jalur unik START -> GOAL lewat pointer parent.
  const pathIdx: number[] = [];
  for (let cur = goalIdx; cur !== null && cur !== startIdx; cur = parent[cur] as number) {
    pathIdx.push(cur);
  }
  pathIdx.push(startIdx);
  pathIdx.reverse();

  // 5) Panah tiap sel tree = arah dari sel itu menuju induknya.
  //    Konsekuensinya langkah sah hanyalah "induk -> anak", jadi jalur ke GOAL tunggal.
  const arrows: (ArrowDirection | null)[][] = Array.from({ length: size }, () =>
    Array<ArrowDirection | null>(size).fill(null)
  );

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const cellIdx = idx(r, c);
      if (!inTree[cellIdx]) continue; // tetap tembok
      const p = parent[cellIdx];
      if (p === null) {
        // START: panah hiasan (tidak pernah dipakai karena START tidak pernah "dimasuki").
        arrows[r][c] = Math.floor(rand() * 4) as ArrowDirection;
        continue;
      }
      const pr = Math.floor(p / size);
      const pc = p % size;
      const dir = ARROW_DIRS.findIndex((d) => r + d.dr === pr && c + d.dc === pc);
      arrows[r][c] = (dir === -1 ? 0 : dir) as ArrowDirection;
    }
  }

  const path: ArrowCoord[] = pathIdx.map((i) => ({ row: Math.floor(i / size), col: i % size }));
  return {
    arrows,
    start: { row: 0, col: 0 },
    goal: { row: Math.floor(goalIdx / size), col: goalIdx % size },
    path,
  };
}

/**
 * Hitung jumlah jalur sah START -> GOAL (dipakai untuk memastikan puzzle
 * benar-benar punya satu jawaban). Berhenti begitu menemukan lebih dari `limit`.
 */
export function countArrowPaths(
  arrows: (ArrowDirection | null)[][],
  start: ArrowCoord,
  goal: ArrowCoord,
  limit = 2
): number {
  const size = arrows.length;
  const visited = new Set<string>();
  let count = 0;

  const walk = (pos: ArrowCoord): void => {
    if (count >= limit) return;
    if (pos.row === goal.row && pos.col === goal.col) {
      count++;
      return;
    }
    for (let d = 0; d < 4; d++) {
      const nr = pos.row + ARROW_DIRS[d].dr;
      const nc = pos.col + ARROW_DIRS[d].dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) continue;
      const key = coordKey(nr, nc);
      if (visited.has(key)) continue;
      const arrow = arrows[nr][nc];
      if (arrow === null) continue;
      // Panah di kotak tujuan harus menunjuk balik ke kotak asal.
      if (nr + ARROW_DIRS[arrow].dr !== pos.row || nc + ARROW_DIRS[arrow].dc !== pos.col) continue;
      visited.add(key);
      walk({ row: nr, col: nc });
      visited.delete(key);
      if (count >= limit) return;
    }
  };

  visited.add(coordKey(start.row, start.col));
  walk(start);
  return count;
}

/**
 * Buat puzzle Arrow Puzzle Master.
 * `seed` yang sama + difficulty yang sama = puzzle identik (deterministik).
 */
export function generateArrowPuzzle(
  difficulty: Difficulty | undefined,
  variant: ArrowPuzzleVariant,
  seed: string
): ArrowPuzzleState {
  const cfg = getArrowConfig(difficulty);
  const difficultyKey = normalizeArrowDifficulty(difficulty);

  // Jalur terlalu pendek = puzzle hambar. Kalau tembok kebetulan memutus papan,
  // percobaan berikutnya otomatis mengurangi rasio tembok sampai papan cukup lega.
  const minPathLength = Math.max(4, Math.ceil(cfg.size * 1.2));

  for (let attempt = 0; attempt < 16; attempt++) {
    const wallScale = attempt < 6 ? 1 : attempt < 11 ? 0.55 : 0.2;
    const rand = mulberry32(hashSeedString(`${seed}#${attempt}`));
    const built = buildAttempt(cfg.size, cfg.wallRatio * wallScale, rand);
    if (!built) continue;
    if (built.path.length < minPathLength) continue;

    // Jaminan desain: hanya satu jalur. Verifikasi tetap dijalankan sebagai pengaman.
    if (countArrowPaths(built.arrows, built.start, built.goal, 2) !== 1) continue;

    return {
      boardId: `ap-${hashSeedString(seed).toString(36)}-${attempt}`,
      seed,
      size: cfg.size,
      arrows: built.arrows,
      start: built.start,
      goal: built.goal,
      solutionPath: built.path,
      variant,
      difficulty: difficultyKey,
      currentPath: [],
      playerPaths: {},
      wrongStreak: {},
      winnerId: null,
      winners: [],
      completed: false,
      revision: 1,
      lastMove: null,
    };
  }

  // Fallback ekstrem (praktis tidak pernah terjadi): koridor lurus yang pasti unik.
  const size = cfg.size;
  const arrows: (ArrowDirection | null)[][] = Array.from({ length: size }, () =>
    Array<ArrowDirection | null>(size).fill(null)
  );
  for (let c = 0; c < size; c++) arrows[0][c] = 3; // semua menunjuk ke kiri (ke arah induk)
  const solutionPath: ArrowCoord[] = Array.from({ length: size }, (_, c) => ({ row: 0, col: c }));

  return {
    boardId: `ap-fallback-${hashSeedString(seed).toString(36)}`,
    seed,
    size,
    arrows,
    start: { row: 0, col: 0 },
    goal: { row: 0, col: size - 1 },
    solutionPath,
    variant,
    difficulty: difficultyKey,
    currentPath: [],
    playerPaths: {},
    wrongStreak: {},
    winnerId: null,
    winners: [],
    completed: false,
    revision: 1,
    lastMove: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PEMBACAAN STATE
// ─────────────────────────────────────────────────────────────────────────────

export function getPlayerArrowPath(state: ArrowPuzzleState, userId: string): ArrowCoord[] {
  if (state.variant === 'classic') return state.currentPath;
  return state.playerPaths[userId] || [];
}

/** Kotak tempat pemain berdiri sekarang (START bila belum melangkah). */
export function getArrowCurrentCell(state: ArrowPuzzleState, userId: string): ArrowCoord {
  const path = getPlayerArrowPath(state, userId);
  return path.length > 0 ? path[path.length - 1] : state.start;
}

export function getExpectedNextCell(state: ArrowPuzzleState, userId: string): ArrowCoord | null {
  const path = getPlayerArrowPath(state, userId);
  return state.solutionPath[path.length + 1] ?? null;
}

export function isArrowPuzzleFinished(state: ArrowPuzzleState, userId: string): boolean {
  return getPlayerArrowPath(state, userId).length >= state.solutionPath.length - 1;
}

export function getArrowProgress(state: ArrowPuzzleState, userId: string): number {
  const total = Math.max(1, state.solutionPath.length - 1);
  const done = getPlayerArrowPath(state, userId).length;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

export function getArrowWrongStreak(state: ArrowPuzzleState, userId: string): number {
  return state.wrongStreak[userId] ?? 0;
}

/**
 * Penalti untuk tap salah ke-N secara beruntun: 5, 10, 20, 40, 80 (maks).
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

/** Apakah langkah A -> B sah menurut aturan panah? */
export function isLegalArrowStep(state: ArrowPuzzleState, from: ArrowCoord, to: ArrowCoord): boolean {
  const dr = to.row - from.row;
  const dc = to.col - from.col;
  if (Math.abs(dr) + Math.abs(dc) !== 1) return false;

  const arrow = state.arrows[to.row]?.[to.col];
  if (arrow === null || arrow === undefined) return false;

  return to.row + ARROW_DIRS[arrow].dr === from.row && to.col + ARROW_DIRS[arrow].dc === from.col;
}

export interface ArrowTapEvaluation {
  correct: boolean;
  reason: string;
  expected: ArrowCoord | null;
}

export function evaluateArrowTap(
  state: ArrowPuzzleState,
  userId: string,
  cell: ArrowCoord
): ArrowTapEvaluation {
  const expected = getExpectedNextCell(state, userId);
  if (expected && expected.row === cell.row && expected.col === cell.col) {
    return { correct: true, reason: 'Jalur benar!', expected };
  }

  const from = getArrowCurrentCell(state, userId);
  const path = getPlayerArrowPath(state, userId);
  const arrow = state.arrows[cell.row]?.[cell.col];

  let reason = 'Bukan jalur yang benar';
  if (arrow === null || arrow === undefined) {
    reason = 'Itu tembok, tidak bisa dilewati';
  } else if (Math.abs(cell.row - from.row) + Math.abs(cell.col - from.col) !== 1) {
    reason = 'Hanya bisa melangkah ke kotak yang menempel';
  } else if (path.some((p) => p.row === cell.row && p.col === cell.col)) {
    reason = 'Kotak itu sudah kamu lewati';
  } else if (!isLegalArrowStep(state, from, cell)) {
    reason = 'Panah kotak itu tidak menunjuk ke arahmu';
  } else {
    reason = 'Cabang buntu! Jalur ini tidak menuju GOAL';
  }

  return { correct: false, reason, expected };
}

// ─────────────────────────────────────────────────────────────────────────────
// PENERAPAN LANGKAH (dipakai pengirim & penerima broadcast supaya identik)
// ─────────────────────────────────────────────────────────────────────────────

export interface ArrowMoveResult {
  state: ArrowPuzzleState;
  /** Perubahan poin untuk `userId` (sudah termasuk bonus finis / bonus tim). */
  scoreDelta: number;
  correct: boolean;
  /** Poin yang berkurang khusus karena tap salah (0 bila benar). */
  penalty: number;
  /** Pemain ini baru saja mencapai GOAL. */
  justFinished: boolean;
  /** Puzzle Classic baru saja tuntas dikerjakan bersama. */
  justCompleted: boolean;
  /** Peringkat finis di mode Competition (null bila belum finis / mode Classic). */
  rank: number | null;
  reason: string;
}

export function applyArrowMove(
  state: ArrowPuzzleState,
  userId: string,
  cell: ArrowCoord,
  username = ''
): ArrowMoveResult {
  const evaluation = evaluateArrowTap(state, userId, cell);
  const path = getPlayerArrowPath(state, userId);
  const alreadyFinished = path.length >= state.solutionPath.length - 1;

  if (alreadyFinished) {
    return {
      state,
      scoreDelta: 0,
      correct: false,
      penalty: 0,
      justFinished: false,
      justCompleted: false,
      rank: null,
      reason: 'Puzzle sudah selesai',
    };
  }

  const wrongStreak = { ...state.wrongStreak };
  let scoreDelta = 0;
  let penalty = 0;
  let nextPath = path;
  let justFinished = false;
  let justCompleted = false;
  let rank: number | null = null;

  if (evaluation.correct) {
    nextPath = [...path, { row: cell.row, col: cell.col }];
    wrongStreak[userId] = 0;
    scoreDelta += ARROW_CORRECT_POINTS;
    justFinished = nextPath.length >= state.solutionPath.length - 1;
  } else {
    wrongStreak[userId] = (wrongStreak[userId] ?? 0) + 1;
    penalty = getArrowWrongPenalty(wrongStreak[userId]);
    scoreDelta -= penalty;
  }

  if (state.variant === 'classic') {
    const completed = justFinished;
    if (completed) {
      // Bonus tim: setiap pemain mendapat +50 saat puzzle tuntas bersama.
      scoreDelta += ARROW_TEAM_BONUS;
      justCompleted = true;
    }
    return {
      state: {
        ...state,
        currentPath: nextPath,
        wrongStreak,
        completed,
        winnerId: completed ? userId : state.winnerId,
        revision: (state.revision ?? 0) + 1,
        lastMove: {
          row: cell.row,
          col: cell.col,
          userId,
          username,
          correct: evaluation.correct,
          timestamp: Date.now(),
        },
      },
      scoreDelta,
      correct: evaluation.correct,
      penalty,
      justFinished,
      justCompleted,
      rank: null,
      reason: evaluation.reason,
    };
  }

  // COMPETITION — jejak per pemain, tidak mempengaruhi pemain lain.
  const winners = state.winners ?? [];
  if (justFinished && !winners.includes(userId)) {
    winners.push(userId);
    rank = winners.length;
    const bonus =
      rank <= ARROW_FINISH_BONUS.length ? ARROW_FINISH_BONUS[rank - 1] : ARROW_FINISH_BONUS_DEFAULT;
    scoreDelta += bonus;
  }

  return {
    state: {
      ...state,
      playerPaths: { ...state.playerPaths, [userId]: nextPath },
      wrongStreak,
      winners,
      winnerId: justFinished && !state.winnerId ? userId : state.winnerId,
      revision: (state.revision ?? 0) + 1,
      lastMove: {
        row: cell.row,
        col: cell.col,
        userId,
        username,
        correct: evaluation.correct,
        timestamp: Date.now(),
      },
    },
    scoreDelta,
    correct: evaluation.correct,
    penalty,
    justFinished,
    justCompleted: false,
    rank,
    reason: evaluation.reason,
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
