"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useAnimation } from 'framer-motion';
import {
  Crown,
  FastForward,
  Play,
  RotateCcw,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Volume2,
  VolumeX,
  Wand2,
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
  getActiveArrows,
  getArrowExitDistance,
  getArrowNextPenalty,
  getArrowProgress,
  getArrowWrongStreak,
  getMovableArrowIds,
  getRemovedArrowIds,
  isArrowPuzzleFinished,
  normalizeArrowDifficulty,
} from '@/utils/arrowPuzzle';
import { ArrowObject, ArrowPuzzleState, Player } from '@/types/game';
import toast from 'react-hot-toast';

interface ArrowPuzzleBoardProps {
  /** Mode Classic: siarkan papan utuh ke semua pemain (host). */
  broadcastArrowPuzzleState?: (state: ArrowPuzzleState) => void;
  /** Mode Classic: kirim satu tap arrow supaya pemain lain melihat arrow yang sama keluar. */
  sendArrowMove?: (arrowId: string, baseRevision: number) => void;
  /** Sinkronkan skor/progress/peringkat milik sendiri ke pemain lain. */
  broadcastPlayerStats?: (stats: { score?: number; progress?: number; rank?: number | null }) => void;
}

const EMPTY_PLAYERS: Record<string, Player> = {};

/** Ukuran satu sel dalam satuan viewBox SVG. */
const U = 100;
/** Padding di sekeliling papan (viewBox) supaya kepala panah di tepi tidak terpotong. */
const PAD = 0.5 * U;
/** Durasi animasi arrow meluncur keluar (detik). */
const EXIT_DURATION = 0.42;
/** Warna track sesuai referensi: dark navy di atas putih. */
const TRACK_COLOR = '#1f2a48';
const TRACK_WIDTH = 0.36 * U;

const cx = (col: number) => PAD + (col + 0.5) * U;
const cy = (row: number) => PAD + (row + 0.5) * U;

/** Path SVG (garis tengah) dari ekor ke kepala arrow. */
function arrowPathD(arrow: ArrowObject): string {
  return arrow.cells.map((c, i) => `${i === 0 ? 'M' : 'L'} ${cx(c.col)} ${cy(c.row)}`).join(' ');
}

/** Titik-titik segitiga kepala panah di sel kepala. */
function arrowHeadPoints(arrow: ArrowObject): string {
  const head = arrow.cells[arrow.cells.length - 1];
  const { dr, dc } = ARROW_DIRS[arrow.direction];
  const hx = cx(head.col);
  const hy = cy(head.row);
  // Tip menjorok ke tepi sel, pangkal sedikit di belakang pusat sel.
  const tipX = hx + dc * 0.46 * U;
  const tipY = hy + dr * 0.46 * U;
  const baseX = hx - dc * 0.06 * U;
  const baseY = hy - dr * 0.06 * U;
  // Vektor tegak lurus.
  const px = -dr;
  const py = dc;
  const half = 0.36 * U;
  return [
    `${tipX},${tipY}`,
    `${baseX + px * half},${baseY + py * half}`,
    `${baseX - px * half},${baseY - py * half}`,
  ].join(' ');
}

interface ExitingArrow {
  arrow: ArrowObject;
  distance: number;
  /** Penanda unik supaya AnimatePresence tidak menyatukan dua exit arrow yang sama. */
  key: string;
}

interface ArrowGlyphProps {
  arrow: ArrowObject;
  state: 'idle' | 'exiting';
  distance?: number;
  shakeToken?: number;
  highlightBlocked?: boolean;
  disabled?: boolean;
  onTap?: (arrowId: string) => void;
  onExitDone?: (arrowId: string) => void;
}

const ArrowGlyph: React.FC<ArrowGlyphProps> = ({
  arrow,
  state,
  distance = 0,
  shakeToken = 0,
  highlightBlocked = false,
  disabled = false,
  onTap,
  onExitDone,
}) => {
  const { dr, dc } = ARROW_DIRS[arrow.direction];
  const horizontal = dr === 0;
  const controls = useAnimation();

  const exitX = dc * (distance + 0.6) * U;
  const exitY = dr * (distance + 0.6) * U;

  // Animasi keluar: meluncur searah panah, akselerasi lalu melambat, fade/scale di ujung.
  useEffect(() => {
    if (state !== 'exiting') return;
    let cancelled = false;
    controls
      .start({
        x: exitX,
        y: exitY,
        opacity: [1, 1, 0.9, 0],
        scale: [1, 1.02, 1, 0.94],
        transition: {
          duration: EXIT_DURATION,
          ease: [0.4, 0, 0.2, 1],
          opacity: { duration: EXIT_DURATION, times: [0, 0.55, 0.8, 1] },
          scale: { duration: EXIT_DURATION, times: [0, 0.2, 0.7, 1] },
        },
      })
      .then(() => {
        if (!cancelled) onExitDone?.(arrow.id);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hanya saat mulai keluar
  }, [state]);

  // Getar searah orientasi arrow saat terhalang (150–250ms), lalu kembali ke posisi semula.
  useEffect(() => {
    if (state !== 'idle' || !shakeToken) return;
    const seq = [0, -9, 9, -6, 6, 0];
    controls.start(
      horizontal
        ? { x: seq, y: 0, transition: { duration: 0.22, ease: 'easeInOut' } }
        : { y: seq, x: 0, transition: { duration: 0.22, ease: 'easeInOut' } }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- retrigger hanya via token
  }, [shakeToken]);

  const color = highlightBlocked ? '#e11d48' : TRACK_COLOR;

  const handlePointer = (e: React.PointerEvent<SVGGElement>) => {
    if (disabled || state !== 'idle' || !onTap) return;
    e.preventDefault();
    e.stopPropagation();
    onTap(arrow.id);
  };

  return (
    <motion.g
      data-arrow-id={arrow.id}
      data-arrow-state={state}
      role={state === 'idle' ? 'button' : undefined}
      aria-label={state === 'idle' ? `Arrow ${arrow.id} ke ${ARROW_DIRS[arrow.direction].name}` : undefined}
      tabIndex={state === 'idle' && !disabled ? 0 : -1}
      initial={false}
      animate={controls}
      onPointerDown={handlePointer}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && state === 'idle' && !disabled) {
          e.preventDefault();
          onTap?.(arrow.id);
        }
      }}
      style={{
        cursor: state === 'idle' && !disabled ? 'pointer' : 'default',
        pointerEvents: state === 'idle' ? 'auto' : 'none',
        outline: 'none',
        transformBox: 'fill-box',
        transformOrigin: 'center',
      }}
    >
      {/* Area tap lebar (transparan) supaya mudah ditekan di layar sentuh. */}
      <path
        d={arrowPathD(arrow)}
        fill="none"
        stroke="transparent"
        strokeWidth={0.86 * U}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Bayangan lembut */}
      <path
        d={arrowPathD(arrow)}
        fill="none"
        stroke="rgba(15, 23, 42, 0.12)"
        strokeWidth={TRACK_WIDTH + 0.06 * U}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(0, 5)"
      />
      <polygon points={arrowHeadPoints(arrow)} fill="rgba(15, 23, 42, 0.12)" transform="translate(0, 5)" />
      {/* Track */}
      <path
        d={arrowPathD(arrow)}
        fill="none"
        stroke={color}
        strokeWidth={TRACK_WIDTH}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transition: 'stroke 160ms ease' }}
      />
      {/* Kepala panah */}
      <polygon
        points={arrowHeadPoints(arrow)}
        fill={color}
        stroke={color}
        strokeWidth={0.05 * U}
        strokeLinejoin="round"
        style={{ transition: 'fill 160ms ease, stroke 160ms ease' }}
      />
      {/* Sorot tipis di atas track agar terasa 3D halus */}
      <path
        d={arrowPathD(arrow)}
        fill="none"
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={0.1 * U}
        strokeLinecap="round"
        strokeLinejoin="round"
        transform="translate(0, -6)"
      />
    </motion.g>
  );
};

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
  const [shakes, setShakes] = useState<Record<string, number>>({});
  const [blockedHighlight, setBlockedHighlight] = useState<Set<string>>(new Set());
  const [lastReason, setLastReason] = useState<string | null>(null);
  const [autoRunning, setAutoRunning] = useState<false | 'auto' | 'all'>(false);
  const [showComplete, setShowComplete] = useState(false);

  // Arrow yang sedang meluncur keluar (terkunci dari tap ganda) + jejak removed terakhir.
  const lockedRef = useRef<Set<string>>(new Set());
  // Tap yang sudah diterapkan tetapi render berikutnya belum terjadi (anti double-tap sinkron).
  const pendingRef = useRef<Set<string>>(new Set());
  const autoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const variant = room?.mode === 'arrow_competition' ? 'competition' : 'classic';
  const isClassic = variant === 'classic';
  const isHost = Boolean(room && userId && room.hostId === userId);
  const difficultyKey = room?.difficulty ?? 'medium';
  const normalizedDifficulty = normalizeArrowDifficulty(difficultyKey);

  const seed = useMemo(
    () => buildArrowSeed(room?.id ?? '', difficultyKey, room?.startedAt ?? 0),
    [room?.id, difficultyKey, room?.startedAt]
  );

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sinkron dari localStorage saat mount
    setSfxMuted(sounds.isMuted());
  }, []);

  // ── Siapkan papan ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!room || !userId) return;
    if (isClassic && !isHost) return;

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

  const activeArrows = useMemo(
    () => (arrowState && userId ? getActiveArrows(arrowState, userId) : []),
    [arrowState, userId]
  );
  const removedIds = useMemo(
    () => (arrowState && userId ? getRemovedArrowIds(arrowState, userId) : []),
    [arrowState, userId]
  );
  const totalArrows = arrowState?.arrows.length ?? 0;
  const myProgress = arrowState && userId ? getArrowProgress(arrowState, userId) : 0;
  const myStreak = arrowState && userId ? getArrowWrongStreak(arrowState, userId) : 0;
  const nextPenalty = arrowState && userId ? getArrowNextPenalty(arrowState, userId) : 5;
  const finished = Boolean(arrowState && userId && isArrowPuzzleFinished(arrowState, userId));
  const puzzleDone = isClassic ? Boolean(arrowState?.completed) : finished;

  // ── Deteksi arrow yang baru keluar (lokal maupun dari pemain lain) → animasi ──
  // Derived state: arrow yang tercatat keluar SETELAH papan ini pertama dilihat
  // dan animasinya belum selesai = sedang "exiting". Tidak ada setState di effect.
  const [boardSnapshot, setBoardSnapshot] = useState<{ boardId: string; initialRemoved: string[] } | null>(null);
  const [finishedExitIds, setFinishedExitIds] = useState<string[]>([]);
  const boardId = arrowState?.boardId ?? null;
  if (boardId && boardSnapshot?.boardId !== boardId) {
    // Papan baru: catat arrow yang sudah keluar sebelum kita melihatnya (tidak dianimasikan).
    setBoardSnapshot({ boardId, initialRemoved: removedIds });
    setFinishedExitIds([]);
    setShowComplete(false);
  }

  const exiting = useMemo<ExitingArrow[]>(() => {
    if (!arrowState || !boardSnapshot || boardSnapshot.boardId !== arrowState.boardId) return [];
    const initial = new Set(boardSnapshot.initialRemoved);
    const done = new Set(finishedExitIds);
    const out: ExitingArrow[] = [];
    for (const id of removedIds) {
      if (initial.has(id) || done.has(id)) continue;
      const arrow = arrowState.arrows.find((a) => a.id === id);
      if (!arrow) continue;
      out.push({ arrow, distance: getArrowExitDistance(arrow, arrowState.size), key: `${arrowState.boardId}:${id}` });
    }
    return out;
  }, [arrowState, boardSnapshot, finishedExitIds, removedIds]);

  // Kunci arrow yang sedang keluar (anti double-tap). Ditulis di effect, dibaca di handler.
  useEffect(() => {
    lockedRef.current = new Set(exiting.map((e) => e.arrow.id));
    for (const id of removedIds) pendingRef.current.delete(id);
  }, [exiting, removedIds]);

  const handleExitDone = useCallback((arrowId: string) => {
    setFinishedExitIds((ids) => (ids.includes(arrowId) ? ids : [...ids, arrowId]));
  }, []);

  // Overlay selesai muncul setelah arrow terakhir benar-benar meninggalkan papan.
  useEffect(() => {
    if (!puzzleDone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset overlay saat ronde baru
      setShowComplete(false);
      return;
    }
    if (exiting.length > 0) return;
    const t = setTimeout(() => setShowComplete(true), 120);
    return () => clearTimeout(t);
  }, [puzzleDone, exiting.length]);

  const leaderboard = useMemo(() => {
    return activePlayers
      .map((p) => ({
        player: p,
        score: p.score ?? 0,
        progress: arrowState && isClassic ? getArrowProgress(arrowState, p.id) : (p.progress ?? 0),
      }))
      .sort((a, b) => b.progress - a.progress || b.score - a.score);
  }, [activePlayers, arrowState, isClassic]);

  const publishStats = useCallback(
    (score: number, progress: number, rank?: number | null) => {
      broadcastPlayerStats?.({ score, progress, rank: rank ?? null });
    },
    [broadcastPlayerStats]
  );

  // ── Tap arrow ──────────────────────────────────────────────────────────────
  const performTap = useCallback(
    (arrowId: string, opts: { silent?: boolean } = {}): boolean => {
      if (!userId || !room) return false;
      const state = useGameStore.getState().arrowPuzzleState;
      if (!state || state.variant !== variant) return false;
      if (lockedRef.current.has(arrowId) || pendingRef.current.has(arrowId)) return false;

      if ((isClassic && state.completed) || isArrowPuzzleFinished(state, userId)) {
        if (!opts.silent) toast('Puzzle sudah selesai! Tekan Next Game untuk papan baru.', { icon: '✅' });
        return false;
      }

      const myName = room.players[userId]?.username || 'Kamu';
      const baseRevision = state.revision;
      const result = applyArrowMove(state, userId, arrowId, myName, { silentScore: opts.silent });

      if (result.state === state) return false; // arrow sudah tidak ada / tap ganda

      if (result.correct) pendingRef.current.add(arrowId);
      replaceAllArrowPuzzleState(result.state);

      const me = useGameStore.getState().room?.players[userId];
      const newScore = (me?.score ?? 0) + result.scoreDelta;
      const newProgress = getArrowProgress(result.state, userId);
      const newRank = result.rank ?? me?.rank ?? null;
      updatePlayer(userId, { score: newScore, progress: newProgress, rank: newRank });
      publishStats(newScore, newProgress, newRank);

      if (isClassic && result.correct) sendArrowMove?.(arrowId, baseRevision);

      if (result.correct) {
        setLastReason(null);
        sounds.arrowStep(getRemovedArrowIds(result.state, userId).length);
        if (result.justFinished) {
          setTimeout(() => sounds.arrowComplete(), EXIT_DURATION * 1000);
          if (isClassic) {
            toast.success(`Semua arrow keluar! Bonus tim +${ARROW_TEAM_BONUS}`, { duration: 3200, icon: '🤝' });
          } else {
            toast.success(`Puzzle Complete! Peringkat ${result.rank ?? '-'} (+${result.scoreDelta} poin)`, {
              duration: 3200,
              icon: '🏆',
            });
          }
        }
      } else {
        // Blocked: getar arrow + sorot sebentar arrow yang menghalangi.
        setShakes((s) => ({ ...s, [arrowId]: (s[arrowId] ?? 0) + 1 }));
        setBlockedHighlight(new Set(result.blockers));
        setTimeout(() => setBlockedHighlight(new Set()), 420);
        setLastReason(result.penalty > 0 ? `${result.reason} · -${result.penalty}` : result.reason);
        sounds.arrowWrong(getArrowWrongStreak(result.state, userId));
      }
      return result.correct;
    },
    [userId, room, variant, isClassic, replaceAllArrowPuzzleState, updatePlayer, publishStats, sendArrowMove]
  );

  const handleArrowTap = useCallback(
    (arrowId: string) => {
      if (autoRunning) return;
      performTap(arrowId);
    },
    [autoRunning, performTap]
  );

  // ── Auto / All ─────────────────────────────────────────────────────────────
  const stopAuto = useCallback(() => {
    if (autoTimerRef.current) clearTimeout(autoTimerRef.current);
    autoTimerRef.current = null;
    setAutoRunning(false);
  }, []);

  useEffect(() => () => stopAuto(), [stopAuto]);

  const runAutoStep = useCallback((): boolean => {
    const state = useGameStore.getState().arrowPuzzleState;
    if (!state || !userId) return false;
    const movable = getMovableArrowIds(state, userId).filter(
      (id) => !lockedRef.current.has(id) && !pendingRef.current.has(id)
    );
    if (movable.length === 0) return false;
    return performTap(movable[0], { silent: true });
  }, [performTap, userId]);

  const handleAuto = useCallback(() => {
    if (autoRunning || puzzleDone) return;
    setAutoRunning('auto');
    runAutoStep();
    autoTimerRef.current = setTimeout(() => setAutoRunning(false), EXIT_DURATION * 1000 + 40);
  }, [autoRunning, puzzleDone, runAutoStep]);

  const handleAll = useCallback(() => {
    if (autoRunning || puzzleDone) return;
    setAutoRunning('all');
    const tick = () => {
      const moved = runAutoStep();
      const state = useGameStore.getState().arrowPuzzleState;
      const done = !state || !userId || isArrowPuzzleFinished(state, userId);
      if (!moved || done) {
        autoTimerRef.current = setTimeout(() => setAutoRunning(false), EXIT_DURATION * 1000);
        return;
      }
      // Satu per satu, sedikit lebih rapat dari durasi exit supaya terasa mengalir.
      autoTimerRef.current = setTimeout(tick, EXIT_DURATION * 1000 * 0.7);
    };
    tick();
  }, [autoRunning, puzzleDone, runAutoStep, userId]);

  // ── Papan baru ─────────────────────────────────────────────────────────────
  const canResetBoard = isClassic ? isHost : true;
  const handleNewBoard = useCallback(() => {
    if (!room || !userId) return;
    stopAuto();
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
    setShakes({});
    toast.success('Papan Arrow baru dibuat!', { icon: '🔄' });
  }, [room, userId, stopAuto, difficultyKey, variant, seed, isClassic, replaceAllArrowPuzzleState, broadcastArrowPuzzleState]);

  if (!arrowState) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center gap-3">
        <div className="w-8 h-8 border-3 border-foreground border-t-transparent rounded-full animate-spin" />
        <p className="text-secondary text-sm">
          {isClassic && !isHost ? 'Mengambil papan Arrow Puzzle dari host...' : 'Menyusun arrow puzzle...'}
        </p>
      </div>
    );
  }

  const size = arrowState.size;
  const viewSize = size * U + PAD * 2;
  const cfg = ARROW_DIFFICULTY[normalizeArrowDifficulty(arrowState.difficulty)];
  const removedCount = removedIds.length;
  const exitingIds = new Set(exiting.map((e) => e.arrow.id));

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-[560px] mx-auto px-1">
      {/* Header level & progress */}
      <div className="w-full bg-card border border-border rounded-2xl px-4 py-3 shadow-md">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="w-9 h-9 rounded-xl bg-amber-400 text-slate-900 font-black flex items-center justify-center shadow-sm">
              {isClassic ? <Users className="w-4 h-4" /> : <Swords className="w-4 h-4" />}
            </span>
            <div className="leading-tight">
              <p className="text-sm font-bold">
                Arrow Puzzle · {cfg.label}
              </p>
              <p className="text-[11px] text-secondary">
                {isClassic ? 'Classic — satu papan, kerja sama' : 'Competition — papan sendiri, adu cepat'}
              </p>
            </div>
          </div>
          <div className="text-right leading-tight">
            <p className="text-[11px] text-secondary">Skor</p>
            <p className="font-mono font-black text-lg">{players[userId || '']?.score ?? 0}</p>
          </div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[11px] text-secondary mb-1">
            <span>
              Arrow keluar <span className="font-bold text-foreground">{removedCount}</span> / {totalArrows}
            </span>
            <span className="font-mono">{myProgress}%</span>
          </div>
          <div className="h-2.5 rounded-full bg-secondary/15 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-amber-400 to-orange-400"
              initial={false}
              animate={{ width: `${myProgress}%` }}
              transition={{ type: 'spring', stiffness: 180, damping: 24 }}
            />
          </div>
          {myStreak > 0 && !puzzleDone && (
            <p className="mt-1 text-[11px] text-red-500 font-semibold flex items-center gap-1">
              <XCircle className="w-3 h-3" /> Terhalang beruntun ×{myStreak} — tap terhalang berikutnya -{nextPenalty}
            </p>
          )}
        </div>
      </div>

      {/* Leaderboard multiplayer */}
      {activePlayers.length > 1 && (
        <div className="w-full bg-card border border-border rounded-2xl p-2 shadow-sm flex flex-col gap-1">
          {leaderboard.slice(0, 6).map((entry, i) => (
            <div
              key={entry.player.id}
              className={`flex items-center gap-2 text-xs px-2 py-1 rounded-lg ${
                entry.player.id === userId ? 'bg-amber-400/10' : ''
              }`}
            >
              <span className="w-5 text-center">
                {i === 0 && entry.progress === 100 ? (
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
                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${entry.progress}%` }} />
              </div>
              <span className="w-9 text-right text-secondary font-mono">{entry.progress}%</span>
              <span className="w-12 text-right font-mono font-bold">{entry.score}</span>
            </div>
          ))}
        </div>
      )}

      {/* Papan puzzle */}
      <div
        data-testid="arrow-board"
        className="relative w-full aspect-square max-w-[560px] rounded-3xl bg-white border-4 border-slate-200 shadow-xl overflow-hidden touch-none select-none"
      >
        <svg
          viewBox={`0 0 ${viewSize} ${viewSize}`}
          className="w-full h-full block"
          xmlns="http://www.w3.org/2000/svg"
          style={{ overflow: 'visible' }}
        >
          {/* Titik-titik halus sebagai tekstur papan (bukan grid Sudoku). */}
          <defs>
            <pattern id="arrow-dots" width={U} height={U} patternUnits="userSpaceOnUse" x={PAD} y={PAD}>
              <circle cx={U / 2} cy={U / 2} r={3.2} fill="#cbd5e1" />
            </pattern>
          </defs>
          <rect x={PAD} y={PAD} width={size * U} height={size * U} fill="url(#arrow-dots)" opacity={0.7} />

          {/* Arrow aktif */}
          {activeArrows.map((arrow) =>
            exitingIds.has(arrow.id) ? null : (
              <ArrowGlyph
                key={arrow.id}
                arrow={arrow}
                state="idle"
                shakeToken={shakes[arrow.id] ?? 0}
                highlightBlocked={blockedHighlight.has(arrow.id)}
                disabled={puzzleDone || Boolean(autoRunning)}
                onTap={handleArrowTap}
              />
            )
          )}

          {/* Arrow yang sedang meluncur keluar papan */}
          {exiting.map((e) => (
            <ArrowGlyph
              key={e.key}
              arrow={e.arrow}
              state="exiting"
              distance={e.distance}
              onExitDone={handleExitDone}
            />
          ))}
        </svg>

        {/* Overlay selesai */}
        <AnimatePresence>
          {showComplete && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 rounded-3xl bg-white/85 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 text-center p-6"
            >
              <motion.div
                initial={{ scale: 0.6, rotate: -12 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 16 }}
              >
                <Trophy className="w-12 h-12 text-amber-500" />
              </motion.div>
              <div>
                <h3 className="font-black text-xl text-slate-900">Puzzle Complete!</h3>
                <p className="text-xs text-slate-600 mt-1">
                  {isClassic
                    ? `Tim mengeluarkan ${totalArrows} arrow. Setiap pemain mendapat bonus +${ARROW_TEAM_BONUS}.`
                    : `Peringkat ${players[userId || '']?.rank ?? '-'} · Skor ${players[userId || '']?.score ?? 0}`}
                </p>
              </div>
              {isHost && (
                <p className="text-[11px] text-emerald-600 font-semibold flex items-center gap-1">
                  <Play className="w-3.5 h-3.5" /> Host bisa menekan Next Game untuk level berikutnya.
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Pesan blocked terakhir (kecil, tidak mengganggu) */}
      <div className="h-4">
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
      </div>

      {/* Bar kontrol */}
      <div className="flex items-center justify-between gap-2 bg-amber-400 text-slate-900 p-3 rounded-2xl shadow-md w-full">
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
            className="w-9 h-9 flex items-center justify-center rounded-xl bg-white/70 hover:bg-white transition-colors cursor-pointer"
          >
            {sfxMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
          <div className="hidden sm:flex items-center gap-1.5 text-[11px] bg-white/70 px-3 py-1.5 rounded-xl">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span className="font-semibold">Keluar +{ARROW_CORRECT_POINTS} · Terhalang -5 → -10 → -20</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {!puzzleDone && (
            <>
              <button
                type="button"
                data-testid="arrow-auto"
                onClick={handleAuto}
                disabled={Boolean(autoRunning)}
                title="Keluarkan satu arrow yang bebas (tanpa poin)"
                className="h-9 px-3 rounded-xl bg-white/80 hover:bg-white text-xs font-bold flex items-center gap-1 disabled:opacity-50 cursor-pointer"
              >
                <Wand2 className="w-3.5 h-3.5" /> Auto
              </button>
              <button
                type="button"
                data-testid="arrow-all"
                onClick={handleAll}
                disabled={Boolean(autoRunning)}
                title="Selesaikan seluruh puzzle otomatis (tanpa poin)"
                className="h-9 px-3 rounded-xl bg-slate-900 text-white hover:bg-slate-800 text-xs font-bold flex items-center gap-1 disabled:opacity-50 cursor-pointer"
              >
                <FastForward className="w-3.5 h-3.5" /> All
              </button>
            </>
          )}
          {canResetBoard && !puzzleDone && (
            <Button size="sm" variant="outline" onClick={handleNewBoard} className="gap-1.5 text-xs font-semibold bg-white/80">
              <RotateCcw className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Papan Baru</span>
            </Button>
          )}
          {puzzleDone && isHost && (
            <div className="flex items-center gap-1.5 text-xs font-bold">
              <Play className="w-3.5 h-3.5" /> Tekan Next Game
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
