import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Grid, RoomState, Player, ChatMessage } from '../types/game';
import { checkConflicts } from '../utils/sudoku';

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
  solutionToken: string | null;

  setGameData: (grid: Grid, solutionToken: string) => void;
  updateCellWithValidation: (row: number, col: number, value: number | null, playerId: string, isCorrect: boolean) => void;
  toggleNote: (row: number, col: number, note: number) => void;

  // UI State
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;

  selectedCell: { row: number; col: number } | null;
  setSelectedCell: (cell: { row: number; col: number } | null) => void;
  resetGame: () => void;
  enterRoom: (roomId: string) => void;
}

export const useGameStore = create<GameStore>()(
  persist(
    (set, get) => ({
      messages: [],
      addMessage: (msg) => set((state) => ({ messages: [...state.messages, msg].slice(-200) })),
      setMessages: (msgs) => set({ messages: msgs.slice(-200) }),

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
      solutionToken: null,

      setGameData: (grid, solutionToken) => {
        const validatedGrid = checkConflicts(grid);
        set({ grid: validatedGrid, solutionToken });
      },

      updateCellWithValidation: (row, col, value, playerId, isCorrect) => set((state) => {
        if (!state.grid || !state.room) return state;

        const currentCell = state.grid[row][col];
        if (currentCell.isLocked || currentCell.value === value) return state;

        const newGrid = [...state.grid];
        newGrid[row] = [...newGrid[row]];

        const mode = state.room.mode;

        newGrid[row][col] = {
          ...newGrid[row][col],
          value,
          filledBy: playerId,
          isWrong: value !== null && !isCorrect
        };

        const validatedGrid = checkConflicts(newGrid);

        // Perhitungan Skor Resmi Terverifikasi
        let newRoom = { ...state.room };
        if (value !== null && mode !== 'zen') {
          const currentScore = state.room.players[playerId]?.score || 0;
          const scoreDiff = isCorrect ? 10 : -5;
          const newScore = currentScore + scoreDiff;

          newRoom = {
            ...state.room,
            players: {
              ...state.room.players,
              [playerId]: { ...state.room.players[playerId], score: newScore }
            }
          };
        }

        return {
          grid: validatedGrid,
          room: newRoom
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

      selectedCell: null,
      setSelectedCell: (cell) => set({ selectedCell: cell }),
      resetGame: () => set({ room: null, grid: null, solutionToken: null, messages: [], selectedCell: null }),
      enterRoom: (roomId) => {
        const state = get();
        if (state.room?.id === roomId) return;
        set({
          room: null,
          grid: null,
          solutionToken: null,
          messages: [],
          selectedCell: null,
        });
      },
    }),
    {
      name: "sudoku-game-storage",
      // AMAN: solutionToken dan solution TIDAK disimpan di localStorage
      partialize: (state) => ({ room: state.room, grid: state.grid, messages: state.messages }),
    }
  )
);
