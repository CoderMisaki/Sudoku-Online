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
  Zap,
} from 'lucide-react';
import {
  createInitialSosState,
  applySosMove,
  getBestSosBotMove,
  getSosSideForUser,
  oppositeSosSide,
  SOS_BOT_USER_ID,
} from '@/utils/sosGame';
import { sounds } from '@/utils/sounds';
import { SosState, SosLetter, Player, SosSide } from '@/types/game';
import toast from 'react-hot-toast';

interface SosBoardProps {
  broadcastSosState?: (newState: SosState) => void;
  broadcastPlayerStats?: (stats: { score?: number; progress?: number; rank?: number | null }) => void;
}

const EMPTY_PLAYERS: Record<string, Player> = {};

/**
 * Tema monokrom SOS — hanya hitam & putih, tanpa warna lain.
 * Kelas dipilih supaya tetap terbaca di mode terang maupun gelap:
 * keping hitam selalu hitam (huruf putih), keping putih selalu putih
 * (huruf hitam), dan garis memakai `currentColor` + garis tepi kontras.
 */
interface SosSideTheme {
  label: string;
  glyph: string;
  /** Kartu pemain saat sedang giliran. */
  cardActive: string;
  /** Bulatan identitas sisi di kartu pemain. */
  disc: string;
  /** Badge "Giliran". */
  badge: string;
  /** Sel papan yang diisi pemain sisi ini. */
  cell: string;
  /** Penanda sel yang jadi bagian pola S-O-S. */
  cellOwned: string;
  /** Warna huruf S/O di atas keping. */
  letter: string;
  /** Warna garis pola (memakai currentColor). */
  lineMain: string;
  /** Garis tepi kontras di belakang garis pola. */
  lineHalo: string;
  /** Banner pemenang. */
  banner: string;
}

const SIDE_UI: Record<SosSide, SosSideTheme> = {
  black: {
    label: 'Hitam',
    glyph: '●',
    cardActive: 'bg-black/5 border-black/40 ring-2 ring-black/15 dark:bg-white/10 dark:border-white/40 dark:ring-white/15',
    disc: 'bg-black text-white border border-white/25 dark:border-white/40',
    badge: 'bg-black text-white border border-white/25 dark:bg-white dark:text-black dark:border-transparent',
    cell: 'bg-black text-white border border-white/20 dark:border-white/35',
    cellOwned: 'ring-2 ring-inset ring-white/70',
    letter: 'text-white',
    lineMain: 'text-black dark:text-white',
    lineHalo: 'text-white dark:text-neutral-900',
    banner: 'bg-black text-white border border-white/25',
  },
  white: {
    label: 'Putih',
    glyph: '○',
    cardActive: 'bg-neutral-100 border-neutral-400 ring-2 ring-neutral-400/25 dark:bg-white/10 dark:border-white/40 dark:ring-white/15',
    disc: 'bg-white text-black border border-neutral-400 dark:border-white/40',
    badge: 'bg-white text-black border border-neutral-400 dark:bg-neutral-100 dark:border-white/40',
    cell: 'bg-neutral-100 text-black border border-neutral-400 dark:bg-neutral-100 dark:border-white/40',
    cellOwned: 'ring-2 ring-inset ring-black/50',
    letter: 'text-black',
    lineMain: 'text-white',
    lineHalo: 'text-black/70',
    banner: 'bg-white text-black border border-neutral-300 dark:bg-neutral-100 dark:border-white/40',
  },
};

export const SosBoard: React.FC<SosBoardProps> = ({
  broadcastSosState,
  broadcastPlayerStats,
}) => {
  const userId = useGameStore((state) => state.userId);
  const room = useGameStore((state) => state.room);
  const players = room?.players || EMPTY_PLAYERS;
  const sosState = useGameStore((state) => state.sosState);
  const updateSosState = useGameStore((state) => state.updateSosState);
  const updatePlayer = useGameStore((state) => state.updatePlayer);

  const [sfxMuted, setSfxMuted] = useState(false);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [chosenLetter, setChosenLetter] = useState<SosLetter>('S');
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

  // Host menginisialisasi state SOS jika belum ada
  useEffect(() => {
    if (!sosState || !sosState.grid || sosState.grid.length === 0) {
      if (!isInitializedRef.current && activePlayers.length > 0 && room?.hostId === userId) {
        isInitializedRef.current = true;
        const initial = createInitialSosState(activePlayers, room?.hostId || userId || '');
        updateSosState(initial);
        if (broadcastSosState) broadcastSosState(initial);
      }
    }
  }, [sosState, activePlayers, room?.hostId, userId, updateSosState, broadcastSosState]);

  // Player 2 masuk/keluar: otomatis alihkan player2 antara Bot dan pemain asli
  useEffect(() => {
    if (!sosState || room?.hostId !== userId) return;

    // Sisi hitam/putih tetap milik pemain yang digantikan (tidak diundi ulang
    // di tengah ronde) supaya identitas warna tidak tertukar.
    const player2Side =
      sosState.player2.side === 'black' || sosState.player2.side === 'white'
        ? sosState.player2.side
        : oppositeSosSide(getSosSideForUser(sosState, sosState.player1.id));

    if (guestPlayer && sosState.isAgainstBot) {
      const updated: SosState = {
        ...sosState,
        isAgainstBot: false,
        player2: {
          id: guestPlayer.id,
          username: guestPlayer.username || 'Pemain 2',
          color: guestPlayer.color || '#ef4444',
          avatar: guestPlayer.avatar || null,
          isBot: false,
          letter: 'O',
          side: player2Side,
        },
        scores: { ...sosState.scores, [guestPlayer.id]: sosState.scores[SOS_BOT_USER_ID] || 0 },
        currentTurnUserId:
          sosState.currentTurnUserId === SOS_BOT_USER_ID
            ? guestPlayer.id
            : sosState.currentTurnUserId,
        revision: (sosState.revision ?? 0) + 1,
      };
      delete updated.scores[SOS_BOT_USER_ID];
      updateSosState(updated);
      if (broadcastSosState) broadcastSosState(updated);
      toast.success(`${guestPlayer.username || 'Pemain 2'} bergabung! Mode Player vs Player aktif.`, {
        icon: '👥',
      });
    } else if (!guestPlayer && !sosState.isAgainstBot) {
      const updated: SosState = {
        ...sosState,
        isAgainstBot: true,
        player2: {
          id: SOS_BOT_USER_ID,
          username: 'BOT (Master AI)',
          color: '#10b981',
          avatar: null,
          isBot: true,
          letter: 'O',
          side: player2Side,
        },
        currentTurnUserId:
          sosState.currentTurnUserId === sosState.player2.id
            ? SOS_BOT_USER_ID
            : sosState.currentTurnUserId,
        revision: (sosState.revision ?? 0) + 1,
      };
      updateSosState(updated);
      if (broadcastSosState) broadcastSosState(updated);
      toast('Pemain 2 keluar. Mode bermain lawan Bot AI aktif.', { icon: '🤖' });
    }
  }, [guestPlayer, sosState, room?.hostId, userId, updateSosState, broadcastSosState]);

  const isMyTurn = useMemo(() => {
    if (!sosState || sosState.winner !== null) return false;
    if (sosState.isAgainstBot) {
      return sosState.currentTurnUserId !== SOS_BOT_USER_ID;
    }
    return sosState.currentTurnUserId === userId;
  }, [sosState, userId]);

  // Terapkan bonus kemenangan (+10 skor room) — dipanggil sekali oleh pembuat langkah penentu
  const applyWinBonus = useCallback(
    (finalState: SosState) => {
      if (finalState.winner === null || finalState.winner === 'draw') return;
      const winnerId = finalState.winner;
      const winnerInfo = winnerId === finalState.player1.id ? finalState.player1 : finalState.player2;
      if (winnerInfo.isBot) return;
      const newScore = (players[winnerId]?.score || 0) + 10;
      updatePlayer(winnerId, { score: newScore });
      broadcastPlayerStats?.({ score: newScore });
    },
    [players, updatePlayer, broadcastPlayerStats]
  );

  const announceGameEnd = useCallback((finalState: SosState) => {
    if (finalState.winner === null) return;
    if (finalState.winner === 'draw') {
      sounds.ticTacToeDraw();
      toast('🤝 Permainan Seri! Poin sama kuat.', { duration: 3000 });
      return;
    }
    const winnerInfo =
      finalState.winner === finalState.player1.id ? finalState.player1 : finalState.player2;
    const winnerScore = finalState.scores[finalState.winner] || 0;
    if (winnerInfo.isBot) {
      sounds.ticTacToeLose();
      toast.error(`🤖 ${winnerInfo.username} Menang dengan ${winnerScore} poin!`, { duration: 3500 });
    } else {
      sounds.ticTacToeWin();
      toast.success(`🎉 ${winnerInfo.username} Menang dengan ${winnerScore} poin! (+10 Skor)`, {
        duration: 3500,
      });
    }
  }, []);

  // Otomatisasi giliran Bot (berjalan di klien host saat lawan Bot)
  useEffect(() => {
    if (!sosState || sosState.winner !== null) return;
    if (!sosState.isAgainstBot) return;
    if (sosState.currentTurnUserId !== SOS_BOT_USER_ID) return;
    if (room?.hostId !== userId) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsBotThinking(true);

    if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);

    botTimeoutRef.current = setTimeout(() => {
      const latest = useGameStore.getState().sosState;
      if (!latest || latest.currentTurnUserId !== SOS_BOT_USER_ID || latest.winner !== null) {
        setIsBotThinking(false);
        return;
      }

      const botMove = getBestSosBotMove(latest);
      if (!botMove) {
        setIsBotThinking(false);
        return;
      }

      sounds.sosPlace(botMove.letter);
      const { next, points } = applySosMove(latest, botMove.row, botMove.col, botMove.letter, SOS_BOT_USER_ID);
      if (points > 0) sounds.sosScore(points);
      if (next.winner !== null) announceGameEnd(next);

      updateSosState(next);
      if (broadcastSosState) broadcastSosState(next);
      // Jika bot dapat giliran ekstra, efek ini jalan lagi otomatis (state berubah).
      setIsBotThinking(false);
    }, 550);

    return () => {
      if (botTimeoutRef.current) clearTimeout(botTimeoutRef.current);
    };
  }, [sosState, room?.hostId, userId, updateSosState, broadcastSosState, announceGameEnd]);

  // Langkah pemain manusia (klik kotak)
  const handleCellClick = useCallback(
    (row: number, col: number) => {
      const latest = useGameStore.getState().sosState;
      if (!latest || latest.winner !== null || !userId) return;
      if (latest.grid[row][col].letter !== null) return;

      if (latest.isAgainstBot) {
        if (latest.currentTurnUserId === SOS_BOT_USER_ID || isBotThinking) return;
      } else if (latest.currentTurnUserId !== userId) {
        toast('Bukan giliranmu!', { icon: '⏳', id: 'not-your-turn' });
        return;
      }

      sounds.unlock();
      sounds.sosPlace(chosenLetter);
      const { next, points } = applySosMove(latest, row, col, chosenLetter, userId);
      if (points > 0) {
        sounds.sosScore(points);
        toast.success(
          points === 1 ? 'S-O-S! +1 poin 🎯 Giliran ekstra!' : `COMBO! +${points} poin 🎯🎯 Giliran ekstra!`,
          { duration: 1800, icon: '⚡' }
        );
      }
      if (next.winner !== null) {
        announceGameEnd(next);
        applyWinBonus(next);
      }

      updateSosState(next);
      if (broadcastSosState) broadcastSosState(next);
    },
    [userId, isBotThinking, chosenLetter, updateSosState, broadcastSosState, announceGameEnd, applyWinBonus]
  );

  // Reset papan (ronde baru)
  const handleResetBoard = useCallback(() => {
    const latest = useGameStore.getState().sosState;
    if (!latest || !room) return;

    const fresh = createInitialSosState(activePlayers, room.hostId || userId || '');
    const nextState: SosState = {
      ...fresh,
      revision: Math.max(fresh.revision, (latest.revision ?? 0) + 1),
    };

    updateSosState(nextState);
    if (broadcastSosState) broadcastSosState(nextState);
    toast.success('Papan direset — sisi hitam/putih diundi ulang!', { icon: '🔄' });
  }, [room, activePlayers, userId, updateSosState, broadcastSosState]);

  // Peta sel yang menjadi bagian pola S-O-S -> warna pemiliknya
  const lineCellOwner = useMemo(() => {
    const map = new Map<string, string>();
    if (!sosState) return map;
    for (const line of sosState.lines) {
      for (const cell of line.cells) {
        map.set(`${cell.row}-${cell.col}`, line.byUserId);
      }
    }
    return map;
  }, [sosState]);

  if (!sosState || !sosState.grid) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="w-8 h-8 border-3 border-foreground border-t-transparent rounded-full animate-spin" />
        <p className="text-secondary text-sm">Mempersiapkan papan SOS...</p>
      </div>
    );
  }

  const { grid, winner, lastMove, player1, player2, currentTurnUserId } = sosState;
  const score1 = sosState.scores[player1.id] || 0;
  const score2 = sosState.scores[player2.id] || 0;
  const isCellLastMove = (r: number, c: number) => lastMove?.row === r && lastMove?.col === c;
  const filledCount = grid.flat().filter((c) => c.letter !== null).length;

  const side1 = getSosSideForUser(sosState, player1.id);
  const side2 = getSosSideForUser(sosState, player2.id);
  const ui1 = SIDE_UI[side1];
  const ui2 = SIDE_UI[side2];
  const mySide: SosSide | null = userId
    ? userId === player1.id
      ? side1
      : userId === player2.id
      ? side2
      : null
    : null;

  const winnerName =
    winner === null || winner === 'draw'
      ? null
      : winner === player1.id
      ? player1.username
      : player2.username;

  const winnerUi = winner === null || winner === 'draw' ? null : SIDE_UI[getSosSideForUser(sosState, winner)];

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
              winner === 'draw' ? 'bg-secondary/20 text-foreground border border-border' : winnerUi!.banner
            }`}
          >
            <div className="flex items-center gap-3">
              <Trophy className="w-7 h-7 opacity-90 animate-bounce" />
              <div>
                <h3 className="font-bold text-base sm:text-lg leading-tight">
                  {winner === 'draw' ? 'Permainan Seri (Draw)!' : `🎉 ${winnerName} Menang!`}
                </h3>
                <p className="text-xs opacity-90">
                  {winner === 'draw'
                    ? `Skor imbang ${score1} - ${score2}.`
                    : `Sisi ${winnerUi!.label} unggul ${score1} - ${score2} dari ${filledCount} kotak terisi.`}
                </p>
              </div>
            </div>

            {room?.hostId === userId && (
              <Button
                size="sm"
                variant="outline"
                onClick={handleResetBoard}
                className="bg-transparent border-current/40 text-current hover:bg-current/10 text-xs shrink-0"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Main Lagi
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Kartu pemain 1 vs 2 */}
      <div className="grid grid-cols-2 gap-3 w-full">
        {/* Pemain 1 */}
        <div
          className={`p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between ${
            currentTurnUserId === player1.id && !winner ? ui1.cardActive : 'bg-card border-border opacity-85'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-lg shrink-0 ${ui1.disc}`}
            >
              {ui1.glyph}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs sm:text-sm truncate">{player1.username}</span>
                {player1.id === userId && (
                  <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.2 rounded font-semibold">
                    Kamu
                  </span>
                )}
              </div>
              <span className="text-[11px] text-secondary">
                {ui1.label} · Poin SOS: <b className="text-foreground">{score1}</b>
              </span>
            </div>
          </div>
          {currentTurnUserId === player1.id && !winner && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full animate-pulse ${ui1.badge}`}>
              Giliran
            </span>
          )}
        </div>

        {/* Pemain 2 */}
        <div
          className={`p-3 rounded-2xl border transition-all duration-200 flex items-center justify-between ${
            currentTurnUserId === player2.id && !winner ? ui2.cardActive : 'bg-card border-border opacity-85'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className={`w-9 h-9 rounded-full flex items-center justify-center font-black text-lg shrink-0 ${ui2.disc}`}
            >
              {ui2.glyph}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-xs sm:text-sm truncate">{player2.username}</span>
                {sosState.isAgainstBot ? (
                  <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.2 rounded font-semibold flex items-center gap-0.5">
                    <Bot className="w-2.5 h-2.5" /> Bot
                  </span>
                ) : player2.id === userId ? (
                  <span className="text-[10px] bg-foreground/10 text-foreground px-1.5 py-0.2 rounded font-semibold">
                    Kamu
                  </span>
                ) : null}
              </div>
              <span className="text-[11px] text-secondary">
                {ui2.label} · Poin SOS: <b className="text-foreground">{score2}</b>
              </span>
            </div>
          </div>
          {currentTurnUserId === player2.id && !winner && (
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full animate-pulse ${ui2.badge}`}>
              {isBotThinking ? 'Berpikir...' : 'Giliran'}
            </span>
          )}
        </div>
      </div>

      {/* Aturan singkat */}
      <div className="text-center text-xs text-secondary flex items-center justify-center gap-1.5 px-2">
        <Sparkles className="w-3.5 h-3.5 text-foreground/60 shrink-0" />
        <span>
          Pilih huruf <b>S</b> / <b>O</b>, bentuk pola <b>S-O-S</b> (mendatar, tegak, diagonal) untuk poin +
          giliran ekstra!
          {mySide && (
            <>
              {' '}
              Kamu pegang <b className="text-foreground">{SIDE_UI[mySide].label}</b>.
            </>
          )}
        </span>
      </div>

      {/* Pemilih huruf S / O */}
      <div className="flex items-center gap-2 bg-card border border-border p-1.5 rounded-2xl shadow-sm">
        <span className="text-xs text-secondary font-medium px-1.5">Huruf:</span>
        {(['S', 'O'] as SosLetter[]).map((letter) => (
          <button
            key={letter}
            type="button"
            onClick={() => setChosenLetter(letter)}
            disabled={!isMyTurn || winner !== null}
            className={`w-12 h-10 rounded-xl font-black text-xl transition-all cursor-pointer ${
              chosenLetter === letter
                ? 'bg-foreground text-background shadow-md scale-105'
                : 'bg-background border border-border text-secondary hover:text-foreground hover:border-foreground/30'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {letter}
          </button>
        ))}
        {lastMove && lastMove.points > 0 && !winner && (
          <span className="flex items-center gap-1 text-[11px] font-bold text-foreground bg-foreground/10 border border-foreground/25 px-2 py-1 rounded-xl ml-1 animate-pulse">
            <Zap className="w-3 h-3" /> +{lastMove.points} Ekstra!
          </span>
        )}
      </div>

      {/* Papan 8x8 — monokrom hitam vs putih */}
      <div className="relative w-full aspect-square max-w-[480px] p-2 sm:p-3 bg-card border-2 border-border rounded-3xl shadow-xl flex items-center justify-center">
        <div className="relative w-full h-full" style={{ fontSize: 'clamp(0.85rem, 3.2vw, 1.3rem)' }}>
          {/* Lapisan 1: sel papan (area klik + warna sisi hitam/putih) */}
          <div className="grid w-full h-full gap-1 grid-cols-8 grid-rows-8">
            {grid.map((row, rIdx) =>
              row.map((cell, cIdx) => {
                const ownerId = lineCellOwner.get(`${rIdx}-${cIdx}`);
                const ownerUi = ownerId ? SIDE_UI[getSosSideForUser(sosState, ownerId)] : null;
                const cellSide: SosSide | null = cell.byUserId
                  ? getSosSideForUser(sosState, cell.byUserId)
                  : null;
                const isLast = isCellLastMove(rIdx, cIdx);
                const isClickable = cell.letter === null && !winner && isMyTurn && !isBotThinking;

                return (
                  <button
                    key={`${rIdx}-${cIdx}`}
                    type="button"
                    onClick={() => handleCellClick(rIdx, cIdx)}
                    disabled={cell.letter !== null || winner !== null || (!isMyTurn && !isSolo) || isBotThinking}
                    aria-label={`Kotak baris ${rIdx + 1} kolom ${cIdx + 1}`}
                    className={`relative flex items-center justify-center rounded-md sm:rounded-lg transition-all duration-150 font-black cursor-pointer ${
                      cellSide
                        ? `${SIDE_UI[cellSide].cell} ${ownerUi ? ownerUi.cellOwned : ''} ${
                            isLast ? 'outline outline-2 outline-offset-1 outline-current/70' : ''
                          }`
                        : isLast
                        ? 'bg-secondary/25 border-2 border-border shadow-xs'
                        : isClickable
                        ? 'bg-background border border-border/80 hover:bg-secondary/20 hover:border-foreground/30 hover:scale-[0.97]'
                        : 'bg-background/80 border border-border/40 opacity-70 cursor-not-allowed'
                    }`}
                  >
                    {cell.letter === null && isClickable && (
                      <span className="absolute inset-0 flex items-center justify-center opacity-0 hover:opacity-40 font-black text-secondary pointer-events-none">
                        {chosenLetter}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>

          {/*
           * Lapisan 2: garis pola S-O-S.
           * Ketebalan dipotong 50% (halo 0.09 & garis 0.05 dari 1 satuan sel)
           * dan digambar DI BAWAH huruf (lapisan 3) supaya tulisan S/O tidak
           * pernah tertutup garis.
           */}
          {sosState.lines.length > 0 && (
            <svg
              className="pointer-events-none absolute inset-0 z-10 h-full w-full"
              viewBox="0 0 8 8"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              {sosState.lines.map((line, index) => {
                const start = line.cells[0];
                const end = line.cells[2];
                const ui = SIDE_UI[getSosSideForUser(sosState, line.byUserId)];
                const key = `${line.byUserId}-${line.cells.map((cell) => `${cell.row}-${cell.col}`).join('-')}`;

                return (
                  <g key={`${key}-${index}`}>
                    {/* Halo kontras: hitam tetap terbaca di tema gelap, putih di tema terang. */}
                    <line
                      x1={start.col + 0.5}
                      y1={start.row + 0.5}
                      x2={end.col + 0.5}
                      y2={end.row + 0.5}
                      stroke="currentColor"
                      className={ui.lineHalo}
                      strokeWidth="0.09"
                      strokeLinecap="round"
                    />
                    <line
                      x1={start.col + 0.5}
                      y1={start.row + 0.5}
                      x2={end.col + 0.5}
                      y2={end.row + 0.5}
                      stroke="currentColor"
                      className={ui.lineMain}
                      strokeWidth="0.05"
                      strokeLinecap="round"
                    />
                    <circle cx={start.col + 0.5} cy={start.row + 0.5} r="0.05" fill="currentColor" className={ui.lineMain} />
                    <circle cx={end.col + 0.5} cy={end.row + 0.5} r="0.05" fill="currentColor" className={ui.lineMain} />
                  </g>
                );
              })}
            </svg>
          )}

          {/* Lapisan 3: huruf S/O — selalu paling atas, tidak menghalangi klik */}
          <div className="pointer-events-none absolute inset-0 z-20 grid w-full h-full gap-1 grid-cols-8 grid-rows-8">
            {grid.map((row, rIdx) =>
              row.map((cell, cIdx) => (
                <div key={`letter-${rIdx}-${cIdx}`} className="flex items-center justify-center">
                  <AnimatePresence>
                    {cell.letter && (
                      <motion.span
                        initial={{ scale: 0, opacity: 0, rotate: -15 }}
                        animate={{ scale: 1, opacity: 1, rotate: 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 20 }}
                        className={`leading-none font-black ${
                          SIDE_UI[getSosSideForUser(sosState, cell.byUserId)].letter
                        }`}
                      >
                        {cell.letter}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Progress papan */}
      <div className="text-xs text-secondary">
        Terisi <b className="text-foreground">{filledCount}</b> / 64 kotak ·{' '}
        {ui1.label} <b className="text-foreground">{score1}</b> — {ui2.label}{' '}
        <b className="text-foreground">{score2}</b>
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
                sounds.sosPlace('S');
              }
            }}
            title={sfxMuted ? 'Nyalakan efek suara' : 'Matikan efek suara'}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-border bg-background hover:bg-hover text-secondary hover:text-foreground transition-colors cursor-pointer"
          >
            {sfxMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-1.5 text-xs text-secondary bg-background px-3 py-1.5 rounded-xl border border-border">
            {sosState.isAgainstBot ? (
              <>
                <Bot className="w-3.5 h-3.5" />
                <span className="font-medium">Solo vs Bot</span>
              </>
            ) : (
              <>
                <Users className="w-3.5 h-3.5" />
                <span className="font-medium">Player vs Player</span>
              </>
            )}
          </div>
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
