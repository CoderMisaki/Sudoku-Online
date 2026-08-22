import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useGameStore } from '../store/gameStore';
import { ChatMessage, Grid, RoomState, SnakesState, Player } from '../types/game';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getOrCreateUserId } from '../utils/uuid';
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

  const userId = useGameStore((state) => state.userId);
  const username = useGameStore((state) => state.username);
  const grid = useGameStore((state) => state.grid);
  const snakesState = useGameStore((state) => state.snakesState);

  const userIdRef = useRef(userId);
  const usernameRef = useRef(username);
  const prevGridRef = useRef(grid);
  const prevSnakesStateRef = useRef(snakesState);

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

  // Tambahkan useEffect untuk melepas presence saat tab ditutup
  useEffect(() => {
    const handleTabClose = () => {
      if (channelRef.current) {
        try {
          channelRef.current.untrack();
        } catch {}
      }
    };

    window.addEventListener("beforeunload", handleTabClose);
    window.addEventListener("pagehide", handleTabClose);

    return () => {
      window.removeEventListener("beforeunload", handleTabClose);
      window.removeEventListener("pagehide", handleTabClose);
    };
  }, []);

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`[Realtime Logs] ${logEntry}`);
    setDebugLogs((prev) => [logEntry, ...prev.slice(0, 49)]);
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

      if (isGridJustReady || isSnakesJustReady) {
        addLog(`[Host Broadcast] Membagikan puzzle/state ke semua player.`);

        channelRef.current.send({
          type: 'broadcast',
          event: 'sync_state',
          payload: {
            room: store.room,
            grid: store.grid,
            solutionToken: store.solutionToken,
            snakesState: store.snakesState,
            messages: store.messages,
            senderId: currentUid,
          },
        }).catch((err) => {
          addLog(`[Host Broadcast] Gagal mengirim sync_state: ${String(err)}`);
        });
      }
    }

    prevGridRef.current = grid;
    prevSnakesStateRef.current = snakesState;
  }, [grid, snakesState, addLog]);

  const connectChannel = useCallback(() => {
    const currentUserId = userIdRef.current || (typeof window !== 'undefined' ? getOrCreateUserId() : '');
    const currentUsername = usernameRef.current || (typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') || 'Player' : 'Player');

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
      const hasBoard = currentState.room?.mode === 'snakes_and_ladders' ? Boolean(currentState.snakesState) : Boolean(currentState.grid);
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

    channel
      .on('presence', { event: 'sync' }, () => {
        const presenceState = channel.presenceState();
        const currentRoom = useGameStore.getState().room;
        if (!currentRoom) return;

        const newPlayersState = { ...currentRoom.players };
        let hasChanges = false;

        const activePresenceKeys = new Set(Object.keys(presenceState));

        // 1. Set status disconnected / online untuk player yang terdaftar
        Object.keys(newPlayersState).forEach((key) => {
          const isOnline = activePresenceKeys.has(key);
          const currentStatus = newPlayersState[key].status;
          if (currentStatus === 'left') return;

          const targetStatus = isOnline ? 'online' : 'disconnected';
          if (currentStatus !== targetStatus) {
            newPlayersState[key] = {
              ...newPlayersState[key],
              status: targetStatus,
            };
            hasChanges = true;
          }
        });

        // 2. Periksa presence untuk pendaftaran player baru / update username
        Object.entries(presenceState).forEach(([id, presences]) => {
          const latestPresence = (presences as Array<{ username?: string; status?: string }>)?.[0];
          if (!latestPresence) return;

          const existingPlayer = newPlayersState[id];
          if (!existingPlayer) {
            newPlayersState[id] = {
              id,
              username: latestPresence.username || 'Player',
              color: PLAYER_COLORS[Object.keys(newPlayersState).length % PLAYER_COLORS.length],
              isHost: id === currentRoom.hostId,
              score: 0,
              hints: 3,
              status: 'online',
            };
            hasChanges = true;
          } else {
            const desiredUsername = latestPresence.username || existingPlayer.username;
            const desiredStatus: 'online' | 'offline' | 'disconnected' | 'left' = existingPlayer.status === 'left' ? 'left' : ((latestPresence.status as Player['status']) || 'online');

            if (existingPlayer.username !== desiredUsername || existingPlayer.status !== desiredStatus) {
              newPlayersState[id] = {
                ...existingPlayer,
                username: desiredUsername,
                status: desiredStatus,
              };
              hasChanges = true;
            }
          }
        });

        // Hanya trigger update Zustand jika data memang berbeda
        if (hasChanges) {
          useGameStore.getState().setRoom({
            ...currentRoom,
            players: newPlayersState,
          });
        }
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        const user = newPresences?.[0] as { username?: string } | undefined;
        const store = useGameStore.getState();

        if (store.room) {
          const existingStatus = store.room.players[key]?.status;
          store.updatePlayer(key, {
            status: existingStatus === 'left' ? 'left' : 'online',
            username: user?.username || store.room.players[key]?.username || 'Player',
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
            payload: {
              room: store.room,
              grid: store.grid,
              solutionToken: store.solutionToken,
              snakesState: store.snakesState,
              messages: store.messages,
              senderId: currentUserId,
            },
          });
        }
      })
      .on('broadcast', { event: 'sync_state' }, ({ payload }) => {
        addLog(`[Sync State] Berhasil menerima data board & room dari Host (${payload?.senderId})!`);
        if (offlineTimeoutRef.current) clearTimeout(offlineTimeoutRef.current);
        setIsTrulyOffline(false);
        setConnectionError(null);

        const store = useGameStore.getState();
        if (payload.room) store.setRoom(payload.room);
        if (payload.grid && payload.solutionToken) {
          store.setGameData(payload.grid, payload.solutionToken);
        }
        if (payload.snakesState) {
          store.updateSnakesState(payload.snakesState);
        }
        if (payload.messages && Array.isArray(payload.messages)) {
          payload.messages.forEach((msg: ChatMessage) => store.addMessage(msg));
        }
      })
      .on('broadcast', { event: 'cell_move' }, ({ payload }) => {
        const store = useGameStore.getState();
        if (store.room?.mode === 'competition') return;

        store.updateCellWithValidation(
          payload.row,
          payload.col,
          payload.value,
          payload.userId,
          payload.isCorrect
        );

        if (store.room?.mode === 'collaborative' || store.room?.mode === 'classic') {
          const senderName = store.room.players[payload.userId]?.username || 'Player';
          triggerAnswerToast(senderName, payload.isCorrect);
        }
      })
      .on('broadcast', { event: 'cell_note' }, ({ payload }) => {
        const store = useGameStore.getState();
        if (store.room?.mode === 'competition') return;
        store.toggleNote(payload.row, payload.col, payload.note);
      })
      .on('broadcast', { event: 'cursor_move' }, ({ payload }) => {
        useGameStore.getState().updatePlayer(payload.userId, {
          cursor: { row: payload.row, col: payload.col },
        });
      })
      .on('broadcast', { event: 'cell_lock' }, ({ payload }) => {
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
        if (payload.room) store.setRoom(payload.room);

        if (payload.room?.mode === 'snakes_and_ladders' && payload.snakesState) {
          store.updateSnakesState(payload.snakesState);
        } else if (payload.room?.mode === 'competition') {
          // Kosongkan grid lama agar memicu pengambilan puzzle baru
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          store.setGameData(null as any, null as any);
        } else if (payload.initialGrid && payload.solutionToken) {
          store.startNextGame(payload.initialGrid, payload.solutionToken);
        }
      })
      .on('broadcast', { event: 'snakes_dice_roll' }, ({ payload }) => {
        useGameStore.getState().updateSnakesState({
          diceValue: payload.diceValue,
          playerPositions: {
            ...(useGameStore.getState().snakesState?.playerPositions || {}),
            [payload.userId]: payload.newPosition,
          },
          currentTurnUserId: payload.nextTurnUserId,
          winnerId: payload.hasWon ? payload.userId : null,
        });
      })
      .on('broadcast', { event: 'snakes_state_update' }, ({ payload }) => {
        if (payload.snakesState) {
          useGameStore.getState().updateSnakesState(payload.snakesState);
        }
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
              : Boolean(store.grid);

          const isHost = Boolean(store.room && store.room.hostId === currentUserId);

          if (isHost && hasBoard) {
            addLog('[Host Sync] Channel SUBSCRIBED. Mengirim state awal ke semua guest.');

            channel.send({
              type: 'broadcast',
              event: 'sync_state',
              payload: {
                room: store.room,
                grid: store.grid,
                solutionToken: store.solutionToken,
                snakesState: store.snakesState,
                messages: store.messages,
                senderId: currentUserId,
              },
            }).catch((err) => {
              addLog(`[Host Sync] Gagal mengirim sync_state: ${String(err)}`);
            });
          }

          if (!hasBoard) {
            requestState();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setIsTrulyOffline(true);
            setConnectionError('Gagal terhubung ke realtime server.');
          }
        }
      });
  }, [roomId, addLog, requestState, setRealtimeStatus, triggerAnswerToast]);

  // SMART AUTO RECONNECT (Network Online / Tab Focus / Visibility Change)
  useEffect(() => {
    isMountedRef.current = true;
    connectChannel();

    const handleSmartReconnect = () => {
      if (document.visibilityState === 'visible' || navigator.onLine) {
        connectChannel();
      }
    };

    window.addEventListener('online', handleSmartReconnect);
    window.addEventListener('focus', handleSmartReconnect);
    document.addEventListener('visibilitychange', handleSmartReconnect);

    // Polling sync jika board masih kosong
    syncPollIntervalRef.current = setInterval(() => {
      const store = useGameStore.getState();

      const hasBoard =
        store.room?.mode === 'snakes_and_ladders'
          ? Boolean(store.snakesState)
          : Boolean(store.grid);

      if (!hasBoard && statusRef.current === 'SUBSCRIBED') {
        requestState();
      }
    }, 2500);

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
      const currentUname = usernameRef.current || 'Player';
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

      try {
        const token = store.solutionToken;
        if (!token) return;

        const res = await fetch('/api/game/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ row, col, value, solutionToken: token }),
        });
        const data = await res.json();
        const isCorrect = Boolean(data.isCorrect);

        store.updateCellWithValidation(row, col, value, currentUid, isCorrect);

        if (store.room?.mode === 'collaborative' || store.room?.mode === 'classic') {
          triggerAnswerToast(currentUname, isCorrect);
        }

        channelRef.current?.send({
          type: 'broadcast',
          event: 'cell_move',
          payload: { row, col, value, userId: currentUid, isCorrect },
        });
      } catch (err) {
        console.error('Failed to verify move:', err);
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
    const currentName = usernameRef.current || 'Player';
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
      snakesState?: SnakesState | null
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
          },
        });
      }
    },
    []
  );

  const broadcastLeaveRoom = useCallback(async () => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    useGameStore.getState().updatePlayer(currentUid, { status: 'left' });
    await channelRef.current?.send({
      type: 'broadcast',
      event: 'player_leave_room',
      payload: { userId: currentUid },
    });
    if (channelRef.current) {
      await channelRef.current.untrack();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
  }, []);

  const broadcastSnakesDiceRoll = useCallback((diceValue: number, newPosition: number, nextTurnUserId: string, hasWon: boolean) => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    channelRef.current?.send({
      type: 'broadcast',
      event: 'snakes_dice_roll',
      payload: { diceValue, newPosition, nextTurnUserId, hasWon, userId: currentUid },
    });
  }, []);

  const broadcastSnakesState = useCallback((newState: SnakesState) => {
    useGameStore.getState().updateSnakesState(newState);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'snakes_state_update',
      payload: { snakesState: newState },
    });
  }, []);

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
    requestState,
    realtimeStatus,
    isTrulyOffline,
    connectionError,
    debugLogs,
    reconnect: connectChannel,
  };
}
