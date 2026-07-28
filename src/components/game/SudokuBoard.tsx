"use client";

import React, { useCallback, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { isValidMove } from '../../utils/sudoku';
import { cn } from '../../utils/cn';

import toast from 'react-hot-toast';

interface SudokuBoardProps {
  broadcastMove: (row: number, col: number, value: number | null) => void;
  broadcastNote: (row: number, col: number, note: number) => void;
  broadcastCursor: (row: number, col: number) => void;
  lockCell: (row: number, col: number) => boolean | void;
  locks: Record<string, { userId: string, expiresAt: number }>;
  isPencilMode: boolean;
  isEraserMode: boolean;
}

export const SudokuBoard: React.FC<SudokuBoardProps> = ({ broadcastMove, broadcastNote, broadcastCursor, lockCell, locks, isPencilMode, isEraserMode }) => {
  const grid = useGameStore(state => state.grid);
  const selectedCell = useGameStore(state => state.selectedCell);
  const setSelectedCell = useGameStore(state => state.setSelectedCell);
  const room = useGameStore(state => state.room);
  const userId = useGameStore(state => state.userId);

  const handleCellClick = useCallback((row: number, col: number) => {
    if (!grid) return;

    const key = `${row}-${col}`;
    const currentLock = locks[key];
    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
      return;
    }

    setSelectedCell({ row, col });
    broadcastCursor(row, col);
    lockCell(row, col);
  }, [grid, locks, userId, setSelectedCell, broadcastCursor, lockCell]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('input, textarea, select, [contenteditable="true"]')) {
      return;
    }

    if (!selectedCell || !grid || !userId) return;

    const { row, col } = selectedCell;
    const cell = grid[row][col];

    const key = `${row}-${col}`;
    const currentLock = locks[key];
    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
      return;
    }

    if (e.key >= '1' && e.key <= '9') {
      const val = parseInt(e.key);
      if (!cell.isLocked) {
        if (isEraserMode && cell.value === null) {
          if (cell.notes.includes(val)) {
            broadcastNote(row, col, val);
          }
        } else if (isPencilMode && cell.value === null) {
          broadcastNote(row, col, val);
        } else {
          broadcastMove(row, col, val);
        }
      }
    } else if (e.key === 'Backspace' || e.key === 'Delete') {
      if (!cell.isLocked) {
        broadcastMove(row, col, null);
      }
    } else if (e.key === 'ArrowUp') {
      handleCellClick(Math.max(0, row - 1), col);
    } else if (e.key === 'ArrowDown') {
      handleCellClick(Math.min(8, row + 1), col);
    } else if (e.key === 'ArrowLeft') {
      handleCellClick(row, Math.max(0, col - 1));
    } else if (e.key === 'ArrowRight') {
      handleCellClick(row, Math.min(8, col + 1));
    }
  }, [selectedCell, grid, userId, locks, broadcastMove, broadcastNote, handleCellClick, isPencilMode, isEraserMode]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!grid) return null;

  return (
    <div className="w-full aspect-square max-w-[600px] border-[3px] border-foreground bg-foreground grid grid-cols-9 grid-rows-9 gap-px p-1 mx-auto rounded-md shadow-lg overflow-hidden relative select-none mt-2 mb-2">
      {grid.map((row, rIndex) => (
        row.map((cell, cIndex) => {
          const isSelected = selectedCell?.row === rIndex && selectedCell?.col === cIndex;

          // Check apakah angka sel sama dengan angka di sel yang dipencet
          let isSameValue = false;
          if (selectedCell) {
            const selectedVal = grid[selectedCell.row][selectedCell.col].value;
            isSameValue = selectedVal !== null && cell.value === selectedVal;
          }

          const lockKey = `${rIndex}-${cIndex}`;
          const currentLock = locks[lockKey];
          const isLockedByOther = currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now();
          const lockerPlayer = isLockedByOther ? room?.players[currentLock.userId] : null;

          let otherCursorPlayer = null;
          if (room && !isLockedByOther) {
            for (const p of Object.values(room.players)) {
              if (p.id !== userId && p.cursor?.row === rIndex && p.cursor?.col === cIndex) {
                otherCursorPlayer = p;
                break;
              }
            }
          }

          return (
            <div
              key={`${rIndex}-${cIndex}`}
              onClick={() => handleCellClick(rIndex, cIndex)}
              className={cn(
                "relative flex items-center justify-center text-xl font-medium sm:text-2xl cursor-pointer transition-colors duration-150 bg-background",
                {
                  "border-b-2 border-foreground": rIndex % 3 === 2 && rIndex !== 8,
                  "border-r-2 border-foreground": cIndex % 3 === 2 && cIndex !== 8,

                  // Highlight Minimalist + Indikator Merah Salah
                  "bg-secondary/40": isSelected,                        // Kotak yang langsung di-tap
                  "bg-secondary/20": isSameValue && !isSelected,       // Highlight angka kembar
                  "bg-red-500/80": cell.isConflicting || cell.isWrong, // Background JADI MERAH jika tebakan SALAH / Bentrok

                  // Warna Teks Angka (Kembali menjadi putih seperti default)
                  "text-foreground font-bold": cell.isLocked || (!cell.isLocked && (cell.isConflicting || cell.isWrong)), // Angka Asli bawaan soal atau tebakan yang salah
                  "text-foreground font-medium": !cell.isLocked && cell.value !== null && !cell.isConflicting && !cell.isWrong, // Angka pemain (Warna putih/gelap biasa)

                  "cursor-not-allowed opacity-80": isLockedByOther
                }
              )}
            >
              {cell.value !== null && (
                <span className="relative z-10 font-sans pointer-events-none transition-transform duration-75 scale-100">
                  {cell.value}
                </span>
              )}

              {/* Tampilan Catatan / Pensil */}
              {cell.value === null && cell.notes.length > 0 && (
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 p-0.5 pointer-events-none z-10">
                  {[1,2,3,4,5,6,7,8,9].map(n => (
                    <div key={n} className="flex items-center justify-center text-[9px] text-secondary/70 leading-none">
                      {cell.notes.includes(n) ? n : ''}
                    </div>
                  ))}
                </div>
              )}

              {/* Kursor / Indikator Player Lain */}
              {(otherCursorPlayer || lockerPlayer) && (
                <div
                  className="absolute inset-0 border-2 pointer-events-none z-20 transition-all duration-200"
                  style={{ borderColor: lockerPlayer ? lockerPlayer.color : otherCursorPlayer?.color }}
                />
              )}
            </div>
          );
        })
      ))}
    </div>
  );
};
