"use client";

import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { Dices, Trophy, SkipForward } from 'lucide-react';
import {
  getTileCoordinates,
  generateInitialSnakesState,
} from '@/utils/snakesAndLaddersData';
import { SnakesState, Player, SnakeItem as Snake, WormholePair as Wormhole } from '@/types/game';
import toast from 'react-hot-toast';

interface SnakesActionPayload {
  id: string;
  userId: string;
  dice: number;
  startPos: number;
  steppedPos: number;
  finalPos: number;
  specialHitType?: 'snake' | 'wormhole' | 'ladder' | 'mine';
  hitSnake?: Snake;
  hitWormhole?: Wormhole;
  eventMessage?: string;
  timestamp: number;
}

interface ExtendedSnakesState extends SnakesState {
  lastAction?: SnakesActionPayload;
}

interface SnakesAndLaddersBoardProps {
  broadcastSnakesState?: (newState: ExtendedSnakesState) => void;
  broadcastSnakesDiceRoll?: (diceValue: number, newPosition: number, nextTurnUserId: string, hasWon: boolean) => void;
  /** Siarkan skor/rank sendiri supaya leaderboard pemain lain ikut terupdate. */
  broadcastPlayerStats?: (stats: { score?: number; progress?: number; rank?: number | null }) => void;
}

interface TokenAnimOverride {
  x?: number;
  y?: number;
  scale?: number;
  rotate?: number;
  opacity?: number;
}

const SNAKE_SPECIES = [
  {
    name: 'Emerald Tree Boa',
    gradientId: 'snakeGrad_emerald',
    colors: ['#047857', '#10b981', '#34d399', '#064e3b'],
    scalesColor: '#d1fae5',
    headColor: '#065f46',
    eyeIris: '#facc15',
  },
  {
    name: 'Coral Snake',
    gradientId: 'snakeGrad_coral',
    colors: ['#991b1b', '#ef4444', '#f59e0b', '#18181b'],
    scalesColor: '#fef08a',
    headColor: '#7f1d1d',
    eyeIris: '#f97316',
  },
  {
    name: 'Blue Insularis Viper',
    gradientId: 'snakeGrad_blueViper',
    colors: ['#0369a1', '#0ea5e9', '#38bdf8', '#082f49'],
    scalesColor: '#e0f2fe',
    headColor: '#0284c7',
    eyeIris: '#fde047',
  },
  {
    name: 'Albino Burmese Python',
    gradientId: 'snakeGrad_albino',
    colors: ['#d97706', '#fbbf24', '#fef08a', '#f8fafc'],
    scalesColor: '#ffffff',
    headColor: '#f59e0b',
    eyeIris: '#f43f5e',
  },
  {
    name: 'Black Mamba',
    gradientId: 'snakeGrad_blackMamba',
    colors: ['#0f172a', '#334155', '#475569', '#020617'],
    scalesColor: '#94a3b8',
    headColor: '#0f172a',
    eyeIris: '#64748b',
  },
];

function getSnakePoints(
  start: { x: number; y: number },
  end: { x: number; y: number },
  seed: number = 1,
  numSegments: number = 24
): { x: number; y: number }[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 0.1) return [{ x: start.x, y: start.y }, { x: end.x, y: end.y }];

  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;

  const waveCount = Math.max(3, Math.floor(len / 14) * 2 + 1);
  const maxAmp = Math.max(3.5, Math.min(6.5, len * 0.28));
  const sign = seed % 2 === 0 ? 1 : -1;

  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= numSegments; i++) {
    const t = i / numSegments;
    const envelope = Math.sin(Math.PI * t);
    const wave = Math.sin(t * waveCount * Math.PI) * maxAmp * envelope * sign;
    points.push({
      x: start.x + dx * t + nx * wave,
      y: start.y + dy * t + ny * wave,
    });
  }
  return points;
}

function generateCurvedSnakePath(
  start: { x: number; y: number },
  end: { x: number; y: number },
  seed: number = 1
) {
  const points = getSnakePoints(start, end, seed, 24);
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

/**
 * Tuning animasi papan — SATU sumber kebenaran supaya setiap client
 * memutar durasi yang persis sama (kunci agar animasi tetap sinkron).
 */
const ANIM = {
  /** interval acak visual dadu (makin kecil = makin cepat berputar) */
  DICE_SHUFFLE_MS: 26,
  /** durasi minimum dadu berputar di pelempar sebelum hasil server dipakai */
  DICE_MIN_ROLL_MS: 340,
  /** durasi dadu berputar di layar pemain lain */
  DICE_REMOTE_SHUFFLE_MS: 160,
  /** jeda antar kotak saat bidak melangkah */
  STEP_MS: 120,
  /** jeda kecil sebelum efek spesial dimainkan */
  EVENT_PAUSE_MS: 90,
  /** ular: jeda per titik spline (lebih besar = meluncur lebih pelan) */
  SNAKE_SLIDE_MS: 34,
  /** ular: durasi ular menghilang setelah dipakai */
  SNAKE_VANISH_MS: 320,
  /** wormhole: jeda per langkah masuk/keluar */
  WORMHOLE_STEP_MS: 26,
  WORMHOLE_MID_MS: 110,
  WORMHOLE_RELOCATE_MS: 240,
  /** tangga: durasi bidak memanjat ke kotak tujuan */
  LADDER_CLIMB_MS: 460,
  LADDER_SETTLE_MS: 110,
  /** batas kompensasi lag: di atas ini animasi di-fast-forward */
  MAX_CATCHUP_MS: 2500,
};

const EMPTY_PLAYERS: Record<string, Player> = {};
const EMPTY_FROZEN: Record<string, number> = {};
const EMPTY_ARRAY: string[] = [];

export const SnakesAndLaddersBoard: React.FC<SnakesAndLaddersBoardProps> = ({ broadcastSnakesState, broadcastPlayerStats }) => {
  const userId = useGameStore((state) => state.userId);
  const room = useGameStore((state) => state.room);
  const players = room?.players || EMPTY_PLAYERS;
  const snakesState = useGameStore((state) => state.snakesState) as ExtendedSnakesState | null;
  const updateSnakesState = useGameStore((state) => state.updateSnakesState);
  const updatePlayer = useGameStore((state) => state.updatePlayer);

  const isSkippingRef = useRef(false);
  const isInitializedRef = useRef(false);
  // Initialized on mount so a rejoin never replays an OLD move's animation;
  // positions are already authoritative from sync_state.
  const lastProcessedActionTimeRef = useRef<number>(0);
  useEffect(() => {
    lastProcessedActionTimeRef.current = Date.now();
  }, []);

  const activePlayerIdsKey = useMemo(() => {
    return Object.values(players)
      .filter((p) => !p.isSpectator && p.status !== 'left')
      .map((p) => p.id)
      .join(',');
  }, [players]);

  const activePlayerIds = useMemo(() => {
    return activePlayerIdsKey ? activePlayerIdsKey.split(',') : EMPTY_ARRAY;
  }, [activePlayerIdsKey]);

  // Hanya host yang generate board awal untuk sinkronisasi 100% — guest menunggu broadcast dari host
  useEffect(() => {
    if (!snakesState || !snakesState.ladders || snakesState.ladders.length === 0) {
      if (!isInitializedRef.current && activePlayerIds.length > 0 && room?.hostId === userId) {
        isInitializedRef.current = true;
        const initial = generateInitialSnakesState(room?.difficulty || 'medium', activePlayerIds);
        // Revision must move FORWARD from whatever this client already has,
        // otherwise remote clients would reject the broadcast as stale.
        const baseRevision = useGameStore.getState().snakesState?.revision ?? 0;
        const nextState: ExtendedSnakesState = {
          ...initial,
          revision: Math.max(initial.revision ?? 1, baseRevision + 1),
        } as ExtendedSnakesState;
        updateSnakesState(nextState);
        if (broadcastSnakesState) broadcastSnakesState(nextState);
      }
    }
  }, [snakesState, room?.difficulty, activePlayerIds, updateSnakesState, broadcastSnakesState, room?.hostId, userId]);

  // Player baru join -> host otomatis taruh di kotak 1 (tanpa tunggu giliran)
  const isAnimatingRef = useRef(false);
  const lastProcessedPosRef = useRef<Record<string, number>>({});
  const snakesStateRef = useRef(snakesState);
  useEffect(() => {
    snakesStateRef.current = snakesState;
  }, [snakesState]);

  useEffect(() => {
    if (!snakesState || !room || snakesState.isAnimating || isAnimatingRef.current) return;
    const serverPos = snakesState.playerPositions || {};
    const missing = activePlayerIds.filter((pid) => !(pid in serverPos));
    if (missing.length === 0) return;
    const isAuthority = room.hostId === userId;
    if (!isAuthority) return;
    // Compose from the FRESHEST store state, not the render closure
    const latest = useGameStore.getState().snakesState as ExtendedSnakesState | undefined;
    if (!latest) return;
    const nextPositions = { ...(latest.playerPositions || {}) };
    missing.forEach((pid) => {
      nextPositions[pid] = 1;
    });
    const nextState: ExtendedSnakesState = {
      ...latest,
      playerPositions: nextPositions,
      revision: (latest.revision ?? 0) + 1,
    };
    updateSnakesState(nextState);
    if (broadcastSnakesState) broadcastSnakesState(nextState);
  }, [activePlayerIds, snakesState, room, userId, updateSnakesState, broadcastSnakesState]);

  const [localDiceRoll, setLocalDiceRoll] = useState<number | null>(null);
  const [isRollingLocal, setIsRollingLocal] = useState(false);
  const [isDiceRolling, setIsDiceRolling] = useState(false);
  const [actionStatus, setActionStatus] = useState<string | null>(null);

  const [visualPositions, setVisualPositions] = useState<Record<string, number>>({});
  const [tokenOverrides, setTokenOverrides] = useState<Record<string, TokenAnimOverride>>({});
  const [disappearingSnakeId, setDisappearingSnakeId] = useState<string | null>(null);
  const [relocatingWormholeId, setRelocatingWormholeId] = useState<string | null>(null);
  const [hopTick, setHopTick] = useState<Record<string, number>>({});

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

  // Watchdog: if isAnimating stays true >5s (e.g. roller disconnected mid-animation), reset to avoid deadlock.
  // Every client clears LOCALLY (auto-bumped revision, no broadcast); only the
  // authority (host) broadcasts recovery so N clients never race stale snapshots.
  useEffect(() => {
    if (!snakesState?.isAnimating) return;
    const timer = setTimeout(() => {
      const latest = useGameStore.getState().snakesState as ExtendedSnakesState | undefined;
      if (!latest?.isAnimating) return;
      isAnimatingRef.current = false;
      setIsRollingLocal(false);
      // Explicit forward revision — otherwise the fallback carries the CURRENT
      // revision and is rejected by the stale-revision guard (deadlock).
      const fallback: ExtendedSnakesState = { ...latest, isAnimating: false, revision: (latest.revision ?? 0) + 1 };
      updateSnakesState(fallback);
      if (broadcastSnakesState && room?.hostId === userId) broadcastSnakesState(fallback);
    }, 5000);
    return () => clearTimeout(timer);
  }, [snakesState?.isAnimating, updateSnakesState, broadcastSnakesState, room?.hostId, userId]);

  // Keep visualPositions in sync with server when no animation is running — authoritative wins
  useEffect(() => {
    if (!snakesState?.playerPositions) return;
    if (snakesState.isAnimating || isAnimatingRef.current) return;
    const isNewGame = (!snakesState.winners || snakesState.winners.length === 0) && !snakesState.winnerId;
    if (isNewGame) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync server state to visual state is intentional (new game reset)
      setVisualPositions(snakesState.playerPositions);
      lastProcessedPosRef.current = { ...snakesState.playerPositions };
      setTokenOverrides({});
      isAnimatingRef.current = false;
      setIsRollingLocal(false);
      setActionStatus(null);
      return;
    }
    // Force sync to authoritative positions (handles desync, revision update, reconnect)
    const serverPos = snakesState.playerPositions;
    const filtered: Record<string, number> = {};
    for (const [pid, pos] of Object.entries(serverPos)) {
      const pl = players[pid];
      if (!pl || pl.isSpectator || pl.status === 'left') continue;
      filtered[pid] = pos;
    }
    setVisualPositions((prev) => {
      // Quick check if already in sync
      const prevKeys = Object.keys(prev);
      const filteredKeys = Object.keys(filtered);
      if (prevKeys.length === filteredKeys.length) {
        let same = true;
        for (const k of filteredKeys) {
          if (prev[k] !== filtered[k]) { same = false; break; }
        }
        if (same) return prev;
      }
      lastProcessedPosRef.current = { ...filtered };
      return filtered;
    });
    setTokenOverrides({});
  }, [snakesState?.playerPositions, snakesState?.revision, snakesState?.winners, snakesState?.winnerId, snakesState?.isAnimating, players]);

  const isAlreadyFinished = Boolean(userId && winners.includes(userId));
  const currentTurn = snakesState?.currentTurnUserId || activePlayerIds[0];
  const isMyTurn = currentTurn === userId;
  const isBoardAnimating = Boolean(snakesState?.isAnimating);

  // Pipeline Animasi Lengkap (Sinkron di Semua Player) - SMOOTH, NO BOUNCE, LOW MS
  const animatePath = useCallback(
    async (
      targetUserId: string,
      startPos: number,
      steppedPos: number,
      finalPos: number,
      specialHit: {
        type?: 'snake' | 'wormhole' | 'ladder' | 'mine';
        snakeObj?: Snake;
        wormholeObj?: Wormhole;
      },
      eventLabel?: string,
      onComplete?: () => void,
      lagMs: number = 0
    ) => {
      isAnimatingRef.current = true;
      let curr = startPos;

      // ── LAG COMPENSATION ───────────────────────────────────────────────
      // `lagMs` = berapa lama payload ini sudah "di jalan". Kita bayar hutang
      // waktu itu dengan memperpendek jeda di awal animasi, sehingga pemain
      // yang paketnya telat tetap sampai di kotak akhir bersamaan dengan yang
      // lain — tidak lagi "masih di angka 3 padahal yang lain sudah 5".
      let debtMs = Math.max(0, Math.min(lagMs, ANIM.MAX_CATCHUP_MS));
      const wait = async (ms: number) => {
        if (debtMs >= ms) {
          debtMs -= ms;
          return; // fast-forward: lewati jeda ini
        }
        const remaining = ms - debtMs;
        debtMs = 0;
        await new Promise((r) => setTimeout(r, remaining));
      };

      while (curr !== steppedPos) {
        curr += steppedPos > curr ? 1 : -1;
        setVisualPositions((prev) => ({ ...prev, [targetUserId]: curr }));
        setHopTick((prev) => ({ ...prev, [targetUserId]: (prev[targetUserId] || 0) + 1 }));
        await wait(ANIM.STEP_MS);
      }

      if (eventLabel) {
        setActionStatus(eventLabel);
        await wait(ANIM.EVENT_PAUSE_MS);
      }

      if (specialHit.type === 'snake' && specialHit.snakeObj) {
        const sObj = specialHit.snakeObj;
        const headCoords = getTileCoordinates(sObj.head);
        const tailCoords = getTileCoordinates(sObj.tail);
        const currentSnakes = snakesStateRef.current?.snakes || [];
        const snakeIdx = currentSnakes.findIndex((s) => s.id === sObj.id);
        const splinePoints = getSnakePoints(headCoords, tailCoords, (snakeIdx >= 0 ? snakeIdx : 0) + 1, 20);

        for (let i = 0; i < splinePoints.length; i++) {
          const pt = splinePoints[i];
          setTokenOverrides((prev) => ({
            ...prev,
            [targetUserId]: {
              x: pt.x,
              y: pt.y,
              scale: 0.92,
              rotate: 0,
              opacity: 1,
            },
          }));
          await wait(ANIM.SNAKE_SLIDE_MS);
        }

        setTokenOverrides((prev) => {
          const copy = { ...prev };
          delete copy[targetUserId];
          return copy;
        });
        setVisualPositions((prev) => ({ ...prev, [targetUserId]: sObj.tail }));

        setDisappearingSnakeId(sObj.id);
        await wait(ANIM.SNAKE_VANISH_MS);
        setDisappearingSnakeId(null);
      } else if (specialHit.type === 'wormhole' && specialHit.wormholeObj) {
        const wObj = specialHit.wormholeObj;
        const bhCoords = getTileCoordinates(wObj.blackHole);
        const whCoords = getTileCoordinates(wObj.whiteHole);

        for (let step = 1; step <= 8; step++) {
          const progress = step / 8;
          setTokenOverrides((prev) => ({
            ...prev,
            [targetUserId]: {
              x: bhCoords.x,
              y: bhCoords.y,
              scale: 1 - progress * 0.9,
              rotate: progress * 360,
              opacity: 1 - progress * 0.7,
            },
          }));
          await wait(ANIM.WORMHOLE_STEP_MS);
        }

        await wait(ANIM.WORMHOLE_MID_MS);

        for (let step = 1; step <= 8; step++) {
          const progress = step / 8;
          setTokenOverrides((prev) => ({
            ...prev,
            [targetUserId]: {
              x: whCoords.x,
              y: whCoords.y,
              scale: 0.2 + progress * 0.8,
              rotate: (1 - progress) * -180,
              opacity: 0.3 + progress * 0.7,
            },
          }));
          await wait(ANIM.WORMHOLE_STEP_MS);
        }

        setTokenOverrides((prev) => {
          const copy = { ...prev };
          delete copy[targetUserId];
          return copy;
        });
        setVisualPositions((prev) => ({ ...prev, [targetUserId]: wObj.whiteHole }));

        setRelocatingWormholeId(wObj.id);
        await wait(ANIM.WORMHOLE_RELOCATE_MS);
        setRelocatingWormholeId(null);
      } else if (finalPos !== steppedPos) {
        await wait(ANIM.EVENT_PAUSE_MS);
        const finalCoords = getTileCoordinates(finalPos);
        setTokenOverrides((prev) => ({
          ...prev,
          [targetUserId]: {
            x: finalCoords.x,
            y: finalCoords.y,
            scale: 1,
            rotate: 0,
            opacity: 1,
          },
        }));
        await wait(ANIM.LADDER_CLIMB_MS);
        setTokenOverrides((prev) => {
          const copy = { ...prev };
          delete copy[targetUserId];
          return copy;
        });
        setVisualPositions((prev) => ({ ...prev, [targetUserId]: finalPos }));
        await wait(ANIM.LADDER_SETTLE_MS);
      }

      lastProcessedPosRef.current[targetUserId] = finalPos;
      setActionStatus(null);
      isAnimatingRef.current = false;
      if (onComplete) onComplete();
    },
    []
  );

  // Sinkronisasi Realtime - mendekati no-delay (requestAnimationFrame + immediate start)
  //
  // PENTING: effect ini HANYA bergantung pada identitas lastAction. Sebelumnya
  // ia bergantung pada seluruh `snakesState`, sehingga broadcast berikutnya
  // (mis. state "settle") memicu cleanup dan MEMBATALKAN animasi yang sedang
  // berjalan di layar pemain lain — itulah kenapa langkah lawan terlihat
  // melompat/telat. Sekarang animasi selalu selesai sampai kotak terakhir.
  const lastActionId = snakesState?.lastAction?.id;
  useEffect(() => {
    const latest = snakesStateRef.current;
    const action = latest?.lastAction;
    if (!action || action.userId === userId) return;
    if (action.timestamp <= lastProcessedActionTimeRef.current) return;
    lastProcessedActionTimeRef.current = action.timestamp;

    const startPos =
      action.startPos ?? latest?.playerPositions?.[action.userId] ?? 1;

    const specialHit: Parameters<typeof animatePath>[4] = {
      type: action.specialHitType,
      snakeObj: action.hitSnake,
      wormholeObj: action.hitWormhole,
    };

    // Berapa lama payload ini sudah di perjalanan (broadcast + render).
    // Dipakai untuk memangkas durasi dadu dan mengejar animasi langkah.
    const transitMs = Math.max(0, Date.now() - (action.timestamp ?? Date.now()));

    // Dadu remote: durasi total tetap sama untuk semua orang, sisa waktunya
    // dipotong oleh transit supaya tidak menumpuk delay.
    const remoteDiceMs = Math.max(0, ANIM.DICE_REMOTE_SHUFFLE_MS - transitMs);
    const animLagMs = Math.max(0, transitMs - ANIM.DICE_REMOTE_SHUFFLE_MS);

    let cancelled = false;
    let remoteShuffle: ReturnType<typeof setInterval> | null = null;

    const startTokenAnimation = () => {
      if (cancelled) return;
      setIsDiceRolling(false);
      setLocalDiceRoll(action.dice);
      requestAnimationFrame(() => {
        if (cancelled) return;
        animatePath(
          action.userId,
          startPos,
          action.steppedPos,
          action.finalPos,
          specialHit,
          action.eventMessage,
          undefined,
          animLagMs
        );
      });
    };

    if (remoteDiceMs <= 0) {
      startTokenAnimation();
    } else {
      setIsDiceRolling(true);
      remoteShuffle = setInterval(() => {
        setLocalDiceRoll(Math.floor(Math.random() * 6) + 1);
      }, ANIM.DICE_SHUFFLE_MS);
      const stopTimer = setTimeout(() => {
        if (remoteShuffle) clearInterval(remoteShuffle);
        startTokenAnimation();
      }, remoteDiceMs);
      return () => {
        cancelled = true;
        if (remoteShuffle) clearInterval(remoteShuffle);
        clearTimeout(stopTimer);
      };
    }

    return () => {
      cancelled = true;
      if (remoteShuffle) clearInterval(remoteShuffle);
    };
  }, [lastActionId, userId, animatePath]);

  // Skip giliran otomatis jika pemain yang aktif sudah finish
  useEffect(() => {
    if (!snakesState || isGameFullyFinished || isSkippingRef.current) return;

    const currentTurnId = snakesState.currentTurnUserId || '';
    const isAuthority = room?.hostId === userId || currentTurnId === userId;
    if (isAuthority && winners.includes(currentTurnId) && unfinishedPlayerIds.length > 0) {
      // Compose from the FRESHEST store state so we never build on a stale snapshot
      const latest = useGameStore.getState().snakesState as ExtendedSnakesState | undefined;
      if (!latest || latest.currentTurnUserId !== currentTurnId) return;
      isSkippingRef.current = true;
      const nextTurnId = unfinishedPlayerIds[0];
      const nextState: ExtendedSnakesState = {
        ...latest,
        currentTurnUserId: nextTurnId,
        revision: (latest.revision ?? 0) + 1,
      };

      updateSnakesState(nextState);
      if (broadcastSnakesState) broadcastSnakesState(nextState);

      setTimeout(() => {
        isSkippingRef.current = false;
      }, 100);
    }
  }, [snakesState, winners, unfinishedPlayerIds, isGameFullyFinished, updateSnakesState, broadcastSnakesState, room?.hostId, userId]);

  const handleRollDice = async () => {
    // Always read the FRESHEST authoritative state at call time — never a stale
    // React closure/ref snapshot.
    const latestState = (useGameStore.getState().snakesState as ExtendedSnakesState | undefined) ?? snakesStateRef.current;
    if (!isMyTurn || isRollingLocal || isBoardAnimating || isGameFullyFinished || !userId || isAnimatingRef.current || !latestState || isAlreadyFinished) return;
    if (latestState.isAnimating) return;

    setIsRollingLocal(true);
    setIsDiceRolling(true);
    // ── PHASE 1: LOCK (revision N+1). This exact locked snapshot is what the
    // server validates and builds on, so revisions chain without collisions:
    // N (idle) -> N+1 (lock) -> N+2 (server result, animating) -> N+3 (settle).
    const lockRevision = (latestState.revision ?? 0) + 1;
    const lockState: ExtendedSnakesState = { ...latestState, isAnimating: true, revision: lockRevision } as ExtendedSnakesState;
    updateSnakesState(lockState);
    if (broadcastSnakesState) broadcastSnakesState(lockState);
    isAnimatingRef.current = true;

    // Visual random dice shuffle while rolling
    const shuffleInterval = setInterval(() => {
      setLocalDiceRoll(Math.floor(Math.random() * 6) + 1);
    }, ANIM.DICE_SHUFFLE_MS);

    const unlockAfterFailure = (errorMessage?: string) => {
      clearInterval(shuffleInterval);
      setIsDiceRolling(false);
      if (errorMessage) toast.error(errorMessage);
      const current = (useGameStore.getState().snakesState as ExtendedSnakesState | undefined) ?? lockState;
      const unlock: ExtendedSnakesState = {
        ...current,
        isAnimating: false,
        revision: Math.max((current.revision ?? 0), lockRevision) + 1,
      } as ExtendedSnakesState;
      updateSnakesState(unlock);
      if (broadcastSnakesState) broadcastSnakesState(unlock);
      isAnimatingRef.current = false;
      setIsRollingLocal(false);
    };

    try {
      const minRollDuration = new Promise((resolve) => setTimeout(resolve, ANIM.DICE_MIN_ROLL_MS));
      const fetchRoll = fetch('/api/game/snakes-roll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: room?.id || 'unknown',
          userId,
          snakesState: { ...lockState, isAnimating: false } as SnakesState,
          activePlayerIds,
        }),
      });

      const [res] = await Promise.all([fetchRoll, minRollDuration]);
      const data = await res.json();
      clearInterval(shuffleInterval);
      setIsDiceRolling(false);

      if (!res.ok || !data.success) {
        unlockAfterFailure(data.error || 'Gagal lempar dadu (server).');
        return;
      }

      const finalDice: number = data.dice;
      // The full authoritative state computed by the server from our locked snapshot
      const serverNewState = data.newSnakesState as ExtendedSnakesState | undefined;
      const serverActionPayload = data.actionPayload as SnakesActionPayload;

      let actionPayload: SnakesActionPayload = serverActionPayload;
      let startPos: number = data.startPos;
      let steppedPos: number = data.steppedPos;
      let finalPos: number = data.finalPos;
      let hasWon: boolean = data.hasWon;
      let nextTurnId: string = data.nextTurnId;
      let newWinners: string[] = data.newWinners;
      let newFrozen: Record<string, number> = data.newFrozen;
      const updatedObstacles: Partial<SnakesState> = data.updatedObstacles;

      if (serverNewState && serverNewState.lastAction) {
        actionPayload = serverNewState.lastAction;
        startPos = actionPayload.startPos;
        steppedPos = actionPayload.steppedPos;
        finalPos = actionPayload.finalPos;
        hasWon = !!serverNewState.winnerId && !!serverNewState.winners?.includes(userId);
        nextTurnId = serverNewState.currentTurnUserId || nextTurnId;
        newWinners = serverNewState.winners || newWinners;
        newFrozen = serverNewState.frozenTurns || newFrozen;
      }

      setLocalDiceRoll(finalDice);
      setIsRollingLocal(false);

      if (actionPayload.specialHitType === 'mine') {
        toast.error('💥 Kamu menginjak Ranjau Capit! Freeze 3 giliran!');
      }

      // Use latest winners for rank check
      const currentWinners = useGameStore.getState().snakesState?.winners || winners;
      if (hasWon && !currentWinners.includes(userId)) {
        const myRank = newWinners.length;
        const medal = myRank === 1 ? '🥇' : myRank === 2 ? '🥈' : '🥉';
        toast.success(`${medal} Kamu Finish di Juara ${myRank}!`, { duration: 2500 });
        const earnedScore = myRank === 1 ? 100 : myRank === 2 ? 60 : myRank === 3 ? 30 : 10;
        const currentScore = players[userId]?.score || 0;
        const nextScore = currentScore + earnedScore;
        updatePlayer(userId, { score: nextScore, rank: myRank });
        // Tanpa ini skor kemenangan hanya terlihat di layar sendiri.
        broadcastPlayerStats?.({ score: nextScore, rank: myRank });
      }

      if (data.isExtraTurn) {
        toast.success('🎲 Angka 6! Lempar dadu sekali lagi!');
      }

      lastProcessedActionTimeRef.current = actionPayload.timestamp;

      const specialHit: Parameters<typeof animatePath>[4] = {
        type: actionPayload.specialHitType,
        snakeObj: actionPayload.hitSnake,
        wormholeObj: actionPayload.hitWormhole,
      };

      // ── PHASE 2: RESULT (revision N+2, straight from the server). Contains the
      // FINAL authoritative positions/turn/winners/frozen/obstacles + lastAction.
      // Remote clients apply this immediately and animate from lastAction.
      let resultBase: ExtendedSnakesState;
      if (serverNewState) {
        resultBase = { ...serverNewState, isAnimating: true } as ExtendedSnakesState;
      } else {
        // Backward-compat fallback if server did not return a full state:
        // build onto the FRESHEST local state (never the stale lock snapshot).
        const base = (useGameStore.getState().snakesState as ExtendedSnakesState | undefined) ?? lockState;
        resultBase = {
          ...base,
          ...updatedObstacles,
          diceValue: finalDice,
          playerPositions: { ...(base.playerPositions || {}), [userId]: finalPos },
          currentTurnUserId: nextTurnId,
          winnerId: newWinners[0] || base.winnerId || null,
          winners: newWinners,
          frozenTurns: newFrozen,
          lastAction: actionPayload,
          isAnimating: true,
        } as ExtendedSnakesState;
      }
      updateSnakesState(resultBase);
      if (broadcastSnakesState) broadcastSnakesState(resultBase);

      const localEventMessage = actionPayload.eventMessage;

      // Animate using authoritative start/stepped/final from the server
      animatePath(userId, startPos, steppedPos, finalPos, specialHit, localEventMessage, () => {
        // ── PHASE 3: SETTLE after the animation finishes. Revision MUST move
        // forward past the RESULT broadcast (N+2) or every peer — and this
        // client — would reject it as stale (the original deadlock bug).
        const latestNow = (useGameStore.getState().snakesState as ExtendedSnakesState | undefined) ?? resultBase;
        const settleRevision = Math.max((serverNewState?.revision ?? 0), (latestNow.revision ?? 0)) + 1;
        const finalState: ExtendedSnakesState = {
          ...(serverNewState ?? latestNow),
          isAnimating: false,
          isRolling: false,
          lastAction: actionPayload,
          revision: settleRevision,
        } as ExtendedSnakesState;
        updateSnakesState(finalState);
        if (broadcastSnakesState) broadcastSnakesState(finalState);

        // Authoritative positions win over any visual leftovers
        const authPos = finalState.playerPositions;
        setVisualPositions((prev) => ({ ...prev, ...authPos }));
        Object.entries(authPos).forEach(([pid, pos]) => {
          lastProcessedPosRef.current[pid] = pos;
        });
      });
    } catch {
      unlockAfterFailure('Gagal menghubungi server dadu.');
    }
  };

  const handleSkipTurn = () => {
    const latest = useGameStore.getState().snakesState as ExtendedSnakesState | undefined;
    if (!isMyTurn || !userId || !latest) return;
    if (latest.isAnimating || isAnimatingRef.current) return;

    const latestFrozen = latest.frozenTurns || EMPTY_FROZEN;
    const myFrozen = userId ? latestFrozen[userId] || 0 : 0;
    const remaining = Math.max(0, myFrozen - 1);
    const updatedFrozen = { ...latestFrozen, [userId]: remaining };

    let nextTurnId = userId;
    if (unfinishedPlayerIds.length > 0) {
      const currentIdx = unfinishedPlayerIds.indexOf(userId);
      const nextIdx = (currentIdx + 1) % unfinishedPlayerIds.length;
      nextTurnId = unfinishedPlayerIds[nextIdx];
    }

    toast(`Kamu melewatkan giliran (Sisa hukuman: ${remaining} turn)`, { icon: '⏳' });

    const nextState: ExtendedSnakesState = {
      ...latest,
      currentTurnUserId: nextTurnId,
      frozenTurns: updatedFrozen,
      revision: (latest.revision ?? 0) + 1,
    } as ExtendedSnakesState;
    updateSnakesState(nextState);
    if (broadcastSnakesState) {
      broadcastSnakesState(nextState);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 sm:gap-4 w-full max-w-[640px] lg:max-w-[460px] xl:max-w-[500px] 2xl:max-w-[540px] mx-auto select-none">
      {winners.length > 0 && (
        <div className="bg-foreground text-background px-5 py-3 rounded-2xl flex items-center gap-3 w-full justify-center shadow-xl animate-bounce">
          <Trophy className="w-6 h-6 text-amber-400" />
          <span className="font-bold text-sm sm:text-base">
            🎉 {players[winners[0]]?.username || ''} Menang & Mencapai Kotak 100!
          </span>
        </div>
      )}

      <AnimatePresence>
        {actionStatus && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="bg-card border border-border text-foreground px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold shadow-md flex items-center gap-2"
          >
            {actionStatus}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative w-full aspect-square max-w-[560px] border-2 border-border bg-card rounded-2xl shadow-xl overflow-hidden shrink-0 touch-manipulation select-none">
        {/* Board surface: ONE coordinate space shared by tiles, SVG overlay and tokens.
            Grid is a gapless 10x10 (visual gaps via inner inset) so tile centers sit
            EXACTLY at (col*10+5, 95-row*10)% — snakes, ladders and tokens align pixel-perfect. */}
        <div className="absolute inset-1 sm:inset-1.5">
        <div className="grid grid-cols-10 grid-rows-10 w-full h-full">
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
                className={`relative text-xs ${
                  tileNumber === 100
                    ? 'text-background font-black'
                    : isAlt
                    ? 'text-foreground/80'
                    : 'text-secondary'
                }`}
              >
                <div
                  className={`absolute inset-px rounded-xs ${
                    tileNumber === 100
                      ? 'bg-foreground'
                      : isAlt
                      ? 'bg-secondary/10'
                      : 'bg-card'
                  }`}
                />
                <span className="absolute top-0.5 left-1 text-[9px] font-mono opacity-40">
                  {tileNumber === 100 ? '⭐100' : tileNumber}
                </span>
              </div>
            );
          })}
        </div>

        {/* SVG Layer: Tangga, Ular & Wormhole */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none z-10" viewBox="0 0 100 100">
          <defs>
            <style>{`
              @keyframes spin-cw { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
              @keyframes spin-ccw { from { transform: rotate(0deg); } to { transform: rotate(-360deg); } }
              @keyframes pulse-jet { 0%, 100% { opacity: 0.7; transform: scaleY(1); } 50% { opacity: 1; transform: scaleY(1.15); } }
              .vortex-cw { transform-box: fill-box; transform-origin: center; animation: spin-cw 8s linear infinite; }
              .vortex-ccw { transform-box: fill-box; transform-origin: center; animation: spin-ccw 6s linear infinite; }
              .jet-beam { transform-box: fill-box; transform-origin: center; animation: pulse-jet 1.5s ease-in-out infinite; }
            `}</style>

            {SNAKE_SPECIES.map((species) => (
              <linearGradient key={species.gradientId} id={species.gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor={species.colors[0]} />
                <stop offset="35%" stopColor={species.colors[1]} />
                <stop offset="70%" stopColor={species.colors[2]} />
                <stop offset="100%" stopColor={species.colors[3]} />
              </linearGradient>
            ))}

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

          {/* Tangga */}
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

          {/* Ular */}
          {snakesState?.snakes?.map((snake, sIdx) => {
            const head = getTileCoordinates(snake.head);
            const tail = getTileCoordinates(snake.tail);
            const pathInfo = generateCurvedSnakePath(head, tail, sIdx + 1);
            if (typeof pathInfo === 'string') return null;
            const { d, firstSegmentAngle } = pathInfo;
            const species = SNAKE_SPECIES[sIdx % SNAKE_SPECIES.length];
            const isDisappearing = disappearingSnakeId === snake.id;

            return (
              <g
                key={snake.id}
                style={{
                  opacity: isDisappearing ? 0 : 1,
                  transform: isDisappearing ? 'scale(0.85)' : 'scale(1)',
                  transformOrigin: `${head.x}% ${head.y}%`,
                  transition: 'opacity 0.22s ease-out, transform 0.22s ease-out',
                }}
              >
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

          {/* Ranjau Capit */}
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

          {/* Black Hole & White Hole */}
          {snakesState?.wormholes?.map((wh) => {
            const bhPos = getTileCoordinates(wh.blackHole);
            const whPos = getTileCoordinates(wh.whiteHole);
            const isRelocating = relocatingWormholeId === wh.id;

            return (
              <g
                key={wh.id}
                style={{
                  opacity: isRelocating ? 0 : 1,
                  transform: isRelocating ? 'scale(0.2)' : 'scale(1)',
                  transformOrigin: `${bhPos.x}% ${bhPos.y}%`,
                  transition: 'opacity 0.22s ease-out, transform 0.22s ease-out',
                }}
              >
                <g transform={`translate(${bhPos.x}, ${bhPos.y})`}>
                  <circle cx="0" cy="0" r="4.6" fill="url(#bhDeepBlackGrad)" />
                  <g className="vortex-cw">
                    <path d="M 0 0 C 1.2 0.4, 2.6 2.0, 3.4 0.6 C 4.0 -0.6, 2.2 -2.2, 0 0" fill="#18181b" opacity="0.8" />
                    <path d="M 0 0 C -1.2 -0.4, -2.6 -2.0, -3.4 -0.6 C -4.0 0.6, -2.2 2.2, 0 0" fill="#18181b" opacity="0.8" />
                    <path d="M 0 0 C -0.4 1.2, -2.0 2.6, -0.6 3.4 C 0.6 4.0, 2.2 2.2, 0 0" fill="#09090b" opacity="0.9" />
                    <path d="M 0 0 C 0.4 -1.2, 2.0 -2.6, 0.6 -3.4 C -0.6 -4.0, -2.2 -2.2, 0 0" fill="#09090b" opacity="0.9" />
                  </g>
                  <g className="vortex-ccw">
                    <circle cx="0" cy="0" r="2.8" fill="url(#bhAccretionGrad)" />
                    <path d="M 0 0 C 0.8 0.8, 1.8 1.8, 2.4 0 C 2.8 -1.2, 1.2 -1.8, 0 0" fill="#27272a" opacity="0.6" />
                    <path d="M 0 0 C -0.8 -0.8, -1.8 -1.8, -2.4 0 C -2.8 1.2, -1.2 1.8, 0 0" fill="#27272a" opacity="0.6" />
                  </g>
                  <circle cx="0" cy="0" r="1.8" fill="none" stroke="#3f3f46" strokeWidth="0.25" opacity="0.6" />
                  <circle cx="0" cy="0" r="1.3" fill="#000000" stroke="#18181b" strokeWidth="0.3" />
                </g>

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

        {/* Bidak Pemain - AVATAR + STACKING + SMOOTH */}
        <div className="absolute inset-0 pointer-events-none z-30">
          {(() => {
            const posCount: Record<number, number> = {};
            const posIndex: Record<string, number> = {};
            Object.entries(visualPositions).forEach(([pid, ppos]) => {
              const pl = players[pid];
              if (!pl || pl.isSpectator || pl.status === 'left') return;
              posCount[ppos] = (posCount[ppos] || 0) + 1;
            });
            const seen: Record<number, number> = {};
            Object.entries(visualPositions).forEach(([pid, ppos]) => {
              const pl = players[pid];
              if (!pl || pl.isSpectator || pl.status === 'left') return;
              const idx = seen[ppos] ?? 0;
              posIndex[pid] = idx;
              seen[ppos] = idx + 1;
            });
            return Object.entries(visualPositions).map(([pId, pos]) => {
            const p = players[pId];
            if (!p || p.isSpectator || p.status === 'left') return null;

            const baseCoords = getTileCoordinates(pos || 1);
            const override = tokenOverrides[pId];
            let dx = 0, dy = 0;
            if (!override) {
              const cnt = posCount[pos] || 1;
              const idx = posIndex[pId] || 0;
              if (cnt === 2) { dx = idx === 0 ? -1.8 : 1.8; dy = idx === 0 ? -1.0 : 1.0; }
              else if (cnt === 3) { const off = [-2.0, 2.0, 0]; dx = off[idx] ?? 0; dy = idx === 2 ? 1.8 : -1.0; }
              else if (cnt >= 4) { const offX = [-2.2, 2.2, -2.2, 2.2]; const offY = [-1.4, -1.4, 1.4, 1.4]; dx = offX[idx % 4] ?? 0; dy = offY[idx % 4] ?? 0; }
            }
            const coords = override ? baseCoords : { x: baseCoords.x + dx, y: baseCoords.y + dy };

            const leftPos = override?.x !== undefined ? `${override.x}%` : `${coords.x}%`;
            const topPos = override?.y !== undefined ? `${override.y}%` : `${coords.y}%`;
            const scale = override?.scale !== undefined ? override.scale : 1;
            const rotate = override?.rotate !== undefined ? override.rotate : 0;
            const opacity = override?.opacity !== undefined ? override.opacity : 1;
            const isOverridden = Boolean(override);

            return (
              <div
                key={pId}
                className="absolute pointer-events-none"
                style={{
                  left: leftPos,
                  top: topPos,
                  transform: 'translate(-50%, -50%)',
                  transition: isOverridden ? 'none' : 'left 0.13s ease-in-out, top 0.13s ease-in-out',
                  zIndex: isOverridden ? 40 : 30,
                }}
              >
                <motion.div
                  className="relative flex flex-col items-center justify-center"
                  animate={{
                    scale: scale,
                    rotate: rotate,
                    opacity: opacity,
                  }}
                  transition={{
                    type: 'tween',
                    ease: isOverridden ? 'linear' : 'easeInOut',
                    duration: isOverridden ? 0.02 : 0.13,
                  }}
                >
                  {opacity > 0.35 && (
                    <div className="absolute bottom-full mb-1 px-1.5 py-0.5 text-[9px] font-bold bg-background/95 text-foreground border border-border rounded-md shadow-xs whitespace-nowrap max-w-[80px] truncate text-center z-10 pointer-events-none">
                      {p.username}
                    </div>
                  )}

                  <motion.div
                    key={`hop-${hopTick[pId] || 0}`}
                    initial={{ y: 0 }}
                    animate={{
                      y: isOverridden ? 0 : [0, -6, 0],
                    }}
                    transition={{
                      duration: isOverridden ? 0.03 : 0.16,
                      ease: 'easeOut',
                    }}
                    className="relative flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8"
                  >
                    {p.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.avatar}
                        alt={p.username || 'avatar'}
                        className="w-full h-full rounded-full border-2 shadow-lg object-cover bg-secondary/20"
                        style={{ borderColor: p.color || '#3b82f6', borderWidth: '2px' }}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <div
                        className="w-full h-full rounded-full border-2 border-background shadow-lg flex items-center justify-center text-[10px] sm:text-xs font-black text-white"
                        style={{ backgroundColor: p.color || '#3b82f6' }}
                      >
                        {p.username?.charAt(0).toUpperCase() || '?'}
                      </div>
                    )}
                  </motion.div>
                </motion.div>
              </div>
            );
          }); })()}
        </div>
        </div>
      </div>

      {winners.length > 0 && (
        <div className="bg-card border border-border p-3 rounded-xl w-full text-xs sm:text-sm flex flex-col gap-1.5 shadow-sm">
          <span className="font-bold text-foreground">🏆 Papan Peringkat Finish:</span>
          <div className="flex flex-wrap gap-2">
            {winners.map((wId, idx) => (
              <span key={wId} className="px-2.5 py-1 bg-secondary/15 rounded-lg font-medium">
                {idx === 0 ? '🥇 Juara 1: ' : idx === 1 ? '🥈 Juara 2: ' : idx === 2 ? '🥉 Juara 3: ' : `Rank ${idx + 1}: `}
                {players[wId]?.username || ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-center gap-4 bg-card p-4 rounded-2xl border border-border shadow-md w-full justify-between">
        <div className="flex items-center gap-4">
          {(() => {
            const displayedDice = (isDiceRolling || isRollingLocal)
              ? (localDiceRoll ?? '-')
              : (snakesState?.diceValue ?? localDiceRoll ?? '-');

            return (
              <div className="text-center font-mono w-16 h-16 bg-gradient-to-br from-secondary/15 to-secondary/5 rounded-2xl border border-border shadow-xs flex flex-col items-center justify-center overflow-hidden shrink-0">
                <div className="text-[9px] text-secondary font-bold uppercase tracking-wider mb-0.5">Dadu</div>
                <motion.div
                  key={`${displayedDice}-${isDiceRolling}`}
                  // Kemiringan deterministik dari nilai dadu (pure render).
                  initial={
                    isDiceRolling
                      ? { scale: 0.85, rotate: ((Number(displayedDice) || 0) % 5) * 6 - 12 }
                      : { scale: 1.35, rotate: 0 }
                  }
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ duration: isDiceRolling ? 0.03 : 0.2, ease: isDiceRolling ? 'linear' : 'backOut' }}
                  className="text-3xl font-black text-foreground leading-none"
                >
                  {displayedDice}
                </motion.div>
              </div>
            );
          })()}

          <div className="border-l border-border h-10" />

          <div className="flex flex-col">
            <span className="text-xs text-secondary font-medium">Giliran Saat Ini:</span>
            <span className="font-bold text-sm">
              {players[currentTurn || ''] ? (players[currentTurn || '']?.username || '') : 'Menunggu...'} {isMyTurn ? '(Giliran Kamu)' : ''}
              {isBoardAnimating && !isMyTurn ? ' - Berjalan...' : ''}
            </span>
          </div>
        </div>

        {isAlreadyFinished ? (
          <div className="bg-green-600/15 text-green-600 dark:text-green-400 font-bold px-4 py-2.5 rounded-xl text-center w-full sm:w-auto">
            🎉 Kamu sudah Finish (Juara {winners.indexOf(userId!) + 1})!
          </div>
        ) : myFrozenCount > 0 && isMyTurn ? (
          <Button size="lg" onClick={handleSkipTurn} disabled={isBoardAnimating} className="bg-red-600 hover:bg-red-700 text-white gap-2 w-full sm:w-auto touch-manipulation active:scale-95 select-none">
            <SkipForward className="w-5 h-5" /> Lewati Giliran (Terjebak {myFrozenCount} Turn)
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={handleRollDice}
            disabled={!isMyTurn || isRollingLocal || isBoardAnimating || isGameFullyFinished || Boolean(snakesState?.isAnimating)}
            className="gap-2 w-full sm:w-auto touch-manipulation active:scale-95 select-none"
          >
            <Dices className={`w-5 h-5 ${isRollingLocal ? 'animate-spin' : ''}`} />
            {isRollingLocal ? 'Mengocok...' : isBoardAnimating ? 'Menunggu langkah...' : 'Lempar Dadu'}
          </Button>
        )}
      </div>
    </div>
  );
};
