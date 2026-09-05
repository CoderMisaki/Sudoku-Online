"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowUp,
  Crown,
  Flag,
  Play,
  RotateCcw,
  Sparkles,
  Swords,
  Target,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  XCircle,
} from 'lucide-react';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { sounds } from '@/utils/sounds';
import {
  ARROW_CORRECT_POINTS,
  ARROW_DIFFICULTY,
  ARROW_DIRS,
  ARROW_TEAM_BONUS,
  applyArrowMove,
  buildArrowSeed,
  createArrowRound,
  getArrowCurrentCell,
  getArrowNextPenalty,
  getArrowProgress,
  getArrowWrongStreak,
  getPlayerArrowPath,
  isArrowPuzzleFinished,
  normalizeArrowDifficulty,
} from '@/utils/arrowPuzzle';
import { ArrowCoord, ArrowPuzzleState, Player } from '@/types/game';
import toast from 'react-hot-toast';

interface ArrowPuzzleBoardProps {
  /** Mode Classic: siarkan papan utuh ke semua pemain (host). */
  broadcastArrowPuzzleState?: (state: ArrowPuzzleState) => void;
  /** Mode Classic: kirim satu tap supaya pemain lain ikut maju secara realtime. */
  sendArrowMove?: (row: number, col: number, basePathLength: number) => void;
  /** Sinkronkan skor/progress/peringkat milik sendiri ke pemain lain. */
  broadcastPlayerStats?: (stats: { score?: number; progress?: number; rank?: number | null }) => void;
}

const EMPTY_PLAYERS: Record<string, Player> = {};
const cellKey = (row: number, col: number) => `${row}:${col}`;

export const ArrowPuzzleBoard: React.FC<ArrowPuzzleBoardProps> = ({
  broadcastArrowPuzzleState,
  sendArrowMove,
  broadcastPlayerStats,
}) => {
  const userId = useGameStore((state) => state.userId);
  const room = useGameStore((state) => state.room);
  const players = room?.players || EMPTY_PLAYERS;
  const arrowState = useGameStore((state) => state.arrowPuzzleState);
  const replaceAllArrowPuzzleState = useGameStore((state) => state.replaceAllArrowPuzzleState);
  const updatePlayer = useGameStore((state) => state.updatePlayer);

  const [sfxMuted, setSfxMuted] = useState(false);
  const [flash, setFlash] = useState<{ key: string; correct: boolean; id: number } | null>(null);
  const [lastReason, setLastReason] = useState<string | null>(null);

  const variant = room?.mode === 'arrow_competition' ? 'competition' : 'classic';
  const isClassic = variant === 'classic';
  const isHost = Boolean(room && userId && room.hostId === userId);
  const difficultyKey = room?.difficulty ?? 'medium';
  const normalizedDifficulty = normalizeArrowDifficulty(difficultyKey);

  // Seed yang sama di semua client (roomId + difficulty + ronde) sehingga mode
  // Competition tetap memakai papan identik tanpa perlu server.
  const seed = useMemo(
    () => buildArrowSeed(room?.id ?? '', difficultyKey, room?.startedAt ?? 0),
    [room?.id, difficultyKey, room?.startedAt]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sinkron dari localStorage saat mount
    setSfxMuted(sounds.isMuted());
  }, []);

  // ── Siapkan papan ──────────────────────────────────────────────────────────
  // Classic : hanya host yang membuat papan lalu menyiarkannya (guest menunggu sync).
  // Competition: setiap pemain membuat papan sendiri dari seed ronde yang sama.
  useEffect(() => {
    if (!room || !userId) return;
    if (isClassic && !isHost) return;

    // Papan baru dibuat HANYA bila belum ada papan, atau papan yang ada bukan
    // milik varian/tingkat kesulitan ini. Membandingkan `seed` di sini akan
    // membatalkan "Papan Baru" buatan host: setiap update room memicu effect ini
    // lagi dan papan manual akan ditimpa papan bawaan seed.
    const current = useGameStore.getState().arrowPuzzleState;
    if (current && current.variant === variant && current.difficulty === normalizedDifficulty) return;

    const fresh = createArrowRound(difficultyKey, variant, seed, current?.revision ?? 0);
    replaceAllArrowPuzzleState(fresh);
    if (isClassic && broadcastArrowPuzzleState) broadcastArrowPuzzleState(fresh);
  }, [
    room,
    userId,
    isClassic,
    isHost,
    seed,
    variant,
    difficultyKey,
    normalizedDifficulty,
    replaceAllArrowPuzzleState,
    broadcastArrowPuzzleState,
  ]);

  const activePlayers = useMemo(
    () => Object.values(players).filter((p) => !p.isSpectator && p.status !== 'left'),
    [players]
  );

  const myPath = useMemo(
    () => (arrowState && userId ? getPlayerArrowPath(arrowState, userId) : []),
    [arrowState, userId]
  );
  const myProgress = arrowState && userId ? getArrowProgress(arrowState, userId) : 0;
  const myStreak = arrowState && userId ? getArrowWrongStreak(arrowState, userId) : 0;
  const nextPenalty = arrowState && userId ? getArrowNextPenalty(arrowState, userId) : 5;
  const finished = Boolean(arrowState && userId && isArrowPuzzleFinished(arrowState, userId));
  const puzzleDone = isClassic ? Boolean(arrowState?.completed) : finished;

  const visitedSteps = useMemo(() => {
    const map = new Map<string, number>();
    myPath.forEach((c, i) => map.set(cellKey(c.row, c.col), i + 1));
    return map;
  }, [myPath]);

  const currentCell: ArrowCoord | null =
    arrowState && userId ? getArrowCurrentCell(arrowState, userId) : null;

  const leaderboard = useMemo(() => {
    return activePlayers
      .map((p) => ({
        player: p,
        score: p.score ?? 0,
        progress: arrowState && isClassic ? getArrowProgress(arrowState, p.id) : (p.progress ?? 0),
        streak: arrowState?.wrongStreak[p.id] ?? 0,
      }))
      .sort((a, b) => b.progress - a.progress || b.score - a.score);
  }, [activePlayers, arrowState, isClassic]);

  const publishStats = useCallback(
    (score: number, progress: number, rank?: number | null) => {
      broadcastPlayerStats?.({ score, progress, rank: rank ?? null });
    },
    [broadcastPlayerStats]
  );

  // ── Tap kotak ──────────────────────────────────────────────────────────────
  const handleCellTap = useCallback(
    (row: number, col: number) => {
      if (!userId || !room) return;
      const state = useGameStore.getState().arrowPuzzleState;
      // Jangan menilai tap memakai papan milik varian lain (mis. sisa papan Classic
      // saat room berpindah ke Competition). Seed TIDAK dipakai sebagai penjaga di
      // sini karena papan hasil "Papan Baru" memang memakai seed manual.
      if (!state || state.variant !== variant) return;

      const pathBefore = getPlayerArrowPath(state, userId);
      if (pathBefore.length >= state.solutionPath.length - 1) {
        toast('Puzzle sudah selesai! Tekan Next Game untuk papan baru.', { icon: '✅' });
        return;
      }

      const myName = room.players[userId]?.username || 'Kamu';
      const result = applyArrowMove(state, userId, { row, col }, myName);

      replaceAllArrowPuzzleState(result.state);

      const me = useGameStore.getState().room?.players[userId];
      const newScore = (me?.score ?? 0) + result.scoreDelta;
      const newProgress = getArrowProgress(result.state, userId);
      const newRank = result.rank ?? me?.rank ?? null;
      updatePlayer(userId, { score: newScore, progress: newProgress, rank: newRank });
      publishStats(newScore, newProgress, newRank);

      // Mode Classic: teruskan tap ke pemain lain supaya maju bersama realtime.
      if (isClassic) sendArrowMove?.(row, col, pathBefore.length);

      setFlash({ key: cellKey(row, col), correct: result.correct, id: Date.now() });
      setLastReason(result.correct ? null : result.reason);

      if (result.correct) {
        sounds.arrowStep(pathBefore.length + 1);
        if (result.justFinished) {
          sounds.arrowComplete();
          if (isClassic) {
            toast.success(`Puzzle tuntas bersama! +${ARROW_CORRECT_POINTS} & bonus tim +${ARROW_TEAM_BONUS}`, {
              duration: 3200,
              icon: '🤝',
            });
          } else {
            toast.success(
              `Kamu mencapai GOAL! Peringkat ${result.rank ?? '-'} (+${result.scoreDelta} poin)`,
              { duration: 3200, icon: '🏁' }
            );
          }
        } else {
          toast.success(`Langkah benar! +${ARROW_CORRECT_POINTS} poin`, {
            duration: 1200,
            position: 'top-center',
          });
        }
      } else {
        sounds.arrowWrong(getArrowWrongStreak(result.state, userId));
        toast.error(`${result.reason} — skor -${result.penalty}`, {
          duration: 1900,
          position: 'top-center',
        });
      }
    },
    [userId, room, variant, isClassic, replaceAllArrowPuzzleState, updatePlayer, publishStats, sendArrowMove]
  );

  // ── Papan baru ─────────────────────────────────────────────────────────────
  const canResetBoard = isClassic ? isHost : true;
  const handleNewBoard = useCallback(() => {
    if (!room || !userId) return;
    const current = useGameStore.getState().arrowPuzzleState;
    const fresh = createArrowRound(
      difficultyKey,
      variant,
      `${seed}#${Math.random().toString(36).slice(2, 8)}`,
      current?.revision ?? 0
    );
    replaceAllArrowPuzzleState(fresh);
    if (isClassic && broadcastArrowPuzzleState) broadcastArrowPuzzleState(fresh);
    setLastReason(null);
    setFlash(null);
    toast.success('Papan Arrow baru dibuat!', { icon: '🔄' });
  }, [
    room,
    userId,
    difficultyKey,
    variant,
    seed,
    isClassic,
    replaceAllArrowPuzzleState,
    broadcastArrowPuzzleState,
  ]);

  if (!arrowState) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="w-8 h-8 border-3 border-foreground border-t-transparent rounded-full animate-spin" />
        <p className="text-secondary text-sm">
          {isClassic && !isHost
            ? 'Mengambil papan Arrow Puzzle dari host...'
            : 'Menyusun labirin panah...'}
        </p>
      </div>
    );
  }

  const { size, arrows, start, goal } = arrowState;
  const totalSteps = Math.max(1, arrowState.solutionPath.length - 1);
  const difficultyInfo = ARROW_DIFFICULTY[normalizedDifficulty];

  const candidates = new Set<string>();
  if (currentCell && !puzzleDone) {
    ARROW_DIRS.forEach((d) => {
      const nr = currentCell.row + d.dr;
      const nc = currentCell.col + d.dc;
      if (nr < 0 || nr >= size || nc < 0 || nc >= size) return;
      if (arrows[nr][nc] === null) return;
      candidates.add(cellKey(nr, nc));
    });
  }

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-[620px] mx-auto select-none">
      {/* Baris mode + tingkat kesulitan */}
      <div className="w-full flex flex-wrap items-center justify-center gap-2 text-xs">
        <span
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border font-semibold ${
            isClassic
              ? 'bg-blue-500/10 border-blue-500/30 text-blue-600 dark:text-blue-400'
              : 'bg-red-500/10 border-red-500/30 text-red-600 dark:text-red-400'
          }`}
        >
          {isClassic ? <Users className="w-3.5 h-3.5" /> : <Swords className="w-3.5 h-3.5" />}
          {isClassic ? 'Arrow Classic (Ko-op Realtime)' : 'Arrow Competition (Papan Sendiri)'}
        </span>
        <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-border bg-card text-secondary font-semibold">
          <Target className="w-3.5 h-3.5 text-amber-500" />
          {difficultyInfo?.label ?? 'Medium'} · {size}×{size} · {totalSteps} langkah
        </span>
      </div>

      {/* Penjelasan aturan */}
      <p className="text-center text-[11px] sm:text-xs text-secondary leading-relaxed max-w-[540px]">
        Panah di sebuah kotak menunjuk ke kotak sebelumnya. Kamu hanya boleh melangkah ke kotak
        menempel yang <b>panahnya menunjuk balik ke kotakmu</b>. Tap kotak untuk maju dari{' '}
        <b className="text-emerald-500">START</b> ke <b className="text-amber-500">GOAL</b> — hati-hati,
        cabang buntu memotong skor.
      </p>

      {/* Papan skor */}
      {isClassic ? (
        <div className="w-full flex flex-wrap justify-center gap-2">
          {leaderboard.map((entry) => (
            <div
              key={entry.player.id}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs ${
                entry.player.id === userId
                  ? 'bg-foreground/5 border-foreground/25'
                  : 'bg-card border-border'
              }`}
            >
              {entry.player.avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={entry.player.avatar}
                  alt={entry.player.username}
                  className="w-5 h-5 rounded-full object-cover border border-border"
                />
              ) : (
                <span
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: entry.player.color }}
                />
              )}
              <span className="font-semibold max-w-[110px] truncate">
                {entry.player.username || 'Pemain'}
                {entry.player.id === userId ? ' (Kamu)' : ''}
              </span>
              <span className="font-mono font-bold">{entry.score}</span>
              {entry.streak > 0 && (
                <span className="text-[10px] bg-red-500/15 text-red-500 px-1.5 py-0.5 rounded font-bold">
                  salah ×{entry.streak}
                </span>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="w-full bg-card border border-border rounded-2xl p-3 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-secondary">
            <span className="flex items-center gap-1.5">
              <Trophy className="w-3.5 h-3.5 text-amber-500" /> Papan Peringkat
            </span>
            <span>+{ARROW_CORRECT_POINTS} benar · -5/-10/-20 salah beruntun</span>
          </div>
          {leaderboard.map((entry, i) => (
            <div
              key={entry.player.id}
              className={`flex items-center gap-2 text-xs rounded-xl px-2 py-1.5 ${
                entry.player.id === userId ? 'bg-foreground/5 ring-1 ring-foreground/15' : 'bg-background'
              }`}
            >
              <span className="w-5 text-center font-bold">
                {entry.player.rank ? (
                  entry.player.rank === 1 ? '🥇' : entry.player.rank === 2 ? '🥈' : entry.player.rank === 3 ? '🥉' : entry.player.rank
                ) : i === 0 && entry.progress === 100 ? (
                  <Crown className="w-3.5 h-3.5 text-amber-500 mx-auto" />
                ) : (
                  <span className="text-secondary">{i + 1}</span>
                )}
              </span>
              <span className="font-semibold flex-1 truncate max-w-[140px]">
                {entry.player.username || 'Pemain'}
                {entry.player.id === userId ? ' (Kamu)' : ''}
              </span>
              <div className="w-20 h-1.5 rounded-full bg-secondary/20 overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{ width: `${entry.progress}%` }}
                />
              </div>
              <span className="w-9 text-right text-secondary font-mono">{entry.progress}%</span>
              <span className="w-12 text-right font-mono font-bold">{entry.score}</span>
            </div>
          ))}
        </div>
      )}

      {/* Progress sendiri */}
      <div className="w-full">
        <div className="flex items-center justify-between text-[11px] text-secondary mb-1">
          <span>
            Langkah {myPath.length} / {totalSteps}
          </span>
          <span className="font-mono font-bold text-foreground">
            Skor kamu: {players[userId || '']?.score ?? 0}
          </span>
        </div>
        <div className="h-2 rounded-full bg-secondary/15 overflow-hidden">
          <motion.div
            className="h-full bg-gradient-to-r from-emerald-500 to-teal-400"
            initial={false}
            animate={{ width: `${myProgress}%` }}
            transition={{ type: 'spring', stiffness: 180, damping: 24 }}
          />
        </div>
        {myStreak > 0 && (
          <p className="mt-1 text-[11px] text-red-500 font-semibold flex items-center gap-1">
            <XCircle className="w-3 h-3" /> Salah beruntun ×{myStreak} — tap salah berikutnya -
            {nextPenalty} poin
          </p>
        )}
      </div>

      {/* Papan panah */}
      <div className="relative w-full aspect-square max-w-[520px] p-2 sm:p-3 bg-card border-2 border-border rounded-3xl shadow-xl">
        <div
          className="grid w-full h-full gap-1 sm:gap-1.5"
          style={{
            gridTemplateColumns: `repeat(${size}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${size}, minmax(0, 1fr))`,
          }}
        >
          {arrows.map((rowArr, r) =>
            rowArr.map((dir, c) => {
              const key = cellKey(r, c);
              const isStart = start.row === r && start.col === c;
              const isGoal = goal.row === r && goal.col === c;
              const isWall = dir === null;
              const step = visitedSteps.get(key);
              const isVisited = step !== undefined;
              const isCurrent = currentCell?.row === r && currentCell?.col === c;
              const isCandidate = candidates.has(key);
              const isFlashing = flash?.key === key;
              const disabled = puzzleDone || isWall || isVisited;

              return (
                <motion.button
                  key={key}
                  type="button"
                  onClick={() => handleCellTap(r, c)}
                  disabled={disabled}
                  animate={
                    isFlashing
                      ? flash?.correct
                        ? { scale: [1, 1.14, 1] }
                        : { x: [0, -4, 4, -3, 3, 0] }
                      : { scale: 1, x: 0 }
                  }
                  transition={{ duration: isFlashing ? 0.32 : 0.12 }}
                  className={`relative flex items-center justify-center rounded-lg sm:rounded-xl border transition-colors duration-150 ${
                    isWall
                      ? 'bg-secondary/25 border-transparent'
                      : isStart
                      ? 'bg-emerald-500/20 border-emerald-500/50'
                      : isGoal
                      ? 'bg-amber-500/25 border-amber-500/60'
                      : isVisited
                      ? 'bg-blue-500/15 border-blue-500/35'
                      : isCurrent
                      ? 'bg-foreground/10 border-foreground/40 ring-2 ring-foreground/25'
                      : isCandidate
                      ? 'bg-background border-dashed border-foreground/30 hover:bg-secondary/20 cursor-pointer'
                      : 'bg-background/70 border-border/50'
                  } ${disabled ? 'cursor-default' : 'cursor-pointer'}`}
                >
                  {isWall ? (
                    <span className="w-1/3 h-1/3 rounded-sm bg-secondary/50" />
                  ) : isGoal ? (
                    <Flag className="w-1/2 h-1/2 text-amber-500" strokeWidth={2.5} />
                  ) : (
                    <>
                      <ArrowUp
                        className={`w-1/2 h-1/2 transition-transform duration-200 ${
                          isVisited
                            ? 'text-blue-500 dark:text-blue-400'
                            : isStart
                            ? 'text-emerald-500'
                            : 'text-foreground/70'
                        }`}
                        strokeWidth={2.75}
                        style={{ transform: `rotate(${(dir ?? 0) * 90}deg)` }}
                      />
                      {isStart && (
                        <span className="absolute bottom-0.5 right-1 text-[8px] sm:text-[9px] font-black text-emerald-600 dark:text-emerald-400">
                          S
                        </span>
                      )}
                    </>
                  )}

                  {isVisited && !isStart && (
                    <span className="absolute top-0.5 left-1 text-[8px] sm:text-[9px] font-bold text-blue-500/80">
                      {step}
                    </span>
                  )}

                  {isCurrent && !puzzleDone && (
                    <motion.span
                      className="absolute inset-0 rounded-lg sm:rounded-xl border-2 border-foreground/40"
                      animate={{ opacity: [0.9, 0.25, 0.9] }}
                      transition={{ duration: 1.4, repeat: Infinity }}
                    />
                  )}
                </motion.button>
              );
            })
          )}
        </div>

        {/* Overlay selesai */}
        <AnimatePresence>
          {puzzleDone && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 rounded-3xl bg-background/80 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 text-center p-6"
            >
              <Trophy className="w-10 h-10 text-amber-500 animate-bounce" />
              <div>
                <h3 className="font-bold text-lg">
                  {isClassic ? 'Puzzle Dituntaskan Bersama!' : 'Kamu Mencapai GOAL!'}
                </h3>
                <p className="text-xs text-secondary mt-1">
                  {isClassic
                    ? `Tim menyelesaikan ${totalSteps} langkah. Setiap pemain mendapat bonus +${ARROW_TEAM_BONUS}.`
                    : `Peringkat ${players[userId || '']?.rank ?? '-'} · Skor ${
                        players[userId || '']?.score ?? 0
                      }`}
                </p>
              </div>
              {isHost && (
                <p className="text-[11px] text-emerald-500 font-semibold">
                  Host bisa menekan Next Game untuk papan baru.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pesan tap terakhir */}
      <AnimatePresence mode="wait">
        {lastReason && !puzzleDone && (
          <motion.p
            key={lastReason}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-[11px] text-red-500 font-semibold flex items-center gap-1"
          >
            <XCircle className="w-3 h-3" /> {lastReason}
          </motion.p>
        )}
      </AnimatePresence>

      {/* Bar kontrol */}
      <div className="flex items-center justify-between gap-2 bg-card p-3 rounded-2xl border border-border shadow-md w-full">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              const next = !sfxMuted;
              sounds.setMuted(next);
              setSfxMuted(next);
              if (!next) {
                sounds.unlock();
                sounds.arrowStep(1);
              }
            }}
            title={sfxMuted ? 'Nyalakan efek suara' : 'Matikan efek suara'}
            className="w-9 h-9 flex items-center justify-center rounded-xl border border-border bg-background hover:bg-hover text-secondary hover:text-foreground transition-colors cursor-pointer"
          >
            {sfxMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <div className="flex items-center gap-1.5 text-[11px] text-secondary bg-background px-3 py-1.5 rounded-xl border border-border">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span className="font-medium">
              Benar +{ARROW_CORRECT_POINTS} · Salah -5 → -10 → -20 → -40
            </span>
          </div>
        </div>

        {canResetBoard && !puzzleDone && (
          <Button size="sm" variant="outline" onClick={handleNewBoard} className="gap-1.5 text-xs font-semibold">
            <RotateCcw className="w-3.5 h-3.5" /> Papan Baru
          </Button>
        )}
        {puzzleDone && isHost && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-semibold">
            <Play className="w-3.5 h-3.5" /> Tekan Next Game
          </div>
        )}
      </div>
    </div>
  );
};
