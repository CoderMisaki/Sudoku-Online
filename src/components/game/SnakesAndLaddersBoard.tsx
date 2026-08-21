"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { Dices, Trophy, SkipForward } from 'lucide-react';
import {
  getTileCoordinates,
  generateInitialSnakesState,
  relocateTriggeredItem,
} from '@/utils/snakesAndLaddersData';
import { SnakesState } from '@/types/game';
import toast from 'react-hot-toast';

interface SnakesAndLaddersBoardProps {
  broadcastSnakesState?: (newState: SnakesState) => void;
  broadcastSnakesDiceRoll?: (diceValue: number, newPosition: number, nextTurnUserId: string, hasWon: boolean) => void;
}

export const SnakesAndLaddersBoard: React.FC<SnakesAndLaddersBoardProps> = ({ broadcastSnakesState }) => {
  const userId = useGameStore((state) => state.userId);
  const room = useGameStore((state) => state.room);
  const players = useMemo(() => room?.players || {}, [room?.players]);
  const snakesState = useGameStore((state) => state.snakesState);
  const updateSnakesState = useGameStore((state) => state.updateSnakesState);

  const activePlayerIds = useMemo(() => {
    return Object.values(players)
      .filter((p) => !p.isSpectator && p.status !== 'left')
      .map((p) => p.id);
  }, [players]);

  // Inisialisasi State jika belum tersedia
  useEffect(() => {
    if (!snakesState || !snakesState.ladders || snakesState.ladders.length === 0) {
      const initial = generateInitialSnakesState(room?.difficulty || 'medium', activePlayerIds);
      updateSnakesState(initial);
    }
  }, [snakesState, room?.difficulty, activePlayerIds, updateSnakesState]);

  const [localDiceRoll, setLocalDiceRoll] = useState<number | null>(null);
  const [isRollingLocal, setIsRollingLocal] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const [visualPositions, setVisualPositions] = useState<Record<string, number>>({});
  const isAnimatingRef = useRef(false);

  const serverPositions = useMemo(() => snakesState?.playerPositions || {}, [snakesState?.playerPositions]);
  const frozenTurns = useMemo(() => snakesState?.frozenTurns || {}, [snakesState?.frozenTurns]);
  const myFrozenCount = userId ? frozenTurns[userId] || 0 : 0;

  const currentTurn = snakesState?.currentTurnUserId || activePlayerIds[0];
  const isMyTurn = currentTurn === userId;
  const isGameOver = Boolean(snakesState?.winnerId);

  // Sinkronisasi posisi visual awal
  useEffect(() => {
    const timer = setTimeout(() => {
      setVisualPositions((prev) => {
        const updated = { ...prev };
        let changed = false;
        activePlayerIds.forEach((pId) => {
          if (updated[pId] === undefined) {
            updated[pId] = serverPositions[pId] || 1;
            changed = true;
          }
        });
        return changed ? updated : prev;
      });
    }, 0);
    return () => clearTimeout(timer);
  }, [activePlayerIds, serverPositions]);

  // Sync animation when other players move
  useEffect(() => {
    if (isAnimatingRef.current) return;
    Object.entries(serverPositions).forEach(([pId, targetPos]) => {
      const currentPos = visualPositions[pId] || 1;
      if (currentPos !== targetPos && !isAnimatingRef.current) {
        setVisualPositions((prev) => ({ ...prev, [pId]: targetPos }));
      }
    });
  }, [serverPositions, visualPositions]);

  // Animasi langkah melompat satu per satu
  const animatePath = async (
    targetUserId: string,
    startPos: number,
    steppedPos: number,
    finalPos: number,
    eventLabel?: string,
    onComplete?: () => void
  ) => {
    isAnimatingRef.current = true;
    let curr = startPos;

    if (steppedPos > curr) {
      while (curr < steppedPos) {
        curr++;
        setVisualPositions((prev) => ({ ...prev, [targetUserId]: curr }));
        await new Promise((r) => setTimeout(r, 180));
      }
    } else if (steppedPos < curr) {
      while (curr > steppedPos) {
        curr--;
        setVisualPositions((prev) => ({ ...prev, [targetUserId]: curr }));
        await new Promise((r) => setTimeout(r, 180));
      }
    }

    if (eventLabel) {
      setActionStatus(eventLabel);
      await new Promise((r) => setTimeout(r, 300));
    }

    if (finalPos !== steppedPos) {
      setVisualPositions((prev) => ({ ...prev, [targetUserId]: finalPos }));
      await new Promise((r) => setTimeout(r, 500));
    }

    setActionStatus(null);
    isAnimatingRef.current = false;
    if (onComplete) onComplete();
  };

  // Handler Lempar Dadu
  const handleRollDice = () => {
    if (!isMyTurn || isRollingLocal || isGameOver || !userId || isAnimatingRef.current || !snakesState) return;

    setIsRollingLocal(true);
    let counter = 0;
    const interval = setInterval(() => {
      setLocalDiceRoll(Math.floor(Math.random() * 6) + 1);
      counter++;

      if (counter > 8) {
        clearInterval(interval);
        const finalDice = Math.floor(Math.random() * 6) + 1;
        setLocalDiceRoll(finalDice);

        setTimeout(() => {
          setIsRollingLocal(false);
          const currentPos = visualPositions[userId] || serverPositions[userId] || 1;
          let steppedPos = currentPos + finalDice;

          if (steppedPos > 100) {
            steppedPos = 100 - (steppedPos - 100);
          }

          let finalPos = steppedPos;
          let eventMessage = '';
          let updatedObstacles: Partial<SnakesState> = {};
          const newFrozen = { ...frozenTurns };

          // 1. Cek Tangga (Hanya aktif jika injak start)
          const ladderHit = snakesState.ladders?.find((l) => l.start === steppedPos);
          // 2. Cek Ular (HANYA AKTIF JIKA INJAK KEPALA, BUNTUT DIABAIKAN)
          const snakeHit = snakesState.snakes?.find((s) => s.head === steppedPos);
          // 3. Cek Ranjau
          const mineHit = snakesState.mines?.includes(steppedPos);
          // 4. Cek Black Hole
          const wormholeHit = snakesState.wormholes?.find((w) => w.blackHole === steppedPos);

          const playerName = players[userId]?.username || 'Kamu';

          if (ladderHit) {
            finalPos = ladderHit.end;
            eventMessage = `🪜 ${playerName} memanjat tangga ke kotak ${finalPos}!`;
            updatedObstacles = relocateTriggeredItem(snakesState, 'ladder', ladderHit.id);
          } else if (snakeHit) {
            finalPos = snakeHit.tail;
            eventMessage = `🐍 ${playerName} dimakan ular turun ke kotak ${finalPos}!`;
            updatedObstacles = relocateTriggeredItem(snakesState, 'snake', snakeHit.id);
          } else if (wormholeHit) {
            finalPos = wormholeHit.whiteHole;
            eventMessage = `🌀 ${playerName} masuk Black Hole ${wormholeHit.blackHole} & keluar di White Hole ${finalPos}!`;
            updatedObstacles = relocateTriggeredItem(snakesState, 'wormhole', wormholeHit.id);
          } else if (mineHit) {
            newFrozen[userId] = 3;
            eventMessage = `💣 ${playerName} menginjak Ranjau! Terjebak 3 turn!`;
            updatedObstacles = relocateTriggeredItem(snakesState, 'mine', steppedPos);
            toast.error('💥 Kamu menginjak Ranjau! Freeze 3 giliran!');
          }

          const hasWon = finalPos === 100;

          // Hitung giliran berikutnya
          let nextTurnId = userId;
          if (activePlayerIds.length > 1) {
            if (finalDice !== 6 || mineHit) {
              const currentIdx = activePlayerIds.indexOf(userId);
              nextTurnId = activePlayerIds[(currentIdx + 1) % activePlayerIds.length];
            } else {
              toast.success('🎲 Angka 6! Lempar dadu sekali lagi!');
            }
          }

          animatePath(userId, currentPos, steppedPos, finalPos, eventMessage, () => {
            const nextState: SnakesState = {
              ...snakesState,
              ...updatedObstacles,
              diceValue: finalDice,
              playerPositions: {
                ...serverPositions,
                [userId]: finalPos,
              },
              currentTurnUserId: nextTurnId,
              winnerId: hasWon ? userId : snakesState.winnerId,
              frozenTurns: newFrozen,
            };
            updateSnakesState(nextState);
            if (broadcastSnakesState) {
              broadcastSnakesState(nextState);
            }
          });
        }, 200);
      }
    }, 50);
  };

  // Handler Lewati Giliran (Jika Terkena Ranjau)
  const handleSkipTurn = () => {
    if (!isMyTurn || !userId || !snakesState) return;

    const remaining = Math.max(0, myFrozenCount - 1);
    const updatedFrozen = { ...frozenTurns, [userId]: remaining };

    const currentIdx = activePlayerIds.indexOf(userId);
    const nextTurnId = activePlayerIds[(currentIdx + 1) % activePlayerIds.length];

    toast(`Kamu melewatkan giliran (Sisa hukuman: ${remaining} turn)`, { icon: '⏳' });

    const nextState: SnakesState = {
      ...snakesState,
      currentTurnUserId: nextTurnId,
      frozenTurns: updatedFrozen,
    };
    updateSnakesState(nextState);
    if (broadcastSnakesState) {
      broadcastSnakesState(nextState);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-2xl mx-auto select-none">
      {/* Banner Pemenang */}
      {isGameOver && (
        <div className="bg-foreground text-background px-5 py-3 rounded-2xl flex items-center gap-3 w-full justify-center shadow-xl animate-bounce">
          <Trophy className="w-6 h-6 text-amber-400" />
          <span className="font-bold text-sm sm:text-base">
            🎉 {players[snakesState?.winnerId || '']?.username || 'Pemain'} Menang & Mencapai Kotak 100!
          </span>
        </div>
      )}

      {/* Status Aksi Terinjak */}
      <AnimatePresence>
        {actionStatus && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-card border border-border text-foreground px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md flex items-center gap-2"
          >
            {actionStatus}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Papan 10x10 Ular Tangga */}
      <div className="relative w-full aspect-square border-2 border-border bg-card rounded-2xl shadow-xl p-1 overflow-hidden">
        {/* Grid Nomor */}
        <div className="grid grid-cols-10 grid-rows-10 w-full h-full gap-0.5">
          {Array.from({ length: 100 }, (_, i) => {
            const rowFromTop = Math.floor(i / 10);
            const col = i % 10;
            const tileNumber =
              rowFromTop % 2 === 0
                ? 100 - rowFromTop * 10 - col
                : 100 - rowFromTop * 10 - (9 - col);

            const isAlt = (rowFromTop + col) % 2 === 0;

            return (
              <div
                key={tileNumber}
                className={`relative flex items-center justify-center text-xs rounded-xs ${
                  tileNumber === 100
                    ? 'bg-foreground text-background font-black'
                    : isAlt
                    ? 'bg-secondary/10 text-foreground/80'
                    : 'bg-card text-secondary'
                }`}
              >
                <span className="absolute top-1 left-1 text-[9px] font-mono opacity-40">
                  {tileNumber === 100 ? '⭐100' : tileNumber}
                </span>
              </div>
            );
          })}
        </div>

        {/* SVG Item Layer */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100">
          <defs>
            <linearGradient id="snakeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#16a34a" />
              <stop offset="100%" stopColor="#14532d" />
            </linearGradient>
            <radialGradient id="bhGrad">
              <stop offset="0%" stopColor="#000000" />
              <stop offset="70%" stopColor="#581c87" />
              <stop offset="100%" stopColor="#3b0764" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="whGrad">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="60%" stopColor="#38bdf8" />
              <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* 1. TANGGA */}
          {snakesState?.ladders?.map((ladder) => {
            const start = getTileCoordinates(ladder.start);
            const end = getTileCoordinates(ladder.end);
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const nx = (-dy / len) * 0.6;
            const ny = (dx / len) * 0.6;
            const rungs = Math.max(3, Math.floor(len / 4.5));

            return (
              <g key={ladder.id}>
                <line x1={start.x + nx} y1={start.y + ny} x2={end.x + nx} y2={end.y + ny} stroke="#d97706" strokeWidth="0.4" strokeLinecap="round" />
                <line x1={start.x - nx} y1={start.y - ny} x2={end.x - nx} y2={end.y - ny} stroke="#d97706" strokeWidth="0.4" strokeLinecap="round" />
                {Array.from({ length: rungs }, (_, r) => {
                  const t = (r + 1) / (rungs + 1);
                  return (
                    <line
                      key={r}
                      x1={start.x + dx * t + nx}
                      y1={start.y + dy * t + ny}
                      x2={start.x + dx * t - nx}
                      y2={start.y + dy * t - ny}
                      stroke="#fde68a"
                      strokeWidth="0.3"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* 2. ULAR */}
          {snakesState?.snakes?.map((snake) => {
            const head = getTileCoordinates(snake.head);
            const tail = getTileCoordinates(snake.tail);
            const dx = tail.x - head.x;
            const dy = tail.y - head.y;
            const angle = Math.atan2(dy, dx);

            const c1x = head.x + dx * 0.35 + Math.cos(angle + Math.PI / 2) * (snake.waveStrength * 0.8);
            const c1y = head.y + dy * 0.35 + Math.sin(angle + Math.PI / 2) * (snake.waveStrength * 0.8);
            const c2x = head.x + dx * 0.7 - Math.cos(angle + Math.PI / 2) * (snake.waveStrength * 0.8);
            const c2y = head.y + dy * 0.7 - Math.sin(angle + Math.PI / 2) * (snake.waveStrength * 0.8);

            return (
              <g key={snake.id}>
                <path d={`M ${head.x} ${head.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tail.x} ${tail.y}`} fill="none" stroke="url(#snakeGrad)" strokeWidth="1.2" strokeLinecap="round" />
                <ellipse cx={head.x} cy={head.y} rx="1.0" ry="0.75" transform={`rotate(${(angle * 180) / Math.PI + 180}, ${head.x}, ${head.y})`} fill="#15803d" />
                <circle cx={head.x - 0.3} cy={head.y - 0.3} r="0.2" fill="#fff" />
                <circle cx={head.x + 0.3} cy={head.y - 0.3} r="0.2" fill="#fff" />
                <circle cx={head.x - 0.3} cy={head.y - 0.3} r="0.1" fill="#000" />
                <circle cx={head.x + 0.3} cy={head.y - 0.3} r="0.1" fill="#000" />
              </g>
            );
          })}

          {/* 3. RANJAU (MINES) */}
          {snakesState?.mines?.map((mineTile, idx) => {
            const pos = getTileCoordinates(mineTile);
            return (
              <g key={`mine-${idx}`}>
                <circle cx={pos.x} cy={pos.y} r="2.2" fill="#ef4444" opacity="0.25" className="animate-ping" />
                <circle cx={pos.x} cy={pos.y} r="1.5" fill="#dc2626" />
                <circle cx={pos.x} cy={pos.y} r="0.6" fill="#18181b" />
              </g>
            );
          })}

          {/* 4. BLACK HOLE & WHITE HOLE */}
          {snakesState?.wormholes?.map((wh) => {
            const bhPos = getTileCoordinates(wh.blackHole);
            const whPos = getTileCoordinates(wh.whiteHole);

            return (
              <g key={wh.id}>
                {/* Black Hole */}
                <circle cx={bhPos.x} cy={bhPos.y} r="2.8" fill="url(#bhGrad)" />
                <circle cx={bhPos.x} cy={bhPos.y} r="1.2" fill="#000000" stroke="#a855f7" strokeWidth="0.2" />

                {/* White Hole */}
                <circle cx={whPos.x} cy={whPos.y} r="2.8" fill="url(#whGrad)" />
                <circle cx={whPos.x} cy={whPos.y} r="1.1" fill="#ffffff" stroke="#38bdf8" strokeWidth="0.2" />
              </g>
            );
          })}
        </svg>

        {/* 5. BIDAK PEMAIN */}
        <div className="absolute inset-0 pointer-events-none z-30">
          {Object.entries(visualPositions).map(([pId, pos]) => {
            const p = players[pId];
            if (!p || p.isSpectator || p.status === 'left') return null;

            const coords = getTileCoordinates(pos || 1);
            return (
              <motion.div
                key={pId}
                className="absolute flex flex-col items-center justify-center -translate-x-1/2 -translate-y-1/2 pointer-events-none"
                animate={{ left: `${coords.x}%`, top: `${coords.y}%` }}
                transition={{ type: 'spring', stiffness: 320, damping: 22 }}
              >
                <div className="mb-0.5 px-1 py-0.2 text-[9px] font-bold bg-background/90 text-foreground border border-border rounded-md shadow-sm">
                  {p.username || 'Player'}
                </div>
                <div
                  className="w-5 h-5 rounded-full border-2 border-background shadow-lg flex items-center justify-center text-[10px] font-black text-white"
                  style={{ backgroundColor: p.color || '#3b82f6' }}
                >
                  {p.username?.charAt(0).toUpperCase()}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Kontrol & Turn Status */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-2xl border border-border shadow-md w-full justify-between">
        <div className="flex items-center gap-4">
          <div className="text-center font-mono w-16 bg-secondary/10 py-1.5 rounded-xl border border-border">
            <div className="text-[10px] text-secondary font-semibold uppercase">Dadu</div>
            <div className="text-3xl font-black text-foreground">
              {isRollingLocal ? localDiceRoll : snakesState?.diceValue ?? '-'}
            </div>
          </div>

          <div className="border-l border-border h-10" />

          <div className="flex flex-col">
            <span className="text-xs text-secondary font-medium">Giliran Saat Ini:</span>
            <span className="font-bold text-sm">
              {players[currentTurn || '']?.username || 'Menunggu...'} {isMyTurn ? '(Giliran Kamu)' : ''}
            </span>
          </div>
        </div>

        {/* Tombol Aksi Turn */}
        {myFrozenCount > 0 && isMyTurn ? (
          <Button size="lg" onClick={handleSkipTurn} className="bg-red-600 hover:bg-red-700 text-white gap-2 w-full sm:w-auto">
            <SkipForward className="w-5 h-5" /> Lewati Giliran (Beku {myFrozenCount} Turn)
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={handleRollDice}
            disabled={!isMyTurn || isRollingLocal || isGameOver}
            className="gap-2 w-full sm:w-auto"
          >
            <Dices className={`w-5 h-5 ${isRollingLocal ? 'animate-spin' : ''}`} />
            {isRollingLocal ? 'Mengocok...' : 'Lempar Dadu'}
          </Button>
        )}
      </div>
    </div>
  );
};
