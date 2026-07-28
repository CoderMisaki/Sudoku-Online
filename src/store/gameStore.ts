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
  setOptimisticMove: (row: number, col: number, value: number) => void;
  updateCellWithValidation: (row: number, col: number, value: number | null, playerId: string, isCorrect: boolean) => void;
  toggleNote: (row: number, col: number, note: number) => void;

  // UI State
  messages: ChatMessage[];
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;

  selectedCell: { row: number; col: number } | null;
  setSelectedCell: (cell: { row: number; col: number } | null) => void;
  resetGame: () => void;
  startNextGame: (newGrid: Grid, newSolutionToken: string) => void;
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

      setOptimisticMove: (row, col, value) => set((state) => {
        if (!state.grid) return state;
        const currentCell = state.grid[row][col];
        if (currentCell.isLocked) return state;

        const newGrid = [...state.grid];
        newGrid[row] = [...newGrid[row]];
        newGrid[row][col] = {
          ...newGrid[row][col],
          value,
          isPending: true
        };

        return { grid: newGrid };
      }),

      setGameData: (grid, solutionToken) => {
        const validatedGrid = checkConflicts(grid);
        set({ grid: validatedGrid, solutionToken });
      },

      updateCellWithValidation: (row, col, value, playerId, isCorrect) => set((state) => {
        if (!state.grid || !state.room) return state;

        const currentCell = state.grid[row][col];
        if (currentCell.isLocked) return state;
        if (currentCell.value === value && !currentCell.isPending) return state;

        const newGrid = [...state.grid];
        newGrid[row] = [...newGrid[row]];

        const mode = state.room.mode;

        const isWrongMove = value !== null && !isCorrect;
        // Pada mode classic jika jawaban salah, angkanya tidak dimasukkan (tetap null)
        const shouldRejectWrongMove = isWrongMove && mode === 'classic';

        newGrid[row][col] = {
          ...newGrid[row][col],
          value: shouldRejectWrongMove ? null : value,
          filledBy: shouldRejectWrongMove ? undefined : playerId,
          isWrong: shouldRejectWrongMove ? false : isWrongMove,
          isPending: false
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

        let updatedNotes = hasNote ? currentNotes.filter(n => n !== note) : [...currentNotes, note].sort();
        if (updatedNotes.length > 5) {
          updatedNotes = updatedNotes.slice(0, 5);
        }
        newGrid[row][col] = {
          ...newGrid[row][col],
          notes: updatedNotes
        };

        return { grid: newGrid };
      }),

      selectedCell: null,
      setSelectedCell: (cell) => set({ selectedCell: cell }),
      resetGame: () => set({ room: null, grid: null, solutionToken: null, messages: [], selectedCell: null }),
      startNextGame: (newGrid, newSolutionToken) => set((state) => {
        if (!state.room) return state;

        // Reset scores and hints for all players
        const newPlayers = { ...state.room.players };
        Object.keys(newPlayers).forEach(playerId => {
          newPlayers[playerId] = {
            ...newPlayers[playerId],
            score: 0,
            hints: 3
          };
        });

        return {
          room: {
            ...state.room,
            players: newPlayers,
            startedAt: Date.now(), // Reset timer
            status: 'playing'
          },
          grid: newGrid,
          solutionToken: newSolutionToken,
          selectedCell: null,
          messages: [] // Optional: clear messages, but keeping might be fine. Let's keep messages, it's nice for chat history. Wait, user said "reset ulang lagi seperti main baru". Usually chat can be kept. Let's clear it just in case. Or let's not clear chat, it breaks communication. Actually I will leave messages alone.
        };
      }),
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
      partialize: (state) => ({ messages: state.messages }),
    }
  )
);
