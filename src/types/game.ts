export type Difficulty = 'easy' | 'medium' | 'hard' | 'expert' | 'evil';
export type GameMode = 'classic' | 'learning' | 'collaborative' | 'race' | 'zen' | 'competition';

export interface Player {
  id: string;
  username: string;
  color: string;
  isHost: boolean;
  score: number;
  progress?: number; // Persentase progress (0 - 100)
  rank?: number | null; // Peringkat juara (1, 2, 3, 4, dst)
  hints: number;
  status: 'online' | 'offline';
  cursor?: { row: number; col: number } | null;
}

export interface CellData {
  value: number | null;
  isLocked: boolean; // Initial puzzle numbers
  notes: number[];
  filledBy?: string; // Player ID
  isConflicting?: boolean;
  isWrong?: boolean;
  isPending?: boolean;
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
