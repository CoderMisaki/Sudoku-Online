"use client";

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import {
  Trophy,
  RotateCcw,
  Bot,
  Users,
  Volume2,
  VolumeX,
  Sparkles,
  Circle,
} from 'lucide-react';
import {
  createInitialOthelloState,
  applyOthelloMove,
  getBestOthelloBotMove,
  getValidMoves,
  OTHELLO_BOT_USER_ID,
} from '@/utils/othello';
import { sounds } from '@/utils/sounds';
import { OthelloState, OthelloDisc, Player } from '@/types/game';
import toast from 'react-hot-toast';

interface OthelloBoardProps {
  broadcastOthelloState?: (newState: OthelloState) => void;
  broadcastPlayerStats?: (stats: { score?: number; progress?: number; rank?: number | null }) => void;
}

const EMPTY_PLAYERS: Record<string, Player> = {};

export const OthelloBoard: React.FC<OthelloBoardProps> = ({
  broadcastOthelloState,
  broadcastPlayerStats,
}) => {
  const userId = useGameStore((state) => state.userId);
  const room = useGameStore((state) => state.room);
  const players = room?.players || EMPTY_PLAYERS;
  const othelloState = useGameStore((state) => state.othelloState);
  const updateOthelloState = useGameStore((state) => state.updateOthelloState);
  const updatePlayer = useGameStore((state) => state.updatePlayer);

  const [sfxMuted, setSfxMuted] = useState(false);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [showHints, setShowHints] = useState(true);
  const isInitializedRef = useRef(false);
  const botTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activePlayers = useMemo(() => {
    return Object.values(players).filter((p) => !p.isSpectator && p.status !== 'left');
  }, [players]);

  const hostPlayer = useMemo(() => {
    return activePlayers.find((p) => p.isHost) || activePlayers[0];
  }, [activePlayers]);

  const guestPlayer = useMemo(() => {
    return activePlayers.find((p) => p.id !== (hostPlayer?.id || ''));
  }, [activePlayers, hostPlayer]);

  const isSolo = activePlayers.length <= 1;

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from localStorage on mount
    setSfxMuted(sounds.isMuted());
  }, []);

  // Host menginisialisasi state Othello jika belum ada
  useEffect(() => {
    if (!othelloState || !othelloState.grid || othelloState.grid.length === 0) {
      if (!isInitializedRef.current && activePlayers.length > 0 && room?.hostId === userId) {
        isInitializedRef.current = true;
        const initial = createInitialOthelloState(activePlayers, room?.hostId || userId || '');
        updateOthelloState(initial);
        if (broadcastOthelloState) broadcastOthelloState(initial);
      }
    }
  }, [othelloState, activePlayers, room?.hostId, userId, updateOthelloState, broadcastOthelloState]);

  // Player 2 masuk/keluar: otomatis alihkan playerW antara Bot dan pemain asli
  useEffect(() => {
    if (!othelloState || room?.hostId !== userId) return;

    if (guestPlayer && othelloState.isAgainstBot) {
      const updated: OthelloState = {
        ...othelloState,
        isAgainstBot: false,
        playerW: {
          id: guestPlayer.id,
          username: guestPlayer.username || 'Pemain 2',
          disc: 'W',
          color: guestPlayer.color || '#ef4444',
          avatar: guestPlayer.avatar || null,
          isBot: false,
        },
        currentTurnUserId:
          othelloState.currentTurnUserId === OTHELLO_BOT_USER_ID
            ? guestPlayer.id
            : othelloState.currentTurnUserId,
        revision: (othelloState.revision ?? 0) + 1,
      };
      updateOthelloState(updated);
      if (broadcastOthelloState) broadcastOthelloState(updated);
      toast.success(`${guestPlayer.username || 'Pemain 2'} bergabung! Mode Player vs Player aktif.`, {
        icon: '👥',
      });
    } else if (!guestPlayer && !othelloState.isAgainstBot) {
      const updated: OthelloState = {
        ...othelloState,
        isAgainstBot: true,
        playerW: {
          id: OTHELLO_BOT_USER_ID,
          username: 'BOT (Master AI)',
          disc: 'W',
          color: '#10b981',
          avatar: null,
          isBot: true,
        },
        currentTurnUserId:
          othelloState.currentTurnUserId === othelloState.playerW.id
            ? OTHELLO_BOT_USER_ID
            : othelloState.currentTurnUserId,
        revision: (othelloState.revision ?? 0) + 1,
      };
      updateOthelloState(updated);
      if (broadcastOthelloState) broadcastOthelloState(updated);
      toast('Pemain 2 keluar. Mode bermain lawan Bot AI aktif.', { icon: '🤖' });
    }
  }, [guestPlayer, othelloState, room?.hostId, userId, updateOthelloState, broadcastOthelloState]);

  const isMyTurn = useMemo(() => {
    if (!othelloState || othelloState.winner !== null) return false;
    if (othelloState.isAgainstBot) {
      return othelloState.currentTurnDisc === 'B';
    }
    return othelloState.currentTurnUserId === userId;
  }, [othelloState, userId]);

  // Terapkan bonus kemenangan (+10 skor room) — dipanggil sekali oleh pembuat langkah penentu
  const applyWinBonus = useCallback(
    (finalState: OthelloState) => {
      if (finalState.winner === null || finalState.winner === 'draw') return;
      const winnerId = finalState.winner;
      const winnerInfo = winnerId === finalState.playerB.id ? finalState.playerB : finalState.playerW;
      if (winnerInfo.isBot) return;
      const newScore = (players[winnerId]?.score || 0) + 10;
      updatePlayer(winnerId, { score: newScore });
      broadcastPlayerStats?.({ score: newScore });
    },
    [players, updatePlayer, broadcastPlayerStats]
  );

  const announceGameEnd = useCallback((finalState: OthelloState) => {
    if (finalState.winner === null) return;
    if (finalState.winner === 'draw') {
      sounds.ticTacToeDraw();
      toast(`🤝 Seri! Hitam ${finalState.counts.B} - ${finalState.counts.W} Putih.`, { duration: 3000 });
      return;
    }
    const winnerInfo =
      finalState.winner === finalState.playerB.id ? finalState.playerB : finalState.playerW;
    const label = `Hitam ${finalState.counts.B} - ${finalState.counts.W} Putih`;
    if (winnerInfo.isBot) {
      sounds.ticTacToeLose();
      toast.error(`🤖 ${winnerInfo.username} Menang! (${label})`, { duration: 3500 });
    } else {
      sounds.ticTacToeWin();
      toast.success(`🎉 ${winnerInfo.username} Menang! (${label}) (+10 Skor)`, { duration: 3500 });
    }
  }, []);

  // Otomatisasi giliran Bot (berjalan di klien host saat lawan Bot)
  useEffect(() => {
    if (!othelloState || othelloState.winner !== null) return;
    if (!othelloState.isAgainstBot) return;
    if (othelloState.currentTurnDisc !== 'W') return;
    if (room?.hostId !== userId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsBotThinking(true);

    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);

    botTimeoutRef.current = setTimeout(() => {
      const latest = useGameStore.getState().othelloState;
      if (!latest || latest.currentTurnDisc !== 'W' || latest.winner !== null) {
        setIsBotThinking(false);
        return;
      }

      const botMove = getBestOthelloBotMove(latest);
      if (!botMove) {
        setIsBotThinking(false);
        return;
      }

      const { next, valid } = applyOthelloMove(latest, botMove.row, botMove.col, OTHELLO_BOT_USER_ID);
      if (!valid) {
        setIsBotThinking(false);
        return;
      }
      sounds.othelloPlace(next.lastMove?.flipped.length || 1);
      if (next.lastMove?.skippedOpponent) {
        sounds.othelloPass();
        toast('Kamu tidak punya langkah sah — giliran dilewati, Bot jalan lagi!', {
          icon: '⏭️',
          duration: 2200,
        });
      }
      if (next.winner !== null) announceGameEnd(next);

      updateOthelloState(next);
      if (broadcastOthelloState) broadcastOthelloState(next);
      setIsBotThinking(false);
    }, 600);

    return () => {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    };
  }, [othelloState, room?.hostId, userId, updateOthelloState, broadcastOthelloState, announceGameEnd]);

  // Langkah pemain manusia (klik kotak)
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      const latest = useGameStore.getState().othelloState;
      if (!latest || latest.winner !== null || !userId) return;
      if (latest.grid[row][col] !== null) return;

      if (latest.isAgainstBot) {
        if (latest.currentTurnDisc !== 'B' || isBotThinking) return;
      } else if (latest.currentTurnUserId !== userId) {
        toast('Bukan giliranmu!', { icon: '⏳', id: 'not-your-turn' });
        return;
      }

      const { next, valid } = applyOthelloMove(latest, row, col, userId);
      if (!valid) {
        toast('Langkah tidak sah! Kepingmu harus mengapit keping lawan.', {
          icon: '⚠️',
          id: 'othello-invalid',
          duration: 1800,
        });
        return;
      }

      sounds.unlock();
      sounds.othelloPlace(next.lastMove?.flipped.length || 1);
      if (next.lastMove?.skippedOpponent) {
        sounds.othelloPass();
        const skippedName = latest.isAgainstBot
          ? 'Bot'
          : latest.currentTurnDisc === 'B'
          ? latest.playerW.username
          : latest.playerB.username;
        toast(`${skippedName} tidak punya langkah sah — giliran dilewati, kamu jalan lagi!`, {
          icon: '⏭️',
          duration: 2200,
        });
      }
      if (next.winner !== null) {
        announceGameEnd(next);
        applyWinBonus(next);
      }

      updateOthelloState(next);
      if (broadcastOthelloState) broadcastOthelloState(next);
    },
    [userId, isBotThinking, updateOthelloState, broadcastOthelloState, announceGameEnd, applyWinBonus]
  );

  // Reset papan (ronde baru)
  const handleResetBoard = useCallback(() => {
    const latest = useGameStore.getState().othelloState;
    if (!latest || !room) return;

    const fresh = createInitialOthelloState(activePlayers, room.hostId || userId || '');
    const nextState: OthelloState = {
      ...fresh,
      revision: Math.max(fresh.revision, (latest.revision ?? 0) + 1),
    };

    updateOthelloState(nextState);
    if (broadcastOthelloState) broadcastOthelloState(nextState);
    toast.success('Papan telah direset untuk ronde baru!', { icon: '🔄' });
  }, [room, activePlayers, userId, updateOthelloState, broadcastOthelloState]);

  // Himpunan langkah sah untuk highlight (hitung ulang defensif bila kosong)
  const validMoveSet = useMemo(() => {
    if (!othelloState || othelloState.winner !== null) return new Set<string>();
    const moves =
      othelloState.validMoves.length > 0
        ? othelloState.validMoves
        : getValidMoves(othelloState.grid, othelloState.currentTurnDisc);
    return new Set(moves.map((m) => `${m.row}-${m.col}`));
  }, [othelloState]);

  if (!othelloState || !othelloState.grid) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="w-8 h-8 border-3 border-foreground border-t-transparent rounded-full animate-spin" />
        <p className="text-secondary text-sm">Mempersiapkan papan Othello...</p>
      </div>
    );
  }

  const { grid, winner, lastMove, playerB, playerW, currentTurnDisc, counts } = othelloState;
  const isCellLastMove = (r: number, c: number) => lastMove?.row === r && lastMove?.col === c;

  const winnerName =
    winner === null || winner === 'draw'
      ? null
      : winner === playerB.id
      ? playerB.username
      : playerW.username;

  // Keping dibuat statis. Animasi spring pada setiap render sebelumnya membuat
  // seluruh papan tampak bergetar setiap kali sebuah langkah ditekan.
  const renderDisc = (disc: OthelloDisc, small = false) => (
    <span
      aria-hidden="true"
      className={`rounded-full block ${
        disc === 'B'
          ? 'bg-gradient-to-br from-neutral-700 via-neutral-900 to-black shadow-[0_2px_6px_rgba(0,0,0,0.45),inset_0_2px_3px_rgba(255,255,255,0.25)] border border-black/60'
          : 'bg-gradient-to-br from-white via-neutral-100 to-neutral-300 shadow-[0_2px_6px_rgba(0,0,0,0.35),inset_0_-2px_3px_rgba(0,0,0,0.15)] border border-neutral-300'
      } ${small ? 'w-6 h-6' : 'w-[82%] h-[82%]'}`}
    />
  );

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[560px] mx-auto select-none">
      {/* Banner pemenang */}
      <AnimatePresence>
        {winner && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`w-full p-4 rounded-2xl flex items-center justify-between shadow-xl ${
              winner === 'draw'
                ? 'bg-secondary/20 text-foreground border border-border'
                : winner === playerB.id
                ? 'bg-neutral-900 text-white shadow-black/30 border border-neutral-700'
                : othelloState.isAgainstBot
                ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                : 'bg-sky-600 text-white shadow-sky-500/20'
            }`}
          >
            <div className="flex items-center gap-3">
              <Trophy className="w-7 h-7 text-amber-300 animate-bounce" />
              <div>
                <h3 className="font-bold text-base sm:text-lg leading-tight">
                  {winner === 'draw' ? 'Permainan Seri (Draw)!' : `🎉 ${winnerName} Menang!`}
                </h3>
                <p className="text-xs opacity-90">
                  Hitam {counts.B} - {counts.W} Putih
                  {winner !== 'draw' && ' • Pemenang +10 Skor'}
                </p>
              </div>
            </div>

            {room?.hostId === userId && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleResetBoard}
                className="bg-white/10 hover:bg-white/20 border-white/30 text-white text-xs shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Main Lagi
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kartu Hitam vs Putih */}
      <div className="grid grid-cols-2 gap-3 w-full">
        {/* Hitam */}
        <div
          className={`p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between ${
            currentTurnDisc === 'B' && !winner
              ? 'bg-neutral-500/10 border-neutral-500/50 shadow-sm ring-2 ring-neutral-500/25'
              : 'bg-card border-border opacity-85'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="shrink-0">{renderDisc('B', true)}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs sm:text-sm truncate">{playerB.username}</span>
                {playerB.id === userId && (
                  <span className="text-[10px] bg-neutral-500/20 text-foreground px-1.5 py-0.2 rounded font-semibold">
                    Kamu
                  </span>
                )}
              </div>
              <span className="text-[11px] text-secondary">
                ⚫ Hitam: <b className="text-foreground">{counts.B}</b>
              </span>
            </div>
          </div>
          {currentTurnDisc === 'B' && !winner && (
            <span className="text-[10px] bg-neutral-800 dark:bg-neutral-200 dark:text-black text-white font-semibold px-2 py-0.5 rounded-full animate-pulse">
              Giliran
            </span>
          )}
        </div>

        {/* Putih */}
        <div
          className={`p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between ${
            currentTurnDisc === 'W' && !winner
              ? 'bg-sky-500/10 border-sky-500/40 shadow-sm ring-2 ring-sky-500/20'
              : 'bg-card border-border opacity-85'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="shrink-0">{renderDisc('W', true)}</div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs sm:text-sm truncate">{playerW.username}</span>
                {othelloState.isAgainstBot ? (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.2 rounded font-semibold flex items-center gap-0.5">
                    <Bot className="w-2.5 h-2.5" /> Bot
                  </span>
                ) : playerW.id === userId ? (
                  <span className="text-[10px] bg-sky-500/20 text-sky-500 px-1.5 py-0.2 rounded font-semibold">
                    Kamu
                  </span>
                ) : null}
              </div>
              <span className="text-[11px] text-secondary">
                ⚪ Putih: <b className="text-foreground">{counts.W}</b>
              </span>
            </div>
          </div>
          {currentTurnDisc === 'W' && !winner && (
            <span
              className={`text-[10px] text-white font-semibold px-2 py-0.5 rounded-full animate-pulse ${
                othelloState.isAgainstBot ? 'bg-emerald-600' : 'bg-sky-500'
              }`}
            >
              {isBotThinking ? 'Berpikir...' : 'Giliran'}
            </span>
          )}
        </div>
      </div>

      {/* Aturan singkat */}
      <div className="text-center text-xs text-secondary flex items-center justify-center gap-1.5 px-2">
        <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
        <span>
          Hitam jalan duluan. Apit keping lawan dalam garis lurus untuk membaliknya. Titik hijau = langkah sah.
        </span>
      </div>

      {/* Papan 8x8 hijau */}
      <div className="relative w-full aspect-square max-w-[480px] p-2 sm:p-3 bg-emerald-800 dark:bg-emerald-950 border-2 border-emerald-900 dark:border-emerald-800 rounded-3xl shadow-xl flex items-center justify-center">
        <div className="grid w-full h-full gap-[3px] grid-cols-8 grid-rows-8">
          {grid.map((row, rIdx) =>
            row.map((cell, cIdx) => {
              const isLast = isCellLastMove(rIdx, cIdx);
              const isValid = validMoveSet.has(`${rIdx}-${cIdx}`);
              const isClickable = cell === null && isValid && !winner && isMyTurn && !isBotThinking;

              return (
                <button
                  key={`${rIdx}-${cIdx}`}
                  type="button"
                  onClick={() => handleCellClick(rIdx, cIdx)}
                  disabled={cell !== null || winner !== null || (!isMyTurn && !isSolo) || isBotThinking}
                  className={`relative flex items-center justify-center rounded-[4px] transition-colors duration-150 cursor-pointer touch-manipulation ${
                    isLast
                      ? 'bg-emerald-600/80 dark:bg-emerald-700/80 ring-2 ring-amber-300/80'
                      : 'bg-emerald-600/40 dark:bg-emerald-800/60 hover:bg-emerald-500/50'
                  } ${!isClickable && cell === null ? 'cursor-not-allowed' : ''}`}
                  style={{ touchAction: 'manipulation', WebkitTapHighlightColor: 'transparent' }}
                >
                  {cell && renderDisc(cell)}
                  {!cell && isValid && showHints && !winner && (
                    <span
                      className={`rounded-full block ${
                        isClickable
                          ? 'w-[26%] h-[26%] bg-emerald-200/90 shadow'
                          : 'w-[18%] h-[18%] bg-white/25'
                      }`}
                    />
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Bar kontrol bawah */}
      <div className="flex items-center justify-between bg-card p-3 sm:p-4 rounded-2xl border border-border shadow-md w-full">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !sfxMuted;
              sounds.setMuted(next);
              setSfxMuted(next);
              if (!next) {
                sounds.unlock();
                sounds.othelloPlace(1);
              }
            }}
            title={sfxMuted ? 'Nyalakan efek suara' : 'Matikan efek suara'}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-border bg-background hover:bg-hover text-secondary hover:text-foreground transition-colors cursor-pointer"
          >
            {sfxMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-1.5 text-xs text-secondary bg-background px-3 py-1.5 rounded-xl border border-border">
            {othelloState.isAgainstBot ? (
              <>
                <Bot className="w-3.5 h-3.5 text-emerald-500" />
                <span className="font-medium">Solo vs Bot</span>
              </>
            ) : (
              <>
                <Users className="w-3.5 h-3.5 text-blue-500" />
                <span className="font-medium">Player vs Player</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setShowHints((v) => !v)}
            title={showHints ? 'Sembunyikan petunjuk langkah' : 'Tampilkan petunjuk langkah'}
            className={`h-9 px-3 flex items-center gap-1.5 rounded-xl border text-xs font-medium transition-colors cursor-pointer ${
              showHints
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'border-border bg-background text-secondary hover:text-foreground'
            }`}
          >
            <Circle className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Petunjuk</span>
          </button>
        </div>

        {room?.hostId === userId && (
          <Button
            size="sm"
            variant={winner ? 'primary' : 'outline'}
            onClick={handleResetBoard}
            className="gap-1.5 text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            {winner ? 'Ronde Baru' : 'Reset Papan'}
          </Button>
        )}
      </div>
    </div>
  );
};
