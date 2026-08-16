import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useGameStore } from '../store/gameStore';
import { Grid, RoomState, ChatMessage } from '../types/game';
import { RealtimeChannel } from '@supabase/supabase-js';
import { moveRateLimiter } from '../utils/rateLimiter';
import { getOrCreateUserId } from '../utils/uuid';
import toast from 'react-hot-toast';

const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];
const MAX_SILENT_RETRIES = 5;
const OFFLINE_GRACE_PERIOD_MS = 6000; // 6 detik grace period sebelum menampilkan UI offline

export function useRealtime(roomId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offlineGraceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // State stabil untuk UI (Hanya bernilai true jika benar-benar offline setelah seluruh retry gagal)
  const [isTrulyOffline, setIsTrulyOffline] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const intentionalLeaveRef = useRef(false);
  const disconnectedIdsRef = useRef<Set<string>>(new Set());
  const leftUntilRef = useRef<Map<string, number>>(new Map());

  const markLeft = useCallback((playerId: string) => {
    leftUntilRef.current.set(playerId, Date.now() + 60000);
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

  // Sync state dari Host ketika grid & solutionToken sudah siap
  useEffect(() => {
    if (grid && !prevGridRef.current && channelRef.current) {
      const store = useGameStore.getState();
      const currentUid = userIdRef.current || store.userId;
      if (store.room && store.room.hostId === currentUid && store.solutionToken) {
        channelRef.current.send({
          type: 'broadcast',
          event: 'sync_state',
          payload: {
            room: store.room,
            grid: store.grid,
            solutionToken: store.solutionToken,
            messages: store.messages,
            senderId: currentUid
          }
        });
      }
    }
    prevGridRef.current = grid;
  }, [grid]);

  const connectChannel = useCallback((immediate: boolean = false) => {
    const currentUserId = userIdRef.current || (typeof window !== 'undefined' ? getOrCreateUserId() : '');
    const currentUsername = usernameRef.current || (typeof window !== 'undefined' ? localStorage.getItem('sudoku_username') || 'Player' : 'Player');

    if (!roomId || !currentUserId || !isMountedRef.current || intentionalLeaveRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (channelRef.current) {
      const oldChannel = channelRef.current;
      channelRef.current = null;
      try {
        supabase.removeChannel(oldChannel);
      } catch { /* ignore */ }
    }

    setRealtimeStatus('CONNECTING');
    if (immediate) {
      if (offlineGraceTimerRef.current) {
        clearTimeout(offlineGraceTimerRef.current);
        offlineGraceTimerRef.current = null;
      }
      setIsTrulyOffline(false);
      setConnectionError(null);
    }

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false, ack: true },
        presence: { key: currentUserId },
      },
    });

    channelRef.current = channel;

    const handlePresenceChange = (departedIds: Set<string> = new Set()) => {
      const store = useGameStore.getState();
      if (!store.room) return;

      const presenceState = channel.presenceState();
      const onlineUserIds = new Set<string>();
      const leftUserIds = new Set<string>();
      const disconnectedUserIds = new Set<string>();

      Object.keys(presenceState).forEach((key) => {
        if (departedIds.has(key)) return;

        const presences = presenceState[key] as Array<{
          user_id?: string;
          username?: string;
          status?: string;
        }>;

        presences?.forEach((p) => {
          const pid = p.user_id || key;
          if (departedIds.has(pid)) return;

          if (p.status === 'left') {
            leftUserIds.add(pid);
          } else if (p.status === 'disconnected' || p.status === 'offline') {
            disconnectedUserIds.add(pid);
          } else {
            onlineUserIds.add(pid);
          }
        });
      });

      onlineUserIds.forEach((pid) => {
        disconnectedUserIds.delete(pid);
        disconnectedIdsRef.current.delete(pid);
        clearLeftMark(pid);
      });

      const isCurrentTabHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

      if (currentUserId && !intentionalLeaveRef.current && !departedIds.has(currentUserId)) {
        if (isCurrentTabHidden) {
          disconnectedUserIds.add(currentUserId);
          onlineUserIds.delete(currentUserId);
        } else {
          onlineUserIds.add(currentUserId);
          disconnectedUserIds.delete(currentUserId);
          disconnectedIdsRef.current.delete(currentUserId);
          clearLeftMark(currentUserId);
        }
      }

      const currentPlayers = store.room.players;
      const newPlayers = { ...currentPlayers };
      let changed = false;

      Object.keys(newPlayers).forEach((pId) => {
        const currentStatus = newPlayers[pId].status;

        if (onlineUserIds.has(pId)) {
          clearLeftMark(pId);
          disconnectedIdsRef.current.delete(pId);
          if (currentStatus !== 'online') {
            newPlayers[pId] = { ...newPlayers[pId], status: 'online' };
            changed = true;
          }
          return;
        }

        if (currentStatus === 'left' || leftUserIds.has(pId) || hasLeftMark(pId)) {
          if (currentStatus !== 'left') {
            newPlayers[pId] = { ...newPlayers[pId], status: 'left' };
            changed = true;
          }
          return;
        }

        if (disconnectedUserIds.has(pId) || disconnectedIdsRef.current.has(pId) || !onlineUserIds.has(pId)) {
          if (currentStatus !== 'disconnected') {
            newPlayers[pId] = { ...newPlayers[pId], status: 'disconnected' };
            changed = true;
          }
          return;
        }
      });

      const maxPlayers = store.room.maxPlayers || 4;

      Object.keys(presenceState).forEach((pId) => {
        if (departedIds.has(pId)) return;

        const presences = presenceState[pId] as Array<{
          username?: string;
          user_id?: string;
          status?: string;
        }>;

        const presObj = presences?.[0];
        const actualId = presObj?.user_id || pId;
        const uname = presObj?.username || 'Player';
        const rawStatus = presObj?.status;

        if (departedIds.has(actualId) || rawStatus === 'left' || hasLeftMark(actualId)) return;

        const initialStatus = (rawStatus === 'disconnected' || rawStatus === 'offline' || disconnectedIdsRef.current.has(actualId))
          ? 'disconnected'
          : 'online';

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
            status: initialStatus,
            isSpectator,
          };
          changed = true;
        } else if (newPlayers[actualId].username !== uname && uname !== 'Player') {
          newPlayers[actualId] = { ...newPlayers[actualId], username: uname };
          changed = true;
        }
      });

      if (changed) {
        store.setRoom({ ...store.room, players: newPlayers });
      }
    };

    channel
      .on('presence', { event: 'sync' }, () => handlePresenceChange())
      .on('presence', { event: 'join' }, (payload: { newPresences?: Array<{ user_id?: string; username?: string; status?: string }> }) => {
        const presences = payload.newPresences || [];
        presences.forEach((p) => {
          const pId = p.user_id;
          if (pId) {
            if (p.status !== 'disconnected' && p.status !== 'offline' && p.status !== 'left') {
              disconnectedIdsRef.current.delete(pId);
              clearLeftMark(pId);
              useGameStore.getState().updatePlayer(pId, {
                status: 'online',
                ...(p.username ? { username: p.username } : {})
              });
            } else if (p.status === 'left') {
              markLeft(pId);
              useGameStore.getState().updatePlayer(pId, {
                status: 'left',
                ...(p.username ? { username: p.username } : {})
              });
            } else {
              disconnectedIdsRef.current.add(pId);
              useGameStore.getState().updatePlayer(pId, {
                status: 'disconnected',
                ...(p.username ? { username: p.username } : {})
              });
            }
          }
        });
        handlePresenceChange();
      })
      .on('presence', { event: 'leave' }, (payload: { leftPresences?: Array<{ user_id?: string; username?: string; status?: string }> }) => {
        const store = useGameStore.getState();
        const departedIds = new Set<string>();

        for (const presence of payload?.leftPresences ?? []) {
          const playerId = presence?.user_id;
          if (!playerId || playerId === currentUserId) continue;

          departedIds.add(playerId);

          if (presence.status === 'left') {
            markLeft(playerId);
            store.updatePlayer(playerId, { status: 'left' });
            continue;
          }

          disconnectedIdsRef.current.add(playerId);
            store.updatePlayer(playerId, { status: 'disconnected' });
        }

        handlePresenceChange(departedIds);
      })
      .on('broadcast', { event: 'player_disconnected' }, ({ payload }) => {
        if (!payload?.userId || hasLeftMark(payload.userId)) return;
        const pId = payload.userId;
        disconnectedIdsRef.current.add(pId);

        const store = useGameStore.getState();
        if (store.room?.players[pId] && store.room.players[pId].status !== 'left') {
          store.updatePlayer(pId, { status: 'disconnected' });
        }

        const latest = useGameStore.getState();
        if (latest.room?.hostId === currentUserId && latest.room.players[pId]) {
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
      .on('broadcast', { event: 'player_connected' }, ({ payload }) => {
        if (!payload?.userId) return;
        const pId = payload.userId;
        disconnectedIdsRef.current.delete(pId);
        clearLeftMark(pId);

        const store = useGameStore.getState();
        if (store.room?.players[pId] && store.room.players[pId].status !== 'left') {
          store.updatePlayer(pId, { status: 'online' });
        }
      })
      .on('broadcast', { event: 'leave_room' }, ({ payload }) => {
        if (!payload?.userId) return;
        const pId = payload.userId;
        markLeft(pId);
        disconnectedIdsRef.current.delete(pId);

        const store = useGameStore.getState();
        if (store.room?.players[pId]) {
          store.updatePlayer(pId, { status: 'left' });
        }

        const latest = useGameStore.getState();
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

          if (payload?.userId) {
            clearLeftMark(payload.userId);
            disconnectedIdsRef.current.delete(payload.userId);
            const pName = payload.username || store.room.players[payload.userId]?.username || 'Player';
            const existingPlayer = store.room.players[payload.userId];
            const activeCount = Object.values(store.room.players).filter(p => !p.isSpectator && p.id !== payload.userId).length;
            const isSpectator = activeCount >= (store.room.maxPlayers || 4) && payload.userId !== store.room.hostId;

            const newPlayers = {
              ...store.room.players,
              [payload.userId]: {
                ...existingPlayer,
                id: payload.userId,
                color: existingPlayer?.color || PLAYER_COLORS[Object.keys(store.room.players).length % PLAYER_COLORS.length],
                isHost: payload.userId === store.room.hostId,
                score: existingPlayer?.score || 0,
                hints: existingPlayer?.hints ?? 3,
                isSpectator: existingPlayer?.isSpectator ?? isSpectator,
                username: pName,
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
          const presenceState = channel.presenceState();

          Object.keys(mergedPlayers).forEach((pId) => {
            const currentStatus = store.room?.players?.[pId]?.status;
            const incomingStatus = mergedPlayers[pId]?.status;

            const isConfirmedOnline = incomingStatus === 'online' || pId === payload.senderId || Boolean(presenceState[pId]);

            if (isConfirmedOnline && !hasLeftMark(pId)) {
              disconnectedIdsRef.current.delete(pId);
              clearLeftMark(pId);
              mergedPlayers[pId] = { ...mergedPlayers[pId], status: 'online' };
              return;
            }

            if (disconnectedIdsRef.current.has(pId)) {
              mergedPlayers[pId] = { ...mergedPlayers[pId], status: 'disconnected' };
              return;
            }

            if (incomingStatus === 'left' || currentStatus === 'left' || hasLeftMark(pId)) {
              markLeft(pId);
              mergedPlayers[pId] = { ...mergedPlayers[pId], status: 'left' };
            }
          });

          if (currentUserId && !mergedPlayers[currentUserId] && !intentionalLeaveRef.current) {
            const activeCount = Object.values(mergedPlayers).filter((p) => !(p as { isSpectator?: boolean }).isSpectator).length;
            const isSpectator = activeCount >= (incomingRoom.maxPlayers || 4) && currentUserId !== incomingRoom.hostId;
            mergedPlayers[currentUserId] = {
              id: currentUserId,
              username: currentUsername,
              color: PLAYER_COLORS[Object.keys(mergedPlayers).length % PLAYER_COLORS.length],
              isHost: currentUserId === incomingRoom.hostId,
              score: 0,
              hints: 3,
              status: 'online',
              isSpectator,
            };
          } else if (currentUserId && mergedPlayers[currentUserId]) {
            mergedPlayers[currentUserId] = {
              ...mergedPlayers[currentUserId],
              username: currentUsername || mergedPlayers[currentUserId].username,
              status: intentionalLeaveRef.current ? 'left' : (document.visibilityState === 'hidden' ? 'disconnected' : 'online'),
            };
          }

          incomingRoom = { ...incomingRoom, players: mergedPlayers };
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
        if (!isMountedRef.current || channelRef.current !== channel) return;

        setRealtimeStatus(status as 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED');

        if (status === 'SUBSCRIBED') {
          // Bersihkan seluruh timer offline & reset error state secara mulus
          if (offlineGraceTimerRef.current) {
            clearTimeout(offlineGraceTimerRef.current);
            offlineGraceTimerRef.current = null;
          }
          setIsTrulyOffline(false);
          setConnectionError(null);
          retryCountRef.current = 0;

          disconnectedIdsRef.current.delete(currentUserId);
          clearLeftMark(currentUserId);
          if (!intentionalLeaveRef.current) {
            useGameStore.getState().updatePlayer(currentUserId, { status: 'online', username: currentUsername });
          }

          const isHidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';
          const userStatus = intentionalLeaveRef.current ? 'left' : (isHidden ? 'disconnected' : 'online');

          await channel.track({
            user_id: currentUserId,
            username: currentUsername,
            status: userStatus,
            online_at: new Date().toISOString(),
          });

          handlePresenceChange();

          if (!intentionalLeaveRef.current && !isHidden) {
            channel.send({
              type: 'broadcast',
              event: 'player_connected',
              payload: { userId: currentUserId, username: currentUsername, at: Date.now() },
            });
          }

          channel.send({
            type: 'broadcast',
            event: 'request_state',
            payload: { userId: currentUserId, username: currentUsername }
          });

          if (retryRef.current) clearInterval(retryRef.current);
          let attempts = 0;

          retryRef.current = setInterval(() => {
            if (channelRef.current !== channel) {
              if (retryRef.current) clearInterval(retryRef.current);
              return;
            }
            const currentGrid = useGameStore.getState().grid;
            const currentToken = useGameStore.getState().solutionToken;
            attempts += 1;
            if ((currentGrid && currentToken) || attempts >= 8) {
              if (retryRef.current) {
                clearInterval(retryRef.current);
                retryRef.current = null;
              }
              return;
            }
            channel.send({
              type: 'broadcast',
              event: 'request_state',
              payload: { userId: currentUserId, username: currentUsername }
            });
          }, 1500);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          const rawError = err?.message || (status === 'TIMED_OUT' ? 'Server Supabase tidak merespons (Timeout).' : 'Koneksi WebSocket terputus.');

          // Mulai Grace Period Timer: Jangan langsung tampilkan error ke UI!
          if (!offlineGraceTimerRef.current && !isTrulyOffline) {
            offlineGraceTimerRef.current = setTimeout(() => {
              offlineGraceTimerRef.current = null;
              if (isMountedRef.current && !intentionalLeaveRef.current) {
                setIsTrulyOffline(true);
                setConnectionError(rawError);
              }
            }, OFFLINE_GRACE_PERIOD_MS);
          }

          // Silent Background Auto-Reconnect dengan Exponential Backoff
          if (!reconnectTimeoutRef.current && isMountedRef.current && !intentionalLeaveRef.current) {
            const delay = Math.min(800 * Math.pow(1.5, retryCountRef.current), 4500);
            retryCountRef.current += 1;

            reconnectTimeoutRef.current = setTimeout(() => {
              reconnectTimeoutRef.current = null;
              if (isMountedRef.current && connectRef.current && retryCountRef.current <= MAX_SILENT_RETRIES) {
                connectRef.current(false);
              } else if (retryCountRef.current > MAX_SILENT_RETRIES) {
                setIsTrulyOffline(true);
                setConnectionError('Gagal menghubungkan otomatis setelah beberapa kali mencoba.');
              }
            }, delay);
          }
        }
      });
  }, [roomId, clearLeftMark, hasLeftMark, markLeft, isTrulyOffline]);

  useEffect(() => {
    connectRef.current = connectChannel;
  }, [connectChannel]);

  useEffect(() => {
    isMountedRef.current = true;
    intentionalLeaveRef.current = false;

    const initialConnectTimeout = setTimeout(() => {
      if (isMountedRef.current && connectRef.current) {
        connectRef.current(true);
      }
    }, 0);

    const handleInstantReconnect = () => {
      const uid = userIdRef.current;
      const uname = usernameRef.current;
      const channel = channelRef.current;

      if (uid) {
        disconnectedIdsRef.current.delete(uid);
        clearLeftMark(uid);
        useGameStore.getState().updatePlayer(uid, { status: 'online' });
      }

      if (channel && uid && uname && !intentionalLeaveRef.current) {
        channel.track({
          user_id: uid,
          username: uname,
          status: 'online',
          online_at: new Date().toISOString(),
        }).catch(() => {});

        channel.send({
          type: 'broadcast',
          event: 'player_connected',
          payload: { userId: uid, at: Date.now() },
        });

        channel.send({
          type: 'broadcast',
          event: 'request_state',
          payload: { userId: uid, username: uname },
        });
      }

      if (realtimeStatusRef.current !== 'SUBSCRIBED' && connectRef.current && !intentionalLeaveRef.current) {
        retryCountRef.current = 0;
        connectRef.current(true);
      }
    };

    const handleVisibilityChange = () => {
      const uid = userIdRef.current;
      const uname = usernameRef.current;
      const channel = channelRef.current;

      if (document.visibilityState === 'visible') {
        handleInstantReconnect();
      } else {
        if (uid) {
          disconnectedIdsRef.current.add(uid);
          useGameStore.getState().updatePlayer(uid, { status: 'disconnected' });
        }

        if (channel && uid && uname && !intentionalLeaveRef.current) {
          channel.track({
            user_id: uid,
            username: uname,
            status: 'disconnected',
            online_at: new Date().toISOString(),
          }).catch(() => {});

          channel.send({
            type: 'broadcast',
            event: 'player_disconnected',
            payload: { userId: uid, at: Date.now() },
          });
        }
      }
    };

    const handleOffline = () => {
      setRealtimeStatus('CHANNEL_ERROR');
      if (!offlineGraceTimerRef.current && !isTrulyOffline) {
        offlineGraceTimerRef.current = setTimeout(() => {
          offlineGraceTimerRef.current = null;
          if (isMountedRef.current && !intentionalLeaveRef.current) {
            setIsTrulyOffline(true);
            setConnectionError('Koneksi internet perangkat terputus.');
          }
        }, 3000);
      }

      const uid = userIdRef.current;
      const uname = usernameRef.current;
      const channel = channelRef.current;

      if (uid) {
        disconnectedIdsRef.current.add(uid);
        useGameStore.getState().updatePlayer(uid, { status: 'disconnected' });
      }

      if (channel && uid && uname && !intentionalLeaveRef.current) {
        channel.send({
          type: 'broadcast',
          event: 'player_disconnected',
          payload: { userId: uid, at: Date.now() },
        });
      }
    };

    const handleBeforeUnload = () => {
      const channel = channelRef.current;
      const uid = userIdRef.current;
      const uname = usernameRef.current;
      if (!channel || !uid) return;

      if (intentionalLeaveRef.current) {
        channel.send({
          type: 'broadcast',
          event: 'leave_room',
          payload: { userId: uid, at: Date.now() },
        });
      } else {
        channel.send({
          type: 'broadcast',
          event: 'player_disconnected',
          payload: { userId: uid, at: Date.now() },
        });
        if (uname) {
          channel.track({
            user_id: uid,
            username: uname,
            status: 'disconnected',
            online_at: new Date().toISOString(),
          }).catch(() => {});
        }
      }
    };

    window.addEventListener('online', handleInstantReconnect);
    window.addEventListener('offline', handleOffline);
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

    return () => {
      isMountedRef.current = false;
      clearTimeout(initialConnectTimeout);
      window.removeEventListener('online', handleInstantReconnect);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('focus', handleInstantReconnect);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
      if (offlineGraceTimerRef.current) {
        clearTimeout(offlineGraceTimerRef.current);
        offlineGraceTimerRef.current = null;
      }
      if (retryRef.current) {
        clearInterval(retryRef.current);
        retryRef.current = null;
      }
      clearInterval(interval);
      if (channelRef.current) {
        const chan = channelRef.current;
        channelRef.current = null;
        supabase.removeChannel(chan);
      }
    };
  }, [connectChannel, clearLeftMark, isTrulyOffline]);

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

    if (!store.solutionToken) {
      channelRef.current.send({
        type: 'broadcast',
        event: 'request_state',
        payload: { userId, username }
      });
      toast.error('Menyinkronkan data room... Coba input kembali sebentar lagi.');
      return;
    }

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
    intentionalLeaveRef.current = true;
    const uid = userIdRef.current;
    if (uid) {
      markLeft(uid);
      useGameStore.getState().updatePlayer(uid, { status: 'left' });
    }

    const channel = channelRef.current;
    if (!channel || !uid) return;

    try {
      await channel.send({
        type: 'broadcast',
        event: 'leave_room',
        payload: { userId: uid, at: Date.now() },
      });
      await channel.untrack();
    } catch (err) {
      console.warn('broadcastLeaveRoom non-blocking error:', err);
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
    isTrulyOffline,
    connectionError,
    reconnect: () => connectChannel(true),
  };
}
