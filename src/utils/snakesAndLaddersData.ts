import { Difficulty } from '@/types/game';
import { SnakeItem, LadderItem, WormholePair, SnakesState } from '@/types/game';

export function getTileCoordinates(tile: number): { x: number; y: number } {
  const boundedTile = Math.max(1, Math.min(100, tile));
  const rowFromBottom = Math.floor((boundedTile - 1) / 10);
  const colInRow = (boundedTile - 1) % 10;

  const isLeftToRight = rowFromBottom % 2 === 0;
  const col = isLeftToRight ? colInRow : 9 - colInRow;

  const x = col * 10 + 5;
  const y = 95 - rowFromBottom * 10;

  return { x, y };
}

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getUsedTiles(
  ladders: LadderItem[],
  snakes: SnakeItem[],
  mines: number[],
  wormholes: WormholePair[]
): Set<number> {
  const used = new Set<number>([1, 100]);
  ladders.forEach((l) => {
    used.add(l.start);
    used.add(l.end);
  });
  snakes.forEach((s) => {
    used.add(s.head);
    used.add(s.tail);
  });
  mines.forEach((m) => used.add(m));
  wormholes.forEach((w) => {
    used.add(w.blackHole);
    used.add(w.whiteHole);
  });
  return used;
}

export function generateInitialSnakesState(
  difficulty: Difficulty = 'medium',
  activePlayerIds: string[] = []
): SnakesState {
  const counts = {
    easy: { ladders: 6, snakes: 4, mines: 2, wormholes: 1 },
    medium: { ladders: 6, snakes: 6, mines: 3, wormholes: 2 },
    hard: { ladders: 5, snakes: 8, mines: 5, wormholes: 2 },
    expert: { ladders: 4, snakes: 10, mines: 6, wormholes: 3 },
    evil: { ladders: 3, snakes: 12, mines: 8, wormholes: 3 },
  }[difficulty] || { ladders: 6, snakes: 6, mines: 3, wormholes: 2 };

  const ladders: LadderItem[] = [];
  const snakes: SnakeItem[] = [];
  const mines: number[] = [];
  const wormholes: WormholePair[] = [];

  // Generate Tangga
  for (let i = 0; i < counts.ladders; i++) {
    let attempts = 0;
    while (attempts++ < 100) {
      const used = getUsedTiles(ladders, snakes, mines, wormholes);
      const start = getRandomInt(2, 79);
      const end = getRandomInt(start + 11, Math.min(99, start + 35));
      if (!used.has(start) && !used.has(end) && Math.floor((start - 1) / 10) !== Math.floor((end - 1) / 10)) {
        ladders.push({ id: `ladder_${i}_${Date.now()}`, start, end });
        break;
      }
    }
  }

  // Generate Ular
  for (let i = 0; i < counts.snakes; i++) {
    let attempts = 0;
    while (attempts++ < 100) {
      const used = getUsedTiles(ladders, snakes, mines, wormholes);
      const head = getRandomInt(21, 98);
      const tail = getRandomInt(Math.max(2, head - 35), head - 11);
      if (!used.has(head) && !used.has(tail) && Math.floor((head - 1) / 10) !== Math.floor((tail - 1) / 10)) {
        snakes.push({ id: `snake_${i}_${Date.now()}`, head, tail, waveStrength: getRandomInt(2, 5) });
        break;
      }
    }
  }

  // Generate Ranjau
  for (let i = 0; i < counts.mines; i++) {
    let attempts = 0;
    while (attempts++ < 100) {
      const used = getUsedTiles(ladders, snakes, mines, wormholes);
      const tile = getRandomInt(5, 95);
      if (!used.has(tile)) {
        mines.push(tile);
        break;
      }
    }
  }

  // Generate Wormhole (Black Hole -> White Hole)
  for (let i = 0; i < counts.wormholes; i++) {
    let attempts = 0;
    while (attempts++ < 100) {
      const used = getUsedTiles(ladders, snakes, mines, wormholes);
      const bh = getRandomInt(15, 92);
      const wh = getRandomInt(5, 95);
      if (!used.has(bh) && !used.has(wh) && Math.abs(bh - wh) > 12) {
        wormholes.push({ id: `wh_${i}_${Date.now()}`, blackHole: bh, whiteHole: wh });
        break;
      }
    }
  }

  const initialPositions: Record<string, number> = {};
  activePlayerIds.forEach((pId) => {
    initialPositions[pId] = 1;
  });

  return {
    diceValue: null,
    playerPositions: initialPositions,
    currentTurnUserId: activePlayerIds[0] || null,
    winnerId: null,
    ladders,
    snakes,
    mines,
    wormholes,
    frozenTurns: {},
  };
}

// Fungsi merelokasi obstacle yang terinjak ke koordinat baru secara dinamis
export function relocateTriggeredItem(
  state: SnakesState,
  type: 'ladder' | 'snake' | 'mine' | 'wormhole',
  idOrValue: string | number
): Partial<SnakesState> {
  const ladders = [...state.ladders];
  const snakes = [...state.snakes];
  const mines = [...state.mines];
  const wormholes = [...state.wormholes];

  if (type === 'ladder') {
    const idx = ladders.findIndex((l) => l.id === idOrValue);
    if (idx !== -1) ladders.splice(idx, 1);
    const used = getUsedTiles(ladders, snakes, mines, wormholes);
    let attempts = 0;
    while (attempts++ < 100) {
      const start = getRandomInt(2, 79);
      const end = getRandomInt(start + 11, Math.min(99, start + 35));
      if (!used.has(start) && !used.has(end) && Math.floor((start - 1) / 10) !== Math.floor((end - 1) / 10)) {
        ladders.push({ id: `ladder_${Date.now()}`, start, end });
        break;
      }
    }
  } else if (type === 'snake') {
    const idx = snakes.findIndex((s) => s.id === idOrValue);
    if (idx !== -1) snakes.splice(idx, 1);
    const used = getUsedTiles(ladders, snakes, mines, wormholes);
    let attempts = 0;
    while (attempts++ < 100) {
      const head = getRandomInt(21, 98);
      const tail = getRandomInt(Math.max(2, head - 35), head - 11);
      if (!used.has(head) && !used.has(tail) && Math.floor((head - 1) / 10) !== Math.floor((tail - 1) / 10)) {
        snakes.push({ id: `snake_${Date.now()}`, head, tail, waveStrength: getRandomInt(2, 5) });
        break;
      }
    }
  } else if (type === 'mine') {
    const idx = mines.indexOf(Number(idOrValue));
    if (idx !== -1) mines.splice(idx, 1);
    const used = getUsedTiles(ladders, snakes, mines, wormholes);
    let attempts = 0;
    while (attempts++ < 100) {
      const tile = getRandomInt(5, 95);
      if (!used.has(tile)) {
        mines.push(tile);
        break;
      }
    }
  } else if (type === 'wormhole') {
    const idx = wormholes.findIndex((w) => w.id === idOrValue);
    if (idx !== -1) wormholes.splice(idx, 1);
    const used = getUsedTiles(ladders, snakes, mines, wormholes);
    let attempts = 0;
    while (attempts++ < 100) {
      const bh = getRandomInt(15, 92);
      const wh = getRandomInt(5, 95);
      if (!used.has(bh) && !used.has(wh) && Math.abs(bh - wh) > 12) {
        wormholes.push({ id: `wh_${Date.now()}`, blackHole: bh, whiteHole: wh });
        break;
      }
    }
  }

  return { ladders, snakes, mines, wormholes };
}
