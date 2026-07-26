import { getSudoku } from 'sudoku-gen';
import { Difficulty, Grid } from '../types/game';

// sudoku-gen difficulties: 'easy', 'medium', 'hard', 'expert'
// we map 'evil' to 'expert' as it's the highest sudoku-gen supports natively
const mapDifficulty = (diff: Difficulty): 'easy' | 'medium' | 'hard' | 'expert' => {
  if (diff === 'evil') return 'expert';
  return diff;
};

export const generatePuzzle = (difficulty: Difficulty) => {
  const diff = mapDifficulty(difficulty);
  const sudoku = getSudoku(diff);

  const puzzle = sudoku.puzzle;
  const solution = sudoku.solution;

  const initialGrid: Grid = Array(9).fill(null).map((_, row) =>
    Array(9).fill(null).map((_, col) => {
      const char = puzzle[row * 9 + col];
      const value = char === '-' ? null : parseInt(char, 10);
      return {
        value,
        isLocked: value !== null,
        notes: [],
      };
    })
  );

  const solutionGrid: number[][] = Array(9).fill(null).map((_, row) =>
    Array(9).fill(null).map((_, col) => parseInt(solution[row * 9 + col], 10))
  );

  return { initialGrid, solutionGrid };
};

export const checkConflicts = (grid: Grid): Grid => {
  const newGrid = grid.map(row => row.map(cell => ({ ...cell, isConflicting: false })));

  // Check rows
  for (let r = 0; r < 9; r++) {
    const seen = new Map<number, number[]>(); // value -> array of col indices
    for (let c = 0; c < 9; c++) {
      const val = newGrid[r][c].value;
      if (val !== null) {
        if (!seen.has(val)) seen.set(val, []);
        seen.get(val)!.push(c);
      }
    }
    seen.forEach(cols => {
      if (cols.length > 1) {
        cols.forEach(c => newGrid[r][c].isConflicting = true);
      }
    });
  }

  // Check cols
  for (let c = 0; c < 9; c++) {
    const seen = new Map<number, number[]>(); // value -> array of row indices
    for (let r = 0; r < 9; r++) {
      const val = newGrid[r][c].value;
      if (val !== null) {
        if (!seen.has(val)) seen.set(val, []);
        seen.get(val)!.push(r);
      }
    }
    seen.forEach(rows => {
      if (rows.length > 1) {
        rows.forEach(r => newGrid[r][c].isConflicting = true);
      }
    });
  }

  // Check 3x3 boxes
  for (let boxR = 0; boxR < 3; boxR++) {
    for (let boxC = 0; boxC < 3; boxC++) {
      const seen = new Map<number, {r: number, c: number}[]>();
      for (let r = 0; r < 3; r++) {
        for (let c = 0; c < 3; c++) {
          const actR = boxR * 3 + r;
          const actC = boxC * 3 + c;
          const val = newGrid[actR][actC].value;
          if (val !== null) {
            if (!seen.has(val)) seen.set(val, []);
            seen.get(val)!.push({r: actR, c: actC});
          }
        }
      }
      seen.forEach(cells => {
        if (cells.length > 1) {
          cells.forEach(({r, c}) => newGrid[r][c].isConflicting = true);
        }
      });
    }
  }

  return newGrid;
};

export const isValidMove = (grid: Grid, r: number, c: number, value: number) => {
  // Cek baris (horizontal)
  for (let i = 0; i < 9; i++) {
    if (i !== c && grid[r][i].value === value) return false;
  }
  // Cek kolom (vertikal)
  for (let i = 0; i < 9; i++) {
    if (i !== r && grid[i][c].value === value) return false;
  }
  // Cek 3x3 blok
  const boxR = Math.floor(r / 3) * 3;
  const boxC = Math.floor(c / 3) * 3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if ((boxR + i !== r || boxC + j !== c) && grid[boxR + i][boxC + j].value === value) {
        return false;
      }
    }
  }
  return true;
};
