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
} from 'lucide-react';
import {
  createInitialTicTacToeState,
  checkTicTacToeWin,
  getBestBotMove,
  BOT_USER_ID,
  BOT_NAME,
} from '@/utils/ticTacToe';
import { sounds } from '@/utils/sounds';
import { TicTacToeState, TicTacToeSymbol, Player } from '@/types/game';
import toast from 'react-hot-toast';

interface TicTacToeBoardProps {
  broadcastTicTacToeState?: (newState: TicTacToeState) => void;
  broadcastPlayerStats?: (stats: { score?: number; progress?: number; rank?: number | null }) => void;
}

const EMPTY_PLAYERS: Record<string, Player> = {};

export const TicTacToeBoard: React.FC<TicTacToeBoardProps> = ({
  broadcastTicTacToeState,
  broadcastPlayerStats,
}) => {
  const userId = useGameStore((state) => state.userId);
  const room = useGameStore((state) => state.room);
  const players = room?.players || EMPTY_PLAYERS;
  const ticTacToeState = useGameStore((state) => state.ticTacToeState);
  const updateTicTacToeState = useGameStore((state) => state.updateTicTacToeState);
  const updatePlayer = useGameStore((state) => state.updatePlayer);

  const [sfxMuted, setSfxMuted] = useState(false);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const isInitializedRef = useRef(false);
  const botTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Filter active real human players (non-spectator, not left)
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

  // Sync SFX mute status with localStorage
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync from localStorage on mount
    setSfxMuted(sounds.isMuted());
  }, []);

  // Host initializes Tic Tac Toe state if not present
  useEffect(() => {
    if (!ticTacToeState || !ticTacToeState.grid || ticTacToeState.grid.length === 0) {
      if (!isInitializedRef.current && activePlayers.length > 0 && room?.hostId === userId) {
        isInitializedRef.current = true;
        const initial = createInitialTicTacToeState(
          room?.difficulty || '3x3',
          activePlayers,
          room?.hostId || userId || ''
        );
        updateTicTacToeState(initial);
        if (broadcastTicTacToeState) broadcastTicTacToeState(initial);
      }
    }
  }, [ticTacToeState, room?.difficulty, activePlayers, room?.hostId, userId, updateTicTacToeState, broadcastTicTacToeState]);

  // Handle Player 2 entering/leaving: automatically adapt playerO between Bot and Real Player
  useEffect(() => {
    if (!ticTacToeState || room?.hostId !== userId) return;

    if (guestPlayer && ticTacToeState.isAgainstBot) {
      // Player 2 joined! Convert playerO from Bot to real player
      const updated: TicTacToeState = {
        ...ticTacToeState,
        isAgainstBot: false,
        playerO: {
          id: guestPlayer.id,
          username: guestPlayer.username || 'Pemain 2',
          symbol: 'O',
          color: guestPlayer.color || '#ef4444',
          avatar: guestPlayer.avatar || null,
          isBot: false,
        },
        currentTurnUserId:
          ticTacToeState.currentTurnUserId === BOT_USER_ID
            ? guestPlayer.id
            : ticTacToeState.currentTurnUserId,
        revision: (ticTacToeState.revision ?? 0) + 1,
      };
      updateTicTacToeState(updated);
      if (broadcastTicTacToeState) broadcastTicTacToeState(updated);
      toast.success(`${guestPlayer.username || 'Pemain 2'} bergabung! Mode Player vs Player aktif.`, {
        icon: '👥',
      });
    } else if (!guestPlayer && !ticTacToeState.isAgainstBot) {
      // Player 2 left! Convert playerO back to Bot
      const updated: TicTacToeState = {
        ...ticTacToeState,
        isAgainstBot: true,
        playerO: {
          id: BOT_USER_ID,
          username: BOT_NAME,
          symbol: 'O',
          color: '#10b981',
          avatar: null,
          isBot: true,
        },
        currentTurnUserId:
          ticTacToeState.currentTurnSymbol === 'O'
            ? BOT_USER_ID
            : ticTacToeState.currentTurnUserId,
        revision: (ticTacToeState.revision ?? 0) + 1,
      };
      updateTicTacToeState(updated);
      if (broadcastTicTacToeState) broadcastTicTacToeState(updated);
      toast('Pemain 2 keluar. Mode bermain lawan Bot AI aktif.', { icon: '🤖' });
    }
  }, [guestPlayer, ticTacToeState, room?.hostId, userId, updateTicTacToeState, broadcastTicTacToeState]);

  const isMyTurn = useMemo(() => {
    if (!ticTacToeState || ticTacToeState.winner !== null) return false;
    if (ticTacToeState.isAgainstBot) {
      return ticTacToeState.currentTurnSymbol === 'X';
    }
    return (
      (ticTacToeState.currentTurnSymbol === 'X' && ticTacToeState.playerX.id === userId) ||
      (ticTacToeState.currentTurnSymbol === 'O' && ticTacToeState.playerO.id === userId)
    );
  }, [ticTacToeState, userId]);

  // Bot Turn Automation (Runs on Host client when playing against Bot)
  useEffect(() => {
    if (!ticTacToeState || ticTacToeState.winner !== null) return;
    if (!ticTacToeState.isAgainstBot) return;
    if (ticTacToeState.currentTurnSymbol !== 'O') return;
    if (room?.hostId !== userId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsBotThinking(true);

    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);

    botTimeoutRef.current = setTimeout(() => {
      const latest = useGameStore.getState().ticTacToeState;
      if (!latest || latest.currentTurnSymbol !== 'O' || latest.winner !== null) {
        setIsBotThinking(false);
        return;
      }

      const botMove = getBestBotMove(latest);
      if (!botMove) {
        setIsBotThinking(false);
        return;
      }

      const { row, col } = botMove;
      const nextGrid = latest.grid.map((r, rIdx) =>
        r.map((cell, cIdx) => (rIdx === row && cIdx === col ? 'O' : cell))
      );

      sounds.ticTacToePlace('O');

      const winResult = checkTicTacToeWin(nextGrid, latest.winLength);
      let nextWinnerUserId: string | null = null;
      if (winResult.winner === 'O') {
        nextWinnerUserId = BOT_USER_ID;
        sounds.ticTacToeLose();
        toast.error('🤖 BOT (Master AI) Menang!', { duration: 3000 });
      } else if (winResult.winner === 'draw') {
        sounds.ticTacToeDraw();
        toast('🤝 Permainan Seri!', { duration: 2500 });
      }

      const nextState: TicTacToeState = {
        ...latest,
        grid: nextGrid,
        currentTurnSymbol: 'X',
        currentTurnUserId: latest.playerX.id,
        winner: winResult.winner,
        winnerUserId: nextWinnerUserId,
        winningCells: winResult.winningCells,
        lastMove: { row, col, symbol: 'O', timestamp: Date.now() },
        revision: (latest.revision ?? 0) + 1,
      };

      updateTicTacToeState(nextState);
      if (broadcastTicTacToeState) broadcastTicTacToeState(nextState);
      setIsBotThinking(false);
    }, 450);

    return () => {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    };
  }, [ticTacToeState, room?.hostId, userId, updateTicTacToeState, broadcastTicTacToeState]);

  // Handle Human Move (Clicking a cell)
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      const latest = useGameStore.getState().ticTacToeState;
      if (!latest || latest.winner !== null || !userId) return;
      if (latest.grid[row][col] !== null) return;

      if (latest.isAgainstBot) {
        if (latest.currentTurnSymbol !== 'X' || isBotThinking) return;
      } else {
        const expectedUserId =
          latest.currentTurnSymbol === 'X' ? latest.playerX.id : latest.playerO.id;
        if (expectedUserId !== userId) {
          toast('Bukan giliranmu!', { icon: '⏳', id: 'not-your-turn' });
          return;
        }
      }

      const currentSymbol = latest.currentTurnSymbol;
      const nextSymbol: TicTacToeSymbol = currentSymbol === 'X' ? 'O' : 'X';
      const nextUserId =
        nextSymbol === 'X'
          ? latest.playerX.id
          : latest.isAgainstBot
          ? BOT_USER_ID
          : latest.playerO.id;

      const nextGrid = latest.grid.map((r, rIdx) =>
        r.map((cell, cIdx) => (rIdx === row && cIdx === col ? currentSymbol : cell))
      );

      sounds.ticTacToePlace(currentSymbol);

      const winResult = checkTicTacToeWin(nextGrid, latest.winLength);
      let nextWinnerUserId: string | null = null;

      if (winResult.winner) {
        if (winResult.winner === 'X') {
          nextWinnerUserId = latest.playerX.id;
          sounds.ticTacToeWin();
          const winScore = (players[latest.playerX.id]?.score || 0) + 10;
          updatePlayer(latest.playerX.id, { score: winScore });
          broadcastPlayerStats?.({ score: winScore });
          toast.success(`🎉 ${latest.playerX.username} Menang! (+10 Skor)`, { duration: 3000 });
        } else if (winResult.winner === 'O') {
          nextWinnerUserId = latest.playerO.id;
          if (latest.isAgainstBot) {
            sounds.ticTacToeLose();
            toast.error('🤖 BOT Menang!', { duration: 3000 });
          } else {
            sounds.ticTacToeWin();
            const winScore = (players[latest.playerO.id]?.score || 0) + 10;
            updatePlayer(latest.playerO.id, { score: winScore });
            broadcastPlayerStats?.({ score: winScore });
            toast.success(`🎉 ${latest.playerO.username} Menang! (+10 Skor)`, { duration: 3000 });
          }
        } else if (winResult.winner === 'draw') {
          sounds.ticTacToeDraw();
          toast('🤝 Permainan Seri (Draw)!', { duration: 2500 });
        }
      }

      const nextState: TicTacToeState = {
        ...latest,
        grid: nextGrid,
        currentTurnSymbol: nextSymbol,
        currentTurnUserId: nextUserId,
        winner: winResult.winner,
        winnerUserId: nextWinnerUserId,
        winningCells: winResult.winningCells,
        lastMove: { row, col, symbol: currentSymbol, timestamp: Date.now() },
        revision: (latest.revision ?? 0) + 1,
      };

      updateTicTacToeState(nextState);
      if (broadcastTicTacToeState) broadcastTicTacToeState(nextState);
    },
    [userId, isBotThinking, players, updatePlayer, broadcastPlayerStats, updateTicTacToeState, broadcastTicTacToeState]
  );

  // Rematch / Reset Board
  const handleResetBoard = useCallback(() => {
    const latest = useGameStore.getState().ticTacToeState;
    if (!latest || !room) return;

    const fresh = createInitialTicTacToeState(
      room.difficulty || '3x3',
      activePlayers,
      room.hostId || userId || ''
    );

    const nextState: TicTacToeState = {
      ...fresh,
      revision: Math.max(fresh.revision, (latest.revision ?? 0) + 1),
    };

    updateTicTacToeState(nextState);
    if (broadcastTicTacToeState) broadcastTicTacToeState(nextState);
    toast.success('Papan telah direset untuk ronde baru!', { icon: '🔄' });
  }, [room, activePlayers, userId, updateTicTacToeState, broadcastTicTacToeState]);

  if (!ticTacToeState || !ticTacToeState.grid) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="w-8 h-8 border-3 border-foreground border-t-transparent rounded-full animate-spin" />
        <p className="text-secondary text-sm">Mempersiapkan papan Tic Tac Toe...</p>
      </div>
    );
  }

  const { boardSize, winLength, grid, currentTurnSymbol, winner, winningCells, lastMove } =
    ticTacToeState;

  const isCellWinning = (r: number, c: number) => {
    return winningCells?.some((cell) => cell.row === r && cell.col === c);
  };

  const isCellLastMove = (r: number, c: number) => {
    return lastMove?.row === r && lastMove?.col === c;
  };

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[560px] mx-auto select-none">
      {/* Pemenang / Status Banner */}
      <AnimatePresence>
        {winner && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className={`w-full p-4 rounded-2xl flex items-center justify-between shadow-xl ${
              winner === 'draw'
                ? 'bg-secondary/20 text-foreground border border-border'
                : winner === 'X'
                ? 'bg-blue-600 text-white shadow-blue-500/20'
                : ticTacToeState.isAgainstBot
                ? 'bg-emerald-600 text-white shadow-emerald-500/20'
                : 'bg-red-600 text-white shadow-red-500/20'
            }`}
          >
            <div className="flex items-center gap-3">
              <Trophy className="w-7 h-7 text-amber-300 animate-bounce" />
              <div>
                <h3 className="font-bold text-base sm:text-lg leading-tight">
                  {winner === 'draw'
                    ? 'Permainan Seri (Draw)!'
                    : winner === 'X'
                    ? `🎉 ${ticTacToeState.playerX.username} (X) Menang!`
                    : `🎉 ${ticTacToeState.playerO.username} (O) Menang!`}
                </h3>
                <p className="text-xs opacity-90">
                  {winner === 'draw'
                    ? 'Kedua pemain sama kuat.'
                    : `Berhasil menghubungkan ${winLength} kotak berurutan.`}
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

      {/* Header Info Pemain X vs O */}
      <div className="grid grid-cols-2 gap-3 w-full">
        {/* Player X */}
        <div
          className={`p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between ${
            currentTurnSymbol === 'X' && !winner
              ? 'bg-blue-500/10 border-blue-500/40 shadow-sm ring-2 ring-blue-500/20'
              : 'bg-card border-border opacity-85'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-blue-500/15 text-blue-500 border border-blue-500/30 flex items-center justify-center font-black text-lg shrink-0">
              X
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs sm:text-sm truncate">
                  {ticTacToeState.playerX.username}
                </span>
                {ticTacToeState.playerX.id === userId && (
                  <span className="text-[10px] bg-blue-500/20 text-blue-500 px-1.5 py-0.2 rounded font-semibold">
                    Kamu
                  </span>
                )}
              </div>
              <span className="text-[11px] text-secondary">
                Skor: {players[ticTacToeState.playerX.id]?.score || 0}
              </span>
            </div>
          </div>
          {currentTurnSymbol === 'X' && !winner && (
            <span className="text-[10px] bg-blue-500 text-white font-semibold px-2 py-0.5 rounded-full animate-pulse">
              Giliran
            </span>
          )}
        </div>

        {/* Player O */}
        <div
          className={`p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between ${
            currentTurnSymbol === 'O' && !winner
              ? 'bg-red-500/10 border-red-500/40 shadow-sm ring-2 ring-red-500/20'
              : 'bg-card border-border opacity-85'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-lg shrink-0 border ${
                ticTacToeState.isAgainstBot
                  ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
                  : 'bg-red-500/15 text-red-500 border-red-500/30'
              }`}
            >
              O
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs sm:text-sm truncate">
                  {ticTacToeState.playerO.username}
                </span>
                {ticTacToeState.isAgainstBot ? (
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.2 rounded font-semibold flex items-center gap-0.5">
                    <Bot className="w-2.5 h-2.5" /> Bot
                  </span>
                ) : ticTacToeState.playerO.id === userId ? (
                  <span className="text-[10px] bg-red-500/20 text-red-500 px-1.5 py-0.2 rounded font-semibold">
                    Kamu
                  </span>
                ) : null}
              </div>
              <span className="text-[11px] text-secondary">
                {ticTacToeState.isAgainstBot
                  ? 'Expert AI'
                  : `Skor: ${players[ticTacToeState.playerO.id]?.score || 0}`}
              </span>
            </div>
          </div>
          {currentTurnSymbol === 'O' && !winner && (
            <span
              className={`text-[10px] text-white font-semibold px-2 py-0.5 rounded-full animate-pulse ${
                ticTacToeState.isAgainstBot ? 'bg-emerald-600' : 'bg-red-500'
              }`}
            >
              {isBotThinking ? 'Berpikir...' : 'Giliran'}
            </span>
          )}
        </div>
      </div>

      {/* Rules Notice */}
      <div className="text-center text-xs text-secondary flex items-center justify-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-amber-500" />
        <span>
          Mode <b>{boardSize}x{boardSize}</b>: Dapatkan <b>{winLength} simbol sejajar</b> (horizontal, vertikal, atau diagonal) untuk menang!
        </span>
      </div>

      {/* Papan Permainan (Interactive Grid) */}
      <div className="relative w-full aspect-square max-w-[480px] p-2 sm:p-3 bg-card border-2 border-border rounded-3xl shadow-xl flex items-center justify-center">
        <div
          className={`grid w-full h-full gap-1.5 sm:gap-2 ${
            boardSize === 3 ? 'grid-cols-3 grid-rows-3' : 'grid-cols-8 grid-rows-8'
          }`}
        >
          {grid.map((row, rIdx) =>
            row.map((cell, cIdx) => {
              const isWinning = isCellWinning(rIdx, cIdx);
              const isLast = isCellLastMove(rIdx, cIdx);
              const isClickable = cell === null && !winner && isMyTurn && !isBotThinking;

              return (
                <button
                  key={`${rIdx}-${cIdx}`}
                  type="button"
                  onClick={() => handleCellClick(rIdx, cIdx)}
                  disabled={cell !== null || winner !== null || (!isMyTurn && !isSolo) || isBotThinking}
                  className={`relative flex items-center justify-center rounded-xl sm:rounded-2xl transition-all duration-150 font-black cursor-pointer ${
                    isWinning
                      ? 'bg-amber-400/25 border-2 border-amber-400 shadow-md scale-95 ring-2 ring-amber-400/40'
                      : isLast
                      ? 'bg-secondary/20 border-2 border-border shadow-xs'
                      : cell !== null
                      ? 'bg-secondary/10 border border-border/60'
                      : isClickable
                      ? 'bg-background border border-border/80 hover:bg-secondary/20 hover:border-foreground/30 hover:scale-[0.98]'
                      : 'bg-background/80 border border-border/40 opacity-70 cursor-not-allowed'
                  }`}
                  style={{
                    fontSize:
                      boardSize === 3
                        ? 'clamp(2rem, 8vw, 3.5rem)'
                        : 'clamp(0.9rem, 3.5vw, 1.4rem)',
                  }}
                >
                  <AnimatePresence>
                    {cell && (
                      <motion.span
                        initial={{ scale: 0, opacity: 0, rotate: -15 }}
                        animate={{
                          scale: isWinning ? [1, 1.15, 1] : 1,
                          opacity: 1,
                          rotate: 0,
                        }}
                        transition={{
                          type: 'spring',
                          stiffness: 400,
                          damping: 20,
                          repeat: isWinning ? Infinity : 0,
                          repeatDelay: 1.2,
                        }}
                        className={`leading-none ${
                          cell === 'X'
                            ? 'text-blue-500 dark:text-blue-400 drop-shadow-sm'
                            : ticTacToeState.isAgainstBot
                            ? 'text-emerald-500 dark:text-emerald-400 drop-shadow-sm'
                            : 'text-red-500 dark:text-red-400 drop-shadow-sm'
                        }`}
                      >
                        {cell}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Controls Bar Bawah */}
      <div className="flex items-center justify-between bg-card p-3 sm:p-4 rounded-2xl border border-border shadow-md w-full">
        <div className="flex items-center gap-2">
          {/* Sound Toggle */}
          <button
            type="button"
            onClick={() => {
              const next = !sfxMuted;
              sounds.setMuted(next);
              setSfxMuted(next);
              if (!next) {
                sounds.unlock();
                sounds.ticTacToePlace('X');
              }
            }}
            title={sfxMuted ? 'Nyalakan efek suara' : 'Matikan efek suara'}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-border bg-background hover:bg-hover text-secondary hover:text-foreground transition-colors cursor-pointer"
          >
            {sfxMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          {/* Mode Indicator */}
          <div className="flex items-center gap-1.5 text-xs text-secondary bg-background px-3 py-1.5 rounded-xl border border-border">
            {ticTacToeState.isAgainstBot ? (
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
        </div>

        {/* Action Button: Reset / Rematch */}
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
