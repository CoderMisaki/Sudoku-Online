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
  updatePlayerProgress: (playerId: string, progress: number, rank?: number | null) => void;

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

      updatePlayerProgress: (playerId, progress, rank) => set((state) => {
        if (!state.room || !state.room.players[playerId]) return state;
        return {
          room: {
            ...state.room,
            players: {
              ...state.room.players,
              [playerId]: {
                ...state.room.players[playerId],
                progress,
                rank: rank !== undefined ? rank : state.room.players[playerId].rank
              }
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

        // Auto-clear notes
        const filledVal = value;
        const boxR = Math.floor(row / 3) * 3;
        const boxC = Math.floor(col / 3) * 3;

        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            if (r === row || c === col || (r >= boxR && r < boxR + 3 && c >= boxC && c < boxC + 3)) {
              if (newGrid[r][c].notes.includes(filledVal)) {
                if (newGrid[r] === state.grid[r]) {
                  newGrid[r] = [...newGrid[r]];
                }
                newGrid[r][c] = {
                  ...newGrid[r][c],
                  notes: newGrid[r][c].notes.filter((n) => n !== filledVal)
                };
              }
            }
          }
        }

        return { grid: checkConflicts(newGrid) };
      }),

      setGameData: (grid, solutionToken) => {
        const validatedGrid = checkConflicts(grid);
        set({ grid: validatedGrid, solutionToken });
      },

      updateCellWithValidation: (row, col, value, playerId, isCorrect) => set((state) => {
        if (!state.grid || !state.room) return state;

        const currentCell = state.grid[row][col];
        if (currentCell.isLocked) return state;

        const newGrid = [...state.grid];
        newGrid[row] = [...newGrid[row]];

        const mode = state.room.mode;

        const isWrongMove = value !== null && !isCorrect;
        // Mengabaikan input salah di mode competition & classic
        const shouldRejectWrongMove = isWrongMove && (mode === 'classic' || mode === 'competition' || !mode);

        newGrid[row][col] = {
          ...newGrid[row][col],
          value: shouldRejectWrongMove ? null : value,
          filledBy: shouldRejectWrongMove ? undefined : playerId,
          isWrong: shouldRejectWrongMove ? false : isWrongMove,
          isPending: false,
          notes: value !== null ? [] : newGrid[row][col].notes
        };

        if (value !== null && !isWrongMove && !shouldRejectWrongMove) {
          const filledVal = value;
          const boxR = Math.floor(row / 3) * 3;
          const boxC = Math.floor(col / 3) * 3;

          for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
              if (r === row || c === col || (r >= boxR && r < boxR + 3 && c >= boxC && c < boxC + 3)) {
                if (newGrid[r][c].notes.includes(filledVal)) {
                  if (newGrid[r] === state.grid[r]) {
                    newGrid[r] = [...newGrid[r]];
                  }
                  newGrid[r][c] = {
                    ...newGrid[r][c],
                    notes: newGrid[r][c].notes.filter((n) => n !== filledVal)
                  };
                }
              }
            }
          }
        }
        const validatedGrid = checkConflicts(newGrid);

        let newRoom = { ...state.room };

        if (mode === 'competition') {
          // Hitung progress berdasarkan sel yang benar dan tidak berkonflik
          let totalNonLocked = 0;
          let correctCount = 0;
          for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
              const cell = validatedGrid[r][c];
              if (!cell.isLocked) {
                totalNonLocked++;
                if (cell.value !== null && !cell.isWrong && !cell.isConflicting) {
                  correctCount++;
                }
              }
            }
          }

          const progPercent = totalNonLocked > 0 ? Math.floor((correctCount / totalNonLocked) * 100) : 0;
          const isComplete = totalNonLocked > 0 && correctCount === totalNonLocked;

          const currentPlayer = newRoom.players[playerId];
          let newRank = currentPlayer?.rank ?? null;

          if (isComplete && !newRank) {
            // Hitung berapa banyak player yang sudah selesai sebelumnya
            const existingRanks = Object.values(newRoom.players)
              .map(p => p.rank)
              .filter((r): r is number => typeof r === 'number' && r > 0);
            newRank = existingRanks.length + 1;
          }

          if (newRoom.players[playerId]) {
            newRoom = {
              ...newRoom,
              players: {
                ...newRoom.players,
                [playerId]: {
                  ...newRoom.players[playerId],
                  progress: progPercent,
                  rank: newRank,
                }
              }
            };
          }
        } else if (value !== null && mode !== 'zen') {
          const currentScore = state.room.players[playerId]?.score || 0;
          const scoreDiff = isCorrect ? 10 : -5;
          const newScore = currentScore + scoreDiff;

          if (newRoom.players[playerId]) {
            newRoom = {
              ...newRoom,
              players: {
                ...newRoom.players,
                [playerId]: { ...newRoom.players[playerId], score: newScore }
              }
            };
          }
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

        // Reset skor, progress, dan peringkat untuk semua pemain
        const newPlayers = { ...state.room.players };
        Object.keys(newPlayers).forEach(playerId => {
          newPlayers[playerId] = {
            ...newPlayers[playerId],
            score: 0,
            progress: 0,
            rank: null,
            hints: 3
          };
        });

        return {
          room: {
            ...state.room,
            players: newPlayers,
            startedAt: Date.now(),
            status: 'playing'
          },
          grid: checkConflicts(newGrid),
          solutionToken: newSolutionToken,
          selectedCell: null,
          // PERBAIKAN BUG: Tidak menghapus pesan chat (messages)
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
      partialize: (state) => ({
        room: state.room,
        grid: state.grid,
        solutionToken: state.solutionToken,
        messages: state.messages,
      }),
    }
  )
);
