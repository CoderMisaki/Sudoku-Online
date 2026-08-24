"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { Dices, Trophy, SkipForward } from 'lucide-react';
import {
  getTileCoordinates,
  generateInitialSnakesState,
  relocateTriggeredItem,
} from '@/utils/snakesAndLaddersData';
import { SnakesState, Player } from '@/types/game';
import toast from 'react-hot-toast';

interface SnakesAndLaddersBoardProps {
  broadcastSnakesState?: (newState: SnakesState) => void;
  broadcastSnakesDiceRoll?: (diceValue: number, newPosition: number, nextTurnUserId: string, hasWon: boolean) => void;
}

const SNAKE_SPECIES = [
  {
    name: 'Emerald Tree Boa',
    gradientId: 'snakeGrad_emerald',
    colors: ['#047857', '#10b981', '#34d399', '#064e3b'],
    scalesColor: '#d1fae5',
    headColor: '#065f46',
    eyeIris: '#facc15',
    eyePupil: '#000000',
    tongueColor: '#ef4444',
  },
  {
    name: 'Coral Snake',
    gradientId: 'snakeGrad_coral',
    colors: ['#991b1b', '#ef4444', '#f59e0b', '#18181b'],
    scalesColor: '#fef08a',
    headColor: '#7f1d1d',
    eyeIris: '#f97316',
    eyePupil: '#000000',
    tongueColor: '#450a0a',
  },
  {
    name: 'Blue Insularis Viper',
    gradientId: 'snakeGrad_blueViper',
    colors: ['#0369a1', '#0ea5e9', '#38bdf8', '#082f49'],
    scalesColor: '#e0f2fe',
    headColor: '#0284c7',
    eyeIris: '#fde047',
    eyePupil: '#000000',
    tongueColor: '#0284c7',
  },
  {
    name: 'Albino Burmese Python',
    gradientId: 'snakeGrad_albino',
    colors: ['#d97706', '#fbbf24', '#fef08a', '#f8fafc'],
    scalesColor: '#ffffff',
    headColor: '#f59e0b',
    eyeIris: '#f43f5e',
    eyePupil: '#881337',
    tongueColor: '#fb7185',
  },
  {
    name: 'Black Mamba',
    gradientId: 'snakeGrad_blackMamba',
    colors: ['#0f172a', '#334155', '#475569', '#020617'],
    scalesColor: '#94a3b8',
    headColor: '#0f172a',
    eyeIris: '#64748b',
    eyePupil: '#000000',
    tongueColor: '#0f172a',
  },
];

function generateCurvedSnakePath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  seed: number = 1
) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.1) return `M ${start.x} ${start.y} L ${end.x} ${end.y}`;

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const waveCount = Math.max(3, Math.floor(len / 14) * 2 + 1);
  const maxAmp = Math.max(3.5, Math.min(6.5, len * 0.28));
  const sign = seed % 2 === 0 ? 1 : -1;

  const points: { x: number; y: number }[] = [];
  const segments = 24;

  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const envelope = Math.sin(Math.PI * t);
    const wave = Math.sin(t * waveCount * Math.PI) * maxAmp * envelope * sign;
    points.push({
      x: start.x + dx * t + nx * wave,
      y: start.y + dy * t + ny * wave,
    });
  }

  let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 >= points.length ? points.length - 1 : i + 2];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`;
  }

  return { d, firstSegmentAngle: Math.atan2(points[1].y - points[0].y, points[1].x - points[0].x) };
}

const EMPTY_PLAYERS: Record<string, Player> = {};
const EMPTY_POSITIONS: Record<string, number> = {};
const EMPTY_FROZEN: Record<string, number> = {};
const EMPTY_ARRAY: string[] = [];

export const SnakesAndLaddersBoard: React.FC<SnakesAndLaddersBoardProps> = ({ broadcastSnakesState }) => {
  const userId = useGameStore((state) => state.userId);
  const room = useGameStore((state) => state.room);
  const players = room?.players || EMPTY_PLAYERS;
  const snakesState = useGameStore((state) => state.snakesState);
  const updateSnakesState = useGameStore((state) => state.updateSnakesState);
  const updatePlayer = useGameStore((state) => state.updatePlayer);

  const isSkippingRef = useRef(false);
  const isInitializedRef = useRef(false);

  const activePlayerIdsKey = useMemo(() => {
    return Object.values(players)
      .filter((p) => !p.isSpectator && p.status !== 'left')
      .map((p) => p.id)
      .join(',');
  }, [players]);

  const activePlayerIds = useMemo(() => {
    return activePlayerIdsKey ? activePlayerIdsKey.split(',') : EMPTY_ARRAY;
  }, [activePlayerIdsKey]);

  useEffect(() => {
    if (!snakesState || !snakesState.ladders || snakesState.ladders.length === 0) {
      if (!isInitializedRef.current && activePlayerIds.length > 0) {
        isInitializedRef.current = true;
        const initial = generateInitialSnakesState(room?.difficulty || 'medium', activePlayerIds);
        updateSnakesState(initial);
      }
    }
  }, [snakesState, room?.difficulty, activePlayerIds, updateSnakesState]);

  const [localDiceRoll, setLocalDiceRoll] = useState<number | null>(null);
  const [isRollingLocal, setIsRollingLocal] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const [visualPositions, setVisualPositions] = useState<Record<string, number>>({});
  const isAnimatingRef = useRef(false);
  const lastProcessedPosRef = useRef<Record<string, number>>({});

  const serverPositions = snakesState?.playerPositions ?? EMPTY_POSITIONS;
  const frozenTurns = snakesState?.frozenTurns ?? EMPTY_FROZEN;
  const myFrozenCount = userId ? frozenTurns[userId] || 0 : 0;

  const winners = useMemo(() => {
    if (snakesState?.winners && snakesState.winners.length > 0) {
      return snakesState.winners;
    }
    return snakesState?.winnerId ? [snakesState.winnerId] : EMPTY_ARRAY;
  }, [snakesState]);

  const unfinishedPlayerIds = useMemo(() => {
    return activePlayerIds.filter((id) => !winners.includes(id));
  }, [activePlayerIds, winners]);

  const isGameFullyFinished = useMemo(() => {
    if (activePlayerIds.length <= 1) return winners.length >= 1;
    return unfinishedPlayerIds.length === 0 || winners.length === activePlayerIds.length;
  }, [activePlayerIds.length, unfinishedPlayerIds.length, winners.length]);

  // Reset visual posisi dan flag saat ronde baru dimulai (winners kosong)
  useEffect(() => {
    if (snakesState?.playerPositions) {
      const isNewGame = (!snakesState.winners || snakesState.winners.length === 0) && !snakesState.winnerId;
      if (isNewGame) {
        // Use queueMicrotask to avoid synchronous setState inside effect lint warning
        queueMicrotask(() => {
          setVisualPositions(snakesState.playerPositions);
          lastProcessedPosRef.current = { ...snakesState.playerPositions };
          isAnimatingRef.current = false;
          setIsRollingLocal(false);
          setActionStatus(null);
        });
      }
    }
  }, [snakesState?.winners, snakesState?.winnerId, snakesState?.playerPositions]);

  const isAlreadyFinished = Boolean(userId && winners.includes(userId));
  const currentTurn = snakesState?.currentTurnUserId || activePlayerIds[0];
  const isMyTurn = currentTurn === userId;

  // Animasi langkah yang lebih lambat & smooth (380ms per langkah)
  const animatePath = useCallback(async (
    targetUserId: string,
    startPos: number,
    steppedPos: number,
    finalPos: number,
    eventLabel?: string,
    onComplete?: () => void
  ) => {
    isAnimatingRef.current = true;
    let curr = startPos;
    const stepIntervalMs = 380; // Dipelanin agar jelas dilihat semua pemain

    if (steppedPos > curr) {
      while (curr < steppedPos) {
        curr++;
        setVisualPositions((prev) => ({ ...prev, [targetUserId]: curr }));
        await new Promise((r) => setTimeout(r, stepIntervalMs));
      }
    } else if (steppedPos < curr) {
      while (curr > steppedPos) {
        curr--;
        setVisualPositions((prev) => ({ ...prev, [targetUserId]: curr }));
        await new Promise((r) => setTimeout(r, stepIntervalMs));
      }
    }

    if (eventLabel) {
      setActionStatus(eventLabel);
      await new Promise((r) => setTimeout(r, 600));
    }

    // Meluncur turun ular atau naik tangga
    if (finalPos !== steppedPos) {
      setVisualPositions((prev) => ({ ...prev, [targetUserId]: finalPos }));
      await new Promise((r) => setTimeout(r, 700));
    }

    lastProcessedPosRef.current[targetUserId] = finalPos;
    setActionStatus(null);
    isAnimatingRef.current = false;
    if (onComplete) onComplete();
  }, []);

  // Sinkronisasi animasi saat pemain lain melangkah
  useEffect(() => {
    if (isAnimatingRef.current) return;

    Object.entries(serverPositions).forEach(([pId, targetPos]) => {
      const currentVisual = visualPositions[pId] || lastProcessedPosRef.current[pId] || 1;

      // Jika posisi server berbeda dan ini adalah aksi dari pemain lain
      if (targetPos !== currentVisual && pId !== userId) {
        let steppedPos = targetPos;
        const ladderHit = snakesState?.ladders?.find((l) => l.end === targetPos);
        const snakeHit = snakesState?.snakes?.find((s) => s.tail === targetPos);
        const wormholeHit = snakesState?.wormholes?.find((w) => w.whiteHole === targetPos);

        let eventMsg = '';
        const pName = players[pId]?.username || 'Player';

        if (ladderHit) {
          steppedPos = ladderHit.start;
          eventMsg = `🪜 ${pName} menaiki tangga ke kotak ${targetPos}!`;
        } else if (snakeHit) {
          steppedPos = snakeHit.head;
          eventMsg = `🐍 ${pName} dimakan ular turun ke kotak ${targetPos}!`;
        } else if (wormholeHit) {
          steppedPos = wormholeHit.blackHole;
          eventMsg = `🌀 ${pName} tersedot lubang ke kotak ${targetPos}!`;
        }

        animatePath(pId, currentVisual, steppedPos, targetPos, eventMsg);
      } else if (visualPositions[pId] === undefined) {
        setVisualPositions((prev) => ({ ...prev, [pId]: targetPos }));
        lastProcessedPosRef.current[pId] = targetPos;
      }
    });
  }, [serverPositions, visualPositions, userId, snakesState, players, animatePath]);

  // Auto skip giliran jika pemain saat ini sudah selesai
  useEffect(() => {
    if (!snakesState || isGameFullyFinished || isSkippingRef.current) return;

    const currentTurnId = snakesState.currentTurnUserId || '';
    const isAuthority = room?.hostId === userId || currentTurnId === userId;
    if (isAuthority && winners.includes(currentTurnId) && unfinishedPlayerIds.length > 0) {
      isSkippingRef.current = true;
      const nextTurnId = unfinishedPlayerIds[0];
      const nextState: SnakesState = {
        ...snakesState,
        currentTurnUserId: nextTurnId,
      };

      updateSnakesState(nextState);
      if (broadcastSnakesState) broadcastSnakesState(nextState);

      setTimeout(() => {
        isSkippingRef.current = false;
      }, 100);
    }
  }, [snakesState, winners, unfinishedPlayerIds, isGameFullyFinished, updateSnakesState, broadcastSnakesState, room?.hostId, userId]);

  const handleRollDice = () => {
    if (!isMyTurn || isRollingLocal || isGameFullyFinished || !userId || isAnimatingRef.current || !snakesState || isAlreadyFinished) return;

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

          const ladderHit = snakesState.ladders?.find((l) => l.start === steppedPos);
          const snakeHit = snakesState.snakes?.find((s) => s.head === steppedPos);
          const mineHit = snakesState.mines?.includes(steppedPos);
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
            eventMessage = `🌀 ${playerName} tersedot Black Hole ke kotak ${finalPos}!`;
            updatedObstacles = relocateTriggeredItem(snakesState, 'wormhole', wormholeHit.id);
          } else if (mineHit) {
            newFrozen[userId] = 3;
            eventMessage = `💣 ${playerName} terinjak Ranjau Capit! Terjebak 3 turn!`;
            updatedObstacles = relocateTriggeredItem(snakesState, 'mine', steppedPos);
            toast.error('💥 Kamu menginjak Ranjau Capit! Freeze 3 giliran!');
          }

          const hasWon = finalPos === 100;
          const newWinners = [...winners];

          if (hasWon && !newWinners.includes(userId)) {
            newWinners.push(userId);
            const myRank = newWinners.length;
            const medal = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : '🥉';
            toast.success(`${medal} Kamu Finish di Juara ${myRank}!`, { duration: 3500 });

            // Tambahkan skor akumulatif
            const earnedScore = myRank === 1 ? 100 : myRank === 2 ? 60 : 30;
            const currentScore = players[userId]?.score || 0;
            updatePlayer(userId, { score: currentScore + earnedScore, rank: myRank });
          }

          const remainingUnfinished = activePlayerIds.filter((id) => !newWinners.includes(id));

          let nextTurnId = userId;
          if (remainingUnfinished.length > 0) {
            if (hasWon) {
              nextTurnId = remainingUnfinished[0];
            } else if (finalDice !== 6 || mineHit) {
              const currentIdxInUnfinished = remainingUnfinished.indexOf(userId);
              const nextIdx = (currentIdxInUnfinished + 1) % remainingUnfinished.length;
              nextTurnId = remainingUnfinished[nextIdx];
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
              winnerId: newWinners[0] || snakesState.winnerId,
              winners: newWinners,
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

  const handleSkipTurn = () => {
    if (!isMyTurn || !userId || !snakesState) return;

    const remaining = Math.max(0, myFrozenCount - 1);
    const updatedFrozen = { ...frozenTurns, [userId]: remaining };

    let nextTurnId = userId;
    if (unfinishedPlayerIds.length > 0) {
      const currentIdx = unfinishedPlayerIds.indexOf(userId);
      const nextIdx = (currentIdx + 1) % unfinishedPlayerIds.length;
      nextTurnId = unfinishedPlayerIds[nextIdx];
    }

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
      {winners.length > 0 && (
        <div className="bg-foreground text-background px-5 py-3 rounded-2xl flex items-center gap-3 w-full justify-center shadow-xl animate-bounce">
          <Trophy className="w-6 h-6 text-amber-400" />
          <span className="font-bold text-sm sm:text-base">
            🎉 {players[winners[0]]?.username || 'Pemain'} Menang & Mencapai Kotak 100!
          </span>
        </div>
      )}

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

      <div className="relative w-full aspect-square border-2 border-border bg-card rounded-2xl shadow-xl p-1 overflow-hidden">
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

        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100">
          <defs>
            {SNAKE_SPECIES.map((species) => (
              <linearGradient key={species.gradientId} id={species.gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={species.colors[0]} />
                <stop offset="35%" stopColor={species.colors[1]} />
                <stop offset="70%" stopColor={species.colors[2]} />
                <stop offset="100%" stopColor={species.colors[3]} />
              </linearGradient>
            ))}
          </defs>

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

          {snakesState?.snakes?.map((snake, sIdx) => {
            const head = getTileCoordinates(snake.head);
            const tail = getTileCoordinates(snake.tail);
            const pathInfo = generateCurvedSnakePath(head, tail, sIdx + 1);
            if (typeof pathInfo === 'string') return null;
            const { d, firstSegmentAngle } = pathInfo;
            const species = SNAKE_SPECIES[sIdx % SNAKE_SPECIES.length];

            return (
              <g key={snake.id}>
                <path d={d} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1.6" strokeLinecap="round" transform="translate(0.2, 0.3)" />
                <path d={d} fill="none" stroke={`url(#${species.gradientId})`} strokeWidth="1.45" strokeLinecap="round" />
                <path d={d} fill="none" stroke={species.scalesColor} strokeWidth="0.55" strokeDasharray="0.6 1.1" strokeLinecap="round" opacity="0.9" />
                <g transform={`translate(${head.x}, ${head.y}) rotate(${(firstSegmentAngle * 180) / Math.PI + 180})`}>
                  <ellipse cx="0" cy="0" rx="1.15" ry="0.9" fill={species.headColor} stroke="rgba(0,0,0,0.4)" strokeWidth="0.15" />
                  <circle cx="-0.25" cy="-0.4" r="0.28" fill={species.eyeIris} />
                  <circle cx="-0.25" cy="0.4" r="0.28" fill={species.eyeIris} />
                </g>
              </g>
            );
          })}
        </svg>

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
                transition={{ type: 'spring', stiffness: 280, damping: 22 }}
              >
                <div className="mb-0.5 px-1.5 py-0.2 text-[9px] font-bold bg-background/95 text-foreground border border-border rounded-md shadow-xs whitespace-nowrap">
                  {p.username || 'Player'}
                </div>

                <motion.div
                  key={`hop-${pos}`}
                  animate={{
                    y: [0, -16, -3, 0],
                    scaleX: [1, 0.88, 1.12, 1],
                    scaleY: [1, 1.2, 0.9, 1],
                  }}
                  transition={{
                    duration: 0.35,
                    ease: [0.25, 1, 0.5, 1],
                  }}
                  className="relative flex items-center justify-center"
                >
                  <div
                    className="w-5.5 h-5.5 rounded-full border-2 border-background shadow-lg flex items-center justify-center text-[10px] font-black text-white"
                    style={{ backgroundColor: p.color || '#3b82f6' }}
                  >
                    {p.username?.charAt(0).toUpperCase()}
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {winners.length > 0 && (
        <div className="bg-card border border-border p-3 rounded-xl w-full text-xs sm:text-sm flex flex-col gap-1.5 shadow-sm">
          <span className="font-bold text-foreground">🏆 Papan Peringkat Finish:</span>
          <div className="flex flex-wrap gap-2">
            {winners.map((wId, idx) => (
              <span key={wId} className="px-2.5 py-1 bg-secondary/15 rounded-lg font-medium">
                {idx === 0 ? '🥇 Juara 1: ' : idx === 1 ? '🥈 Juara 2: ' : idx === 2 ? '🥉 Juara 3: ' : `Rank ${idx + 1}: `}
                {players[wId]?.username || 'Player'}
              </span>
            ))}
          </div>
        </div>
      )}

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

        {isAlreadyFinished ? (
          <div className="bg-green-600/15 text-green-600 dark:text-green-400 font-bold px-4 py-2.5 rounded-xl text-center w-full sm:w-auto">
            🎉 Kamu sudah Finish (Juara {winners.indexOf(userId!) + 1})!
          </div>
        ) : myFrozenCount > 0 && isMyTurn ? (
          <Button size="lg" onClick={handleSkipTurn} className="bg-red-600 hover:bg-red-700 text-white gap-2 w-full sm:w-auto">
            <SkipForward className="w-5 h-5" /> Lewati Giliran (Terjebak {myFrozenCount} Turn)
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={handleRollDice}
            disabled={!isMyTurn || isRollingLocal || isGameFullyFinished}
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
