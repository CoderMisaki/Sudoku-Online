import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useGameStore } from '../store/gameStore';
import { Grid, RoomState, ChatMessage } from '../types/game';
import { RealtimeChannel } from '@supabase/supabase-js';
import { getOrCreateUserId } from '../utils/uuid';

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const OFFLINE_TIMEOUT_MS = 6000; // 6 detik tanpa respon = Room Offline

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

  const addLog = useCallback((message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`[Realtime Logs] ${logEntry}`);
    setDebugLogs((prev) => [logEntry, ...prev.slice(0, 49)]);
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

  // Host memancarkan state ke guest ketika data sudah tersedia
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

    setRealtimeStatus('CONNECTING');
    setIsTrulyOffline(false);
    setConnectionError(null);
    addLog(`[Connect] Menghubungkan ke Realtime channel room:${roomId}...`);

    // Set timeout deteksi room offline jika tidak ada respons
    if (offlineTimeoutRef.current) clearTimeout(offlineTimeoutRef.current);
    offlineTimeoutRef.current = setTimeout(() => {
      const currentState = useGameStore.getState();
      const hasBoard = currentState.room?.mode === 'snakes_and_ladders' ? Boolean(currentState.snakesState) : Boolean(currentState.grid);
      if (!hasBoard) {
        setIsTrulyOffline(true);
        setConnectionError('Room offline atau Host tidak aktif/tidak merespons.');
        addLog(`[Timeout] Tidak ada respons dari Host setelah ${OFFLINE_TIMEOUT_MS / 1000}s. Room dinyatakan OFFLINE.`);
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
        const state = channel.presenceState();
        const userCount = Object.keys(state).length;
        addLog(`[Presence SYNC] Total pemain aktif di presence: ${userCount}`);

        const store = useGameStore.getState();
        if (store.room) {
          const updatedPlayers = { ...store.room.players };
          Object.keys(state).forEach((key) => {
            const pres = (state[key] as Array<{ username?: string }>)?.[0];
            if (pres && !updatedPlayers[key]) {
              updatedPlayers[key] = {
                id: key,
                username: pres.username || 'Player',
                color: PLAYER_COLORS[Object.keys(updatedPlayers).length % PLAYER_COLORS.length],
                isHost: key === store.room?.hostId,
                score: 0,
                hints: 3,
                status: 'online',
              };
            }
          });
          store.setRoom({ ...store.room, players: updatedPlayers });
        }
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        const user = newPresences?.[0] as { username?: string } | undefined;
        addLog(`[Presence JOIN] Player masuk: ${user?.username || key}`);

        let store = useGameStore.getState();

        // Tambahkan player baru ke room jika belum ada
        if (store.room && !store.room.players[key]) {
          const updatedPlayers = {
            ...store.room.players,
            [key]: {
              id: key,
              username: user?.username || 'Player',
              color: PLAYER_COLORS[Object.keys(store.room.players).length % PLAYER_COLORS.length],
              isHost: key === store.room.hostId,
              score: 0,
              hints: 3,
              status: 'online' as const,
            },
          };

          store.setRoom({
            ...store.room,
            players: updatedPlayers,
          });

          store = useGameStore.getState();
        }

        // Jika mode snakes, tambahkan player baru ke snakesState
        if (
          store.room?.mode === 'snakes_and_ladders' &&
          store.snakesState &&
          !store.snakesState.playerPositions[key]
        ) {
          store.updateSnakesState({
            turnOrder: [...store.snakesState.turnOrder, key],
            playerPositions: {
              ...store.snakesState.playerPositions,
              [key]: 1,
            },
          });

          store = useGameStore.getState();
        }

        const hasBoard =
          store.room?.mode === 'snakes_and_ladders'
            ? Boolean(store.snakesState)
            : Boolean(store.grid);

        // Jika kita host dan board sudah siap, langsung kirim state ke player baru
        if (store.room && store.room.hostId === currentUserId && hasBoard) {
          addLog(`[Host Auto-Sync] Mengirim state ke player baru (${key}).`);

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
            addLog(`[Host Auto-Sync] Gagal mengirim sync_state: ${String(err)}`);
          });
        } else if (store.room && store.room.hostId === currentUserId) {
          addLog(`[Host Auto-Sync] Player baru masuk, tetapi board belum siap.`);
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        addLog(`[Presence LEAVE] Player keluar: ${key}`);
        useGameStore.getState().updatePlayer(key, { status: 'offline' });
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
        store.updateCellWithValidation(payload.row, payload.col, payload.value, payload.userId, true);
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
      .on('broadcast', { event: 'next_game' }, ({ payload }) => {
        addLog(`[Next Game] Game baru dimulai oleh host.`);
        const store = useGameStore.getState();
        if (payload.room) store.setRoom(payload.room);
        if (payload.initialGrid && payload.solutionToken) {
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
      .subscribe(async (status) => {
        if (!isMountedRef.current) return;

        addLog(`[Channel Status Change] -> ${status}`);
        setRealtimeStatus(status as RealtimeStatus);

        if (status === 'SUBSCRIBED') {
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

          // Jika host sudah punya board, langsung kirim state awal
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

          // Jika kita guest dan belum ada board, minta sync ke host
          if (!hasBoard) {
            requestState();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setIsTrulyOffline(true);
          setConnectionError(`Koneksi realtime ${status.toLowerCase()}.`);
        }
      });
  }, [roomId, addLog, requestState, setRealtimeStatus]);

  useEffect(() => {
    isMountedRef.current = true;
    connectChannel();

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
  const broadcastMove = useCallback((row: number, col: number, value: number | null) => {
    const currentUid = userIdRef.current || getOrCreateUserId();
    if (value === null) {
      useGameStore.getState().updateCellWithValidation(row, col, null, currentUid, false);
    } else {
      useGameStore.getState().setOptimisticMove(row, col, value);
    }
    channelRef.current?.send({
      type: 'broadcast',
      event: 'cell_move',
      payload: { row, col, value, userId: currentUid },
    });
  }, []);

  const broadcastNote = useCallback((row: number, col: number, note: number) => {
    useGameStore.getState().toggleNote(row, col, note);
    channelRef.current?.send({
      type: 'broadcast',
      event: 'cell_note',
      payload: { row, col, note },
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

  const broadcastNextGame = useCallback((initialGrid: Grid | null, solutionToken: string | null, roomData: RoomState) => {
    channelRef.current?.send({
      type: 'broadcast',
      event: 'next_game',
      payload: { initialGrid, solutionToken, room: roomData },
    });
  }, []);

  const broadcastLeaveRoom = useCallback(async () => {
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
    requestState,
    realtimeStatus,
    isTrulyOffline,
    connectionError,
    debugLogs,
    reconnect: connectChannel,
  };
}
