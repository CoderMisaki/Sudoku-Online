import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useGameStore } from '../store/gameStore';
import { Grid, RoomState } from "../types/game";
import { RealtimeChannel } from '@supabase/supabase-js';
import { ChatMessage } from '../types/game';
import { moveRateLimiter } from '../utils/rateLimiter';
import toast from 'react-hot-toast';

export function useRealtime(roomId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryCountRef = useRef<number>(0);
  const isMountedRef = useRef(true);

  const userId = useGameStore((state) => state.userId);
  const username = useGameStore((state) => state.username);
  const grid = useGameStore((state) => state.grid);
  const prevGridRef = useRef(grid);

  const [locks, setLocks] = useState<Record<string, { userId: string, expiresAt: number }>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'>('CONNECTING');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const connectRef = useRef<((immediate?: boolean) => void) | null>(null);

  useEffect(() => {
    if (grid && !prevGridRef.current && channelRef.current && userId) {
      const store = useGameStore.getState();
      if (store.room && store.room.hostId === userId) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'sync_state',
          payload: {
            room: store.room,
            grid: store.grid,
            solutionToken: store.solutionToken,
            messages: store.messages,
            senderId: userId
          }
        });
      }
    }
    prevGridRef.current = grid;
  }, [grid, userId]);

  const connectChannel = useCallback((immediate: boolean = false) => {
    if (!roomId || !userId || !username || !isMountedRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    // Bersihkan channel lama jika ada
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    setRealtimeStatus('CONNECTING');
    if (immediate) {
      // Hapus error secara optimis agar notifikasi langsung hilang saat kembali ke web
      setConnectionError(null);
    }

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: userId },
      },
    });

    channelRef.current = channel;

    const syncHostState = () => {
      const store = useGameStore.getState();
      if (store.room && store.grid && store.solutionToken) {
        channel.send({
          type: 'broadcast',
          event: 'sync_state',
          payload: { room: store.room, grid: store.grid, solutionToken: store.solutionToken, messages: store.messages, senderId: userId }
        });
      }
    };

    const handlePresenceChange = () => {
      const store = useGameStore.getState();
      if (!store.room) return;

      const presenceState = channel.presenceState();
      const onlineUserIds = new Set<string>();

      Object.keys(presenceState).forEach((key) => {
        onlineUserIds.add(key);
        const presences = presenceState[key] as Array<{ user_id?: string }>;
        presences?.forEach((p) => {
          if (p.user_id) onlineUserIds.add(p.user_id);
        });
      });

      if (userId) onlineUserIds.add(userId);

      const currentPlayers = store.room.players;
      const newPlayers = { ...currentPlayers };
      let changed = false;

      const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

      Object.keys(newPlayers).forEach((pId) => {
        const isOnline = onlineUserIds.has(pId);
        if (isOnline) {
          if (newPlayers[pId].status !== 'online') {
            newPlayers[pId] = { ...newPlayers[pId], status: 'online' };
            changed = true;
          }
        } else {
          if (newPlayers[pId].status !== 'left' && newPlayers[pId].status !== 'offline') {
            newPlayers[pId] = { ...newPlayers[pId], status: 'offline' };
            changed = true;
          }
        }
      });

      const maxPlayers = store.room.maxPlayers || 4;

      Object.keys(presenceState).forEach((pId) => {
        const presences = presenceState[pId] as Array<{ username?: string; user_id?: string }>;
        const presObj = presences?.[0];
        const actualId = presObj?.user_id || pId;
        const uname = presObj?.username || 'Player';

        if (!newPlayers[actualId]) {
          const activeCount = Object.values(newPlayers).filter((p) => !p.isSpectator).length;
          const isSpectator = activeCount >= maxPlayers && actualId !== store.room?.hostId;

          newPlayers[actualId] = {
            id: actualId,
            username: uname,
            color: PLAYER_COLORS[Object.keys(newPlayers).length % PLAYER_COLORS.length],
            isHost: actualId === store.room?.hostId,
            score: 0,
            hints: 3,
            status: 'online',
            isSpectator,
          };
          changed = true;
        }
      });

      Object.keys(newPlayers).forEach((pId) => {
        const shouldBeHost = pId === store.room?.hostId;
        if (newPlayers[pId].isHost !== shouldBeHost) {
          newPlayers[pId] = { ...newPlayers[pId], isHost: shouldBeHost };
          changed = true;
        }
      });

      if (changed) {
        const updatedRoom = { ...store.room, players: newPlayers };
        store.setRoom(updatedRoom);
        if (store.room.hostId === userId) syncHostState();
      }
    };

    channel
      .on('presence', { event: 'sync' }, handlePresenceChange)
      .on('presence', { event: 'join' }, handlePresenceChange)
      .on('presence', { event: 'leave' }, handlePresenceChange)
      .on('broadcast', { event: 'leave_room' }, ({ payload }) => {
        if (!payload?.userId) return;
        const store = useGameStore.getState();
        if (store.room && store.room.players[payload.userId]) {
          store.updatePlayer(payload.userId, { status: 'left' });
        }
      })
      .on('broadcast', { event: 'request_state' }, ({ payload }) => {
        const store = useGameStore.getState();
        if (store.room && store.room.hostId === userId) {
          let updatedRoom = store.room;

          if (payload?.userId && store.room.players[payload.userId]) {
            if (store.room.players[payload.userId].status !== 'online') {
              const newPlayers = {
                ...store.room.players,
                [payload.userId]: { ...store.room.players[payload.userId], status: 'online' as const },
              };
              updatedRoom = { ...store.room, players: newPlayers };
              store.setRoom(updatedRoom);
            }
          }

          channel.send({
            type: 'broadcast',
            event: 'sync_state',
            payload: {
              room: updatedRoom,
              grid: store.grid,
              solutionToken: store.solutionToken,
              messages: store.messages,
              senderId: userId,
            },
          });
        }
      })
      .on('broadcast', { event: 'sync_state' }, ({ payload }) => {
        const store = useGameStore.getState();
        if (!payload?.room || payload.senderId !== payload.room.hostId) return;

        if (payload.room) {
          let incomingRoom = payload.room;
          if (userId && incomingRoom.players && incomingRoom.players[userId]) {
            if (incomingRoom.players[userId].status !== 'online') {
              incomingRoom = {
                ...incomingRoom,
                players: {
                  ...incomingRoom.players,
                  [userId]: { ...incomingRoom.players[userId], status: 'online' },
                },
              };
            }
          }
          store.setRoom(incomingRoom);
        }

        if (payload.room?.mode !== 'competition' && payload.grid && payload.solutionToken) {
          store.setGameData(payload.grid, payload.solutionToken);
        }

        if (Array.isArray(payload.messages)) {
          store.setMessages(payload.messages);
        }
      })
      .on('broadcast', { event: 'progress_update' }, ({ payload }) => {
        if (!payload?.userId) return;
        useGameStore.getState().updatePlayerProgress(payload.userId, payload.progress, payload.rank);
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;
        useGameStore.getState().updatePlayer(payload.userId, {
          cursor: { row: payload.row, col: payload.col }
        });
      })
      .on('broadcast', { event: 'cell_lock' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;
        const key = `${payload.row}-${payload.col}`;
        setLocks(prev => ({
          ...prev,
          [key]: { userId: payload.userId, expiresAt: Date.now() + 5000 }
        }));
      })
      .on('broadcast', { event: 'note' }, ({ payload }) => {
        if (useGameStore.getState().room?.mode === 'competition') return;
        if (typeof payload.row !== "number" || typeof payload.col !== "number" || typeof payload.note !== "number") return;
        useGameStore.getState().toggleNote(payload.row, payload.col, payload.note);
      })
      .on('broadcast', { event: 'move_optimistic' }, ({ payload }) => {
        if (useGameStore.getState().room?.mode === 'competition') return;
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;
        useGameStore.getState().setOptimisticMove(payload.row, payload.col, payload.value);
      })
      .on('broadcast', { event: 'move_verified' }, ({ payload }) => {
        if (useGameStore.getState().room?.mode === 'competition') return;
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;

        const store = useGameStore.getState();
        const isCorrect = Boolean(payload.isCorrect);
        store.updateCellWithValidation(payload.row, payload.col, payload.value, payload.userId, isCorrect);

        if (payload.value !== null && store.room && payload.userId !== userId) {
          const playerName = store.room.players[payload.userId]?.username || 'Pemain';
          if (isCorrect) {
            toast.success(`${playerName}: Jawaban benar ✅`, { id: `move-${payload.row}-${payload.col}-${payload.userId}`, duration: 1500 });
          } else {
            toast.error(`${playerName}: Jawaban salah ❌`, { id: `move-${payload.row}-${payload.col}-${payload.userId}`, duration: 1500 });
          }
        }
      })
      .on('broadcast', { event: 'next_game' }, async ({ payload }) => {
        const store = useGameStore.getState();
        if (payload?.room) {
          store.setRoom(payload.room);
        }

        const currentRoom = store.room;
        if (currentRoom?.mode === 'competition') {
          try {
            const res = await fetch('/api/game/create-room', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ difficulty: currentRoom.difficulty }),
            });
            const data = await res.json();
            if (data.initialGrid && data.solutionToken) {
              store.startNextGame(data.initialGrid, data.solutionToken);
            }
          } catch (e) {
            console.error('Failed to create new competition puzzle', e);
          }
        } else if (payload?.grid && payload?.solutionToken) {
          store.startNextGame(payload.grid, payload.solutionToken);
        }
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        useGameStore.getState().addMessage(payload);
      })
      .subscribe(async (status, err) => {
        if (!isMountedRef.current) return;
        setRealtimeStatus(status as 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED');

        if (status === 'SUBSCRIBED') {
          // Reset error banner & counter retry
          setConnectionError(null);
          retryCountRef.current = 0;

          await channel.track({
            user_id: userId,
            username: username,
            online_at: new Date().toISOString(),
          });

          handlePresenceChange();

          const sendRequest = () => {
            channel.send({ type: 'broadcast', event: 'request_state', payload: { userId } });
          };

          sendRequest();

          if (retryRef.current) clearInterval(retryRef.current);
          let attempts = 0;

          retryRef.current = setInterval(() => {
            const currentGrid = useGameStore.getState().grid;
            attempts += 1;
            if (currentGrid || attempts >= 25) {
              if (retryRef.current) {
                clearInterval(retryRef.current);
                retryRef.current = null;
              }
              return;
            }
            sendRequest();
          }, 1000);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          const errorMsg = err?.message || (status === 'TIMED_OUT' ? 'Server Supabase tidak merespons (Timeout).' : 'Koneksi WebSocket terputus.');
          setConnectionError(errorMsg);

          // Fast adaptive auto-reconnect (800ms -> 1.5s -> max 4s)
          if (!reconnectTimeoutRef.current && isMountedRef.current) {
            const delay = Math.min(800 * Math.pow(1.5, retryCountRef.current), 4000);
            retryCountRef.current += 1;

            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              if (isMountedRef.current && connectRef.current) {
                connectRef.current(false);
              }
            }, delay);
          }
        }
      });
  }, [roomId, userId, username]);

  useEffect(() => {
    connectRef.current = connectChannel;
  }, [connectChannel]);

  useEffect(() => {
    isMountedRef.current = true;

    // Defer the initial connection to avoid synchronous setState warning
    const initialConnectTimeout = setTimeout(() => {
      if (isMountedRef.current && connectRef.current) {
        connectRef.current(true);
      }
    }, 0);

    // Reconnect super cepat saat tab fokus kembali atau browser online
    const handleInstantReconnect = () => {
      retryCountRef.current = 0;
      if (connectRef.current) {
        connectRef.current(true);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleInstantReconnect();
      }
    };

    window.addEventListener('online', handleInstantReconnect);
    window.addEventListener('focus', handleInstantReconnect);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const interval = setInterval(() => {
      setLocks(prev => {
        const now = Date.now();
        const next = { ...prev };
        let changed = false;
        for (const [key, lock] of Object.entries(next)) {
          if (lock.expiresAt < now) {
            delete next[key];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => {
      isMountedRef.current = false;
      clearTimeout(initialConnectTimeout);
      window.removeEventListener('online', handleInstantReconnect);
      window.removeEventListener('focus', handleInstantReconnect);
      document.removeEventListener('visibilitychange', handleVisibilityChange);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (retryRef.current) {
        clearInterval(retryRef.current);
        retryRef.current = null;
      }
      clearInterval(interval);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [connectChannel]);

  const broadcastCursor = (row: number, col: number) => {
    if (!channelRef.current || !userId) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { userId, row, col },
    });
  };

  const lockCell = (row: number, col: number) => {
    if (!channelRef.current || !userId) return;
    const key = `${row}-${col}`;
    const currentLock = locks[key];

    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
      return false;
    }

    channelRef.current.send({
      type: 'broadcast',
      event: 'cell_lock',
      payload: { userId, row, col },
    });

    setLocks(prev => ({
      ...prev,
      [key]: { userId, expiresAt: Date.now() + 5000 }
    }));
    return true;
  };

  const broadcastMove = (row: number, col: number, value: number | null) => {
    if (!channelRef.current || !userId) return;
    if (!moveRateLimiter.checkAllowed()) return;

    const store = useGameStore.getState();
    const isCompetition = store.room?.mode === 'competition';

    if (value === null) {
      store.updateCellWithValidation(row, col, null, userId, false);

      if (isCompetition) {
        const latestPlayer = useGameStore.getState().room?.players[userId];
        channelRef.current.send({
          type: 'broadcast',
          event: 'progress_update',
          payload: {
            userId,
            progress: latestPlayer?.progress ?? 0,
            rank: latestPlayer?.rank ?? null,
          },
        });
      } else {
        channelRef.current.send({
          type: 'broadcast',
          event: 'move_verified',
          payload: { userId, row, col, value: null, isCorrect: false },
        });
      }
      return;
    }

    store.setOptimisticMove(row, col, value);

    if (!isCompetition) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'move_optimistic',
        payload: { userId, row, col, value },
      });
    }

    if (store.solutionToken) {
      fetch('/api/game/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ row, col, value, solutionToken: store.solutionToken }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Failed to verify move');
          return res.json();
        })
        .then((data) => {
          const isCorrect = Boolean(data.isCorrect);

          store.updateCellWithValidation(row, col, value, userId, isCorrect);

          if (isCorrect) {
            toast.success('Jawaban benar ✅', { id: `move-${row}-${col}`, duration: 1500 });
          } else {
            toast.error('Jawaban salah ❌', { id: `move-${row}-${col}`, duration: 1500 });
          }

          const latestPlayer = useGameStore.getState().room?.players[userId];

          if (isCompetition) {
            channelRef.current?.send({
              type: 'broadcast',
              event: 'progress_update',
              payload: {
                userId,
                progress: latestPlayer?.progress ?? 0,
                rank: latestPlayer?.rank ?? null,
              },
            });
          } else {
            channelRef.current?.send({
              type: 'broadcast',
              event: 'move_verified',
              payload: { userId, row, col, value, isCorrect },
            });
          }
        })
        .catch((e) => {
          console.error('Gagal verifikasi jawaban ke server', e);
          store.updateCellWithValidation(row, col, value, userId, false);
        });
    }
  };

  const broadcastNote = (row: number, col: number, note: number) => {
    if (!channelRef.current || !userId) return;

    useGameStore.getState().toggleNote(row, col, note);

    if (useGameStore.getState().room?.mode === 'competition') return;

    channelRef.current.send({
      type: 'broadcast',
      event: 'note',
      payload: { userId, row, col, note },
    });
  };

  const broadcastNextGame = (newGrid: Grid | null, newSolutionToken: string | null, updatedRoom?: RoomState) => {
    if (!channelRef.current || !userId) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'next_game',
      payload: { grid: newGrid, solutionToken: newSolutionToken, room: updatedRoom },
    });
  };

  const broadcastLeaveRoom = () => {
    if (!channelRef.current || !userId) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'leave_room',
      payload: { userId },
    });
    const store = useGameStore.getState();
    if (store.room && store.room.players[userId]) {
      store.updatePlayer(userId, { status: 'left' });
    }
  };

  const broadcastChat = (text: string) => {
    if (!channelRef.current || !userId || !username) return;
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      userId,
      username,
      text,
      timestamp: Date.now()
    };

    useGameStore.getState().addMessage(msg);
    channelRef.current.send({
      type: 'broadcast',
      event: 'chat',
      payload: msg,
    });
  };

  return {
    broadcastCursor,
    broadcastMove,
    broadcastNote,
    lockCell,
    locks,
    broadcastChat,
    broadcastNextGame,
    broadcastLeaveRoom,
    realtimeStatus,
    connectionError,
    reconnect: () => connectChannel(true),
  };
}
