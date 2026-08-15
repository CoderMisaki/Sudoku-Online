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

  const userIdRef = useRef(userId);
  const usernameRef = useRef(username);
  useEffect(() => {
    userIdRef.current = userId;
    usernameRef.current = username;
  }, [userId, username]);

  const [locks, setLocks] = useState<Record<string, { userId: string; expiresAt: number }>>({});
  const [realtimeStatus, setRealtimeStatus] = useState<'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'>('CONNECTING');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const intentionalLeaveRef = useRef(false);
  const leftUntilRef = useRef<Map<string, number>>(new Map());

  const markLeft = useCallback((playerId: string) => {
    leftUntilRef.current.set(playerId, Date.now() + 20000);
  }, []);

  const hasLeftMark = useCallback((playerId: string) => {
    return (leftUntilRef.current.get(playerId) ?? 0) > Date.now();
  }, []);

  const clearLeftMark = useCallback((playerId: string) => {
    leftUntilRef.current.delete(playerId);
  }, []);

  const realtimeStatusRef = useRef(realtimeStatus);
  useEffect(() => {
    realtimeStatusRef.current = realtimeStatus;
  }, [realtimeStatus]);

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
    const currentUserId = userIdRef.current;
    const currentUsername = usernameRef.current;

    if (!roomId || !currentUserId || !currentUsername || !isMountedRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    setRealtimeStatus('CONNECTING');
    if (immediate) {
      setConnectionError(null);
    }

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false, ack: true },
        presence: { key: currentUserId },
      },
    });

    channelRef.current = channel;

    const syncHostState = () => {
      const store = useGameStore.getState();
      if (store.room && store.grid && store.solutionToken) {
        channel.send({
          type: 'broadcast',
          event: 'sync_state',
          payload: {
            room: store.room,
            grid: store.grid,
            solutionToken: store.solutionToken,
            messages: store.messages,
            senderId: currentUserId
          }
        });
      }
    };

    const handlePresenceChange = () => {
      const store = useGameStore.getState();
      if (!store.room) return;

      const presenceState = channel.presenceState();

      const onlineUserIds = new Set<string>();
      const leftUserIds = new Set<string>();

      Object.keys(presenceState).forEach((key) => {
        const presences = presenceState[key] as Array<{
          user_id?: string;
          status?: string;
        }>;

        presences?.forEach((p) => {
          const pid = p.user_id || key;

          if (p.status === 'left') {
            leftUserIds.add(pid);
          } else {
            onlineUserIds.add(pid);
          }
        });
      });

      // Jangan paksa diri sendiri online kalau memang sedang leave
      if (currentUserId && !intentionalLeaveRef.current) {
        onlineUserIds.add(currentUserId);
      }

      const currentPlayers = store.room.players;
      const newPlayers = { ...currentPlayers };
      let changed = false;

      const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

      Object.keys(newPlayers).forEach((pId) => {
        const currentStatus = newPlayers[pId].status;

        // Kalau presence bilang online, left mark harus dibersihkan
        if (onlineUserIds.has(pId)) {
          clearLeftMark(pId);

          if (currentStatus !== 'online') {
            newPlayers[pId] = { ...newPlayers[pId], status: 'online' };
            changed = true;
          }

          return;
        }

        // Kalau ada tanda left eksplisit, jangan turunkan ke disconnected
        if (
          currentStatus === 'left' ||
          leftUserIds.has(pId) ||
          hasLeftMark(pId)
        ) {
          if (currentStatus !== 'left') {
            newPlayers[pId] = { ...newPlayers[pId], status: 'left' };
            changed = true;
          }

          return;
        }

        // Jika tidak online dan tidak ada tanda left, berarti disconnected
        if (currentStatus !== 'disconnected') {
          newPlayers[pId] = { ...newPlayers[pId], status: 'disconnected' };
          changed = true;
        }
      });

      const maxPlayers = store.room.maxPlayers || 4;

      Object.keys(presenceState).forEach((pId) => {
        const presences = presenceState[pId] as Array<{
          username?: string;
          user_id?: string;
          status?: string;
        }>;

        const presObj = presences?.[0];
        const actualId = presObj?.user_id || pId;
        const uname = presObj?.username || 'Player';

        // Jangan tambah user baru jika presence-nya sudah left
        if (presObj?.status === 'left') return;

        if (!newPlayers[actualId]) {
          const activeCount = Object.values(newPlayers).filter(
            (p) => !p.isSpectator
          ).length;

          const isSpectator =
            activeCount >= maxPlayers && actualId !== store.room?.hostId;

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

        if (store.room.hostId === currentUserId) {
          syncHostState();
        }
      }
    };

    channel
      .on('presence', { event: 'sync' }, handlePresenceChange)
      .on('presence', { event: 'join' }, handlePresenceChange)
      .on('presence', { event: 'leave' }, (payload: {
        leftPresences?: Array<{ user_id?: string; status?: string }>;
      }) => {
        payload?.leftPresences?.forEach((p) => {
          if (p?.user_id && p?.status === 'left') {
            markLeft(p.user_id);
          }
        });

        handlePresenceChange();
      })
      .on('broadcast', { event: 'player_disconnected' }, ({ payload }) => {
        if (!payload?.userId) return;

        // Jika sudah ada tanda left, jangan downgrade ke disconnected
        if (hasLeftMark(payload.userId)) return;

        const store = useGameStore.getState();

        if (store.room?.players[payload.userId]) {
          if (store.room.players[payload.userId].status !== 'left') {
            store.updatePlayer(payload.userId, { status: 'disconnected' });
          }
        }
      })
      .on('broadcast', { event: 'leave_room' }, ({ payload }) => {
        if (!payload?.userId) return;

        markLeft(payload.userId);

        const store = useGameStore.getState();

        if (!store.room?.players[payload.userId]) return;

        // Kunci status sebagai left
        store.updatePlayer(payload.userId, { status: 'left' });

        // Ambil state terbaru setelah update
        const latest = useGameStore.getState();

        // Jika kita host, sebarkan state terbaru supaya semua client sinkron
        if (latest.room?.hostId === currentUserId) {
          channel.send({
            type: 'broadcast',
            event: 'sync_state',
            payload: {
              room: latest.room,
              grid: latest.grid,
              solutionToken: latest.solutionToken,
              messages: latest.messages,
              senderId: currentUserId,
            },
          });
        }
      })
      .on('broadcast', { event: 'request_state' }, ({ payload }) => {
        const store = useGameStore.getState();

        if (store.room && store.room.hostId === currentUserId) {
          let updatedRoom = store.room;

          // Pemain yang meminta state dianggap online kembali
          if (payload?.userId && store.room.players[payload.userId]) {
            clearLeftMark(payload.userId);

            const newPlayers = {
              ...store.room.players,
              [payload.userId]: {
                ...store.room.players[payload.userId],
                status: 'online' as const,
              },
            };

            updatedRoom = { ...store.room, players: newPlayers };
            store.setRoom(updatedRoom);
          }

          channel.send({
            type: 'broadcast',
            event: 'sync_state',
            payload: {
              room: updatedRoom,
              grid: store.grid,
              solutionToken: store.solutionToken,
              messages: store.messages,
              senderId: currentUserId,
            },
          });
        }
      })
      .on('broadcast', { event: 'sync_state' }, ({ payload }) => {
        const store = useGameStore.getState();

        if (!payload?.room || payload.senderId !== payload.room.hostId) return;

        if (payload.room) {
          let incomingRoom = payload.room;
          const mergedPlayers = { ...incomingRoom.players };

          Object.keys(mergedPlayers).forEach((pId) => {
            const currentStatus = store.room?.players?.[pId]?.status;
            const incomingStatus = mergedPlayers[pId]?.status;

            if (incomingStatus === 'online') {
              clearLeftMark(pId);
            }

            if (incomingStatus === 'left') {
              markLeft(pId);
            }

            const mustStayLeft =
              (currentStatus === 'left' && incomingStatus !== 'online') ||
              incomingStatus === 'left' ||
              (hasLeftMark(pId) && incomingStatus !== 'online');

            if (mustStayLeft) {
              mergedPlayers[pId] = {
                ...mergedPlayers[pId],
                status: 'left',
              };
            }
          });

          incomingRoom = { ...incomingRoom, players: mergedPlayers };

          // Jangan paksa diri sendiri online jika memang sedang leave
          if (
            currentUserId &&
            incomingRoom.players[currentUserId] &&
            !intentionalLeaveRef.current
          ) {
            incomingRoom = {
              ...incomingRoom,
              players: {
                ...incomingRoom.players,
                [currentUserId]: {
                  ...incomingRoom.players[currentUserId],
                  status: 'online',
                },
              },
            };
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

        if (payload.value !== null && store.room && payload.userId !== currentUserId) {
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
          setConnectionError(null);
          retryCountRef.current = 0;

          await channel.track({
            user_id: currentUserId,
            username: currentUsername,
            status: intentionalLeaveRef.current ? 'left' : 'online',
            online_at: new Date().toISOString(),
          });

          handlePresenceChange();

          const sendRequest = () => {
            channel.send({ type: 'broadcast', event: 'request_state', payload: { userId: currentUserId } });
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

          if (!reconnectTimeoutRef.current && isMountedRef.current) {
            const delay = Math.min(1500 * Math.pow(1.5, retryCountRef.current), 5000);
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
  }, [roomId, clearLeftMark, hasLeftMark, markLeft]);

  useEffect(() => {
    connectRef.current = connectChannel;
  }, [connectChannel]);

  useEffect(() => {
    isMountedRef.current = true;

    const initialConnectTimeout = setTimeout(() => {
      if (isMountedRef.current && connectRef.current) {
        connectRef.current(true);
      }
    }, 0);

    const handleInstantReconnect = () => {
      if (realtimeStatusRef.current === 'SUBSCRIBED') {
        return;
      }
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

    // Deteksi saat tab/browser ditutup untuk instan Disconnect
    const handleBeforeUnload = () => {
      const channel = channelRef.current;
      const uid = userIdRef.current;

      if (!channel || !uid) return;

      // Jika memang leave room, jangan kirim disconnected
      if (intentionalLeaveRef.current) {
        try {
          channel.send({
            type: 'broadcast',
            event: 'leave_room',
            payload: {
              userId: uid,
              at: Date.now(),
            },
          });
        } catch (e) {
          console.warn('Gagal kirim leave_room saat beforeunload:', e);
        }

        return;
      }

      try {
        channel.send({
          type: 'broadcast',
          event: 'player_disconnected',
          payload: { userId: uid },
        });

        channel.untrack();
      } catch (e) {
        console.warn('Gagal kirim player_disconnected:', e);
      }
    };

    window.addEventListener('online', handleInstantReconnect);
    window.addEventListener('focus', handleInstantReconnect);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

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

    const leftCleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [playerId, expiresAt] of leftUntilRef.current.entries()) {
        if (expiresAt < now) {
          leftUntilRef.current.delete(playerId);
        }
      }
    }, 5000);

    return () => {
      isMountedRef.current = false;
      clearTimeout(initialConnectTimeout);
      window.removeEventListener('online', handleInstantReconnect);
      window.removeEventListener('focus', handleInstantReconnect);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);

      clearInterval(leftCleanupInterval);

      if (intentionalLeaveRef.current && channelRef.current && userIdRef.current) {
        try {
          channelRef.current.send({
            type: 'broadcast',
            event: 'leave_room',
            payload: {
              userId: userIdRef.current,
              at: Date.now(),
            },
          });
        } catch (e) {
          console.warn('Gagal kirim leave_room terakhir saat cleanup:', e);
        }
      }

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

  const broadcastLeaveRoom = async () => {
    const channel = channelRef.current;
    if (!channel || !userId) return;

    intentionalLeaveRef.current = true;
    markLeft(userId);

    const store = useGameStore.getState();

    if (store.room?.players[userId]) {
      store.updatePlayer(userId, { status: 'left' });
    }

    const payload = {
      userId,
      at: Date.now(),
    };

    try {
      // Tandai presence sebagai left juga, supaya presence leave membawa hint left
      try {
        await channel.track({
          user_id: userId,
          username: usernameRef.current,
          status: 'left',
          left_at: new Date().toISOString(),
        });
      } catch (e) {
        console.warn('Gagal track presence left:', e);
      }

      // Kirim berulang untuk mengurangi risiko event hilang / race
      for (let i = 0; i < 3; i++) {
        await channel.send({
          type: 'broadcast',
          event: 'leave_room',
          payload,
        });

        await new Promise((resolve) => setTimeout(resolve, 80));
      }

      await channel.untrack();
      await new Promise((resolve) => setTimeout(resolve, 250));
    } catch (err) {
      console.error('Gagal broadcast leave_room:', err);
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
