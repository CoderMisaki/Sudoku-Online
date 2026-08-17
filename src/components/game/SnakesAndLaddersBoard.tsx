"use client";

import React, { useState, useMemo } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { Dices, Trophy } from 'lucide-react';
import {
  generateRandomSnakesAndLadders,
  getTileCoordinates,
} from '@/utils/snakesAndLaddersData';

interface SnakesAndLaddersBoardProps {
  broadcastSnakesDiceRoll: (diceValue: number, newPosition: number, nextTurnUserId: string, hasWon: boolean) => void;
}

// Warna kotak klasik retro seperti di gambar
const TILE_COLORS = [
  'bg-amber-300 text-amber-950', // Kuning
  'bg-blue-600 text-white',      // Biru
  'bg-red-600 text-white',       // Merah
  'bg-emerald-600 text-white',   // Hijau
  'bg-slate-100 text-slate-900',  // Putih
];

export const SnakesAndLaddersBoard: React.FC<SnakesAndLaddersBoardProps> = ({ broadcastSnakesDiceRoll }) => {
  const userId = useGameStore(state => state.userId);
  const room = useGameStore(state => state.room);
  const players = useMemo(() => room?.players || {}, [room?.players]);
  const snakesState = useGameStore(state => state.snakesState);

  // Generate susunan ular & tangga acak saat game dimulai
  const config = useMemo(() => {
    return generateRandomSnakesAndLadders();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.startedAt]);

  // List ID pemain aktif yang tidak keluar / spectator
  const activePlayerIds = useMemo(() => {
    return Object.values(players)
      .filter(p => !p.isSpectator && p.status !== 'left')
      .map(p => p.id);
  }, [players]);

  const [localDiceRoll, setLocalDiceRoll] = useState<number | null>(null);
  const [isRollingLocal, setIsRollingLocal] = useState(false);

  const positions = snakesState?.playerPositions || {};

  // Jika hanya ada 1 orang di room, otomatis menjadi giliran dia
  const isSolo = activePlayerIds.length <= 1;
  const currentTurn = snakesState?.currentTurnUserId || (isSolo ? userId : activePlayerIds[0]);
  const isMyTurn = currentTurn === userId;
  const isGameOver = !!snakesState?.winnerId;

  const handleRollDice = () => {
    if (!isMyTurn || isRollingLocal || isGameOver || !userId) return;

    setIsRollingLocal(true);

    // Animasi putaran dadu acak
    let rollCounter = 0;
    const rollInterval = setInterval(() => {
      setLocalDiceRoll(Math.floor(Math.random() * 6) + 1);
      rollCounter++;

      if (rollCounter > 10) {
        clearInterval(rollInterval);

        // Nilai dadu acak murni (1-6)
        const finalRoll = Math.floor(Math.random() * 6) + 1;
        setLocalDiceRoll(finalRoll);

        setTimeout(() => {
          setIsRollingLocal(false);

          const currentPos = positions[userId] || 1;
          let targetPos = currentPos + finalRoll;
          let hasWon = false;

          // Logika Pantulan jika melebihi kotak 100
          if (targetPos > 100) {
            targetPos = 100 - (targetPos - 100);
          } else if (targetPos === 100) {
            hasWon = true;
          }

          // Cek apakah menginjak Ular atau Tangga Acak
          if (config.map[targetPos]) {
            targetPos = config.map[targetPos];
          }

          // Tentukan giliran berikutnya
          let nextTurnUserId = userId;
          if (activePlayerIds.length > 1) {
            if (finalRoll !== 6) {
              const currentIndex = activePlayerIds.indexOf(userId);
              const nextIndex = (currentIndex + 1) % activePlayerIds.length;
              nextTurnUserId = activePlayerIds[nextIndex];
            } else {
              // Jika dapat 6, dapat giliran ekstra
              nextTurnUserId = userId;
            }
          }

          // Broadcast state ke semua pemain
          broadcastSnakesDiceRoll(finalRoll, targetPos, nextTurnUserId, hasWon);

          // Update optimistik di lokal
          useGameStore.getState().updateSnakesState({
            diceValue: finalRoll,
            playerPositions: {
              ...positions,
              [userId]: targetPos
            },
            currentTurnUserId: nextTurnUserId,
            winnerId: hasWon ? userId : null
          });
        }, 500);
      }
    }, 60);
  };

  const currentDiceDisplay = isRollingLocal ? localDiceRoll : (snakesState?.diceValue ?? '-');
  const isRolling = isRollingLocal || snakesState?.isRolling;

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl mx-auto py-4">
      {/* Banner Pemenang */}
      {isGameOver && (
        <div className="bg-amber-500/20 text-amber-500 border border-amber-500/40 px-6 py-3 rounded-2xl flex items-center gap-3 w-full justify-center shadow-lg animate-bounce">
          <Trophy className="w-7 h-7" />
          <span className="font-bold text-lg">
            🎉 {players[snakesState.winnerId!]?.username || 'Pemain'} Berhasil Menang!
          </span>
        </div>
      )}

      {/* Papan Ular Tangga 10x10 dengan Layer SVG */}
      <div className="relative w-full aspect-square border-4 border-foreground/90 rounded-2xl bg-card shadow-2xl p-1 overflow-hidden select-none">

        {/* Matrix Kotak 10x10 */}
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

            const colorClass = TILE_COLORS[(tileNumber - 1) % TILE_COLORS.length];

            return (
              <div
                key={tileNumber}
                className={`relative flex items-center justify-center font-bold text-xs sm:text-sm rounded-sm transition-all ${colorClass}`}
              >
                <span className="absolute top-1 left-1 text-[9px] sm:text-[10px] opacity-75 font-mono">
                  {tileNumber === 100 ? '⭐ 100' : tileNumber}
                </span>

                {/* Bidak Pemain di Kotak */}
                <div className="flex gap-1 items-center justify-center flex-wrap z-20 w-full h-full p-1">
                  {Object.entries(positions).map(([pId, pos]) => {
                    if (pos === tileNumber) {
                      const p = players[pId];
                      if (!p || p.isSpectator || p.status === 'left') return null;
                      return (
                        <div
                          key={pId}
                          className="w-4 h-4 sm:w-5 sm:h-5 rounded-full border-2 border-white shadow-xl transform scale-110 transition-all duration-500 ease-out"
                          style={{ backgroundColor: p.color || '#3b82f6' }}
                          title={p.username || 'Pemain'}
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

        {/* SVG Overlay: Gambar Tangga & Ular Miring Memanjang */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100">
          <defs>
            <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0.5" dy="0.8" stdDeviation="0.6" floodOpacity="0.4" />
            </filter>
          </defs>

          {/* 1. Render Tangga Menembus Baris */}
          {config.ladders.map((ladder) => {
            const start = getTileCoordinates(ladder.start);
            const end = getTileCoordinates(ladder.end);

            const dx = end.x - start.x;
            const dy = end.y - start.y;
            const length = Math.sqrt(dx * dx + dy * dy);
            const nx = (-dy / length) * 1.3; // Offset tiang samping
            const ny = (dx / length) * 1.3;

            const rungsCount = Math.max(3, Math.floor(length / 5));

            return (
              <g key={ladder.id} filter="url(#shadow)">
                {/* Tiang Kiri & Kanan */}
                <line x1={start.x + nx} y1={start.y + ny} x2={end.x + nx} y2={end.y + ny} stroke="#334155" strokeWidth="0.8" strokeLinecap="round" />
                <line x1={start.x - nx} y1={start.y - ny} x2={end.x - nx} y2={end.y - ny} stroke="#334155" strokeWidth="0.8" strokeLinecap="round" />

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
                      stroke="#475569"
                      strokeWidth="0.6"
                      strokeLinecap="round"
                    />
                  );
                })}
              </g>
            );
          })}

          {/* 2. Render Ular Memanjang & Bergelombang */}
          {config.snakes.map((snake) => {
            const head = getTileCoordinates(snake.head);
            const tail = getTileCoordinates(snake.tail);

            const midX = (head.x + tail.x) / 2 + snake.curveFactor;
            const midY = (head.y + tail.y) / 2;

            const pathD = `M ${head.x} ${head.y} Q ${midX} ${midY} ${tail.x} ${tail.y}`;

            return (
              <g key={snake.id} filter="url(#shadow)">
                {/* Badan Luar Ular */}
                <path d={pathD} fill="none" stroke={snake.color} strokeWidth="2.2" strokeLinecap="round" />
                {/* Corak Garis Tengah Ular */}
                <path d={pathD} fill="none" stroke={snake.patternColor} strokeWidth="0.8" strokeDasharray="1.5 1.5" strokeLinecap="round" />

                {/* Kepala Ular */}
                <circle cx={head.x} cy={head.y} r="1.6" fill={snake.color} />
                <circle cx={head.x - 0.4} cy={head.y - 0.4} r="0.4" fill="#ffffff" />
                <circle cx={head.x + 0.4} cy={head.y - 0.4} r="0.4" fill="#ffffff" />
                <circle cx={head.x - 0.4} cy={head.y - 0.4} r="0.2" fill="#000000" />
                <circle cx={head.x + 0.4} cy={head.y - 0.4} r="0.2" fill="#000000" />

                {/* Lidah Merah */}
                <line x1={head.x} y1={head.y - 1.2} x2={head.x} y2={head.y - 2.2} stroke="#ef4444" strokeWidth="0.3" strokeLinecap="round" />
              </g>
            );
          })}
        </svg>
      </div>

      {/* Kontrol Dadu & Informasi Giliran */}
      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-2xl border border-border shadow-lg w-full justify-between">
        <div className="flex items-center gap-4">
          <div className="text-center font-mono w-16 bg-secondary/10 py-1.5 rounded-xl border border-border">
            <div className="text-[10px] text-secondary font-semibold uppercase tracking-wider">Dadu</div>
            <div className="text-3xl font-black text-foreground">{currentDiceDisplay}</div>
          </div>

          <div className="border-l border-border h-10"></div>

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
