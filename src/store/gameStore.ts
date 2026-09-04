import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { Grid, RoomState, Player, ChatMessage, SnakesState } from '../types/game';
import { checkConflicts } from '../utils/sudoku';
import { generateInitialSnakesState, areSnakesLayoutsEqual } from '../utils/snakesAndLaddersData';

// Debug logging off by default. Enable with: localStorage.setItem('sudoku_debug_snakes', '1')
const isSnakesDebugEnabled = (): boolean => {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem('sudoku_debug_snakes') === '1';
  } catch {
    return false;
  }
};

const debugSnakesState = (message: string, s: SnakesState): void => {
  if (!isSnakesDebugEnabled()) return;
  console.debug(
    `[SnakesState] ${message} | turn=${s.currentTurnUserId ?? '-'} | positions=${JSON.stringify(s.playerPositions)}`
  );
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
  updatePlayerProgress: (playerId: string, progress: number, rank?: number | null) => void;

  // Game State
  grid: Grid | null;
  solutionToken: string | null;

  setGameData: (grid: Grid, solutionToken: string) => void;
  /**
   * Hard-clear the sudoku board + solution token WITHOUT running conflict
   * detection. Used when a client must discard its current puzzle so it can
   * fetch a fresh one (e.g. competition "next game"). Previously the code
   * called `setGameData(null, null)` which crashed inside `checkConflicts`
   * (null.map), so guests kept their finished board while only the host reset.
   */
  clearGameData: () => void;
  setOptimisticMove: (row: number, col: number, value: number) => void;
  updateCellWithValidation: (row: number, col: number, value: number | null, playerId: string, isCorrect: boolean) => void;
  toggleNote: (row: number, col: number, note: number) => void;
  autoNote: () => void;

  // UI State
  messages: ChatMessage[];
  snakesState?: SnakesState;
  addMessage: (msg: ChatMessage) => void;
  setMessages: (msgs: ChatMessage[]) => void;

  selectedCell: { row: number; col: number } | null;
  setSelectedCell: (cell: { row: number; col: number } | null) => void;
  resetGame: () => void;
  startNextGame: (newGrid: Grid, newSolutionToken: string) => void;
  updateSnakesState: (state: Partial<SnakesState>) => void;
  /**
   * Adopt a full authoritative SnakesState (host sync_state / next_game).
   * Bypasses the revision guard because a full resnapshot from the authority
   * is always the truth, even if our local persisted revision drifted ahead
   * (e.g. reconnect after host restart, or brand-new game with revision 1).
   */
  replaceAllSnakesState: (state: SnakesState) => void;
  enterRoom: (roomId: string) => void;
  clearPersistedStorage: () => void;
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
        const existingPlayer = state.room.players[playerId];
        return {
          room: {
            ...state.room,
            players: {
              ...state.room.players,
              [playerId]: {
                ...(existingPlayer || {
                  id: playerId,
                  // No fake name: empty until the player actually sets one
                  username: '',
                  color: '#3b82f6',
                  isHost: false,
                  score: 0,
                  hints: 3,
                  status: 'online'
                }),
                ...data
              }
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
        if (currentCell.isLocked || currentCell.isCorrect) return state;

        const newGrid = [...state.grid];
        newGrid[row] = [...newGrid[row]];
        newGrid[row][col] = {
          ...newGrid[row][col],
          value,
          isPending: true
        };

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

      clearGameData: () => set({ grid: null, solutionToken: null, selectedCell: null }),

      updateCellWithValidation: (row, col, value, playerId, isCorrect) => set((state) => {
        if (!state.grid || !state.room) return state;

        const currentCell = state.grid[row][col];
        if (currentCell.isLocked || currentCell.isCorrect) return state;

        const newGrid = [...state.grid];
        newGrid[row] = [...newGrid[row]];

        const mode = state.room.mode;
        const isWrongMove = value !== null && !isCorrect;
        const shouldRejectWrongMove = isWrongMove && (mode === 'classic' || mode === 'competition' || !mode);

        newGrid[row][col] = {
          ...newGrid[row][col],
          value: shouldRejectWrongMove ? null : value,
          filledBy: shouldRejectWrongMove ? undefined : playerId,
          isWrong: shouldRejectWrongMove || mode === 'zen' ? false : isWrongMove,
          isCorrect: Boolean(isCorrect && value !== null),
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
          let totalNonLocked = 0;
          let correctCount = 0;
          for (let r = 0; r < 9; r++) {
            for (let c = 0; c < 9; c++) {
              const cell = validatedGrid[r][c];
              if (!cell.isLocked) {
                totalNonLocked++;
                if (cell.value !== null && (cell.isCorrect || (!cell.isWrong && !cell.isConflicting))) {
                  correctCount++;
                }
              }
            }
          }

          const progPercent = totalNonLocked > 0 ? Math.floor((correctCount / totalNonLocked) * 100) : 0;
          const isComplete = totalNonLocked > 0 && correctCount === totalNonLocked;

          const currentPlayer = newRoom.players[playerId];
          let newRank = currentPlayer?.rank ?? null;

          // Skor competition: +10 per sel benar, -5 per sel salah (sebelumnya
          // mode ini tidak pernah menambah skor sama sekali -> "skor tidak jalan").
          let newScore = currentPlayer?.score || 0;
          if (value !== null) {
            newScore += isCorrect ? 10 : -5;
          }

          if (isComplete && !newRank) {
            const existingRanks = Object.values(newRoom.players)
              .map(p => p.rank)
              .filter((r): r is number => typeof r === 'number' && r > 0);
            newRank = existingRanks.length + 1;
            // Bonus juara: 1st=100, 2nd=60, 3rd=30, sisanya 10
            newScore += newRank === 1 ? 100 : newRank === 2 ? 60 : newRank === 3 ? 30 : 10;
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
                  score: newScore,
                }
              }
            };
          }
        } else if (value !== null && mode !== 'zen') {
          const currentPlayer = newRoom.players[playerId];
          const currentScore = currentPlayer?.score || 0;

          if (mode === 'race') {
            const now = Date.now();
            if (isCorrect) {
              const lastCorrect = currentPlayer?.lastCorrectMoveAt || 0;
              let streak = currentPlayer?.streak || 0;

              if (now - lastCorrect < 4000) {
                streak += 1;
              } else {
                streak = 1;
              }

              const multiplier = streak;
              let newScore = currentScore + (10 * multiplier);

              let blockCompleted = true;
              let rowCompleted = true;
              let colCompleted = true;

              for (let i = 0; i < 9; i++) {
                if (validatedGrid[row][i].value === null || validatedGrid[row][i].isWrong || validatedGrid[row][i].isConflicting) rowCompleted = false;
                if (validatedGrid[i][col].value === null || validatedGrid[i][col].isWrong || validatedGrid[i][col].isConflicting) colCompleted = false;
              }
              const boxR = Math.floor(row / 3) * 3;
              const boxC = Math.floor(col / 3) * 3;
              for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                  if (validatedGrid[boxR + i][boxC + j].value === null || validatedGrid[boxR + i][boxC + j].isWrong || validatedGrid[boxR + i][boxC + j].isConflicting) blockCompleted = false;
                }
              }

              if (rowCompleted || colCompleted || blockCompleted) {
                newScore += 50;
              }

              if (newRoom.players[playerId]) {
                newRoom = {
                  ...newRoom,
                  players: {
                    ...newRoom.players,
                    [playerId]: { ...newRoom.players[playerId], score: newScore, streak, lastCorrectMoveAt: now }
                  }
                };
              }
            } else {
              if (newRoom.players[playerId]) {
                newRoom = {
                  ...newRoom,
                  players: {
                    ...newRoom.players,
                    [playerId]: { ...newRoom.players[playerId], streak: 0, stunnedUntil: now + 3000 }
                  }
                };
              }
            }
          } else {
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
        }

        return {
          grid: validatedGrid,
          room: newRoom
        };
      }),

      autoNote: () => set((state) => {
        if (!state.grid) return state;
        const newGrid = state.grid.map(row => row.map(cell => ({ ...cell, notes: [...cell.notes] })));

        for (let r = 0; r < 9; r++) {
          for (let c = 0; c < 9; c++) {
            if (newGrid[r][c].value === null) {
              const possible = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9]);
              for (let i = 0; i < 9; i++) {
                if (newGrid[r][i].value !== null && !newGrid[r][i].isWrong && !newGrid[r][i].isConflicting) possible.delete(newGrid[r][i].value as number);
              }
              for (let i = 0; i < 9; i++) {
                if (newGrid[i][c].value !== null && !newGrid[i][c].isWrong && !newGrid[i][c].isConflicting) possible.delete(newGrid[i][c].value as number);
              }
              const boxR = Math.floor(r / 3) * 3;
              const boxC = Math.floor(c / 3) * 3;
              for (let i = 0; i < 3; i++) {
                for (let j = 0; j < 3; j++) {
                  if (newGrid[boxR + i][boxC + j].value !== null && !newGrid[boxR + i][boxC + j].isWrong && !newGrid[boxR + i][boxC + j].isConflicting) possible.delete(newGrid[boxR + i][boxC + j].value as number);
                }
              }
              newGrid[r][c].notes = Array.from(possible).sort();
            }
          }
        }
        return { grid: newGrid };
      }),

      toggleNote: (row, col, note) => set((state) => {
        if (!state.grid) return state;
        const targetCell = state.grid[row][col];
        if (targetCell.isLocked || targetCell.isCorrect || targetCell.value !== null) return state;

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
      snakesState: undefined,
      setSelectedCell: (cell) => set({ selectedCell: cell }),
      updateSnakesState: (updates) => set((state) => {
        const current = state.snakesState as SnakesState | undefined;
        const incomingRevision = (updates as SnakesState).revision;
        const incomingBoardId = (updates as SnakesState).boardId;

        // If the incoming state belongs to a DIFFERENT boardId (new game/host generation),
        // adopt the new board wholesale rather than rejecting it based on the old board's revision.
        const isDifferentBoard = Boolean(
          incomingBoardId && current?.boardId && incomingBoardId !== current.boardId
        );

        // Check if obstacles layout changed (e.g. host moved a ladder/wormhole or incoming has different obstacle positions)
        const isLayoutDiscrepancy = !areSnakesLayoutsEqual(current, updates as SnakesState);

        // Revision ordering: ignore stale state ONLY if it's the exact same board and layout matches
        if (!isDifferentBoard && !isLayoutDiscrepancy && current && typeof incomingRevision === 'number' && typeof current.revision === 'number') {
          if (incomingRevision <= current.revision) {
            debugSnakesState(`ignore stale revision ${incomingRevision} <= ${current.revision}`, current);
            return state;
          }
        }

        // If no revision provided, auto-increment from current (monotonic guarantee)
        let nextRevision = incomingRevision;
        if (typeof nextRevision !== 'number' && current && typeof current.revision === 'number' && !isDifferentBoard) {
          nextRevision = current.revision + 1;
        } else if (typeof nextRevision !== 'number') {
          nextRevision = 1;
        }

        const merged = isDifferentBoard
          ? ({ ...updates, revision: nextRevision } as SnakesState)
          : ({ ...current, ...updates, revision: nextRevision } as SnakesState);

        debugSnakesState(`apply revision ${nextRevision} board=${(merged.boardId || '').slice(0, 8)}`, merged);
        return { snakesState: merged };
      }),
      replaceAllSnakesState: (incoming) => set((state) => {
        const current = state.snakesState as SnakesState | undefined;
        // Adopt a full authority snapshot UNLESS it is a stale in-flight snapshot
        // of the EXACT SAME board with identical layout. If obstacles differ in ANY way, adopt incoming immediately!
        if (
          current &&
          incoming.boardId &&
          current.boardId &&
          incoming.boardId === current.boardId &&
          areSnakesLayoutsEqual(current, incoming) &&
          typeof incoming.revision === 'number' &&
          typeof current.revision === 'number' &&
          incoming.revision < current.revision
        ) {
          debugSnakesState(`replaceAll ignored (stale same-board snapshot ${incoming.revision} < ${current.revision})`, current);
          return state;
        }
        const next: SnakesState = {
          ...incoming,
          revision: typeof incoming.revision === 'number'
            ? incoming.revision
            : Math.max(current?.revision ?? 0, 0) + 1,
        };
        debugSnakesState(`replaceAll -> revision ${next.revision} board=${(next.boardId || '').slice(0, 8)}`, next);
        return { snakesState: next };
      }),
      resetGame: () => set({ room: null, grid: null, solutionToken: null, messages: [], selectedCell: null, snakesState: undefined }),

      startNextGame: (newGrid, newSolutionToken) => set((state) => {
        if (!state.room) return state;

        const newPlayers = { ...state.room.players };
        const isSnakesMode = state.room.mode === 'snakes_and_ladders';
        let newSnakesState = state.snakesState;

        if (isSnakesMode) {
          const fresh = generateInitialSnakesState(state.room.difficulty, Object.keys(newPlayers));
          // Keep revision monotonic across games so peers never reject the new
          // board as "stale" (generateInitial restarts at revision 1).
          newSnakesState = {
            ...fresh,
            revision: Math.max(fresh.revision ?? 1, (state.snakesState?.revision ?? 0) + 1),
          } as SnakesState;
        }
        Object.keys(newPlayers).forEach(playerId => {
          newPlayers[playerId] = {
            ...newPlayers[playerId],
            // Skor bersifat kumulatif antar ronde dan HARUS cocok dengan payload
            // room yang disiarkan host (yang juga mempertahankan skor).
            score: newPlayers[playerId]?.score ?? 0,
            progress: 0,
            rank: null,
            hints: 3,
            streak: 0,
            lastCorrectMoveAt: 0,
            stunnedUntil: 0
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
          snakesState: newSnakesState,
        };
      }),

      enterRoom: (roomId) => {
        const state = get();
        if (state.room?.id === roomId) {
          // Already inside this exact room (e.g. a page reload / re-render of an
          // in-progress game). Keep room + grid + snakesState so a refresh does
          // NOT wipe the running game back to a brand-new room. Ephemeral
          // handshake state is reconciled by the realtime channel on subscribe.
          return;
        }
        set({
          room: null,
          grid: null,
          solutionToken: null,
          messages: [],
          selectedCell: null,
          snakesState: undefined,
        });
      },

      clearPersistedStorage: () => {
        try {
          if (typeof window !== 'undefined') {
            localStorage.removeItem('sudoku-game-storage');
          }
        } catch {}
        try {
          // Typed wrapper around the zustand persist API (no `as any`)
          const persisted = useGameStore as unknown as {
            persist?: { clearStorage?: () => void };
          };
          persisted.persist?.clearStorage?.();
        } catch {}
      },
    }),
    {
      name: "sudoku-game-storage",
      partialize: (state) => ({
        room: state.room,
        grid: state.grid,
        solutionToken: state.solutionToken,
        messages: state.messages,
        // Persist snakesState so a refresh / reload of an in-progress snakes & ladders
        // room resumes the same board (positions, turn, obstacles) instead of resetting
        // everyone to a brand-new game. Stale snapshots are already reconciled safely:
        // updateSnakesState ignores lower revisions only for the SAME boardId+layout, and
        // replaceAllSnakesState adopts any differently-boardId / differently-layout snapshot.
        snakesState: state.snakesState,
      }),
    }
  )
);
