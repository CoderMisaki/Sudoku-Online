"use client";

import React, { useCallback, useEffect } from 'react';
import { useGameStore } from '../../store/gameStore';
import { cn } from '../../utils/cn';
import toast from 'react-hot-toast';

interface SudokuBoardProps {
  broadcastMove: (row: number, col: number, value: number | null) => void;
  broadcastNote: (row: number, col: number, note: number) => void;
  broadcastCursor: (row: number, col: number) => void;
  lockCell: (row: number, col: number) => boolean | void;
  locks: Record<string, { userId: string; expiresAt: number }>;
  isPencilMode: boolean;
  isEraserMode: boolean;
}

export const SudokuBoard: React.FC<SudokuBoardProps> = ({
  broadcastMove,
  broadcastNote,
  broadcastCursor,
  lockCell,
  locks,
  isPencilMode,
  isEraserMode,
}) => {
  const grid = useGameStore((state) => state.grid);
  const selectedCell = useGameStore((state) => state.selectedCell);
  const setSelectedCell = useGameStore((state) => state.setSelectedCell);
  const room = useGameStore((state) => state.room);
  const userId = useGameStore((state) => state.userId);

  const isCompetition = room?.mode === 'competition';

  const stunEnd = (room?.mode === 'race' && userId && room?.players[userId]?.stunnedUntil) || 0;

  const [isStunned, setIsStunned] = React.useState(false);

  useEffect(() => {
    const handleCheck = () => {
      setIsStunned(stunEnd > Date.now());
    };

    handleCheck();

    if (stunEnd > Date.now()) {
      const timeout = setTimeout(handleCheck, stunEnd - Date.now());
      return () => clearTimeout(timeout);
    }
  }, [stunEnd]);

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (!grid) return;

      if (room?.mode === 'race' && userId) {
        if (isStunned) {
          return;
        }
      }

      if (!isCompetition) {
        const key = `${row}-${col}`;
        const currentLock = locks[key];
        if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
          return;
        }
      }

      setSelectedCell({ row, col });
      if (!isCompetition) {
        broadcastCursor(row, col);
        lockCell(row, col);
      }
    },
    [grid, locks, userId, setSelectedCell, broadcastCursor, lockCell, isCompetition, room?.mode, isStunned]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!grid || !userId) return;

      // Navigasi: panah + WASD (PC). Mobile/tab memakai joystick/D-pad (lihat room page).
      const navDir =
        e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W' ? 'up'
        : e.key === 'ArrowDown' || e.key === 's' || e.key === 'S' ? 'down'
        : e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A' ? 'left'
        : e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D' ? 'right'
        : null;
      if (navDir) {
        if (e.key.startsWith('Arrow')) e.preventDefault();
        const current = selectedCell || { row: 0, col: 0 };
        let newRow = current.row;
        let newCol = current.col;
        if (navDir === 'up') newRow = Math.max(0, current.row - 1);
        if (navDir === 'down') newRow = Math.min(8, current.row + 1);
        if (navDir === 'left') newCol = Math.max(0, current.col - 1);
        if (navDir === 'right') newCol = Math.min(8, current.col + 1);
        handleCellClick(newRow, newCol);
        return;
      }

      if (!selectedCell) return;

      if (room?.mode === 'race' && userId) {
        if (isStunned) return;
      }

      const { row, col } = selectedCell;
      const cell = grid[row][col];

      if (!isCompetition) {
        const key = `${row}-${col}`;
        const currentLock = locks[key];
        if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
          return;
        }
      }

      const isFixed = Boolean(cell.isLocked || cell.isCorrect);

      if (isFixed) {
        if (e.key >= '1' && e.key <= '9') {
          toast('Jawaban sudah benar', { icon: '✅', id: 'cell-correct' });
        }
        return;
      }

      if (e.key >= '1' && e.key <= '9') {
        const val = parseInt(e.key);
        if (isEraserMode && cell.value === null) {
          if (cell.notes.includes(val)) broadcastNote(row, col, val);
        } else if (isPencilMode && cell.value === null) {
          broadcastNote(row, col, val);
        } else {
          broadcastMove(row, col, val);
        }
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        broadcastMove(row, col, null);
      }
    },
    [selectedCell, grid, userId, locks, broadcastMove, broadcastNote, handleCellClick, isPencilMode, isEraserMode, isCompetition, room?.mode, isStunned]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (!grid) return null;

  return (
    <div
      className={cn(
        "w-full aspect-square max-w-[600px] border-[3px] border-foreground bg-foreground grid grid-cols-9 grid-rows-9 gap-px p-1 mx-auto rounded-md shadow-lg overflow-hidden relative select-none mt-2 mb-2 transition-all duration-300",
        { "opacity-50 grayscale": isStunned }
      )}
    >
      {grid.map((row, rIndex) =>
        row.map((cell, cIndex) => {
          const isSelected = selectedCell?.row === rIndex && selectedCell?.col === cIndex;
          const isError = cell.isWrong || (cell.isConflicting && room?.mode !== 'zen');
          const isFixed = Boolean(cell.isLocked || cell.isCorrect);

          let isSameValue = false;
          if (selectedCell) {
            const selectedVal = grid[selectedCell.row][selectedCell.col]?.value;
            isSameValue = selectedVal !== null && selectedVal !== undefined && cell.value === selectedVal;
          }

          const lockKey = `${rIndex}-${cIndex}`;
          const currentLock = isCompetition ? null : locks[lockKey];
          const isLockedByOther = !isCompetition && currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now();
          const lockerPlayer = isLockedByOther ? room?.players[currentLock.userId] : null;

          const shouldBlinkWrong = room?.mode === 'collaborative' && Boolean(cell.isWrong) && cell.value !== null;

          let otherCursorPlayer = null;
          if (room && !isLockedByOther && !isCompetition) {
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
                  "bg-secondary/40": isSelected && !isError,
                  "bg-red-500/20": isError && !isSelected,
                  "ring-2 ring-pink-400 ring-inset": isSameValue && !isSelected,
                  "ring-2 ring-white ring-inset": isSameValue && isSelected,
                  "text-red-500 font-black": isError,
                  "text-foreground font-bold": !isError && isFixed,
                  "text-foreground font-semibold": !isError && !isFixed,
                  "cursor-not-allowed opacity-80": isLockedByOther
                }
              )}
            >
              {cell.value !== null && (
                <span className={cn("relative z-10 font-sans pointer-events-none transition-transform duration-75 scale-100", cell.isPending && "opacity-75 animate-pulse", shouldBlinkWrong && "animate-collab-wrong")}>
                  {cell.value}
                </span>
              )}

              {cell.value === null && cell.notes.length > 0 && (
                <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 p-0.5 pointer-events-none z-10">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <div
                      key={n}
                      className={cn(
                        "flex items-center justify-center text-[10px] sm:text-[11px] leading-none select-none transition-colors duration-150 font-bold",
                        isSelected
                          ? "text-foreground font-black"
                          : "text-foreground/90 dark:text-gray-100"
                      )}
                    >
                      {cell.notes.includes(n) ? n : ''}
                    </div>
                  ))}
                </div>
              )}

              {(otherCursorPlayer || lockerPlayer) && (
                <div
                  className="absolute inset-0 border-2 pointer-events-none z-20 transition-all duration-200"
                  style={{ borderColor: lockerPlayer ? lockerPlayer.color : otherCursorPlayer?.color }}
                />
              )}
            </div>
          );
        })
      )}
    </div>
  );
};
