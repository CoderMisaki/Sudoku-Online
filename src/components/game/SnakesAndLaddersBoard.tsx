"use client";

import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { Dices, Trophy, ArrowUpRight, ArrowDownRight, Medal } from 'lucide-react';
import {
  generateSnakesAndLaddersByDifficulty,
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

  // Mengikuti standar difficulty room: easy s/d evil
  const config = useMemo(() => {
    return generateSnakesAndLaddersByDifficulty(room?.difficulty || 'medium');
  }, [room?.difficulty]);

  const activePlayerIds = useMemo(() => {
    return Object.values(players)
      .filter(p => !p.isSpectator && p.status !== 'left')
      .map(p => p.id);
  }, [players]);

  const [localDiceRoll, setLocalDiceRoll] = useState<number | null>(null);
  const [isRollingLocal, setIsRollingLocal] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  // Posisi visual per pemain untuk animasi
  const [visualPositions, setVisualPositions] = useState<Record<string, number>>({});
  const isAnimatingRef = useRef(false);

  const serverPositions = useMemo(() => snakesState?.playerPositions || {}, [snakesState?.playerPositions]);

  // Daftar pemain yang telah berhasil finis (Juara 1, 2, 3)
  const finishers = useMemo(() => {
    const list: { id: string; rank: number }[] = [];
    Object.entries(serverPositions).forEach(([pId, pos]) => {
      const p = players[pId];
      if (pos === 100 && p) {
        list.push({ id: pId, rank: p.rank || 1 });
      }
    });
    return list.sort((a, b) => a.rank - b.rank);
  }, [serverPositions, players]);

  // Animasi langkah melompat per-kotak (Hopping Parabolic Step by Step)
  const animatePath = async (
    targetUserId: string,
    startPos: number,
    finalDest: number,
    onComplete?: () => void
  ) => {
    isAnimatingRef.current = true;
    const pName = players[targetUserId]?.username || 'Pemain';

    let intermediateTarget = finalDest;
    let isLadder = false;
    let isSnake = false;

    // Cek apakah tujuan akhir adalah hasil dari Tangga atau Ular
    for (const ladder of config.ladders) {
      if (ladder.end === finalDest) {
        intermediateTarget = ladder.start;
        isLadder = true;
        break;
      }
    }
    for (const snake of config.snakes) {
      if (snake.tail === finalDest) {
        intermediateTarget = snake.head;
        isSnake = true;
        break;
      }
    }

    // 1. Langkah melompat satu demi satu ke kotak injakan awal
    let current = startPos;
    if (intermediateTarget > current) {
      while (current < intermediateTarget) {
        current++;
        setVisualPositions(prev => ({ ...prev, [targetUserId]: current }));
        await new Promise(res => setTimeout(res, 200));
      }
    } else if (intermediateTarget < current && !isSnake && !isLadder) {
      while (current > intermediateTarget) {
        current--;
        setVisualPositions(prev => ({ ...prev, [targetUserId]: current }));
        await new Promise(res => setTimeout(res, 200));
      }
    }

    // 2. Jika Masuk Tangga (Memanjat)
    if (isLadder) {
      setActionStatus(`🪜 ${pName} memanjat tangga dari ${intermediateTarget} ke ${finalDest}!`);
      await new Promise(res => setTimeout(res, 300));
      setVisualPositions(prev => ({ ...prev, [targetUserId]: finalDest }));
      await new Promise(res => setTimeout(res, 500));
      setActionStatus(null);
    }
    // 3. Jika Terinjak Ular (Meluncur Turun)
    else if (isSnake) {
      setActionStatus(`🐍 ${pName} ditelan ular dari ${intermediateTarget} turun ke ${finalDest}!`);
      await new Promise(res => setTimeout(res, 300));
      setVisualPositions(prev => ({ ...prev, [targetUserId]: finalDest }));
      await new Promise(res => setTimeout(res, 500));
      setActionStatus(null);
    }

    isAnimatingRef.current = false;
    if (onComplete) onComplete();
  };

  useEffect(() => {
    const timer = setTimeout(() => {
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
    }, 0);
    return () => clearTimeout(timer);
  }, [players, serverPositions]);

  // Sinkronisasi animasi saat player lain melempar dadu
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
  const isGameOver = Boolean(snakesState?.winnerId);

  const handleRollDice = () => {
    if (!isMyTurn || isRollingLocal || isGameOver || !userId || isAnimatingRef.current) return;

    setIsRollingLocal(true);

    let rollCounter = 0;
    const rollInterval = setInterval(() => {
      setLocalDiceRoll(Math.floor(Math.random() * 6) + 1);
      rollCounter++;

      if (rollCounter > 7) {
        clearInterval(rollInterval);

        const finalRoll = Math.floor(Math.random() * 6) + 1;
        setLocalDiceRoll(finalRoll);

        setTimeout(() => {
          setIsRollingLocal(false);

          const currentPos = visualPositions[userId] || serverPositions[userId] || 1;
          let targetPos = currentPos + finalRoll;
          let hasWon = false;

          // Aturan pantulan jika melebihi 100
          if (targetPos > 100) {
            targetPos = 100 - (targetPos - 100);
          } else if (targetPos === 100) {
            hasWon = true;
          }

          // Cek Tangga atau Ular
          if (config.map[targetPos]) {
            targetPos = config.map[targetPos];
          }

          // Hitung Medali / Ranking Juara (1, 2, atau 3)
          if (hasWon || targetPos === 100) {
            const currentFinishedCount = Object.values(players).filter(p => (p.rank ?? 0) > 0).length;
            const myRank = currentFinishedCount + 1;
            useGameStore.getState().updatePlayer(userId, { rank: myRank });
          }

          // Aturan Giliran Selanjutnya
          let nextTurnUserId = userId;
          if (activePlayerIds.length > 1) {
            if (finalRoll !== 6) {
              const currentIndex = activePlayerIds.indexOf(userId);
              const nextIndex = (currentIndex + 1) % activePlayerIds.length;
              nextTurnUserId = activePlayerIds[nextIndex];
            } else {
              toast('Angka 6! Lempar dadu sekali lagi 🎲', { icon: '✨' });
            }
          }

          // Jalankan animasi lompat lokal
          animatePath(userId, currentPos, targetPos, () => {
            broadcastSnakesDiceRoll(finalRoll, targetPos, nextTurnUserId, hasWon);
            useGameStore.getState().updateSnakesState({
              diceValue: finalRoll,
              playerPositions: {
                ...serverPositions,
                [userId]: targetPos,
              },
              currentTurnUserId: nextTurnUserId,
              winnerId: hasWon ? userId : snakesState?.winnerId || null,
            });
          });
        }, 300);
      }
    }, 55);
  };

  const currentDiceDisplay = isRollingLocal ? localDiceRoll : (snakesState?.diceValue ?? '-');
  const isRolling = isRollingLocal || snakesState?.isRolling;

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-2xl mx-auto select-none">
      {/* Banner Pemenang / Peringkat */}
      {isGameOver && (
        <div className="bg-foreground text-background border border-border px-5 py-3 rounded-2xl flex items-center gap-3 w-full justify-center shadow-xl animate-bounce">
          <Trophy className="w-6 h-6 text-amber-400" />
          <span className="font-bold text-sm sm:text-base">
            🎉 {snakesState?.winnerId ? (players[snakesState.winnerId]?.username || 'Pemain') : 'Pemain'} Berhasil Mencapai 100 & Menjadi Juara 1!
          </span>
        </div>
      )}

      {/* Leaderboard Juara 1 - 3 */}
      {finishers.length > 0 && (
        <div className="flex items-center gap-3 bg-card border border-border px-4 py-2 rounded-xl text-xs shadow-sm">
          <span className="font-semibold text-secondary flex items-center gap-1">
            <Medal className="w-4 h-4 text-amber-500" /> Podium:
          </span>
          {finishers.map((f, idx) => (
            <span key={f.id} className="font-bold flex items-center gap-1">
              {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : null} {players[f.id]?.username}
            </span>
          ))}
        </div>
      )}

      {/* Status Aksi Ular / Tangga */}
      <AnimatePresence>
        {actionStatus && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="bg-card border border-border text-foreground px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md flex items-center gap-2"
          >
            {actionStatus.includes('🪜') ? <ArrowUpRight className="w-4 h-4 text-emerald-500" /> : <ArrowDownRight className="w-4 h-4 text-red-500" />}
            {actionStatus}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Papan Ular Tangga 10x10 Modern */}
      <div className="relative w-full aspect-square border-2 border-border bg-card rounded-2xl shadow-xl p-1 overflow-hidden">
        {/* Grid 10x10 Kotak */}
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
                className={`relative flex items-center justify-center text-xs rounded-sm transition-colors ${
                  tileNumber === 100
                    ? 'bg-foreground text-background font-black'
                    : isAlternate
                    ? 'bg-secondary/10 text-foreground/80'
                    : 'bg-card text-secondary'
                }`}
              >
                <span className="absolute top-1 left-1 text-[9px] sm:text-[10px] font-mono opacity-50">
                  {tileNumber === 100 ? '⭐100' : tileNumber}
                </span>
              </div>
            );
          })}
        </div>

        {/* SVG Overlay: Desain Tangga & Ular Monokrom Lebih Ramping (Dikecilkan >50%) */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100">
          <defs>
            {/* Gradasi Monokrom Badan Ular */}
            <linearGradient id="snakeBodyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#27272a" />
              <stop offset="50%" stopColor="#71717a" />
              <stop offset="100%" stopColor="#18181b" />
            </linearGradient>
            {/* Gradasi Monokrom Sisik/Perut Ular */}
            <linearGradient id="snakeBellyGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#e4e4e7" />
              <stop offset="100%" stopColor="#a1a1aa" />
            </linearGradient>
          </defs>

          {/* 1. TANGGA MONOKROM (Ramping / 50% Lebih Kecil) */}
          {config.ladders.map((ladder) => {
            const start = getTileCoordinates(ladder.start);
            const end = getTileCoordinates(ladder.end);

            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            // Lebar tangga dipersempit dari 1.3 menjadi 0.6
            const nx = (-dy / length) * 0.6;
            const ny = (dx / length) * 0.6;
            const rungsCount = Math.max(3, Math.floor(length / 4.5));

            return (
              <g key={ladder.id}>
                {/* Tiang Tangga Kiri & Kanan (Monokrom) */}
                <line x1={start.x + nx} y1={start.y + ny} x2={end.x + nx} y2={end.y + ny} stroke="#71717a" strokeWidth="0.4" strokeLinecap="round" opacity="0.85" />
                <line x1={start.x - nx} y1={start.y - ny} x2={end.x - nx} y2={end.y - ny} stroke="#71717a" strokeWidth="0.4" strokeLinecap="round" opacity="0.85" />

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
                      stroke="#d4d4d8"
                      strokeWidth="0.3"
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* 2. ULAR MONOKROM (Ramping / 50% Lebih Kecil) */}
          {config.snakes.map((snake) => {
            const head = getTileCoordinates(snake.head);
            const tail = getTileCoordinates(snake.tail);

            const dx = tail.x - head.x;
            const dy = tail.y - head.y;
            const angle = Math.atan2(dy, dx);

            // Double Wave Control Points
            const c1x = head.x + dx * 0.35 + Math.cos(angle + Math.PI / 2) * (snake.waveStrength * 0.8);
            const c1y = head.y + dy * 0.35 + Math.sin(angle + Math.PI / 2) * (snake.waveStrength * 0.8);
            const c2x = head.x + dx * 0.7 - Math.cos(angle + Math.PI / 2) * (snake.waveStrength * 0.8);
            const c2y = head.y + dy * 0.7 - Math.sin(angle + Math.PI / 2) * (snake.waveStrength * 0.8);

            const pathD = `M ${head.x} ${head.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${tail.x} ${tail.y}`;

            // Lidah Ramping
            const tongueLength = 1.2;
            const tx = head.x - Math.cos(angle) * tongueLength;
            const ty = head.y - Math.sin(angle) * tongueLength;
            const fork1X = tx - Math.cos(angle + 0.45) * 0.55;
            const fork1Y = ty - Math.sin(angle + 0.45) * 0.55;
            const fork2X = tx - Math.cos(angle - 0.45) * 0.55;
            const fork2Y = ty - Math.sin(angle - 0.45) * 0.55;

            return (
              <g key={snake.id}>
                {/* Lidah Monokrom */}
                <path
                  d={`M ${head.x} ${head.y} L ${tx} ${ty} M ${tx} ${ty} L ${fork1X} ${fork1Y} M ${tx} ${ty} L ${fork2X} ${fork2Y}`}
                  stroke="#71717a"
                  strokeWidth="0.2"
                  strokeLinecap="round"
                />

                {/* Badan Utama Ular (Dikecilkan ke 1.2) */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="url(#snakeBodyGrad)"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                />

                {/* Motif Sisik Garis Perut Ular */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="url(#snakeBellyGrad)"
                  strokeWidth="0.4"
                  strokeDasharray="0.6 0.8"
                  strokeLinecap="round"
                />

                {/* Kepala Ular Monokrom (Dikecilkan ke rx 1.0, ry 0.75) */}
                <ellipse
                  cx={head.x}
                  cy={head.y}
                  rx="1.0"
                  ry="0.75"
                  transform={`rotate(${(angle * 180) / Math.PI + 180}, ${head.x}, ${head.y})`}
                  fill="#3f3f46"
                  stroke="#18181b"
                  strokeWidth="0.15"
                />

                {/* Mata Kiri & Kanan */}
                <circle cx={head.x - 0.35} cy={head.y - 0.35} r="0.22" fill="#f4f4f5" />
                <circle cx={head.x + 0.35} cy={head.y - 0.35} r="0.22" fill="#f4f4f5" />
                {/* Pupil Mata */}
                <circle cx={head.x - 0.35} cy={head.y - 0.35} r="0.1" fill="#09090b" />
                <circle cx={head.x + 0.35} cy={head.y - 0.35} r="0.1" fill="#09090b" />
              </g>
            );
          })}
        </svg>

        {/* 3. Layer Bidak Pemain Melompat (Hopping Animation) */}
        <div className="absolute inset-0 pointer-events-none z-30">
          {Object.entries(visualPositions).map(([pId, pos]) => {
            const p = players[pId];
            if (!p || p.isSpectator || p.status === 'left') return null;

            const coords = getTileCoordinates(pos || 1);
            const rank = p.rank ?? 0;

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
                  stiffness: 300,
                  damping: 20,
                  mass: 0.5,
                }}
              >
                {/* Username Badge + Medali Juara */}
                <div className="mb-0.5 px-1.5 py-0.2 text-[9px] sm:text-[10px] font-bold bg-background/90 text-foreground border border-border rounded-md shadow-md whitespace-nowrap flex items-center gap-1 -translate-y-1">
                  {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null}
                  {p.username || 'Player'}
                </div>

                {/* Avatar Token Pion Beranimasi Loncat */}
                <motion.div
                  key={`${pId}-${pos}`}
                  initial={{ y: -10, scaleY: 1.25, scaleX: 0.8 }}
                  animate={{ y: 0, scaleY: 1, scaleX: 1 }}
                  transition={{ type: 'spring', stiffness: 450, damping: 18 }}
                  className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 border-background shadow-xl flex items-center justify-center text-[10px] font-black text-white ring-1 ring-border"
                  style={{ backgroundColor: p.color || '#3b82f6' }}
                >
                  {p.username?.charAt(0).toUpperCase()}
                </motion.div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Kontrol Dadu & Indikator Giliran */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-2xl border border-border shadow-md w-full justify-between">
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
          {isRolling ? 'Mengocok...' : 'Lempar Dadu'}
        </Button>
      </div>
    </div>
  );
};
