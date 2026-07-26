import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Grid, RoomState, Player, ChatMessage } from '../types/game';
import { checkConflicts } from '../utils/sudoku';

type HistoryEntry = {
  grid: Grid;
  scores: Record<string, number>;
};

interface GameStore {
  // Local User State
  userId: string | null;
  username: string | null;
  setUserInfo: (id: string, username: string) => void;

  // Room State
  room: RoomState | null;
  setRoom: (room: RoomState | null) => void;
  updatePlayer: (playerId: string, data: Partial<Player>) => void;

  // Game State
  grid: Grid | null;
  solution: number[][] | null;
  history: HistoryEntry[];
  historyIndex: number;

  setGameData: (grid: Grid, solution: number[][]) => void;
  updateCell: (row: number, col: number, value: number | null, playerId: string) => void;
  toggleNote: (row: number, col: number, note: number) => void;

  undo: () => void;
  redo: () => void;
  useHint: (playerId: string) => { row: number, col: number, value: number } | null;

  // UI State

  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;

  selectedCell: { row: number; col: number } | null;
  setSelectedCell: (cell: { row: number; col: number } | null) => void;
}

export const useGameStore = create<GameStore>()(
  persist(
    (set) => ({
  messages: [],
  addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg] })),
  setMessages: (msgs) => set({ messages: msgs }),

  userId: null,
  username: null,
  setUserInfo: (id, username) => set({ userId: id, username }),

  room: null,
  setRoom: (room) => set({ room }),
  updatePlayer: (playerId, data) => set((state) => {
    if (!state.room) return state;
    return {
      room: {
        ...state.room,
        players: {
          ...state.room.players,
          [playerId]: { ...state.room.players[playerId], ...data }
        }
      }
    };
  }),

  grid: null,
  solution: null,
  history: [],
  historyIndex: -1,

  setGameData: (grid, solution) => {
    // Check conflicts initially if needed
    const validatedGrid = checkConflicts(grid);
    set({
      grid: validatedGrid,
      solution,
      history: [{ grid: validatedGrid, scores: {} }],
      historyIndex: 0
    });
  },

  updateCell: (row, col, value, playerId) => set((state) => {
    if (!state.grid || !state.room || !state.solution) return state;

    const currentCell = state.grid[row][col];
    if (currentCell.isLocked || currentCell.value === value) return state;

    const newGrid = [...state.grid];
    newGrid[row] = [...newGrid[row]];

    const isCorrect = value !== null && state.solution[row][col] === value;
    const mode = state.room.mode;

    // In classic mode, reject wrong answers immediately
    if (mode === 'classic' && value !== null && !isCorrect) {
      // Return state with score penalty but no grid change
      const currentScore = state.room.players[playerId]?.score || 0;
      const newScore = Math.max(0, currentScore - 5);

      const newRoom = {
        ...state.room,
        players: {
          ...state.room.players,
          [playerId]: { ...state.room.players[playerId], score: newScore }
        }
      };
      return { room: newRoom };
    }

    newGrid[row][col] = {
      ...newGrid[row][col],
      value,
      filledBy: playerId
    };

    const validatedGrid = checkConflicts(newGrid);

    // Calculate scoring
    let newRoom = { ...state.room };
    if (value !== null) {
      const currentScore = state.room.players[playerId]?.score || 0;
      const scoreDiff = isCorrect ? 10 : -5;
      const newScore = Math.max(0, currentScore + scoreDiff);

      newRoom = {
        ...state.room,
        players: {
          ...state.room.players,
          [playerId]: { ...state.room.players[playerId], score: newScore }
        }
      };
    }

    // Update history
    const currentScores = Object.fromEntries(
      Object.entries(newRoom.players).map(([id, p]) => [id, p.score])
    );

    const newHistory = state.history.slice(0, state.historyIndex + 1);
    newHistory.push({ grid: validatedGrid, scores: currentScores });

    return {
      grid: validatedGrid,
      room: newRoom,
      history: newHistory,
      historyIndex: newHistory.length - 1
    };
  }),

  toggleNote: (row, col, note) => set((state) => {
    if (!state.grid) return state;
    const newGrid = [...state.grid];
    newGrid[row] = [...newGrid[row]];

    const currentNotes = newGrid[row][col].notes;
    const hasNote = currentNotes.includes(note);

    newGrid[row][col] = {
      ...newGrid[row][col],
      notes: hasNote
        ? currentNotes.filter(n => n !== note)
        : [...currentNotes, note].sort()
    };

    return { grid: newGrid };
  }),

  undo: () => set((state) => {
    if (state.historyIndex > 0 && state.room) {
      const newIndex = state.historyIndex - 1;
      const entry = state.history[newIndex];

      // Revert scores
      const newRoom = { ...state.room };
      Object.entries(entry.scores).forEach(([id, score]) => {
        if (newRoom.players[id]) {
          newRoom.players[id] = { ...newRoom.players[id], score };
        }
      });

      return {
        grid: entry.grid,
        historyIndex: newIndex,
        room: newRoom
      };
    }
    return state;
  }),

  redo: () => set((state) => {
    if (state.historyIndex < state.history.length - 1 && state.room) {
      const newIndex = state.historyIndex + 1;
      const entry = state.history[newIndex];

      // Apply scores
      const newRoom = { ...state.room };
      Object.entries(entry.scores).forEach(([id, score]) => {
        if (newRoom.players[id]) {
          newRoom.players[id] = { ...newRoom.players[id], score };
        }
      });

      return {
        grid: entry.grid,
        historyIndex: newIndex,
        room: newRoom
      };
    }
    return state;
  }),


  useHint: (playerId) => {
    let result = null;
    set((state) => {
      if (!state.grid || !state.room || !state.solution || !state.selectedCell) return state;

      const player = state.room.players[playerId];
      if (!player || player.hints <= 0) return state;

      const { row, col } = state.selectedCell;
      const currentCell = state.grid[row][col];
      const correctVal = state.solution[row][col];

      // Hint hanya bekerja pada 1 kotak yang dipilih jika belum terisi dengan benar & tidak terkunci
      if (currentCell.isLocked || currentCell.value === correctVal) {
        return state;
      }

      result = { row, col, value: correctVal };

      const newRoom = {
        ...state.room,
        players: {
          ...state.room.players,
          [playerId]: { ...player, hints: player.hints - 1 }
        }
      };

      return { room: newRoom };
    });
    return result;
  },

  selectedCell: null,
  setSelectedCell: (cell) => set({ selectedCell: cell }),
    }),
    {
      name: "sudoku-game-storage",
      partialize: (state) => ({ room: state.room, grid: state.grid, solution: state.solution, messages: state.messages }),
    }
  )
);