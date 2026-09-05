export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'evil' | '3x3' | '8x8';
export type GameMode =
  | 'classic'
  | 'learning'
  | 'collaborative'
  | 'race'
  | 'zen'
  | 'competition'
  | 'snakes_and_ladders'
  | 'tic_tac_toe'
  | 'arrow_classic'
  | 'arrow_competition'
  | 'arrow_practice'
  | 'harvest_moon';

/** Game yang memakai papan Arrow Puzzle Master (bukan papan Sudoku). */
export type ArrowGameMode = 'arrow_classic' | 'arrow_competition' | 'arrow_practice';

export const isArrowGameMode = (mode?: GameMode | null): mode is ArrowGameMode =>
  mode === 'arrow_classic' || mode === 'arrow_competition' || mode === 'arrow_practice';

export interface Player {
  id: string;
  username: string;
  color: string;
  isHost: boolean;
  score: number;
  progress?: number; // Persentase progress (0 - 100)
  rank?: number | null; // Peringkat juara (1, 2, 3, 4, dst)
  /** Timestamp lokal saat pemain menyelesaikan ronde; dipakai tie-break deterministik. */
  finishedAt?: number;
  hints: number;
  streak?: number;
  lastCorrectMoveAt?: number;
  stunnedUntil?: number;
  status: 'online' | 'offline' | 'disconnected' | 'left';
  cursor?: { row: number; col: number } | null;
  isSpectator?: boolean;
  avatar?: string | null; // Data URL compressed avatar (64-128px), null = fallback
}

export interface CellData {
  value: number | null;
  isLocked: boolean; // Initial puzzle numbers
  notes: number[];
  filledBy?: string; // Player ID
  isConflicting?: boolean;
  isWrong?: boolean;
  isPending?: boolean;
  isCorrect?: boolean; // Menandai sel yang sudah diisi dengan benar
}

export type Grid = CellData[][];

export interface RoomState {
  id: string;
  code: string;
  hostId: string;
  difficulty: Difficulty;
  mode: GameMode;
  maxPlayers: number;
  status: 'waiting' | 'playing' | 'completed';
  players: Record<string, Player>;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

export interface SnakeOrLadder {
  from: number;
  to: number;
}

export interface SnakeItem {
  id: string;
  head: number;
  tail: number;
  waveStrength: number;
}

export interface LadderItem {
  id: string;
  start: number;
  end: number;
}

export interface WormholePair {
  id: string;
  blackHole: number; // Titik masuk (Black Hole)
  whiteHole: number; // Titik keluar (White Hole)
}

export interface SnakesState {
  boardId?: string; // Identity of THIS board (regenerated every new game) — lets clients distinguish "new board" from "stale snapshot of the same board"
  diceValue: number | null;
  playerPositions: Record<string, number>;
  currentTurnUserId: string | null;
  winnerId: string | null;
  winners?: string[]; // Urutan ID pemain yang sudah finish (Juara 1, Juara 2, dst.)
  isRolling?: boolean;
  isAnimating?: boolean; // Global lock: true selama token sedang berjalan step-by-step
  ladders: LadderItem[];
  snakes: SnakeItem[];
  mines: number[]; // Posisi kotak yang berisi ranjau
  wormholes: WormholePair[]; // Pasangan Blackhole -> Whitehole
  frozenTurns: Record<string, number>; // Jumlah turn yang harus dilewati pemain
  revision: number; // Monotonic sequence untuk ordering state
}

// Retain alias for backward compatibility if needed
export type SnakesAndLaddersState = SnakesState;

// ─────────────────────────────────────────────────────────────────────────────
// Tic Tac Toe Types
// ─────────────────────────────────────────────────────────────────────────────

export type TicTacToeSymbol = 'X' | 'O';

export interface TicTacToePlayerInfo {
  id: string;
  username: string;
  symbol: TicTacToeSymbol;
  color?: string;
  avatar?: string | null;
  isBot?: boolean;
}

export interface TicTacToeState {
  boardId?: string;
  boardSize: 3 | 8;
  winLength: number; // 3 for 3x3, 5 for 8x8
  grid: (TicTacToeSymbol | null)[][];
  currentTurnSymbol: TicTacToeSymbol;
  currentTurnUserId: string; // userId or 'bot-player'
  winner: TicTacToeSymbol | 'draw' | null;
  winnerUserId: string | null;
  winningCells: { row: number; col: number }[] | null;
  isAgainstBot: boolean;
  playerX: TicTacToePlayerInfo;
  playerO: TicTacToePlayerInfo;
  revision: number;
  lastMove?: { row: number; col: number; symbol: TicTacToeSymbol; timestamp: number } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Arrow Puzzle Master Types — ARROW REMOVAL PUZZLE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Arah panah sebagai indeks: 0 = Atas, 1 = Kanan, 2 = Bawah, 3 = Kiri.
 * Lihat ARROW_DIRS di utils/arrowPuzzle.ts untuk vektor (dr, dc) tiap indeks.
 */
export type ArrowDirection = 0 | 1 | 2 | 3;

export interface ArrowCoord {
  row: number;
  col: number;
}

/** Varian permainan di dalam Arrow Puzzle Master. */
export type ArrowPuzzleVariant = 'classic' | 'competition';

/**
 * Satu objek arrow di papan: jalur (track) berbentuk garis/siku yang ujungnya
 * memiliki kepala panah. Arrow bergerak sebagai satu benda kaku ke arah
 * `direction` dan hanya boleh keluar bila seluruh lintasannya bebas.
 */
export interface ArrowObject {
  id: string;
  /** Sel-sel yang ditempati, berurutan dari EKOR ke KEPALA (kepala = elemen terakhir). */
  cells: ArrowCoord[];
  /** Arah keluar (arah yang ditunjuk kepala panah). */
  direction: ArrowDirection;
}

export interface ArrowPuzzleState {
  /** Identitas papan — berbeda tiap puzzle baru supaya state lama tidak dianggap "lebih baru". */
  boardId: string;
  /** Kunci deterministik: seed yang sama menghasilkan puzzle yang sama (dipakai mode Competition). */
  seed: string;
  /** Papan persegi `size` × `size` sel. */
  size: number;
  /** Semua arrow di puzzle (tidak berubah selama ronde; yang keluar dicatat di removed*). */
  arrows: ArrowObject[];
  variant: ArrowPuzzleVariant;
  difficulty: Difficulty;

  /** CLASSIC (ko-op): satu papan bersama — id arrow yang sudah keluar. */
  removedArrowIds: string[];
  /** COMPETITION: papan tiap pemain terpisah — id arrow yang sudah keluar per pemain. */
  playerRemoved: Record<string, string[]>;
  /** Jumlah tap terhalang beruntun per pemain -> penalti 5, 10, 20, 40, ... */
  wrongStreak: Record<string, number>;
  /** Pemain yang menuntaskan puzzle (Classic: pengetuk arrow terakhir). */
  winnerId: string | null;
  /** Urutan pemain yang finis (Competition: Juara 1, 2, 3, dst). */
  winners: string[];
  /** Classic: semua arrow sudah keluar. */
  completed: boolean;

  revision: number;
  lastMove?: {
    arrowId: string;
    userId: string;
    username: string;
    correct: boolean;
    timestamp: number;
  } | null;
}
