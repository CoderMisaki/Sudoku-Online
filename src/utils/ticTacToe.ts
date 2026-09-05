import { TicTacToeState, TicTacToeSymbol, Difficulty, Player, TicTacToePlayerInfo } from '../types/game';

export const BOT_USER_ID = 'bot-player';
export const BOT_NAME = 'BOT (Master AI)';

/**
 * Buat state awal Tic Tac Toe berdasarkan tingkat kesulitan (3x3 atau 8x8)
 */
export function createInitialTicTacToeState(
  difficulty: Difficulty,
  activePlayers: Player[],
  hostId: string
): TicTacToeState {
  const is8x8 = difficulty === '8x8';
  const boardSize: 3 | 8 = is8x8 ? 8 : 3;
  const winLength = is8x8 ? 5 : 3;

  const grid: (TicTacToeSymbol | null)[][] = Array.from({ length: boardSize }, () =>
    Array.from({ length: boardSize }, () => null)
  );

  const hostPlayer = activePlayers.find((p) => p.id === hostId) || activePlayers[0];
  const secondPlayer = activePlayers.find((p) => p.id !== (hostPlayer?.id || ''));

  const isAgainstBot = !secondPlayer;

  const playerX: TicTacToePlayerInfo = {
    id: hostPlayer ? hostPlayer.id : 'host',
    username: hostPlayer ? hostPlayer.username || 'Pemain 1' : 'Pemain 1',
    symbol: 'X',
    color: hostPlayer?.color || '#3b82f6',
    avatar: hostPlayer?.avatar || null,
    isBot: false,
  };

  const playerO: TicTacToePlayerInfo = secondPlayer
    ? {
        id: secondPlayer.id,
        username: secondPlayer.username || 'Pemain 2',
        symbol: 'O',
        color: secondPlayer.color || '#ef4444',
        avatar: secondPlayer.avatar || null,
        isBot: false,
      }
    : {
        id: BOT_USER_ID,
        username: BOT_NAME,
        symbol: 'O',
        color: '#10b981',
        avatar: null,
        isBot: true,
      };

  return {
    boardId: Math.random().toString(36).substring(2, 9),
    boardSize,
    winLength,
    grid,
    currentTurnSymbol: 'X',
    currentTurnUserId: playerX.id,
    winner: null,
    winnerUserId: null,
    winningCells: null,
    isAgainstBot,
    playerX,
    playerO,
    revision: 1,
    lastMove: null,
  };
}

/**
 * Cek apakah ada pemenang atau seri di papan
 */
export function checkTicTacToeWin(
  grid: (TicTacToeSymbol | null)[][],
  winLength: number
): { winner: TicTacToeSymbol | 'draw' | null; winningCells: { row: number; col: number }[] | null } {
  const size = grid.length;

  const directions = [
    { dr: 0, dc: 1 },  // Horizontal ->
    { dr: 1, dc: 0 },  // Vertikal v
    { dr: 1, dc: 1 },  // Diagonal \
    { dr: 1, dc: -1 }, // Diagonal /
  ];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const symbol = grid[r][c];
      if (!symbol) continue;

      for (const { dr, dc } of directions) {
        const endR = r + dr * (winLength - 1);
        const endC = c + dc * (winLength - 1);

        if (endR < 0 || endR >= size || endC < 0 || endC >= size) continue;

        let won = true;
        const lineCells: { row: number; col: number }[] = [];

        for (let step = 0; step < winLength; step++) {
          const currR = r + dr * step;
          const currC = c + dc * step;
          lineCells.push({ row: currR, col: currC });
          if (grid[currR][currC] !== symbol) {
            won = false;
            break;
          }
        }

        if (won) {
          return { winner: symbol, winningCells: lineCells };
        }
      }
    }
  }

  // Cek apakah papan penuh (seri / draw)
  let isFull = true;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] === null) {
        isFull = false;
        break;
      }
    }
    if (!isFull) break;
  }

  if (isFull) {
    return { winner: 'draw', winningCells: null };
  }

  return { winner: null, winningCells: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// AI BOT ENGINE (Smart & Expert for both 3x3 and 8x8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 3x3 Minimax Algorithm: Bot bermain optimal & tak terkalahkan
 */
function minimax3x3(
  grid: (TicTacToeSymbol | null)[][],
  depth: number,
  isMaximizing: boolean,
  alpha: number,
  beta: number
): number {
  const check = checkTicTacToeWin(grid, 3);
  if (check.winner === 'O') return 10 - depth; // Bot ('O') menang
  if (check.winner === 'X') return depth - 10; // Player ('X') menang
  if (check.winner === 'draw') return 0;
  if (depth >= 9) return 0;

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (grid[r][c] === null) {
          grid[r][c] = 'O';
          const evaluation = minimax3x3(grid, depth + 1, false, alpha, beta);
          grid[r][c] = null;
          maxEval = Math.max(maxEval, evaluation);
          alpha = Math.max(alpha, evaluation);
          if (beta <= alpha) break;
        }
      }
      if (beta <= alpha) break;
    }
    return maxEval;
  } else {
    let minEval = Infinity;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        if (grid[r][c] === null) {
          grid[r][c] = 'X';
          const evaluation = minimax3x3(grid, depth + 1, true, alpha, beta);
          grid[r][c] = null;
          minEval = Math.min(minEval, evaluation);
          beta = Math.min(beta, evaluation);
          if (beta <= alpha) break;
        }
      }
      if (beta <= alpha) break;
    }
    return minEval;
  }
}

function getBestMove3x3(grid: (TicTacToeSymbol | null)[][]): { row: number; col: number } | null {
  let filledCount = 0;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[r][c] !== null) filledCount++;
    }
  }

  // Jika bot main pertama pada papan kosong, pilih tengah atau sudut
  if (filledCount === 0) {
    return { row: 1, col: 1 };
  }

  // Jika giliran ke-2 dan tengah kosong, ambil tengah
  if (filledCount === 1 && grid[1][1] === null) {
    return { row: 1, col: 1 };
  }

  let bestScore = -Infinity;
  const bestMoves: { row: number; col: number }[] = [];

  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[r][c] === null) {
        grid[r][c] = 'O';
        const score = minimax3x3(grid, 0, false, -Infinity, Infinity);
        grid[r][c] = null;

        if (score > bestScore) {
          bestScore = score;
          bestMoves.length = 0;
          bestMoves.push({ row: r, col: c });
        } else if (score === bestScore) {
          bestMoves.push({ row: r, col: c });
        }
      }
    }
  }

  if (bestMoves.length > 0) {
    const randomIndex = Math.floor(Math.random() * bestMoves.length);
    return bestMoves[randomIndex];
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 8x8 Gomoku/Tic Tac Toe AI (Win length = 5)
// ─────────────────────────────────────────────────────────────────────────────

const DIRECTIONS_8X8 = [
  { dr: 0, dc: 1 },
  { dr: 1, dc: 0 },
  { dr: 1, dc: 1 },
  { dr: 1, dc: -1 },
];

function evaluateLineSegment(
  grid: (TicTacToeSymbol | null)[][],
  r: number,
  c: number,
  dr: number,
  dc: number,
  targetSymbol: TicTacToeSymbol
): number {
  const size = grid.length;

  // Analisis 5-sel dari (r, c)
  let count = 0;
  let empty = 0;

  for (let i = 0; i < 5; i++) {
    const nr = r + dr * i;
    const nc = c + dc * i;
    if (nr < 0 || nr >= size || nc < 0 || nc >= size) return 0;
    const cell = grid[nr][nc];
    if (cell === targetSymbol) count++;
    else if (cell === null) empty++;
    else return 0; // Terhalang oleh lawan
  }

  if (count === 5) return 1000000; // Menang 5 berurutan
  if (count === 4 && empty === 1) return 10000;  // 4 berurutan
  if (count === 3 && empty === 2) return 1000;   // 3 berurutan
  if (count === 2 && empty === 3) return 100;    // 2 berurutan
  if (count === 1 && empty === 4) return 10;
  return 0;
}

/**
 * Evaluasi skor posisi untuk langkah (row, col) pada papan 8x8
 */
function evaluateMove8x8(
  grid: (TicTacToeSymbol | null)[][],
  row: number,
  col: number
): number {
  let score = 0;

  // Bonus kedekatan posisi dengan tengah (center control)
  const centerDist = Math.abs(row - 3.5) + Math.abs(col - 3.5);
  score += Math.max(0, 10 - centerDist * 2);

  // 1. Evaluasi Serangan Bot ('O')
  grid[row][col] = 'O';
  const winCheckO = checkTicTacToeWin(grid, 5);
  if (winCheckO.winner === 'O') {
    grid[row][col] = null;
    return 10000000; // Langkah menang instan!
  }

  let attackScore = 0;
  for (const { dr, dc } of DIRECTIONS_8X8) {
    for (let offset = -4; offset <= 0; offset++) {
      const sr = row + dr * offset;
      const sc = col + dc * offset;
      attackScore += evaluateLineSegment(grid, sr, sc, dr, dc, 'O');
    }
  }

  // 2. Evaluasi Pertahanan (Blok Ancaman Lawan 'X')
  grid[row][col] = 'X';
  const winCheckX = checkTicTacToeWin(grid, 5);
  if (winCheckX.winner === 'X') {
    grid[row][col] = null;
    return 8000000; // Blok lawan agar tidak menang instan!
  }

  let defenseScore = 0;
  for (const { dr, dc } of DIRECTIONS_8X8) {
    for (let offset = -4; offset <= 0; offset++) {
      const sr = row + dr * offset;
      const sc = col + dc * offset;
      defenseScore += evaluateLineSegment(grid, sr, sc, dr, dc, 'X');
    }
  }

  grid[row][col] = null;

  score += attackScore * 1.1 + defenseScore * 1.0;
  return score;
}

function getBestMove8x8(grid: (TicTacToeSymbol | null)[][]): { row: number; col: number } | null {
  const size = 8;
  let filledCount = 0;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] !== null) filledCount++;
    }
  }

  // Jika papan kosong, ambil salah satu posisi tengah
  if (filledCount === 0) {
    const centers = [
      { row: 3, col: 3 },
      { row: 3, col: 4 },
      { row: 4, col: 3 },
      { row: 4, col: 4 },
    ];
    return centers[Math.floor(Math.random() * centers.length)];
  }

  // Kumpulkan kandidat kotak yang berada di sekitar batu yang ada
  const candidateCells: { row: number; col: number }[] = [];
  const candidateSet = new Set<string>();

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] !== null) {
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr >= 0 && nr < size && nc >= 0 && nc < size && grid[nr][nc] === null) {
              const key = `${nr},${nc}`;
              if (!candidateSet.has(key)) {
                candidateSet.add(key);
                candidateCells.push({ row: nr, col: nc });
              }
            }
          }
        }
      }
    }
  }

  if (candidateCells.length === 0) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (grid[r][c] === null) return { row: r, col: c };
      }
    }
    return null;
  }

  let bestScore = -Infinity;
  const bestMoves: { row: number; col: number }[] = [];

  for (const cell of candidateCells) {
    const score = evaluateMove8x8(grid, cell.row, cell.col);
    if (score > bestScore) {
      bestScore = score;
      bestMoves.length = 0;
      bestMoves.push(cell);
    } else if (score === bestScore) {
      bestMoves.push(cell);
    }
  }

  if (bestMoves.length > 0) {
    const randomIndex = Math.floor(Math.random() * bestMoves.length);
    return bestMoves[randomIndex];
  }

  return candidateCells[0] || null;
}

/**
 * Hitung langkah terbaik untuk Bot (Master AI)
 */
export function getBestBotMove(state: TicTacToeState): { row: number; col: number } | null {
  if (state.winner !== null) return null;

  const gridClone: (TicTacToeSymbol | null)[][] = state.grid.map((row) => [...row]);

  if (state.boardSize === 3) {
    return getBestMove3x3(gridClone);
  } else {
    return getBestMove8x8(gridClone);
  }
}
