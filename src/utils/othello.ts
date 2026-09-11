import { OthelloState, OthelloDisc, Player, OthelloPlayerInfo } from '../types/game';

export const OTHELLO_BOT_USER_ID = 'othello-bot-player';
export const OTHELLO_BOT_NAME = 'BOT (Master AI)';
export const OTHELLO_BOARD_SIZE = 8;

const DIRS = [
  { dr: -1, dc: -1 },
  { dr: -1, dc: 0 },
  { dr: -1, dc: 1 },
  { dr: 0, dc: -1 },
  { dr: 0, dc: 1 },
  { dr: 1, dc: -1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
] as const;

export const opponentOf = (d: OthelloDisc): OthelloDisc => (d === 'B' ? 'W' : 'B');

function inBoard(r: number, c: number): boolean {
  return r >= 0 && r < OTHELLO_BOARD_SIZE && c >= 0 && c < OTHELLO_BOARD_SIZE;
}

/**
 * Keping lawan yang akan dibalik jika `disc` ditaruh di (row, col).
 * Kosong = langkah tidak sah.
 */
export function getFlipsForMove(
  grid: (OthelloDisc | null)[][],
  row: number,
  col: number,
  disc: OthelloDisc
): { row: number; col: number }[] {
  if (!inBoard(row, col) || grid[row][col] !== null) return [];
  const opp = opponentOf(disc);
  const flips: { row: number; col: number }[] = [];

  for (const { dr, dc } of DIRS) {
    const line: { row: number; col: number }[] = [];
    let r = row + dr;
    let c = col + dc;
    // Harus ada minimal 1 keping lawan tepat di sebelahnya.
    while (inBoard(r, c) && grid[r][c] === opp) {
      line.push({ row: r, col: c });
      r += dr;
      c += dc;
    }
    // Diakhiri keping sendiri -> seluruh line sah dibalik.
    if (line.length > 0 && inBoard(r, c) && grid[r][c] === disc) {
      flips.push(...line);
    }
  }

  return flips;
}

/** Semua langkah sah untuk `disc` di papan saat ini. */
export function getValidMoves(grid: (OthelloDisc | null)[][], disc: OthelloDisc): { row: number; col: number }[] {
  const moves: { row: number; col: number }[] = [];
  for (let r = 0; r < OTHELLO_BOARD_SIZE; r++) {
    for (let c = 0; c < OTHELLO_BOARD_SIZE; c++) {
      if (grid[r][c] === null && getFlipsForMove(grid, r, c, disc).length > 0) {
        moves.push({ row: r, col: c });
      }
    }
  }
  return moves;
}

export function countDiscs(grid: (OthelloDisc | null)[][]): { B: number; W: number } {
  let B = 0;
  let W = 0;
  for (let r = 0; r < OTHELLO_BOARD_SIZE; r++) {
    for (let c = 0; c < OTHELLO_BOARD_SIZE; c++) {
      if (grid[r][c] === 'B') B++;
      else if (grid[r][c] === 'W') W++;
    }
  }
  return { B, W };
}

/**
 * State awal Othello: 4 keping tengah berselang-seling, Hitam jalan pertama.
 * Standar: d4=W, e4=B, d5=B, e5=W (baris/kolom 3-4 dengan 0-index).
 */
export function createInitialOthelloState(activePlayers: Player[], hostId: string): OthelloState {
  const hostPlayer = activePlayers.find((p) => p.id === hostId) || activePlayers[0];
  const secondPlayer = activePlayers.find((p) => p.id !== (hostPlayer?.id || ''));

  const isAgainstBot = !secondPlayer;

  const playerB: OthelloPlayerInfo = {
    id: hostPlayer ? hostPlayer.id : 'host',
    username: hostPlayer ? hostPlayer.username || 'Pemain 1' : 'Pemain 1',
    disc: 'B',
    color: hostPlayer?.color || '#3b82f6',
    avatar: hostPlayer?.avatar || null,
    isBot: false,
  };

  const playerW: OthelloPlayerInfo = secondPlayer
    ? {
        id: secondPlayer.id,
        username: secondPlayer.username || 'Pemain 2',
        disc: 'W',
        color: secondPlayer.color || '#ef4444',
        avatar: secondPlayer.avatar || null,
        isBot: false,
      }
    : {
        id: OTHELLO_BOT_USER_ID,
        username: OTHELLO_BOT_NAME,
        disc: 'W',
        color: '#10b981',
        avatar: null,
        isBot: true,
      };

  const grid: (OthelloDisc | null)[][] = Array.from({ length: OTHELLO_BOARD_SIZE }, () =>
    Array.from({ length: OTHELLO_BOARD_SIZE }, () => null)
  );
  grid[3][3] = 'W';
  grid[3][4] = 'B';
  grid[4][3] = 'B';
  grid[4][4] = 'W';

  const validMoves = getValidMoves(grid, 'B');

  return {
    boardId: Math.random().toString(36).substring(2, 9),
    boardSize: 8,
    grid,
    currentTurnDisc: 'B',
    currentTurnUserId: playerB.id,
    counts: { B: 2, W: 2 },
    validMoves,
    winner: null,
    winnerDisc: null,
    isAgainstBot,
    playerB,
    playerW,
    revision: 1,
    lastMove: null,
  };
}

/**
 * Terapkan satu langkah Othello. Menangani: pembalikan keping, giliran lewat
 * (pass) otomatis bila lawan tak punya langkah sah, dan akhir permainan
 * (papan penuh ATAU kedua pemain tak punya langkah sah).
 */
export function applyOthelloMove(
  state: OthelloState,
  row: number,
  col: number,
  userId: string
): { next: OthelloState; valid: boolean; skippedOpponent: boolean } {
  const disc = state.currentTurnDisc;
  const flips = getFlipsForMove(state.grid, row, col, disc);
  if (flips.length === 0) return { next: state, valid: false, skippedOpponent: false };

  const nextGrid = state.grid.map((r, rIdx) =>
    r.map((cell, cIdx) => {
      if (rIdx === row && cIdx === col) return disc;
      return flips.some((f) => f.row === rIdx && f.col === cIdx) ? disc : cell;
    })
  );

  const counts = countDiscs(nextGrid);
  const total = counts.B + counts.W;

  const opp = opponentOf(disc);
  const oppMoves = total >= 64 ? [] : getValidMoves(nextGrid, opp);
  const myMoves = total >= 64 ? [] : getValidMoves(nextGrid, disc);

  // Akhir permainan: papan penuh ATAU keduanya tak punya langkah sah.
  if (total >= 64 || (oppMoves.length === 0 && myMoves.length === 0)) {
    let winner: OthelloState['winner'];
    let winnerDisc: OthelloDisc | null;
    if (counts.B === counts.W) {
      winner = 'draw';
      winnerDisc = null;
    } else if (counts.B > counts.W) {
      winner = state.playerB.id;
      winnerDisc = 'B';
    } else {
      winner = state.playerW.id;
      winnerDisc = 'W';
    }
    const next: OthelloState = {
      ...state,
      grid: nextGrid,
      counts,
      validMoves: [],
      winner,
      winnerDisc,
      lastMove: { row, col, disc, userId, flipped: flips, skippedOpponent: false, timestamp: Date.now() },
      revision: (state.revision ?? 0) + 1,
    };
    return { next, valid: true, skippedOpponent: false };
  }

  // Lawan punya langkah -> giliran pindah normal.
  // Lawan tidak punya langkah -> pemain yang sama jalan lagi (pass).
  const skippedOpponent = oppMoves.length === 0;
  const nextDisc = skippedOpponent ? disc : opp;
  const next: OthelloState = {
    ...state,
    grid: nextGrid,
    counts,
    currentTurnDisc: nextDisc,
    currentTurnUserId: nextDisc === 'B' ? state.playerB.id : state.playerW.id,
    validMoves: skippedOpponent ? myMoves : oppMoves,
    lastMove: { row, col, disc, userId, flipped: flips, skippedOpponent, timestamp: Date.now() },
    revision: (state.revision ?? 0) + 1,
  };
  return { next, valid: true, skippedOpponent };
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT AI — greedy + bobot posisi (sudut & tepi diutamakan, dekat-sudut dihindari)
// ─────────────────────────────────────────────────────────────────────────────

const POSITIONAL_WEIGHTS = [
  [120, -20, 20, 5, 5, 20, -20, 120],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [5, -5, 3, 3, 3, 3, -5, 5],
  [20, -5, 15, 3, 3, 15, -5, 20],
  [-20, -40, -5, -5, -5, -5, -40, -20],
  [120, -20, 20, 5, 5, 20, -20, 120],
];

export function getBestOthelloBotMove(state: OthelloState): { row: number; col: number } | null {
  const disc = state.currentTurnDisc;
  const moves = state.validMoves.length > 0 ? state.validMoves : getValidMoves(state.grid, disc);
  if (moves.length === 0) return null;

  let bestScore = -Infinity;
  let best: { row: number; col: number }[] = [];

  for (const m of moves) {
    const flips = getFlipsForMove(state.grid, m.row, m.col, disc);
    // Mobilitas lawan setelah langkah ini (makin kecil makin bagus).
    const testGrid = state.grid.map((r, rIdx) =>
      r.map((cell, cIdx) => {
        if (rIdx === m.row && cIdx === m.col) return disc;
        return flips.some((f) => f.row === rIdx && f.col === cIdx) ? disc : cell;
      })
    );
    const oppMobility = getValidMoves(testGrid, opponentOf(disc)).length;
    const score =
      flips.length * 10 +
      POSITIONAL_WEIGHTS[m.row][m.col] -
      oppMobility * 4 +
      Math.random() * 2;

    if (score > bestScore) {
      bestScore = score;
      best = [m];
    } else if (score === bestScore) {
      best.push(m);
    }
  }

  return best[Math.floor(Math.random() * best.length)];
}
