"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { Dices, Trophy, ArrowUpRight, ArrowDownRight } from 'lucide-react';
import {
  generateRandomSnakesAndLadders,
  getTileCoordinates,
} from '@/utils/snakesAndLaddersData';
import toast from 'react-hot-toast';

interface SnakesAndLaddersBoardProps {
  broadcastSnakesDiceRoll: (diceValue: number, newPosition: number, nextTurnUserId: string, hasWon: boolean) => void;
}

export const SnakesAndLaddersBoard: React.FC<SnakesAndLaddersBoardProps> = ({ broadcastSnakesDiceRoll }) => {
  const userId = useGameStore(state => state.userId);
  const room = useGameStore(state => state.room);
  const players = useMemo(() => room?.players || {}, [room?.players]);
  const snakesState = useGameStore(state => state.snakesState);

  // Susunan ular & tangga
  const config = useMemo(() => {
    return generateRandomSnakesAndLadders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.startedAt]);

  const activePlayerIds = useMemo(() => {
    return Object.values(players)
      .filter(p => !p.isSpectator && p.status !== 'left')
      .map(p => p.id);
  }, [players]);

  const [localDiceRoll, setLocalDiceRoll] = useState<number | null>(null);
  const [isRollingLocal, setIsRollingLocal] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // State posisi visual animasi per-player
  const [visualPositions, setVisualPositions] = useState<Record<string, number>>({});
  const isAnimatingRef = useRef(false);

  const serverPositions = useMemo(() => snakesState?.playerPositions || {}, [snakesState?.playerPositions]);

  // Fungsi Animasi Berjalan Per-Kotak, Naik Tangga, & Ditelan Ular
  const animatePath = async (
    targetUserId: string,
    startPos: number,
    finalDest: number,
    onComplete?: () => void
  ) => {
    isAnimatingRef.current = true;
    const pName = players[targetUserId]?.username || 'Pemain';

    // 1. Tentukan langkah maju satu per satu
    const current = startPos;
    const forwardSteps: number[] = [];

    if (startPos < finalDest) {
      // Cek apakah ada loncatan tangga/ular
      let isLadder = false;
      let isSnake = false;

      // Cari titik injakan awal sebelum tangga / ular
      let stepTarget = finalDest;
      for (const ladder of config.ladders) {
        if (ladder.end === finalDest) {
          stepTarget = ladder.start;
          isLadder = true;
          break;
        }
      }
      for (const snake of config.snakes) {
        if (snake.tail === finalDest) {
          stepTarget = snake.head;
          isSnake = true;
          break;
        }
      }

      // Animasi langkah biasa satu demi satu
      let temp = current;
      if (stepTarget >= temp) {
        while (temp < stepTarget) {
          temp++;
          forwardSteps.push(temp);
        }
      } else {
        while (temp > stepTarget) {
          temp--;
          forwardSteps.push(temp);
        }
      }

      for (const step of forwardSteps) {
        setVisualPositions(prev => ({ ...prev, [targetUserId]: step }));
        await new Promise(res => setTimeout(res, 220)); // Delay per kotak
      }

      // 2. Jika Naik Tangga
      if (isLadder) {
        setActionStatus(`🪜 ${pName} memanjat tangga ke kotak ${finalDest}!`);
        await new Promise(res => setTimeout(res, 350));
        setVisualPositions(prev => ({ ...prev, [targetUserId]: finalDest }));
        await new Promise(res => setTimeout(res, 600));
        setActionStatus(null);
      }
      // 3. Jika Ditelan Ular
      else if (isSnake) {
        setActionStatus(`🐍 ${pName} ditelan ular meluncur ke kotak ${finalDest}!`);
        await new Promise(res => setTimeout(res, 350));
        setVisualPositions(prev => ({ ...prev, [targetUserId]: finalDest }));
        await new Promise(res => setTimeout(res, 600));
        setActionStatus(null);
      }
    } else {
      // Gerakan mundur (pantulan jika > 100 atau turun)
      setVisualPositions(prev => ({ ...prev, [targetUserId]: finalDest }));
    }

    isAnimatingRef.current = false;
    if (onComplete) onComplete();
  };

  // Sinkronisasi posisi awal jika belum terdaftar
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisualPositions(prev => {
      const updated = { ...prev };
      let changed = false;
      Object.keys(players).forEach(pId => {
        if (updated[pId] === undefined) {
          updated[pId] = serverPositions[pId] || 1;
          changed = true;
        }
      });
      return changed ? updated : prev;
    });
  }, [players, serverPositions]);

  // Handle animasi perpindahan jika ada broadcast posisi dari player lain
  useEffect(() => {
    if (isAnimatingRef.current) return;

    Object.entries(serverPositions).forEach(([pId, targetPos]) => {
      const currentPos = visualPositions[pId] || 1;
      if (currentPos !== targetPos && !isAnimatingRef.current) {
        animatePath(pId, currentPos, targetPos);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverPositions]);

  const isSolo = activePlayerIds.length <= 1;
  const currentTurn = snakesState?.currentTurnUserId || (isSolo ? userId : activePlayerIds[0]);
  const isMyTurn = currentTurn === userId;
  const isGameOver = !!snakesState?.winnerId;



  const handleRollDice = () => {
    if (!isMyTurn || isRollingLocal || isGameOver || !userId || isAnimatingRef.current) return;

    setIsRollingLocal(true);

    let rollCounter = 0;
    const rollInterval = setInterval(() => {
      setLocalDiceRoll(Math.floor(Math.random() * 6) + 1);
      rollCounter++;

      if (rollCounter > 8) {
        clearInterval(rollInterval);

        const finalRoll = Math.floor(Math.random() * 6) + 1;
        setLocalDiceRoll(finalRoll);

        setTimeout(() => {
          setIsRollingLocal(false);

          const currentPos = visualPositions[userId] || serverPositions[userId] || 1;
          let targetPos = currentPos + finalRoll;
          let hasWon = false;

          // Logika pantul 100
          if (targetPos > 100) {
            targetPos = 100 - (targetPos - 100);
          } else if (targetPos === 100) {
            hasWon = true;
          }

          // Cek Tangga atau Ular
          if (config.map[targetPos]) {
            targetPos = config.map[targetPos];
          }

          // Giliran selanjutnya
          let nextTurnUserId = userId;
          if (activePlayerIds.length > 1) {
            if (finalRoll !== 6) {
              const currentIndex = activePlayerIds.indexOf(userId);
              const nextIndex = (currentIndex + 1) % activePlayerIds.length;
              nextTurnUserId = activePlayerIds[nextIndex];
            } else {
              toast('Dapat 6! Kamu dapat giliran melempar dadu lagi 🎲', { icon: '✨' });
            }
          }

          // Jalankan animasi lokal
          animatePath(userId, currentPos, targetPos, () => {
            broadcastSnakesDiceRoll(finalRoll, targetPos, nextTurnUserId, hasWon);
            useGameStore.getState().updateSnakesState({
              diceValue: finalRoll,
              playerPositions: {
                ...serverPositions,
                [userId]: targetPos
              },
              currentTurnUserId: nextTurnUserId,
              winnerId: hasWon ? userId : null
            });
          });
        }, 400);
      }
    }, 60);
  };

  const currentDiceDisplay = isRollingLocal ? localDiceRoll : (snakesState?.diceValue ?? '-');
  const isRolling = isRollingLocal || snakesState?.isRolling;

  return (
    <div className="flex flex-col items-center gap-5 w-full max-w-2xl mx-auto py-2">
      {/* Banner Pemenang */}
      {isGameOver && (
        <div className="bg-foreground text-background border border-border px-6 py-3 rounded-2xl flex items-center gap-3 w-full justify-center shadow-2xl animate-bounce">
          <Trophy className="w-6 h-6 text-amber-400" />
          <span className="font-bold text-base sm:text-lg">
            🎉 {players[snakesState.winnerId!]?.username || 'Pemain'} Berhasil Mencapai Kotak 100 & Menang!
          </span>
        </div>
      )}

      {/* Banner Status Aksi Animasi */}
      <AnimatePresence>
        {actionStatus && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="bg-card border border-border text-foreground px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-lg flex items-center gap-2"
          >
            {actionStatus.includes('🪜') ? <ArrowUpRight className="w-4 h-4 text-emerald-400" /> : <ArrowDownRight className="w-4 h-4 text-red-400" />}
            {actionStatus}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Papan Ular Tangga Monokrom Modern */}
      <div className="relative w-full aspect-square border-2 border-border bg-card rounded-2xl shadow-xl p-1 overflow-hidden select-none">

        {/* Grid Monokrom 10x10 */}
        <div className="grid grid-cols-10 grid-rows-10 w-full h-full gap-0.5">
          {Array.from({ length: 100 }, (_, i) => {
            const rowFromTop = Math.floor(i / 10);
            const col = i % 10;
            let tileNumber = 0;

            if (rowFromTop % 2 === 0) {
              tileNumber = 100 - (rowFromTop * 10) - col;
            } else {
              tileNumber = 100 - (rowFromTop * 10) - (9 - col);
            }

            const isAlternate = (rowFromTop + col) % 2 === 0;

            return (
              <div
                key={tileNumber}
                className={`relative flex items-center justify-center font-semibold text-xs rounded-sm transition-colors ${
                  tileNumber === 100
                    ? 'bg-foreground text-background font-black'
                    : isAlternate
                    ? 'bg-secondary/10 text-foreground/80'
                    : 'bg-card text-secondary'
                }`}
              >
                <span className="absolute top-1 left-1 text-[9px] sm:text-[10px] font-mono opacity-60">
                  {tileNumber === 100 ? '⭐100' : tileNumber}
                </span>
              </div>
            );
          })}
        </div>

        {/* SVG Overlay Monokrom Modern untuk Tangga & Ular */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100">
          <defs>
            <filter id="subtleShadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0.3" dy="0.5" stdDeviation="0.4" floodOpacity="0.5" />
            </filter>
          </defs>

          {/* 1. Tangga Monokrom (Gaya Minimalis Modern) */}
          {config.ladders.map((ladder) => {
            const start = getTileCoordinates(ladder.start);
            const end = getTileCoordinates(ladder.end);

            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const nx = (-dy / length) * 1.2;
            const ny = (dx / length) * 1.2;
            const rungsCount = Math.max(3, Math.floor(length / 4.8));

            return (
              <g key={ladder.id} filter="url(#subtleShadow)">
                {/* Tiang Tangga */}
                <line x1={start.x + nx} y1={start.y + ny} x2={end.x + nx} y2={end.y + ny} stroke="currentColor" className="text-zinc-400 dark:text-zinc-300" strokeWidth="0.8" strokeLinecap="round" />
                <line x1={start.x - nx} y1={start.y - ny} x2={end.x - nx} y2={end.y - ny} stroke="currentColor" className="text-zinc-400 dark:text-zinc-300" strokeWidth="0.8" strokeLinecap="round" />

                {/* Anak Tangga */}
                {Array.from({ length: rungsCount }, (_, r) => {
                  const t = (r + 1) / (rungsCount + 1);
                  const rx = start.x + dx * t;
                  const ry = start.y + dy * t;
                  return (
                    <line
                      key={r}
                      x1={rx + nx}
                      y1={ry + ny}
                      x2={rx - nx}
                      y2={ry - ny}
                      stroke="currentColor"
                      className="text-zinc-400 dark:text-zinc-300"
                      strokeWidth="0.6"
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* 2. Ular Monokrom Modern (Garis Karbon Bertekstur) */}
          {config.snakes.map((snake) => {
            const head = getTileCoordinates(snake.head);
            const tail = getTileCoordinates(snake.tail);

            const midX = (head.x + tail.x) / 2 + snake.curveFactor;
            const midY = (head.y + tail.y) / 2;
            const pathD = `M ${head.x} ${head.y} Q ${midX} ${midY} ${tail.x} ${tail.y}`;

            return (
              <g key={snake.id} filter="url(#subtleShadow)">
                {/* Badan Ular Luar */}
                <path d={pathD} fill="none" stroke="currentColor" className="text-zinc-600 dark:text-zinc-400" strokeWidth="2.2" strokeLinecap="round" />
                {/* Aksen Striping Ular */}
                <path d={pathD} fill="none" stroke="currentColor" className="text-zinc-200 dark:text-zinc-900" strokeWidth="0.7" strokeDasharray="1.2 1.2" strokeLinecap="round" />

                {/* Kepala Ular */}
                <circle cx={head.x} cy={head.y} r="1.6" className="fill-zinc-800 dark:fill-zinc-300" />
                <circle cx={head.x - 0.4} cy={head.y - 0.4} r="0.35" fill="#ffffff" />
                <circle cx={head.x + 0.4} cy={head.y - 0.4} r="0.35" fill="#ffffff" />
                <circle cx={head.x - 0.4} cy={head.y - 0.4} r="0.18" fill="#000000" />
                <circle cx={head.x + 0.4} cy={head.y - 0.4} r="0.18" fill="#000000" />
              </g>
            );
          })}
        </svg>

        {/* 3. Layer Bidak Pemain Animasi Melompat + Username Badge di Atas Bidak */}
        <div className="absolute inset-0 pointer-events-none z-30">
          {Object.entries(visualPositions).map(([pId, pos]) => {
            const p = players[pId];
            if (!p || p.isSpectator || p.status === 'left') return null;

            const coords = getTileCoordinates(pos || 1);

            return (
              <motion.div
                key={pId}
                className="absolute flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                animate={{
                  left: `${coords.x}%`,
                  top: `${coords.y}%`,
                }}
                transition={{
                  type: 'spring',
                  stiffness: 280,
                  damping: 24,
                  mass: 0.6,
                }}
              >
                {/* Username di atas bulat player */}
                <div className="mb-0.5 px-1.5 py-0.2 text-[9px] sm:text-[10px] font-bold bg-background/90 text-foreground border border-border rounded-md shadow-md whitespace-nowrap -translate-y-1">
                  {p.username || 'Player'}
                </div>

                {/* Bulat Avatar Token */}
                <div
                  className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 border-background shadow-xl flex items-center justify-center text-[10px] font-black text-white ring-1 ring-border"
                  style={{ backgroundColor: p.color || '#3b82f6' }}
                  title={p.username || 'Pemain'}
                >
                  {p.username?.charAt(0).toUpperCase()}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Kontrol Dadu & Turn Indicator */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-2xl border border-border shadow-lg w-full justify-between">
        <div className="flex items-center gap-4">
          <div className="text-center font-mono w-16 bg-secondary/10 py-1.5 rounded-xl border border-border">
            <div className="text-[10px] text-secondary font-semibold uppercase tracking-wider">Dadu</div>
            <div className="text-3xl font-black text-foreground">{currentDiceDisplay}</div>
          </div>

          <div className="border-l border-border h-10" />

          <div className="flex flex-col">
            <span className="text-xs text-secondary font-medium">Giliran Saat Ini:</span>
            <div className="flex items-center gap-2 mt-0.5">
              <div
                className="w-3.5 h-3.5 rounded-full ring-2 ring-foreground/20"
                style={{ backgroundColor: players[currentTurn || '']?.color || '#3b82f6' }}
              />
              <span className="font-bold text-sm truncate max-w-[160px]">
                {players[currentTurn || '']?.username || (isSolo ? 'Kamu' : 'Menunggu...')}
                {isMyTurn ? ' (Giliran Kamu)' : ''}
              </span>
            </div>
          </div>
        </div>

        <Button
          size="lg"
          onClick={handleRollDice}
          disabled={!isMyTurn || isRolling || isGameOver}
          className="px-6 gap-2 w-full sm:w-auto shadow-md"
        >
          <Dices className={`w-5 h-5 ${isRolling ? 'animate-spin' : ''}`} />
          {isRolling ? 'Mengocok Dadu...' : 'Lempar Dadu'}
        </Button>
      </div>
    </div>
  );
};
