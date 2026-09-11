import { SosState, SosLetter, SosCell, SosLine, Player, SosPlayerInfo } from '../types/game';

export const SOS_BOT_USER_ID = 'sos-bot-player';
export const SOS_BOT_NAME = 'BOT (Master AI)';
export const SOS_BOARD_SIZE = 8;

const DIRS = [
  { dr: 0, dc: 1 }, // horizontal
  { dr: 1, dc: 0 }, // vertikal
  { dr: 1, dc: 1 }, // diagonal "\"
  { dr: 1, dc: -1 }, // diagonal "/"
] as const;

export function createEmptySosGrid(): SosCell[][] {
  return Array.from({ length: SOS_BOARD_SIZE }, () =>
    Array.from({ length: SOS_BOARD_SIZE }, () => ({ letter: null, byUserId: null }))
  );
}

/**
 * State awal SOS 8x8. Pemain 1 (host) jalan duluan.
 */
export function createInitialSosState(activePlayers: Player[], hostId: string): SosState {
  const hostPlayer = activePlayers.find((p) => p.id === hostId) || activePlayers[0];
  const secondPlayer = activePlayers.find((p) => p.id !== (hostPlayer?.id || ''));

  const isAgainstBot = !secondPlayer;

  const player1: SosPlayerInfo = {
    id: hostPlayer ? hostPlayer.id : 'host',
    username: hostPlayer ? hostPlayer.username || 'Pemain 1' : 'Pemain 1',
    color: hostPlayer?.color || '#3b82f6',
    avatar: hostPlayer?.avatar || null,
    isBot: false,
    letter: 'S',
  };

  const player2: SosPlayerInfo = secondPlayer
    ? {
        id: secondPlayer.id,
        username: secondPlayer.username || 'Pemain 2',
        color: secondPlayer.color || '#ef4444',
        avatar: secondPlayer.avatar || null,
        isBot: false,
        letter: 'O',
      }
    : {
        id: SOS_BOT_USER_ID,
        username: SOS_BOT_NAME,
        color: '#10b981',
        avatar: null,
        isBot: true,
        letter: 'O',
      };

  return {
    boardId: Math.random().toString(36).substring(2, 9),
    boardSize: 8,
    grid: createEmptySosGrid(),
    scores: { [player1.id]: 0, [player2.id]: 0 },
    currentTurnUserId: player1.id,
    selectedLetter: 'S',
    lines: [],
    winner: null,
    isAgainstBot,
    player1,
    player2,
    revision: 1,
    lastMove: null,
  };
}

/** Kunci unik sebuah garis pola (urutan sel dinormalisasi). */
function lineKey(cells: { row: number; col: number }[]): string {
  const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
  return sorted.map((c) => `${c.row},${c.col}`).join('|');
}

/**
 * Cari semua pola S-O-S BARU yang melibatkan sel (row, col) yang baru diisi.
 * Pola sah: 3 sel segaris (horizontal/vertikal/diagonal) berisi S-O-S.
 */
export function findNewSosLines(
  grid: SosCell[][],
  row: number,
  col: number,
  existingKeys: Set<string>
): SosLine['cells'][] {
  const size = grid.length;
  const letterAt = (r: number, c: number): SosLetter | null => {
    if (r < 0 || r >= size || c < 0 || c >= size) return null;
    return grid[r][c].letter;
  };

  const found: SosLine['cells'][] = [];

  // Untuk tiap arah, sel baru bisa berada di posisi 0, 1, atau 2 dari pola.
  for (const { dr, dc } of DIRS) {
    for (let offset = 0; offset < 3; offset++) {
      const cells = [0, 1, 2].map((i) => ({
        row: row + dr * (i - offset),
        col: col + dc * (i - offset),
      }));
      const l0 = cells[0].row >= 0 && cells[0].row < size && cells[0].col >= 0 && cells[0].col < size
        ? letterAt(cells[0].row, cells[0].col)
        : null;
      const l1 = letterAt(cells[1].row, cells[1].col);
      const l2 = cells[2].row >= 0 && cells[2].row < size && cells[2].col >= 0 && cells[2].col < size
        ? letterAt(cells[2].row, cells[2].col)
        : null;
      if (l0 === 'S' && l1 === 'O' && l2 === 'S') {
        const key = lineKey(cells);
        if (!existingKeys.has(key)) {
          existingKeys.add(key);
          found.push(cells as SosLine['cells']);
        }
      }
    }
  }

  return found;
}

/** Apakah papan sudah penuh (game selesai)? */
export function isSosBoardFull(grid: SosCell[][]): boolean {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (!grid[r][c].letter) return false;
    }
  }
  return true;
}

/**
 * Terapkan satu langkah SOS: taruh `letter` di (row, col) oleh `userId`.
 * Mengembalikan state baru (immutable) + jumlah poin yang didapat.
 * Aturan: dapat poin -> jalan lagi (giliran tidak pindah).
 */
export function applySosMove(
  state: SosState,
  row: number,
  col: number,
  letter: SosLetter,
  userId: string
): { next: SosState; points: number } {
  const nextGrid = state.grid.map((r, rIdx) =>
    r.map((cell, cIdx) => (rIdx === row && cIdx === col ? { letter, byUserId: userId } : { ...cell }))
  );

  const existingKeys = new Set(state.lines.map((l) => lineKey(l.cells as unknown as { row: number; col: number }[])));
  const newLines = findNewSosLines(nextGrid, row, col, existingKeys);
  const points = newLines.length;

  const nextScores = { ...state.scores };
  nextScores[userId] = (nextScores[userId] || 0) + points;

  const nextLines: SosLine[] = [
    ...state.lines,
    ...newLines.map((cells) => ({ cells, byUserId: userId })),
  ];

  const full = isSosBoardFull(nextGrid);
  let winner: SosState['winner'] = null;
  if (full) {
    const s1 = nextScores[state.player1.id] || 0;
    const s2 = nextScores[state.player2.id] || 0;
    winner = s1 === s2 ? 'draw' : s1 > s2 ? state.player1.id : state.player2.id;
  }

  // Dapat poin -> giliran ekstra (tetap). Tidak dapat poin -> pindah.
  const scored = points > 0;
  const nextTurnUserId = scored || winner !== null
    ? state.currentTurnUserId
    : state.currentTurnUserId === state.player1.id
    ? state.player2.id
    : state.player1.id;

  const next: SosState = {
    ...state,
    grid: nextGrid,
    scores: nextScores,
    lines: nextLines,
    currentTurnUserId: nextTurnUserId,
    winner,
    lastMove: { row, col, letter, userId, points, timestamp: Date.now() },
    revision: (state.revision ?? 0) + 1,
  };

  return { next, points };
}

// ─────────────────────────────────────────────────────────────────────────────
// BOT AI — greedy: pilih langkah dengan poin instan terbanyak
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Evaluasi berapa pola baru yang tercipta jika `letter` ditaruh di (row, col).
 */
function countPotentialLines(grid: SosCell[][], row: number, col: number, letter: SosLetter, existingKeys: Set<string>): number {
  const testGrid = grid.map((r, rIdx) =>
    r.map((cell, cIdx) => (rIdx === row && cIdx === col ? { letter, byUserId: 'bot-eval' } : cell))
  );
  return findNewSosLines(testGrid, row, col, new Set(existingKeys)).length;
}

export function getBestSosBotMove(state: SosState): { row: number; col: number; letter: SosLetter } | null {
  const size = state.grid.length;
  const existingKeys = new Set(state.lines.map((l) => lineKey(l.cells as unknown as { row: number; col: number }[])));

  let bestScore = -Infinity;
  let bestMoves: { row: number; col: number; letter: SosLetter }[] = [];

  // Pusat papan sedikit diprioritaskan saat belum ada pola (lebih banyak peluang diagonal).
  const centerBonus = (r: number, c: number) => {
    const d = Math.abs(r - 3.5) + Math.abs(c - 3.5);
    return Math.max(0, 3 - d) * 0.1;
  };

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (state.grid[r][c].letter) continue;
      for (const letter of ['S', 'O'] as SosLetter[]) {
        const immediate = countPotentialLines(state.grid, r, c, letter, existingKeys);
        // Bot agresif: kejar poin instan. Bonus kecil untuk S di awal
        // (membuka peluang pola) & posisi tengah.
        let score = immediate * 10 + centerBonus(r, c);
        if (immediate === 0 && letter === 'S') score += 0.4;
        // Jangan memberi lawan pola gratis: hindari melengkapi "S-O" terbuka
        // dengan O yang memudahkan... (heuristik ringan: O di tengah dua S kosong
        // memberi lawan peluang — kurangi sedikit).
        if (immediate === 0 && letter === 'O') score -= 0.2;

        if (score > bestScore + 1e-9) {
          bestScore = score;
          bestMoves = [{ row: r, col: c, letter }];
        } else if (Math.abs(score - bestScore) < 1e-9) {
          bestMoves.push({ row: r, col: c, letter });
        }
      }
    }
  }

  if (bestMoves.length === 0) return null;
  return bestMoves[Math.floor(Math.random() * bestMoves.length)];
}
