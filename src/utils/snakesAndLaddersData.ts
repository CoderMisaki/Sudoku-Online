import { Difficulty } from '@/types/game';

export interface SnakeItem {
  id: string;
  head: number;
  tail: number;
  waveStrength: number;
}

export interface LadderItem {
  id: string;
  start: number;
  end: number;
}

export interface BoardConfig {
  snakes: SnakeItem[];
  ladders: LadderItem[];
  map: Record<number, number>;
}

// Menghitung koordinat X dan Y (persentase 0 - 100) berdasarkan pola Boustrophedon
export function getTileCoordinates(tileNumber: number): { x: number; y: number } {
  if (tileNumber < 1) tileNumber = 1;
  if (tileNumber > 100) tileNumber = 100;

  const zeroIndexed = tileNumber - 1;
  const rowFromBottom = Math.floor(zeroIndexed / 10);
  const rowFromTop = 9 - rowFromBottom;
  const colInRow = zeroIndexed % 10;

  let col: number;
  if (rowFromBottom % 2 === 0) {
    col = colInRow; // Kiri ke Kanan
  } else {
    col = 9 - colInRow; // Kanan ke Kiri
  }

  return {
    x: col * 10 + 5,
    y: rowFromTop * 10 + 5,
  };
}

// Konfigurasi Tangga dan Ular Berdasarkan Tingkat Kesulitan
export function generateSnakesAndLaddersByDifficulty(difficulty: Difficulty = 'medium'): BoardConfig {
  let laddersRaw: [number, number][] = [];
  let snakesRaw: [number, number][] = [];

  switch (difficulty) {
    case 'easy':
      laddersRaw = [
        [4, 25], [13, 46], [33, 70], [42, 63],
        [50, 78], [62, 85], [74, 95], [80, 99]
      ];
      snakesRaw = [
        [37, 18], [64, 45], [89, 71], [96, 84]
      ];
      break;

    case 'hard':
      laddersRaw = [
        [9, 27], [36, 55], [51, 67], [72, 91]
      ];
      snakesRaw = [
        [44, 16], [58, 22], [69, 31], [83, 40],
        [92, 53], [95, 73], [98, 48], [76, 29]
      ];
      break;

    case 'expert':
      laddersRaw = [
        [15, 34], [48, 65], [68, 86]
      ];
      snakesRaw = [
        [47, 12], [61, 23], [73, 19], [84, 38],
        [89, 52], [93, 33], [97, 60], [99, 41], [54, 21]
      ];
      break;

    case 'evil':
      laddersRaw = [
        [18, 37], [56, 75]
      ];
      snakesRaw = [
        [32, 7], [49, 11], [62, 19], [75, 28],
        [82, 39], [88, 24], [94, 43], [96, 35],
        [98, 14], [99, 10], [70, 26]
      ];
      break;

    case 'medium':
    default:
      laddersRaw = [
        [6, 26], [19, 43], [38, 60],
        [53, 76], [67, 88], [77, 97]
      ];
      snakesRaw = [
        [46, 17], [59, 37], [71, 32],
        [83, 45], [92, 68], [98, 55]
      ];
      break;
  }

  const map: Record<number, number> = {};

  const ladders: LadderItem[] = laddersRaw.map(([start, end], idx) => {
    map[start] = end;
    return { id: `ladder-${idx}`, start, end };
  });

  const snakes: SnakeItem[] = snakesRaw.map(([head, tail], idx) => {
    map[head] = tail;
    return {
      id: `snake-${idx}`,
      head,
      tail,
      waveStrength: (idx % 2 === 0 ? 1 : -1) * (6 + (idx % 4) * 2),
    };
  });

  return { snakes, ladders, map };
}
