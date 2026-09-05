import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useGameStore } from '../store/gameStore';
import { ChatMessage, Grid, RoomState, SnakesState, TicTacToeState, Player, ArrowPuzzleState, isArrowGameMode } from '../types/game';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getOrCreateUserId } from '../utils/uuid';
import { getStoredAvatar, isSafeDataUrl } from '../utils/avatar';
import { areSnakesLayoutsEqual } from '../utils/snakesAndLaddersData';
import { applyArrowMove, getArrowProgress, ARROW_TEAM_BONUS, isValidArrowPuzzleState } from '../utils/arrowPuzzle';
import toast from 'react-hot-toast';

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const OFFLINE_TIMEOUT_MS = 6000;

type RealtimeStatus =
  | 'CONNECTING'
  | 'SUBSCRIBED'
  | 'CHANNEL_ERROR'
  | 'TIMED_OUT'
  | 'CLOSED';

export function useRealtime(roomId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const syncPollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const offlineTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef = useRef(true);
  // Last time we received ANY authoritative snakes state (sync_state or update).
  // Used by the reconciliation poll to detect silent divergence.
  const lastSnakesStateAtRef = useRef<number>(0);
  // Waktu terakhir menerima state Arrow Puzzle otoritatif (rekonsiliasi mode Classic).
  const lastArrowStateAtRef = useRef<number>(0);

  const userId = useGameStore((state) => state.userId);
  const username = useGameStore((state) => state.username);
  const grid = useGameStore((state) => state.grid);
  const snakesState = useGameStore((state) => state.snakesState);
  const ticTacToeState = useGameStore((state) => state.ticTacToeState);
  const arrowPuzzleState = useGameStore((state) => state.arrowPuzzleState);

  const userIdRef = useRef(userId);
  const usernameRef = useRef(username);
  const prevGridRef = useRef(grid);
  const prevSnakesStateRef = useRef(snakesState);
  const prevTicTacToeStateRef = useRef(ticTacToeState);
  const prevArrowPuzzleStateRef = useRef(arrowPuzzleState);

  useEffect(() => {
    userIdRef.current = userId;
    usernameRef.current = username;
  }, [userId, username]);

  const [locks, setLocks] = useState<Record<string, { userId: string; expiresAt: number }>>({});
  const [realtimeStatus, setRealtimeStatusState] = useState<RealtimeStatus>('CONNECTING');
  const statusRef = useRef<RealtimeStatus>('CONNECTING');

  const setRealtimeStatus = useCallback((status: RealtimeStatus) => {
    statusRef.current = status;
    setRealtimeStatusState(status);
  }, []);

  const [isTrulyOffline, setIsTrulyOffline] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);

  // Debounced online/offline listeners to prevent flickering notifications
  useEffect(() => {
    const handleOnline = () => {
      setIsTrulyOffline(false);
      setConnectionError(null);
    };

    const handleOffline = () => {
      setIsTrulyOffline(true);
      setConnectionError('Koneksi internet perangkat Anda terputus.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Presence cleanup saat tab ditutup — sinkron untuk status disconnect
  useEffect(() => {
    const handleTabClose = () => {
      if (channelRef.current) {
        try {
          // Supabase presence: untrack akan memicu event 'leave' di client lain
          channelRef.current.untrack();
        } catch {}
        // Fallback: coba removeChannel dengan sendBeacon-like (non-blocking)
        try {
          // Jangan removeChannel di beforeunload (bisa race), biarkan server timeout
          // tapi untrack sudah cukup untuk trigger disconnect
        } catch {}
      }
    };
    const handleVisibilityHide = () => {
      if (document.visibilityState === 'hidden' && channelRef.current) {
        try {
          // Untuk mobile/tab yang di-background, tetap jaga presence
          // tidak untrack di hidden, hanya di pagehide/beforeunload
        } catch {}
      }
    };

    window.addEventListener("beforeunload", handleTabClose);
    window.addEventListener("pagehide", handleTabClose);
    document.addEventListener("visibilitychange", handleVisibilityHide);

    return () => {
      window.removeEventListener("beforeunload", handleTabClose);
      window.removeEventListener("pagehide", handleTabClose);
      document.removeEventListener("visibilitychange", handleVisibilityHide);
    };
  }, []);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`[Realtime Logs] ${logEntry}`);
    setDebugLogs((prev) => [logEntry, ...prev.slice(0, 49)]);
  }, []);

  /**
   * Payload sync_state dari host.
   * COMPETITION ISOLATION: pada mode competition setiap pemain memegang puzzle
   * sendiri, jadi grid & solutionToken host TIDAK PERNAH dikirim ke guest.
   */
  const buildSyncPayload = useCallback((senderId: string) => {
    const store = useGameStore.getState();
    const isCompetition = store.room?.mode === 'competition';
    // ARROW COMPETITION / PRACTICE ISOLATION: tiap pemain memegang papan sendiri
    // (seed acak di Practice), jadi papan Arrow tidak pernah dikirim ke guest.
    // Mode Classic sebaliknya: satu papan bersama.
    const isArrowCompetition =
      store.room?.mode === 'arrow_competition' || store.room?.mode === 'arrow_practice';
    return {
      room: store.room,
      grid: isCompetition ? null : store.grid,
      solutionToken: isCompetition ? null : store.solutionToken,
      snakesState: store.snakesState,
      ticTacToeState: store.ticTacToeState,
      arrowPuzzleState: isArrowCompetition ? null : store.arrowPuzzleState,
      messages: store.messages,
      senderId,
    };
  }, []);

  // Toast notification for move answers (1.5 seconds)
  const triggerAnswerToast = useCallback((playerName: string, isCorrect: boolean) => {
    if (isCorrect) {
      toast.success(`${playerName}: Jawaban Benar`, {
        duration: 1500,
        position: 'top-center',
        id: `ans-${playerName}-${Date.now()}`,
      });
    } else {
      toast.error(`${playerName}: Jawaban Salah`, {
        duration: 1500,
        position: 'top-center',
        id: `ans-${playerName}-${Date.now()}`,
      });
    }
  }, []);

  const requestState = useCallback(() => {
    const currentUid = userIdRef.current || getOrCreateUserId();

    if (channelRef.current && statusRef.current === 'SUBSCRIBED') {
      addLog(`[Handshake] Meminta data game (REQUEST_SYNC) ke Host...`);

      channelRef.current.send({
        type: 'broadcast',
        event: 'request_sync',
        payload: { requesterId: currentUid },
      }).catch((err) => {
        addLog(`[Handshake] Gagal mengirim REQUEST_SYNC: ${String(err)}`);
      });
    }
  }, [addLog]);

  // Host broadcasts initial state when ready
  useEffect(() => {
    const store = useGameStore.getState();
    const currentUid = userIdRef.current || store.userId;

    if (
      store.room &&
      store.room.hostId === currentUid &&
      channelRef.current &&
      statusRef.current === 'SUBSCRIBED'
    ) {
      const isGridJustReady = Boolean(grid && !prevGridRef.current && store.solutionToken);
      const isSnakesJustReady = Boolean(snakesState && !prevSnakesStateRef.current);
      const isTicTacToeJustReady = Boolean(ticTacToeState && !prevTicTacToeStateRef.current);
      const isArrowJustReady = Boolean(arrowPuzzleState && !prevArrowPuzzleStateRef.current);

      if (isGridJustReady || isSnakesJustReady || isTicTacToeJustReady || isArrowJustReady) {
        addLog(`[Host Broadcast] Membagikan puzzle/state ke semua player.`);

        channelRef.current.send({
          type: 'broadcast',
          event: 'sync_state',
          payload: buildSyncPayload(currentUid ?? ''),
        }).catch((err) => {
          addLog(`[Host Broadcast] Gagal mengirim sync_state: ${String(err)}`);
        });
      }
    }

    prevGridRef.current = grid;
    prevSnakesStateRef.current = snakesState;
    prevTicTacToeStateRef.current = ticTacToeState;
    prevArrowPuzzleStateRef.current = arrowPuzzleState;
  }, [grid, snakesState, ticTacToeState, arrowPuzzleState, addLog, buildSyncPayload]);

  const connectChannel = useCallback(() => {
    const currentUserId = userIdRef.current || (typeof window !== 'undefined' ? getOrCreateUserId() : '');
    // Empty name is valid ("") — never fabricate a placeholder identity
    const currentUsername = usernameRef.current ??
      (typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') ?? '' : '');
    const currentAvatar = typeof window !== 'undefined' ? getStoredAvatar() : null;

    if (!roomId || !currentUserId || !isMountedRef.current) return;

    if (channelRef.current) {
      addLog(`[Cleanup] Menutup channel lama room:${roomId}`);
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    setIsTrulyOffline(false);
    setConnectionError(null);

    if (offlineTimeoutRef.current) clearTimeout(offlineTimeoutRef.current);
    offlineTimeoutRef.current = setTimeout(() => {
      const currentState = useGameStore.getState();
      const hasBoard =
        currentState.room?.mode === 'snakes_and_ladders'
          ? Boolean(currentState.snakesState)
          : currentState.room?.mode === 'tic_tac_toe'
          ? Boolean(currentState.ticTacToeState)
          : isArrowGameMode(currentState.room?.mode)
          ? Boolean(currentState.arrowPuzzleState)
          : Boolean(currentState.grid);

      if (!hasBoard && typeof navigator !== 'undefined' && !navigator.onLine) {
        setIsTrulyOffline(true);
        setConnectionError('Room offline atau Host tidak aktif.');
      }
    }, OFFLINE_TIMEOUT_MS);

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false, ack: true },
        presence: { key: currentUserId },
      },
    });

    channelRef.current = channel;

    // Satu sumber kebenaran: status player diturunkan dari presence.
    // Player yang "left" akan kembali online begitu presence-nya muncul lagi (rejoin).
    const applyPresenceToRoom = (room: RoomState): RoomState => {
      const presenceState = channel.presenceState();
      const players = { ...room.players };
      let changed = false;

      Object.keys(players).forEach((id) => {
        const presences = presenceState[id] as Array<Record<string, unknown>> | undefined;
        const isTracked = Boolean(presences?.length);
        const current = players[id];

        if (current.status === 'left' && !isTracked) return;

        const lastPresence = presences?.[presences.length - 1];
        // Username only overrides when the presence explicitly carries the field
        // (an explicit "" means the player cleared their name — honor it).
        const hasUsernameField = Boolean(lastPresence && 'username' in lastPresence);
        const latestUsername = hasUsernameField
          ? (typeof lastPresence?.username === 'string' ? lastPresence.username : '')
          : undefined;
        const rawAvatar = lastPresence?.avatar;
        const hasAvatarField = Boolean(lastPresence && 'avatar' in lastPresence);
        // Security: validate avatar DataURL from presence (untrusted)
        let latestAvatar: string | null | undefined = undefined;
        if (hasAvatarField) {
          if (rawAvatar === null) latestAvatar = null;
          else if (typeof rawAvatar === 'string' && isSafeDataUrl(rawAvatar)) latestAvatar = rawAvatar;
          else if (typeof rawAvatar === 'string' && rawAvatar.length === 0) latestAvatar = null;
          else {
            // Reject poisoned avatar, keep current
            latestAvatar = current.avatar;
          }
        }
        const targetStatus: Player['status'] = isTracked ? 'online' : 'disconnected';

        const shouldUpdateUsername = hasUsernameField && latestUsername !== undefined && current.username !== latestUsername;
        const shouldUpdateAvatar = hasAvatarField && latestAvatar !== current.avatar;
        if (current.status !== targetStatus || shouldUpdateUsername || shouldUpdateAvatar) {
          players[id] = {
            ...current,
            status: targetStatus,
            ...(shouldUpdateUsername && latestUsername !== undefined ? { username: latestUsername } : {}),
            ...(hasAvatarField ? { avatar: latestAvatar ?? null } : {}),
          };
          changed = true;
        }
      });

      Object.entries(presenceState).forEach(([id, presences]) => {
        const latestPresence = (presences as Array<Record<string, unknown>>)?.[0];
        if (!latestPresence || players[id]) return;

        players[id] = {
          id,
          // No fake name: empty until the player sets one
          username: typeof latestPresence.username === 'string' ? latestPresence.username : '',
          color: PLAYER_COLORS[Object.keys(players).length % PLAYER_COLORS.length],
          isHost: id === room.hostId,
          score: 0,
          hints: 3,
          status: 'online',
          avatar: (typeof latestPresence.avatar === 'string' && isSafeDataUrl(latestPresence.avatar))
            ? latestPresence.avatar
            : null,
        };
        changed = true;
      });

      return changed ? { ...room, players } : room;
    };

    channel
      .on('presence', { event: 'sync' }, () => {
        const currentRoom = useGameStore.getState().room;
        if (!currentRoom) return;

        const mergedRoom = applyPresenceToRoom(currentRoom);
        if (mergedRoom !== currentRoom) {
          useGameStore.getState().setRoom(mergedRoom);
        }
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        const raw = newPresences?.[0] as Record<string, unknown> | undefined;
        const store = useGameStore.getState();

        if (store.room) {
          let safeAvatar: string | null | undefined = undefined;
          if (raw && 'avatar' in raw) {
            const av = raw.avatar;
            if (av === null) safeAvatar = null;
            else if (typeof av === 'string' && isSafeDataUrl(av)) safeAvatar = av;
            else safeAvatar = store.room.players[key]?.avatar ?? null; // reject poison
          }
          // Honor explicit username field, including "" (cleared name)
          const hasUsernameField = Boolean(raw && 'username' in raw);
          const incomingUsername = typeof raw?.username === 'string' ? raw.username : undefined;
          const existingName = store.room.players[key]?.username ?? '';
          store.updatePlayer(key, {
            status: 'online',
            ...(hasUsernameField && incomingUsername !== undefined ? { username: incomingUsername } : { username: existingName }),
            ...(safeAvatar !== undefined ? { avatar: safeAvatar } : {}),
          });
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        const store = useGameStore.getState();
        if (store.room?.players[key]?.status !== 'left') {
          store.updatePlayer(key, { status: 'disconnected' });
        }
      })
      .on('broadcast', { event: 'request_sync' }, ({ payload }) => {
        addLog(`[Broadcast] Menerima request_sync dari ${payload?.requesterId}`);
        const store = useGameStore.getState();
        if (store.room && store.room.hostId === currentUserId) {
          channel.send({
            type: 'broadcast',
            event: 'sync_state',
            payload: buildSyncPayload(currentUserId),
          });
        }
      })
      .on('broadcast', { event: 'sync_state' }, ({ payload }) => {
        addLog(`[Sync State] Berhasil menerima data board & room dari Host (${payload?.senderId})!`);
        if (offlineTimeoutRef.current) clearTimeout(offlineTimeoutRef.current);
        setIsTrulyOffline(false);
        setConnectionError(null);

        const store = useGameStore.getState();
        if (payload.room) {
          // Security: sanitize avatars in room payload (untrusted host)
          try {
            Object.values(payload.room.players as Record<string, Player> || {}).forEach((pl: Player) => {
              if (pl.avatar !== undefined && pl.avatar !== null && !isSafeDataUrl(pl.avatar as string)) {
                (pl as Player).avatar = null;
              }
            });
          } catch {}
          // Room dari host bisa saja diambil sebelum presence kita diproses host,
          // jadi rekonsiliasi presence agar player tidak hilang / stuck disconnected.
          store.setRoom(applyPresenceToRoom(payload.room));
        }
        // COMPETITION ISOLATION: jangan pernah adopsi grid/solution milik host.
        const isCompetitionRoom =
          (payload.room?.mode ?? store.room?.mode) === 'competition';
        if (!isCompetitionRoom && payload.grid && payload.solutionToken) {
          store.setGameData(payload.grid, payload.solutionToken);
        }
        if (payload.snakesState) {
          // Full authority snapshot from host: adopt wholesale so a stale/high
          // local revision can never reject fresh authoritative state.
          store.replaceAllSnakesState(payload.snakesState as SnakesState);
          lastSnakesStateAtRef.current = Date.now();
        }
        if (payload.ticTacToeState) {
          store.replaceAllTicTacToeState(payload.ticTacToeState as TicTacToeState);
        }
        if (payload.arrowPuzzleState && isValidArrowPuzzleState(payload.arrowPuzzleState)) {
          store.replaceAllArrowPuzzleState(payload.arrowPuzzleState as ArrowPuzzleState);
          lastArrowStateAtRef.current = Date.now();
        }
        if (payload.messages && Array.isArray(payload.messages)) {
          // Dedupe by id — sync_state can arrive repeatedly (reconciliation,
          // reconnects) and must not duplicate chat history.
          const existingIds = new Set(useGameStore.getState().messages.map((m) => m.id));
          payload.messages.forEach((msg: ChatMessage) => {
            if (!existingIds.has(msg.id)) store.addMessage(msg);
          });
        }
      })
      .on('broadcast', { event: 'cell_move' }, ({ payload }) => {
        const store = useGameStore.getState();
        const senderName = store.room?.players[payload.userId]?.username || '';

        if (store.room?.mode === 'competition') {
          // COMPETITION ISOLATION: setiap pemain punya papan sendiri.
          // Jangan terapkan move lawan DAN jangan tampilkan notifikasi jawaban
          // lawan (membocorkan benar/salah + ritme lawan). Progress % di panel
          // Players sudah cukup sebagai info kompetisi.
          return;
        }

        store.updateCellWithValidation(
          payload.row,
          payload.col,
          payload.value,
          payload.userId,
          payload.isCorrect
        );

        triggerAnswerToast(senderName, payload.isCorrect);
      })
      .on('broadcast', { event: 'cell_note' }, ({ payload }) => {
        const store = useGameStore.getState();
        if (store.room?.mode === 'competition') return;
        store.toggleNote(payload.row, payload.col, payload.note);
      })
      .on('broadcast', { event: 'cursor_move' }, ({ payload }) => {
        // COMPETITION ISOLATION: posisi kursor lawan tidak boleh bocor.
        if (useGameStore.getState().room?.mode === 'competition') return;
        useGameStore.getState().updatePlayer(payload.userId, {
          cursor: { row: payload.row, col: payload.col },
        });
      })
      .on('broadcast', { event: 'cell_lock' }, ({ payload }) => {
        // COMPETITION ISOLATION: tidak ada lock antar pemain (papan terpisah).
        if (useGameStore.getState().room?.mode === 'competition') return;
        setLocks((prev) => ({
          ...prev,
          [`${payload.row}-${payload.col}`]: {
            userId: payload.userId,
            expiresAt: Date.now() + 2000,
          },
        }));
      })
      .on('broadcast', { event: 'chat_message' }, ({ payload }) => {
        useGameStore.getState().addMessage(payload);
      })
      .on('broadcast', { event: 'player_leave_room' }, ({ payload }) => {
        useGameStore.getState().updatePlayer(payload.userId, { status: 'left' });
      })
      .on('broadcast', { event: 'next_game' }, ({ payload }) => {
        addLog(`[Next Game] Game baru dimulai oleh host.`);
        const store = useGameStore.getState();
        if (payload.room) {
          try {
            Object.values(payload.room.players as Record<string, Player> || {}).forEach((pl: Player) => {
              if (pl.avatar !== undefined && pl.avatar !== null && !isSafeDataUrl(pl.avatar as string)) {
                (pl as Player).avatar = null;
              }
            });
          } catch {}
          store.setRoom(payload.room);
        }

        if (payload.room?.mode === 'snakes_and_ladders' && payload.snakesState) {
          // New game state is authoritative (host-generated, revision may reset to 1):
          // adopt wholesale so old higher revisions cannot reject it.
          store.replaceAllSnakesState(payload.snakesState as SnakesState);
        } else if (payload.room?.mode === 'tic_tac_toe' && payload.ticTacToeState) {
          store.replaceAllTicTacToeState(payload.ticTacToeState as TicTacToeState);
        } else if (payload.room?.mode === 'arrow_classic' && isValidArrowPuzzleState(payload.arrowPuzzleState)) {
          store.replaceAllArrowPuzzleState(payload.arrowPuzzleState as ArrowPuzzleState);
          lastArrowStateAtRef.current = Date.now();
        } else if (payload.room?.mode === 'arrow_competition' || payload.room?.mode === 'arrow_practice') {
          // Papan kompetisi/practice dibuat ulang lokal oleh tiap pemain
          // (seed = startedAt baru; Practice memakai seed acak per ronde).
          store.clearArrowPuzzleState();
        } else if (payload.room?.mode === 'competition') {
          // Kosongkan grid lama agar memicu pengambilan puzzle baru.
          store.clearGameData();
        } else if (payload.initialGrid && payload.solutionToken) {
          store.startNextGame(payload.initialGrid, payload.solutionToken);
        }
      })
      .on('broadcast', { event: 'snakes_dice_roll' }, ({ payload }) => {
        const cur = useGameStore.getState().snakesState;
        if (!cur) return;
        if (typeof payload.revision === 'number' && payload.revision <= cur.revision) return;
        if (cur.isAnimating) return;
        useGameStore.getState().updateSnakesState({
          diceValue: payload.diceValue,
          playerPositions: {
            ...(useGameStore.getState().snakesState?.playerPositions || {}),
            [payload.userId]: payload.newPosition,
          },
          currentTurnUserId: payload.nextTurnUserId,
          winnerId: payload.hasWon ? payload.userId : null,
          ...(typeof payload.revision === 'number' ? { revision: payload.revision } : {}),
        });
      })
      .on('broadcast', { event: 'snakes_state_update' }, ({ payload }) => {
        if (payload.snakesState) {
          const incoming = payload.snakesState as SnakesState;
          const current = useGameStore.getState().snakesState;
          const layoutDiffers = !areSnakesLayoutsEqual(current, incoming);
          if (layoutDiffers || (incoming.boardId && current?.boardId && incoming.boardId !== current.boardId)) {
            useGameStore.getState().replaceAllSnakesState(incoming);
          } else {
            useGameStore.getState().updateSnakesState(incoming);
          }
          lastSnakesStateAtRef.current = Date.now();
        }
      })
      .on('broadcast', { event: 'tic_tac_toe_state_update' }, ({ payload }) => {
        if (payload.ticTacToeState) {
          const incoming = payload.ticTacToeState as TicTacToeState;
          const current = useGameStore.getState().ticTacToeState;
          if (incoming.boardId && current?.boardId && incoming.boardId !== current.boardId) {
            useGameStore.getState().replaceAllTicTacToeState(incoming);
          } else {
            useGameStore.getState().updateTicTacToeState(incoming);
          }
        }
      })
      .on('broadcast', { event: 'arrow_puzzle_state_update' }, ({ payload }) => {
        if (!payload?.arrowPuzzleState || !isValidArrowPuzzleState(payload.arrowPuzzleState)) return;
        const incoming = payload.arrowPuzzleState as ArrowPuzzleState;
        const current = useGameStore.getState().arrowPuzzleState;
        if (incoming.boardId && current?.boardId && incoming.boardId !== current.boardId) {
          useGameStore.getState().replaceAllArrowPuzzleState(incoming);
        } else {
          useGameStore.getState().updateArrowPuzzleState(incoming);
        }
        lastArrowStateAtRef.current = Date.now();
      })
      .on('broadcast', { event: 'arrow_move' }, ({ payload }) => {
        const store = useGameStore.getState();
        // COMPETITION ISOLATION: mode kompetisi memakai papan sendiri, tanpa langkah lawan.
        if (store.room?.mode !== 'arrow_classic') return;
        const current = store.arrowPuzzleState;
        const actorId = typeof payload?.userId === 'string' ? payload.userId : '';
        if (!current || !actorId || actorId === userIdRef.current) return;

        const arrowId = typeof payload?.arrowId === 'string' ? payload.arrowId : '';
        if (!arrowId || !current.arrows.some((a) => a.id === arrowId)) {
          // Arrow tidak dikenal -> papan lokal mungkin beda/basi, minta snapshot host.
          requestState();
          return;
        }

        // Revisi lokal tidak sinkron dengan pengirim -> minta snapshot host, tapi tetap
        // terapkan langkahnya bila masih valid supaya animasi keluar terlihat realtime.
        if (typeof payload?.baseRevision === 'number' && payload.baseRevision !== current.revision) {
          requestState();
        }

        const actorName = store.room?.players[actorId]?.username || 'Pemain';
        // Setiap client menilai langkah dari papan yang sama, jadi hasilnya identik.
        const result = applyArrowMove(current, actorId, arrowId, actorName);
        if (result.state !== current) {
          store.replaceAllArrowPuzzleState(result.state);
          useGameStore.getState().updatePlayer(actorId, {
            progress: getArrowProgress(result.state, actorId),
          });
          lastArrowStateAtRef.current = Date.now();
        }

        // Puzzle Classic tuntas oleh pemain lain -> bonus tim masuk ke skor sendiri.
        if (result.justCompleted && userIdRef.current && userIdRef.current !== actorId) {
          const me = userIdRef.current;
          const myPlayer = useGameStore.getState().room?.players[me];
          const myScore = (myPlayer?.score ?? 0) + ARROW_TEAM_BONUS;
          const myProgress = getArrowProgress(result.state, me);
          useGameStore.getState().updatePlayer(me, { score: myScore, progress: myProgress });
          channelRef.current?.send({
            type: 'broadcast',
            event: 'player_stats',
            payload: { userId: me, score: myScore, progress: myProgress, rank: myPlayer?.rank ?? null },
          });
          toast.success(`Puzzle Complete! Bonus tim +${ARROW_TEAM_BONUS}`, {
            duration: 2600,
            icon: '🤝',
          });
        }

        if (result.correct) {
          toast.success(`${actorName} mengeluarkan arrow (+10)`, {
            duration: 1200,
            position: 'top-center',
            id: `arrow-${actorId}-${payload?.ts ?? Date.now()}`,
          });
        }
      })
      .on('broadcast', { event: 'player_stats' }, ({ payload }) => {
        const { userId: pid, score, progress, rank, finishedAt, startedAt } = (payload ?? {}) as {
          userId?: string; score?: unknown; progress?: unknown; rank?: unknown; finishedAt?: unknown; startedAt?: unknown;
        };
        if (!pid || typeof pid !== 'string') return;
        // Paket statistik dari ronde lama tidak boleh menghidupkan kembali
        // ranking setelah Next Game.
        if (typeof startedAt === 'number' && startedAt !== useGameStore.getState().room?.startedAt) return;
        const patch: Partial<Player> = {};
        if (typeof score === 'number' && Number.isFinite(score)) patch.score = score;
        if (typeof progress === 'number' && Number.isFinite(progress)) {
          patch.progress = Math.max(0, Math.min(100, Math.round(progress)));
        }
        const existingPlayer = useGameStore.getState().room?.players[pid];
        if (typeof rank === 'number' && Number.isFinite(rank)) {
          patch.rank = rank;
        } else if (rank === null && typeof existingPlayer?.finishedAt !== 'number') {
          patch.rank = null;
        }
        if (typeof finishedAt === 'number' && Number.isFinite(finishedAt)) {
          patch.finishedAt = finishedAt;
        }
        if (Object.keys(patch).length === 0) return;
        const store = useGameStore.getState();
        store.updatePlayer(pid, patch);

        // Recompute all finished ranks from the same ordered set. This resolves
        // simultaneous finishes deterministically and repairs old clients that
        // broadcast rank 1 before seeing the other player's finish claim.
        if (store.room?.mode === 'arrow_competition') {
          const players = Object.values(useGameStore.getState().room?.players ?? {})
            .filter((p) => typeof p.finishedAt === 'number')
            .sort((a, b) => (a.finishedAt as number) - (b.finishedAt as number) || a.id.localeCompare(b.id));
          players.forEach((p, index) => {
            const expectedRank = index + 1;
            if (p.rank !== expectedRank) {
              useGameStore.getState().updatePlayer(p.id, { rank: expectedRank });
            }
          });
        }
      })
      .on('broadcast', { event: 'player_profile_update' }, ({ payload }) => {
        const { playerId, username, avatar } = (payload ?? {}) as {
          playerId?: string;
          username?: unknown;
          avatar?: unknown;
        };
        if (!playerId || typeof playerId !== 'string') return;
        const patch: Partial<Player> = {};
        if (typeof username === 'string') {
          patch.username = username.trim().slice(0, 20);
        }
        if (avatar === null) {
          patch.avatar = null;
        } else if (typeof avatar === 'string' && isSafeDataUrl(avatar)) {
          patch.avatar = avatar;
        } else if (avatar !== undefined) {
          addLog(`[Profile] Rejected poisoned avatar from ${playerId}`);
        }
        if (Object.keys(patch).length === 0) return;
        useGameStore.getState().updatePlayer(playerId, patch);
        addLog(`[Profile] Update profil dari ${playerId}`);
      })
      .on('broadcast', { event: 'player_avatar_update' }, ({ payload }) => {
        const { playerId, avatar } = payload as { playerId: string; avatar: unknown };
        if (!playerId) return;
        let safe: string | null | undefined = undefined;
        if (avatar === null) safe = null;
        else if (typeof avatar === 'string' && isSafeDataUrl(avatar)) safe = avatar;
        else {
          addLog(`[Avatar] Rejected poisoned avatar from ${playerId}`);
          return;
        }
        useGameStore.getState().updatePlayer(playerId, { avatar: safe });
        addLog(`[Avatar] Update avatar dari ${playerId}`);
      })
      .subscribe(async (status) => {
        if (!isMountedRef.current) return;

        addLog(`[Channel Status Change] -> ${status}`);
        setRealtimeStatus(status as RealtimeStatus);

        if (status === 'SUBSCRIBED') {
          setIsTrulyOffline(false);
          setConnectionError(null);
          if (offlineTimeoutRef.current) clearTimeout(offlineTimeoutRef.current);
          addLog(`[Presence Track] Mendaftarkan player ${currentUsername} (${currentUserId})`);

          try {
            await channel.track({
              user_id: currentUserId,
              username: currentUsername,
              avatar: currentAvatar,
              status: 'online',
              online_at: new Date().toISOString(),
            });
          } catch (err) {
            addLog(`[Presence Track] Gagal track presence: ${String(err)}`);
          }

          const store = useGameStore.getState();
          const hasBoard =
            store.room?.mode === 'snakes_and_ladders'
              ? Boolean(store.snakesState)
              : store.room?.mode === 'tic_tac_toe'
              ? Boolean(store.ticTacToeState)
              : isArrowGameMode(store.room?.mode)
              ? Boolean(store.arrowPuzzleState)
              : Boolean(store.grid);

          const isHost = Boolean(store.room && store.room.hostId === currentUserId);

          if (isHost && hasBoard) {
            addLog('[Host Sync] Channel SUBSCRIBED. Mengirim state awal ke semua guest.');

            channel.send({
              type: 'broadcast',
              event: 'sync_state',
              payload: buildSyncPayload(currentUserId),
            }).catch((err) => {
              addLog(`[Host Sync] Gagal mengirim sync_state: ${String(err)}`);
            });
          }

          requestState();
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setIsTrulyOffline(true);
            setConnectionError('Gagal terhubung ke realtime server.');
          }
        }
      });
  }, [roomId, addLog, requestState, setRealtimeStatus, triggerAnswerToast, buildSyncPayload]);

  // SMART AUTO RECONNECT (Network Online / Tab Focus / Visibility Change)
  useEffect(() => {
    isMountedRef.current = true;
    connectChannel();

    const handleSmartReconnect = (e?: Event) => {
      const isOnlineEvent = e?.type === 'online';
      if (!isOnlineEvent && statusRef.current === 'SUBSCRIBED' && navigator.onLine) return;
      if (document.visibilityState === 'visible' || navigator.onLine) {
        connectChannel();
      }
    };

    window.addEventListener('online', handleSmartReconnect);
    window.addEventListener('focus', handleSmartReconnect);
    document.addEventListener('visibilitychange', handleSmartReconnect);

    // Polling sync & rekonsiliasi periodik: menjamin 100% board identik antar player
    syncPollIntervalRef.current = setInterval(() => {
      const store = useGameStore.getState();

      const hasBoard =
        store.room?.mode === 'snakes_and_ladders'
          ? Boolean(store.snakesState)
          : store.room?.mode === 'tic_tac_toe'
          ? Boolean(store.ticTacToeState)
          : isArrowGameMode(store.room?.mode)
          ? Boolean(store.arrowPuzzleState)
          : Boolean(store.grid);

      if (!hasBoard && statusRef.current === 'SUBSCRIBED') {
        requestState();
        return;
      }

      if (
        store.room?.mode === 'snakes_and_ladders' &&
        hasBoard &&
        statusRef.current === 'SUBSCRIBED'
      ) {
        const isHost = store.room.hostId === (store.userId || '');
        if (!isHost) {
          const lastAt = lastSnakesStateAtRef.current;
          if (lastAt === 0) {
            lastSnakesStateAtRef.current = Date.now();
            requestState();
          } else if (Date.now() - lastAt > 3000) {
            lastSnakesStateAtRef.current = Date.now();
            requestState();
          }
        }
      }

      // Mode Arrow Classic: papan bersama, jadi guest rutin memastikan sinkron.
      if (
        store.room?.mode === 'arrow_classic' &&
        hasBoard &&
        statusRef.current === 'SUBSCRIBED' &&
        store.room.hostId !== (store.userId || '')
      ) {
        const lastAt = lastArrowStateAtRef.current;
        if (lastAt === 0 || Date.now() - lastAt > 3000) {
          lastArrowStateAtRef.current = Date.now();
          requestState();
        }
      }
    }, 1200);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('online', handleSmartReconnect);
      window.removeEventListener('focus', handleSmartReconnect);
      document.removeEventListener('visibilitychange', handleSmartReconnect);

      if (syncPollIntervalRef.current) {
        clearInterval(syncPollIntervalRef.current);
      }

      if (offlineTimeoutRef.current) {
        clearTimeout(offlineTimeoutRef.current);
      }

      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [connectChannel, requestState]);

  // Actions
  const broadcastMove = useCallback(
    async (row: number, col: number, value: number | null) => {
      const currentUid = userIdRef.current || getOrCreateUserId();
      const currentUname = usernameRef.current ?? '';
      const store = useGameStore.getState();

      if (value === null) {
        store.updateCellWithValidation(row, col, null, currentUid, false);
        channelRef.current?.send({
          type: 'broadcast',
          event: 'cell_move',
          payload: { row, col, value: null, userId: currentUid, isCorrect: false },
        });
        return;
      }

      const token = store.solutionToken;
      if (!token) return;

      store.setOptimisticMove(row, col, value);

      try {
        const res = await fetch('/api/game/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row, col, value, solutionToken: token, roomId: store.room?.id }),
        });
        const data = await res.json();
        const isCorrect = Boolean(data.isCorrect);

        const latest = useGameStore.getState();
        latest.updateCellWithValidation(row, col, value, currentUid, isCorrect);

        if (latest.room?.mode !== 'snakes_and_ladders' && latest.room?.mode !== 'tic_tac_toe') {
          triggerAnswerToast(currentUname, isCorrect);
        }

        channelRef.current?.send({
          type: 'broadcast',
          event: 'cell_move',
          payload: { row, col, value, userId: currentUid, isCorrect },
        });

        const me = useGameStore.getState().room?.players[currentUid];
        if (me) {
          channelRef.current?.send({
            type: 'broadcast',
            event: 'player_stats',
            payload: {
              userId: currentUid,
              score: me.score,
              progress: me.progress ?? 0,
              rank: me.rank ?? null,
            },
          });
        }
      } catch (err) {
        console.error('Failed to verify move:', err);
        useGameStore.getState().updateCellWithValidation(row, col, null, currentUid, false);
        toast.error('Gagal memverifikasi jawaban. Coba lagi.');
      }
    },
    [triggerAnswerToast]
  );

  const broadcastNote = useCallback((row: number, col: number, note: number) => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    useGameStore.getState().toggleNote(row, col, note);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'cell_note',
      payload: { row, col, note, userId: currentUid },
    });
  }, []);

  const broadcastCursor = useCallback((row: number, col: number) => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    channelRef.current?.send({
      type: 'broadcast',
      event: 'cursor_move',
      payload: { row, col, userId: currentUid },
    });
  }, []);

  const lockCell = useCallback((row: number, col: number) => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    channelRef.current?.send({
      type: 'broadcast',
      event: 'cell_lock',
      payload: { row, col, userId: currentUid },
    });
  }, []);

  const broadcastChat = useCallback((text: string) => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    const currentName = usernameRef.current ?? '';
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      userId: currentUid,
      username: currentName,
      text,
      timestamp: Date.now(),
    };
    useGameStore.getState().addMessage(msg);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'chat_message',
      payload: msg,
    });
  }, []);

  const broadcastNextGame = useCallback(
    (
      initialGrid: Grid | null,
      solutionToken: string | null,
      updatedRoom?: RoomState,
      snakesState?: SnakesState | null,
      ticTacToeState?: TicTacToeState | null,
      arrowPuzzleState?: ArrowPuzzleState | null
    ) => {
      if (channelRef.current && statusRef.current === 'SUBSCRIBED') {
        channelRef.current.send({
          type: 'broadcast',
          event: 'next_game',
          payload: {
            initialGrid,
            solutionToken,
            room: updatedRoom,
            snakesState,
            ticTacToeState,
            arrowPuzzleState,
          },
        });
      }
    },
    []
  );

  const broadcastLeaveRoom = useCallback(async () => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    useGameStore.getState().updatePlayer(currentUid, { status: 'left' });
    try {
      channelRef.current?.send({
        type: 'broadcast',
        event: 'player_leave_room',
        payload: { userId: currentUid },
      });
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
    if (channelRef.current) {
      try {
        await channelRef.current.untrack();
      } catch {}
      try {
        supabase.removeChannel(channelRef.current);
      } catch {}
      channelRef.current = null;
    }
    statusRef.current = 'CLOSED';
  }, []);

  const broadcastSnakesDiceRoll = useCallback((diceValue: number, newPosition: number, nextTurnUserId: string, hasWon: boolean) => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    channelRef.current?.send({
      type: 'broadcast',
      event: 'snakes_dice_roll',
      payload: {
        diceValue,
        newPosition,
        nextTurnUserId,
        hasWon,
        userId: currentUid,
        revision: useGameStore.getState().snakesState?.revision,
      },
    });
  }, []);

  const broadcastSnakesState = useCallback((newState: SnakesState) => {
    const current = useGameStore.getState().snakesState;
    if (newState.boardId && current?.boardId && newState.boardId !== current.boardId) {
      useGameStore.getState().replaceAllSnakesState(newState);
    } else {
      useGameStore.getState().updateSnakesState(newState);
    }
    channelRef.current?.send({
      type: 'broadcast',
      event: 'snakes_state_update',
      payload: { snakesState: newState, sentAt: Date.now() },
    });
  }, []);

  const broadcastTicTacToeState = useCallback((newState: TicTacToeState) => {
    const current = useGameStore.getState().ticTacToeState;
    if (newState.boardId && current?.boardId && newState.boardId !== current.boardId) {
      useGameStore.getState().replaceAllTicTacToeState(newState);
    } else {
      useGameStore.getState().updateTicTacToeState(newState);
    }
    channelRef.current?.send({
      type: 'broadcast',
      event: 'tic_tac_toe_state_update',
      payload: { ticTacToeState: newState, sentAt: Date.now() },
    });
  }, []);

  /** Siarkan papan Arrow Puzzle utuh (reset papan / adopsi papan baru di mode Classic). */
  const broadcastArrowPuzzleState = useCallback((newState: ArrowPuzzleState) => {
    const current = useGameStore.getState().arrowPuzzleState;
    if (newState.boardId && current?.boardId && newState.boardId !== current.boardId) {
      useGameStore.getState().replaceAllArrowPuzzleState(newState);
    } else {
      useGameStore.getState().updateArrowPuzzleState(newState);
    }
    lastArrowStateAtRef.current = Date.now();
    channelRef.current?.send({
      type: 'broadcast',
      event: 'arrow_puzzle_state_update',
      payload: { arrowPuzzleState: newState, sentAt: Date.now() },
    });
  }, []);

  /**
   * Kirim satu tap arrow (mode Classic). Penerima menilai sendiri dari
   * papan bersama sehingga semua client sampai pada hasil yang sama.
   */
  const sendArrowMove = useCallback(
    (arrowId: string, baseRevision: number) => {
      const currentUid = userIdRef.current || getOrCreateUserId();
      channelRef.current?.send({
        type: 'broadcast',
        event: 'arrow_move',
        payload: { userId: currentUid, arrowId, baseRevision, ts: Date.now() },
      });
    },
    []
  );

  const broadcastProfileUpdate = useCallback(
    (profile: { username?: string; avatar?: string | null }) => {
      const currentUid = userIdRef.current || getOrCreateUserId();
      const patch: Partial<Player> = {};

      if (typeof profile.username === 'string') {
        const clean = profile.username.trim().slice(0, 20);
        patch.username = clean;
        try {
          localStorage.setItem('sudoku_username', clean);
        } catch {}
        usernameRef.current = clean;
      }

      if (profile.avatar !== undefined) {
        if (profile.avatar !== null && !isSafeDataUrl(profile.avatar)) {
          addLog('[Profile] Blocked unsafe avatar upload');
          toast.error('Avatar tidak valid/aman');
          return;
        }
        patch.avatar = profile.avatar;
        try {
          if (profile.avatar) localStorage.setItem('sudoku_avatar', profile.avatar);
          else localStorage.removeItem('sudoku_avatar');
          window.dispatchEvent(new Event('avatarUpdated'));
        } catch {}
      }

      if (Object.keys(patch).length === 0) return;

      useGameStore.getState().updatePlayer(currentUid, patch);

      if (channelRef.current && statusRef.current === 'SUBSCRIBED') {
        const ch = channelRef.current;
        const nextUsername = patch.username !== undefined ? patch.username : (usernameRef.current ?? '');
        const nextAvatar = patch.avatar !== undefined ? patch.avatar : getStoredAvatar();
        ch.untrack().catch(() => {}).finally(() => {
          ch.track({
            user_id: currentUid,
            username: nextUsername,
            avatar: nextAvatar,
            status: 'online',
            online_at: new Date().toISOString(),
          }).catch(() => {});
        });
      }

      channelRef.current?.send({
        type: 'broadcast',
        event: 'player_profile_update',
        payload: {
          playerId: currentUid,
          ...(patch.username !== undefined ? { username: patch.username } : {}),
          ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
        },
      });
    },
    [addLog]
  );

  const broadcastPlayerStats = useCallback(
    (stats: { score?: number; progress?: number; rank?: number | null; finishedAt?: number }) => {
      const currentUid = userIdRef.current || getOrCreateUserId();
      channelRef.current?.send({
        type: 'broadcast',
        event: 'player_stats',
        payload: { userId: currentUid, startedAt: useGameStore.getState().room?.startedAt, ...stats },
      });
    },
    []
  );

  const broadcastAvatarUpdate = useCallback((avatar: string | null) => {
    broadcastProfileUpdate({ avatar });
  }, [broadcastProfileUpdate]);

  return {
    broadcastMove,
    broadcastNote,
    broadcastCursor,
    lockCell,
    locks,
    broadcastChat,
    broadcastNextGame,
    broadcastLeaveRoom,
    broadcastSnakesDiceRoll,
    broadcastSnakesState,
    broadcastTicTacToeState,
    broadcastArrowPuzzleState,
    sendArrowMove,
    broadcastAvatarUpdate,
    broadcastProfileUpdate,
    broadcastPlayerStats,
    requestState,
    realtimeStatus,
    isTrulyOffline,
    connectionError,
    debugLogs,
    reconnect: connectChannel,
  };
}
