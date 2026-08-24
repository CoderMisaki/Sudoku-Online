export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'evil';
export type GameMode = 'classic' | 'learning' | 'collaborative' | 'race' | 'zen' | 'competition' | 'snakes_and_ladders';

export interface Player {
  id: string;
  username: string;
  color: string;
  isHost: boolean;
  score: number;
  progress?: number; // Persentase progress (0 - 100)
  rank?: number | null; // Peringkat juara (1, 2, 3, 4, dst)
  hints: number;
  streak?: number;
  lastCorrectMoveAt?: number;
  stunnedUntil?: number;
  status: 'online' | 'offline' | 'disconnected' | 'left';
  cursor?: { row: number; col: number } | null;
  isSpectator?: boolean;
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
  diceValue: number | null;
  playerPositions: Record<string, number>;
  currentTurnUserId: string | null;
  winnerId: string | null;
  winners?: string[]; // Urutan ID pemain yang sudah finish (Juara 1, Juara 2, dst.)
  isRolling?: boolean;
  ladders: LadderItem[];
  snakes: SnakeItem[];
  mines: number[]; // Posisi kotak yang berisi ranjau
  wormholes: WormholePair[]; // Pasangan Blackhole -> Whitehole
  frozenTurns: Record<string, number>; // Jumlah turn yang harus dilewati pemain
}

// Retain alias for backward compatibility if needed
export type SnakesAndLaddersState = SnakesState;
