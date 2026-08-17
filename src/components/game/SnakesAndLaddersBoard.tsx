"use client";

import React, { useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { Dices, Trophy } from 'lucide-react';
import { SNAKES_AND_LADDERS_MAP } from '@/utils/snakesAndLaddersData';

interface SnakesAndLaddersBoardProps {
  broadcastSnakesDiceRoll: (diceValue: number, newPosition: number, nextTurnUserId: string, hasWon: boolean) => void;
}

export const SnakesAndLaddersBoard: React.FC<SnakesAndLaddersBoardProps> = ({ broadcastSnakesDiceRoll }) => {
  const userId = useGameStore(state => state.userId);
  const room = useGameStore(state => state.room);
  const players = room?.players || {};
  const snakesState = useGameStore(state => state.snakesState);

  // State lokal untuk animasi lempar dadu
  const [localDiceRoll, setLocalDiceRoll] = useState<number | null>(null);
  const [isRollingLocal, setIsRollingLocal] = useState(false);

  // Jika state global belum siap, fallback
  const positions = snakesState?.playerPositions || {};
  const isMyTurn = snakesState?.currentTurnUserId === userId;
  const isGameOver = !!snakesState?.winnerId;

  const handleRollDice = () => {
    if (!isMyTurn || isRollingLocal || isGameOver) return;

    setIsRollingLocal(true);

    // Animasi rolling acak (lokal)
    let rollCounter = 0;
    const rollInterval = setInterval(() => {
        setLocalDiceRoll(Math.floor(Math.random() * 6) + 1);
        rollCounter++;
        if (rollCounter > 10) {
            clearInterval(rollInterval);

            // Tentukan hasil akhir
            const finalRoll = Math.floor(Math.random() * 6) + 1;
            setLocalDiceRoll(finalRoll);

            setTimeout(() => {
              setIsRollingLocal(false);

              const currentPos = positions[userId || ''] || 1;
              let targetPos = currentPos + finalRoll;
              let hasWon = false;

              if (targetPos > 100) {
                targetPos = 100 - (targetPos - 100); // Bounce back
              } else if (targetPos === 100) {
                hasWon = true;
              }

              // Cek apakah menginjak ular atau tangga
              if (SNAKES_AND_LADDERS_MAP[targetPos]) {
                targetPos = SNAKES_AND_LADDERS_MAP[targetPos];
              }

              // Tentukan giliran berikutnya
              let nextTurnUserId = snakesState?.currentTurnUserId || '';
              if (finalRoll !== 6 && snakesState && snakesState.turnOrder.length > 0) {
                 const currentIndex = snakesState.turnOrder.indexOf(userId || '');
                 const nextIndex = (currentIndex + 1) % snakesState.turnOrder.length;
                 nextTurnUserId = snakesState.turnOrder[nextIndex];
              }

              // Broadcast
              broadcastSnakesDiceRoll(finalRoll, targetPos, nextTurnUserId, hasWon);

              // Update local state optimisticly
              useGameStore.getState().updateSnakesState({
                  diceValue: finalRoll,
                  playerPositions: {
                    ...positions,
                    [userId || '']: targetPos
                  },
                  currentTurnUserId: nextTurnUserId,
                  winnerId: hasWon ? userId : null
              });

            }, 500); // Delay singkat sebelum broadcast
        }
    }, 50);
  };

  const currentDiceValue = isRollingLocal ? localDiceRoll : (snakesState?.diceValue ?? '-');
  const isRolling = isRollingLocal || snakesState?.isRolling;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl mx-auto py-8">
       {isGameOver && (
          <div className="bg-yellow-500/20 text-yellow-500 border border-yellow-500/50 p-4 rounded-xl flex items-center gap-3 w-full justify-center">
             <Trophy className="w-6 h-6" />
             <span className="font-bold text-lg">{players[snakesState.winnerId!]?.username} Menang!</span>
          </div>
       )}

      {/* Board 10x10 Matrix */}
      <div className="grid grid-cols-10 grid-rows-10 w-full aspect-square border-4 border-foreground rounded-2xl bg-card shadow-2xl p-2 gap-1 relative overflow-hidden">
        {Array.from({ length: 100 }, (_, i) => {
          // Boustrophedon numbering
          const row = Math.floor(i / 10);
          const col = i % 10;

          let tileNumber = 0;
          if (row % 2 === 0) {
             tileNumber = 100 - (row * 10) - col; // Kanan ke kiri
          } else {
             tileNumber = 100 - (row * 10) - (9 - col); // Kiri ke kanan
          }

          const isSnakeHead = [17, 54, 62, 64, 87, 93, 95, 99].includes(tileNumber);
          const isLadderBase = [4, 9, 20, 28, 40, 51, 63, 71].includes(tileNumber);

          return (
            <div
              key={tileNumber}
              className={`relative flex items-center justify-center rounded-lg border text-xs sm:text-sm font-bold border-border/40 ${
                tileNumber % 2 === 0 ? 'bg-secondary/5' : 'bg-background'
              }`}
            >
              <span className="absolute top-1 left-1 text-[9px] text-secondary/60">
                {tileNumber}
              </span>

              {isSnakeHead && <span className="text-base sm:text-xl">🐍</span>}
              {isLadderBase && <span className="text-base sm:text-xl">🪜</span>}

              {/* Render Bidak Pemain */}
              <div className="flex gap-1 items-center justify-center flex-wrap z-10 w-full h-full p-1">
                {Object.entries(positions).map(([pId, pos]) => {
                  if (pos === tileNumber) {
                    const p = players[pId];
                    if (!p || p.isSpectator || p.status === 'left') return null;
                    return (
                      <div
                        key={pId}
                        className="w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-white shadow-md transition-all duration-500 ease-in-out"
                        style={{ backgroundColor: p?.color || '#3b82f6' }}
                        title={p?.username || 'Player'}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Kontrol Lempar Dadu & Info Giliran */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-2xl border border-border shadow-md w-full justify-between">

        <div className="flex items-center gap-3">
           <div className="text-center font-mono w-16">
             <div className="text-xs text-secondary mb-1">Dadu</div>
             <div className="text-3xl font-black">{currentDiceValue}</div>
           </div>

           <div className="border-l border-border h-12 mx-2"></div>

           <div className="flex flex-col">
              <span className="text-xs text-secondary mb-1">Giliran:</span>
              <div className="flex items-center gap-2">
                 <div
                   className="w-3 h-3 rounded-full"
                   style={{ backgroundColor: players[snakesState?.currentTurnUserId || '']?.color || '#3b82f6' }}
                 />
                 <span className="font-semibold truncate max-w-[150px]">
                   {players[snakesState?.currentTurnUserId || '']?.username || 'Menunggu...'}
                   {isMyTurn ? ' (Kamu)' : ''}
                 </span>
              </div>
           </div>
        </div>

        <Button
          size="lg"
          onClick={handleRollDice}
          disabled={!isMyTurn || isRolling || isGameOver}
          className="px-6 gap-2 w-full sm:w-auto"
        >
          <Dices className={`w-5 h-5 ${isRolling ? 'animate-spin' : ''}`} />
          {isRolling ? 'Mengocok...' : 'Lempar Dadu'}
        </Button>
      </div>
    </div>
  );
};
