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

// Koleksi palet warna & karakteristik spesies ular dunia asli (disesuaikan monokrom)
const SNAKE_SPECIES = [
  {
    name: 'Monochromatic Cobra (Kobra Monokrom)',
    gradientId: 'snakeGrad_mono1',
    colors: ['#222222', '#333333', '#444444', '#111111'],
    scalesColor: '#cccccc',
    bellyColor: '#aaaaaa',
    headColor: '#111111',
    eyeIris: '#cccccc',
    eyePupil: '#000000',
    tongueColor: '#888888',
  },
  {
    name: 'Ashen Viper (Viper Abu)',
    gradientId: 'snakeGrad_mono2',
    colors: ['#333333', '#555555', '#777777', '#222222'],
    scalesColor: '#eeeeee',
    bellyColor: '#bbbbbb',
    headColor: '#222222',
    eyeIris: '#bbbbbb',
    eyePupil: '#000000',
    tongueColor: '#999999',
  },
  {
    name: 'Charcoal Python (Sanca Arang)',
    gradientId: 'snakeGrad_mono3',
    colors: ['#444444', '#666666', '#888888', '#333333'],
    scalesColor: '#dddddd',
    bellyColor: '#cccccc',
    headColor: '#333333',
    eyeIris: '#dddddd',
    eyePupil: '#000000',
    tongueColor: '#aaaaaa',
  },
  {
    name: 'Silver Serpent (Ular Perak)',
    gradientId: 'snakeGrad_mono4',
    colors: ['#666666', '#888888', '#aaaaaa', '#555555'],
    scalesColor: '#ffffff',
    bellyColor: '#dddddd',
    headColor: '#555555',
    eyeIris: '#ffffff',
    eyePupil: '#000000',
    tongueColor: '#bbbbbb',
  },
  {
    name: 'Shadow Boa (Boa Bayangan)',
    gradientId: 'snakeGrad_mono5',
    colors: ['#111111', '#222222', '#333333', '#000000'],
    scalesColor: '#bbbbbb',
    bellyColor: '#999999',
    headColor: '#000000',
    eyeIris: '#999999',
    eyePupil: '#000000',
    tongueColor: '#777777',
  },
  {
    name: 'Stone Rattler (Derik Batu)',
    gradientId: 'snakeGrad_mono6',
    colors: ['#555555', '#777777', '#999999', '#444444'],
    scalesColor: '#dddddd',
    bellyColor: '#bbbbbb',
    headColor: '#444444',
    eyeIris: '#aaaaaa',
    eyePupil: '#000000',
    tongueColor: '#999999',
  },
  {
    name: 'Ghost Serpent (Ular Hantu)',
    gradientId: 'snakeGrad_mono7',
    colors: ['#aaaaaa', '#cccccc', '#eeeeee', '#bbbbbb'],
    scalesColor: '#ffffff',
    bellyColor: '#eeeeee',
    headColor: '#bbbbbb',
    eyeIris: '#dddddd',
    eyePupil: '#000000',
    tongueColor: '#cccccc',
  },
];

// Helper kurva bezier untuk jalur bergelombang natural ular
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

  useEffect(() => {
    if (isAnimatingRef.current) return;
    Object.entries(serverPositions).forEach(([pId, targetPos]) => {
      const currentPos = visualPositions[pId] || 1;
      if (currentPos !== targetPos && !isAnimatingRef.current) {
        setVisualPositions((prev) => ({ ...prev, [pId]: targetPos }));
      }
    });
  }, [serverPositions, visualPositions]);

  // Animasi lompatan petak per petak (Hop step-by-step)
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

    const stepIntervalMs = 240;

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
      await new Promise((r) => setTimeout(r, 400));
    }

    // Meluncur turun ular atau naik tangga
    if (finalPos !== steppedPos) {
      setVisualPositions((prev) => ({ ...prev, [targetUserId]: finalPos }));
      await new Promise((r) => setTimeout(r, 600));
    }

    setActionStatus(null);
    isAnimatingRef.current = false;
    if (onComplete) onComplete();
  };

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
            <style>{`
              @keyframes spin-cw { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
              @keyframes spin-ccw { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
              @keyframes pulse-jet { 0%, 100% { opacity: 0.7; transform: scaleY(1); } 50% { opacity: 1; transform: scaleY(1.25); } }
              .vortex-cw { transform-box: fill-box; transform-origin: center; animation: spin-cw 8s linear infinite; }
              .vortex-ccw { transform-box: fill-box; transform-origin: center; animation: spin-ccw 6s linear infinite; }
              .jet-beam { transform-box: fill-box; transform-origin: center; animation: pulse-jet 2s ease-in-out infinite; }
            `}</style>

            {/* Gradient Ular Dunia Nyata */}
            {SNAKE_SPECIES.map((species) => (
              <linearGradient key={species.gradientId} id={species.gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={species.colors[0]} />
                <stop offset="35%" stopColor={species.colors[1]} />
                <stop offset="70%" stopColor={species.colors[2]} />
                <stop offset="100%" stopColor={species.colors[3]} />
              </linearGradient>
            ))}

            {/* Gradient Black Hole Pekat */}
            <radialGradient id="bhDeepBlackGrad">
              <stop offset="0%" stopColor="#000000" />
              <stop offset="45%" stopColor="#000000" />
              <stop offset="70%" stopColor="#09090b" />
              <stop offset="88%" stopColor="#18181b" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="bhAccretionGrad">
              <stop offset="0%" stopColor="#000000" />
              <stop offset="50%" stopColor="#27272a" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#000000" stopOpacity="0" />
            </radialGradient>

            <radialGradient id="whPusaranGrad">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="25%" stopColor="#e0f2fe" />
              <stop offset="50%" stopColor="#38bdf8" />
              <stop offset="78%" stopColor="#2563eb" />
              <stop offset="100%" stopColor="#1e3a8a" stopOpacity="0" />
            </radialGradient>

            {/* Trap Gradients */}
            <linearGradient id="trapMetalDark" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#475569" />
              <stop offset="50%" stopColor="#94a3b8" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>
            <linearGradient id="trapJawSteel" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="40%" stopColor="#cbd5e1" />
              <stop offset="100%" stopColor="#334155" />
            </linearGradient>
          </defs>

          {/* 1. TANGGA (LADDERS) */}
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

          {/* 2. ULAR DUNIA ASLI BERAGAM SPESIES */}
          {snakesState?.snakes?.map((snake, sIdx) => {
            const head = getTileCoordinates(snake.head);
            const tail = getTileCoordinates(snake.tail);
            const pathInfo = generateCurvedSnakePath(head, tail, sIdx + 1);
            if (typeof pathInfo === 'string') return null;
            const { d, firstSegmentAngle } = pathInfo;

            // Pilih variasi spesies secara unik per ular
            const species = SNAKE_SPECIES[sIdx % SNAKE_SPECIES.length];

            return (
              <g key={snake.id}>
                {/* Bayangan Tubuh Ular */}
                <path d={d} fill="none" stroke="rgba(0,0,0,0.28)" strokeWidth="1.6" strokeLinecap="round" transform="translate(0.2, 0.3)" />

                {/* Tubuh Utama Spesies Ular */}
                <path d={d} fill="none" stroke={`url(#${species.gradientId})`} strokeWidth="1.45" strokeLinecap="round" />

                {/* Pola Sisik & Belang Khas Spesies */}
                <path
                  d={d}
                  fill="none"
                  stroke={species.scalesColor}
                  strokeWidth="0.55"
                  strokeDasharray="0.6 1.1"
                  strokeLinecap="round"
                  opacity="0.9"
                />

                {/* Garis Kilau Punggung */}
                <path
                  d={d}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="0.2"
                  strokeLinecap="round"
                  opacity="0.35"
                />

                {/* Lidah Bercabang */}
                <g transform={`translate(${head.x}, ${head.y}) rotate(${(firstSegmentAngle * 180) / Math.PI + 180})`}>
                  <path d="M 0.6 0 L 1.6 0 L 2.1 -0.4 M 1.6 0 L 2.1 0.4" fill="none" stroke={species.tongueColor} strokeWidth="0.22" strokeLinecap="round" />
                </g>

                {/* Kepala Ular */}
                <g transform={`translate(${head.x}, ${head.y}) rotate(${(firstSegmentAngle * 180) / Math.PI + 180})`}>
                  <ellipse cx="0" cy="0" rx="1.15" ry="0.9" fill={species.headColor} stroke="rgba(0,0,0,0.4)" strokeWidth="0.15" />
                  {/* Mata Reptil Berpupil Slit Vertikal */}
                  <circle cx="-0.25" cy="-0.4" r="0.28" fill={species.eyeIris} />
                  <circle cx="-0.25" cy="0.4" r="0.28" fill={species.eyeIris} />
                  <ellipse cx="-0.25" cy="-0.4" rx="0.08" ry="0.2" fill={species.eyePupil} />
                  <ellipse cx="-0.25" cy="0.4" rx="0.08" ry="0.2" fill={species.eyePupil} />
                </g>
              </g>
            );
          })}

          {/* 3. RANJAU CAPIT BAJA */}
          {snakesState?.mines?.map((mineTile, idx) => {
            const pos = getTileCoordinates(mineTile);
            return (
              <g key={`mine-${idx}`} transform={`translate(${pos.x}, ${pos.y})`}>
                <circle cx="0" cy="0" r="3.2" fill="#ef4444" opacity="0.12" className="animate-ping" />
                <ellipse cx="0" cy="-0.2" rx="2.8" ry="1.6" fill="none" stroke="url(#trapMetalDark)" strokeWidth="0.5" />
                <polygon points="-2.2,-0.4 -2.0,-1.5 -1.7,-0.4" fill="url(#trapJawSteel)" />
                <polygon points="-1.5,-0.7 -1.2,-1.8 -0.9,-0.7" fill="url(#trapJawSteel)" />
                <polygon points="-0.6,-0.9 -0.3,-2.0 0.0,-0.9" fill="url(#trapJawSteel)" />
                <polygon points="0.3,-0.9 0.6,-2.0 0.9,-0.9" fill="url(#trapJawSteel)" />
                <polygon points="1.2,-0.7 1.5,-1.8 1.8,-0.7" fill="url(#trapJawSteel)" />
                <polygon points="1.9,-0.4 2.2,-1.5 2.4,-0.4" fill="url(#trapJawSteel)" />
                <line x1="-2.7" y1="0.1" x2="2.7" y2="0.1" stroke="#334155" strokeWidth="0.4" strokeLinecap="round" />
                <line x1="0" y1="-1.4" x2="0" y2="1.3" stroke="#475569" strokeWidth="0.35" strokeLinecap="round" />
                <path d="M -2.7 0.1 C -2.2 1.6, 2.2 1.6, 2.7 0.1" fill="none" stroke="url(#trapMetalDark)" strokeWidth="0.6" />
                <polygon points="-2.4,0.3 -2.2,1.3 -1.9,0.5" fill="url(#trapJawSteel)" />
                <polygon points="-1.7,0.7 -1.4,1.7 -1.1,0.8" fill="url(#trapJawSteel)" />
                <polygon points="-0.8,0.9 -0.5,1.9 -0.2,1.0" fill="url(#trapJawSteel)" />
                <polygon points="0.2,1.0 0.5,1.9 0.8,0.9" fill="url(#trapJawSteel)" />
                <polygon points="1.1,0.8 1.4,1.7 1.7,0.7" fill="url(#trapJawSteel)" />
                <polygon points="1.9,0.5 2.2,1.3 2.4,0.3" fill="url(#trapJawSteel)" />
                <circle cx="0" cy="0" r="0.9" fill="#94a3b8" stroke="#1e293b" strokeWidth="0.15" />
                <circle cx="0" cy="0" r="0.55" fill="#dc2626" />
              </g>
            );
          })}

          {/* 4. BLACK HOLE & WHITE HOLE */}
          {snakesState?.wormholes?.map((wh) => {
            const bhPos = getTileCoordinates(wh.blackHole);
            const whPos = getTileCoordinates(wh.whiteHole);

            return (
              <g key={wh.id}>
                {/* Black Hole (Hitam Pekat Berpusar) */}
                <g transform={`translate(${bhPos.x}, ${bhPos.y})`}>
                  {/* Lingkaran Gravitasi Gelap Terluar */}
                  <circle cx="0" cy="0" r="4.6" fill="url(#bhDeepBlackGrad)" />

                  {/* Pusaran Lengan Spiral Searah Jarum Jam */}
                  <g className="vortex-cw">
                    <path
                      d="M 0 0 C 1.2 0.4, 2.6 2.0, 3.4 0.6 C 4.0 -0.6, 2.2 -2.2, 0 0"
                      fill="#18181b"
                      opacity="0.8"
                    />
                    <path
                      d="M 0 0 C -1.2 -0.4, -2.6 -2.0, -3.4 -0.6 C -4.0 0.6, -2.2 2.2, 0 0"
                      fill="#18181b"
                      opacity="0.8"
                    />
                    <path
                      d="M 0 0 C -0.4 1.2, -2.0 2.6, -0.6 3.4 C 0.6 4.0, 2.2 2.2, 0 0"
                      fill="#09090b"
                      opacity="0.9"
                    />
                    <path
                      d="M 0 0 C 0.4 -1.2, 2.0 -2.6, 0.6 -3.4 C -0.6 -4.0, -2.2 -2.2, 0 0"
                      fill="#09090b"
                      opacity="0.9"
                    />
                  </g>

                  {/* Pusaran Lapis Kedua Berlawanan Arah */}
                  <g className="vortex-ccw">
                    <circle cx="0" cy="0" r="2.8" fill="url(#bhAccretionGrad)" />
                    <path
                      d="M 0 0 C 0.8 0.8, 1.8 1.8, 2.4 0 C 2.8 -1.2, 1.2 -1.8, 0 0"
                      fill="#27272a"
                      opacity="0.6"
                    />
                    <path
                      d="M 0 0 C -0.8 -0.8, -1.8 -1.8, -2.4 0 C -2.8 1.2, -1.2 1.8, 0 0"
                      fill="#27272a"
                      opacity="0.6"
                    />
                  </g>

                  {/* Cincin Distorsi Lensa Gravitasi */}
                  <circle cx="0" cy="0" r="1.8" fill="none" stroke="#3f3f46" strokeWidth="0.25" opacity="0.6" />

                  {/* Inti Singularity Hitam Pekat */}
                  <circle cx="0" cy="0" r="1.3" fill="#000000" stroke="#18181b" strokeWidth="0.3" />
                </g>

                {/* White Hole */}
                <g transform={`translate(${whPos.x}, ${whPos.y})`}>
                  <circle cx="0" cy="0" r="4.3" fill="url(#whPusaranGrad)" />
                  <g className="vortex-ccw">
                    <path d="M 0 0 C 0.5 1.5, 1.8 3.0, 0.6 3.6 C -0.8 4.2, -2.4 2.2, 0 0" fill="#38bdf8" opacity="0.6" />
                    <path d="M 0 0 C -0.5 -1.5, -1.8 -3.0, -0.6 -3.6 C 0.8 -4.2, 2.4 -2.2, 0 0" fill="#38bdf8" opacity="0.6" />
                  </g>
                  <g className="jet-beam">
                    <path d="M -0.3 0 L 0 -4.2 L 0.3 0 L 0 4.2 Z" fill="#e0f2fe" opacity="0.8" />
                    <line x1="0" y1="-4.5" x2="0" y2="4.5" stroke="#ffffff" strokeWidth="0.25" strokeLinecap="round" />
                  </g>
                  <circle cx="0" cy="0" r="1.4" fill="none" stroke="#38bdf8" strokeWidth="0.3" opacity="0.85" />
                  <circle cx="0" cy="0" r="0.85" fill="#ffffff" />
                </g>
              </g>
            );
          })}
        </svg>

        {/* 5. BIDAK PEMAIN DENGAN ANIMASI LOMPATAN REALISTIS (HOPPING PARABOLIC ARC) */}
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
                transition={{ type: 'spring', stiffness: 360, damping: 24 }}
              >
                {/* Tag Nama Pemain */}
                <div className="mb-0.5 px-1.5 py-0.2 text-[9px] font-bold bg-background/95 text-foreground border border-border rounded-md shadow-xs whitespace-nowrap">
                  {p.username || 'Player'}
                </div>

                {/* Wrapper Bidak Fisik: Efek Lompat Parabola & Squash-and-Stretch */}
                <motion.div
                  key={`hop-${pos}`}
                  animate={{
                    y: [0, -18, -4, 0],
                    scaleX: [1, 0.85, 1.15, 1],
                    scaleY: [1, 1.25, 0.88, 1],
                  }}
                  transition={{
                    duration: 0.23,
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

                {/* Bayangan Bidak Dinamis (Mengecil & Memudar Saat Melayang di Udara) */}
                <motion.div
                  key={`shadow-${pos}`}
                  animate={{
                    scale: [1, 0.45, 1.15, 1],
                    opacity: [0.55, 0.2, 0.65, 0.55],
                  }}
                  transition={{
                    duration: 0.23,
                    ease: [0.25, 1, 0.5, 1],
                  }}
                  className="w-4 h-1.5 bg-black/60 rounded-full blur-[1px] -mt-0.5"
                />
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
            <SkipForward className="w-5 h-5" /> Lewati Giliran (Terjebak {myFrozenCount} Turn)
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
