import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useGameStore } from '../store/gameStore';
import { Grid } from "../types/game";
import { RealtimeChannel } from '@supabase/supabase-js';
import { ChatMessage } from '../types/game';
import { moveRateLimiter } from '../utils/rateLimiter';
import toast from 'react-hot-toast';

export function useRealtime(roomId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const retryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const userId = useGameStore((state) => state.userId);
  const username = useGameStore((state) => state.username);

  // Expose an active locks state and ref for stable access
  const [locks, setLocks] = useState<Record<string, { userId: string, expiresAt: number }>>({});
  const locksRef = useRef<Record<string, { userId: string, expiresAt: number }>>({});

  useEffect(() => {
    locksRef.current = locks;
  }, [locks]);

  // Status koneksi WebSocket
  const [realtimeStatus, setRealtimeStatus] = useState<'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'>('CONNECTING');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!roomId || !userId || !username) return;

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: {
          key: userId,
        },
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

    channel
      .on('presence', { event: 'join' }, ({ newPresences }) => {
        const store = useGameStore.getState();
        const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

        if (store.room && store.room.hostId === userId) {
          const newPlayers = { ...store.room.players };
          let changed = false;

          (newPresences as Array<{ user_id?: string; username?: string }>).forEach((p) => {
            const pid = p.user_id;
            if (!pid) return;
            if (!newPlayers[pid]) {
              newPlayers[pid] = {
                id: pid,
                username: p.username || 'Player',
                color: PLAYER_COLORS[Object.keys(newPlayers).length % PLAYER_COLORS.length],
                isHost: pid === store.room?.hostId,
                score: 0,
                hints: 3,
                status: 'online'
              };
              changed = true;
            } else if (newPlayers[pid].status !== 'online') {
              newPlayers[pid] = {
                ...newPlayers[pid],
                status: 'online'
              };
              changed = true;
            }
          });

          if (changed) {
            const updatedRoom = { ...store.room, players: newPlayers };
            store.setRoom(updatedRoom);
            syncHostState();
          }
        }
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const store = useGameStore.getState();
        if (store.room) {
          const newPlayers = { ...store.room.players };
          let changed = false;
          let hostLeft = false;

          (leftPresences as Array<{ user_id?: string }>).forEach((p) => {
            const pid = p.user_id;
            if (pid && newPlayers[pid]) {
              newPlayers[pid] = {
                ...newPlayers[pid],
                status: 'offline'
              };
              changed = true;
              if (store.room && store.room.hostId === pid) {
                hostLeft = true;
              }
            }
          });

          if (changed) {
            let newHostId = store.room.hostId;
            if (hostLeft) {
              const onlinePlayers = Object.values(newPlayers).filter(p => p.status === 'online');
              if (onlinePlayers.length > 0) {
                newHostId = onlinePlayers[0].id;
                Object.keys(newPlayers).forEach(pid => {
                  newPlayers[pid] = {
                    ...newPlayers[pid],
                    isHost: pid === newHostId
                  };
                });
              }
            }

            const updatedRoom = { ...store.room, players: newPlayers, hostId: newHostId };
            store.setRoom(updatedRoom);
            if (newHostId === userId) {
              syncHostState();
            }
          }
        }
      })
      .on('broadcast', { event: 'request_state' }, () => {
        const store = useGameStore.getState();
        // HANYA Host yang boleh menyiarkan sync_state
        if (store.room && store.room.hostId === userId) {
          channel.send({
            type: 'broadcast',
            event: 'sync_state',
            payload: { room: store.room, grid: store.grid, solutionToken: store.solutionToken, messages: store.messages, senderId: userId }
          });
        }
      })
      .on('broadcast', { event: 'sync_state' }, ({ payload }) => {
        const store = useGameStore.getState();

        // Anti Event-Spoofing: Abaikan sync_state jika room ID tidak cocok atau bukan disiarkan oleh Host
        if (!payload?.room || payload.room.id !== roomId || payload.senderId !== payload.room.hostId) {
          return;
        }

        if (payload.room) {
          store.setRoom(payload.room);
        }

        if (payload.grid && payload.solutionToken) {
          store.setGameData(payload.grid, payload.solutionToken);
        }

        if (Array.isArray(payload.messages)) {
          store.setMessages(payload.messages);
        }
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number" || payload.row < 0 || payload.row > 8 || payload.col < 0 || payload.col > 8) return;
        useGameStore.getState().updatePlayer(payload.userId, {
          cursor: { row: payload.row, col: payload.col }
        });
      })
      .on('broadcast', { event: 'cell_lock' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number" || payload.row < 0 || payload.row > 8 || payload.col < 0 || payload.col > 8) return;
        const key = `${payload.row}-${payload.col}`;
        setLocks(prev => ({
          ...prev,
          [key]: { userId: payload.userId, expiresAt: Date.now() + 5000 }
        }));
      })
      .on('broadcast', { event: 'note' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number" || typeof payload.note !== "number") return;
        if (payload.row < 0 || payload.row > 8 || payload.col < 0 || payload.col > 8) return;
        if (!Number.isInteger(payload.note) || payload.note < 1 || payload.note > 9) return;
        useGameStore.getState().toggleNote(payload.row, payload.col, payload.note);
      })
      .on('broadcast', { event: 'move' }, async ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;
        if (payload.row < 0 || payload.row > 8 || payload.col < 0 || payload.col > 8) return;

        const store = useGameStore.getState();
        // Independently verify the move if it's from another user and not null
        let isCorrect = payload.isCorrect;
        if (payload.userId !== userId && payload.value !== null && store.solutionToken) {
          try {
            const res = await fetch('/api/game/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                row: payload.row,
                col: payload.col,
                value: payload.value,
                solutionToken: store.solutionToken
              })
            });
            const data = await res.json();
            isCorrect = Boolean(data.isCorrect);
          } catch (e) {
            console.error('Failed to verify move independently', e);
          }
        }

        // Terapkan hasil terverifikasi
        store.updateCellWithValidation(payload.row, payload.col, payload.value, payload.userId, isCorrect);

        // Toast notifikasi global
        if (payload.value !== null && store.room) {
          const player = store.room.players[payload.userId];
          const playerName = player?.username || 'Pemain';

          if (isCorrect) {
            toast.success(`${playerName}: Jawaban benar ✅`, { duration: 1500 });
          } else {
            toast.error(`${playerName}: Jawaban salah ❌`, { duration: 1500 });
          }
        }
      })
      .on('broadcast', { event: 'next_game' }, ({ payload }) => {
        useGameStore.getState().startNextGame(payload.grid, payload.solutionToken);
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        useGameStore.getState().addMessage(payload);
      })
      .subscribe(async (status, err) => {
        setRealtimeStatus(status as 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED');
        if (err) {
          setConnectionError(err.message || 'Gagal terhubung ke WebSocket channel.');
        }

        if (status === 'SUBSCRIBED') {
          setConnectionError(null);

          await channel.track({
            user_id: userId,
            username: username,
            online_at: new Date().toISOString(),
          });

          const sendRequest = () => {
            channel.send({
              type: 'broadcast',
              event: 'request_state',
              payload: { userId },
            });
          };

          sendRequest();

          if (retryRef.current) {
            clearInterval(retryRef.current);
          }

          let attempts = 0;

          retryRef.current = setInterval(() => {
            const currentGrid = useGameStore.getState().grid;

            attempts += 1;

            if (currentGrid || attempts >= 12) {
              if (retryRef.current) {
                clearInterval(retryRef.current);
                retryRef.current = null;
              }
              return;
            }

            sendRequest();
          }, 800);
        } else if (status === 'CHANNEL_ERROR') {
          setConnectionError('CHANNEL_ERROR: Koneksi WebSocket ditolak atau channel error.');
        } else if (status === 'TIMED_OUT') {
          setConnectionError('TIMED_OUT: Server Supabase tidak merespons (Timeout).');
        }
      });

    // Cleanup expired locks every second
    const interval = setInterval(() => {
      setLocks(prev => {
        const now = Date.now();
        let changed = false;
        const next: Record<string, { userId: string, expiresAt: number }> = {};
        for (const [key, lock] of Object.entries(prev)) {
          if (lock.expiresAt >= now) {
            next[key] = lock;
          } else {
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);

    return () => {
      if (retryRef.current) {
        clearInterval(retryRef.current);
        retryRef.current = null;
      }
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, username]);

  const broadcastCursor = useCallback((row: number, col: number) => {
    const currentUserId = useGameStore.getState().userId;
    if (!channelRef.current || !currentUserId) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'cursor',
      payload: { userId: currentUserId, row, col },
    });
  }, []);

  const lockCell = useCallback((row: number, col: number) => {
    const currentUserId = useGameStore.getState().userId;
    if (!channelRef.current || !currentUserId) return false;
    const key = `${row}-${col}`;
    const currentLock = locksRef.current[key];

    // Don't broadcast if already locked by someone else
    if (currentLock && currentLock.userId !== currentUserId && currentLock.expiresAt > Date.now()) {
      return false; // Could not lock
    }

    channelRef.current.send({
      type: 'broadcast',
      event: 'cell_lock',
      payload: { userId: currentUserId, row, col },
    });

    // Optimistic lock
    setLocks(prev => ({
      ...prev,
      [key]: { userId: currentUserId, expiresAt: Date.now() + 5000 }
    }));
    return true; // Locked successfully
  }, []);

  const broadcastMove = useCallback(async (row: number, col: number, value: number | null, options?: { silent?: boolean }) => {
    const currentUserId = useGameStore.getState().userId;
    if (!channelRef.current || !currentUserId) return;

    // 1. Proteksi Anti-Bot (Rate Limiting)
    if (!moveRateLimiter.checkAllowed()) return;

    const store = useGameStore.getState();
    let isCorrect = false;

    // 2. Verifikasi jawaban ke Server API Route secara aman
    if (value !== null && store.solutionToken) {
      try {
        const res = await fetch('/api/game/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            row,
            col,
            value,
            solutionToken: store.solutionToken
          })
        });
        const data = await res.json();
        isCorrect = Boolean(data.isCorrect);
      } catch (e) {
        console.error('Gagal verifikasi jawaban ke server', e);
      }
    }

    // 3. Update State Lokal & Disiarkan Hasil Resmi ke Seluruh Pemain
    store.updateCellWithValidation(row, col, value, currentUserId, isCorrect);

    if (value !== null && !options?.silent) {
      if (isCorrect) {
        toast.success('Jawaban benar ✅', { duration: 1500 });
      } else {
        toast.error('Jawaban salah ❌', { duration: 1500 });
      }
    }

    channelRef.current.send({
      type: 'broadcast',
      event: 'move',
      payload: { userId: currentUserId, row, col, value, isCorrect },
    });
  }, []);

  const broadcastNote = useCallback((row: number, col: number, note: number) => {
    const currentUserId = useGameStore.getState().userId;
    if (!channelRef.current || !currentUserId) return;

    useGameStore.getState().toggleNote(row, col, note);

    channelRef.current.send({
      type: 'broadcast',
      event: 'note',
      payload: { userId: currentUserId, row, col, note },
    });
  }, []);

  const broadcastNextGame = useCallback((newGrid: Grid, newSolutionToken: string) => {
    const currentUserId = useGameStore.getState().userId;
    if (!channelRef.current || !currentUserId) return;

    useGameStore.getState().startNextGame(newGrid, newSolutionToken);

    channelRef.current.send({
      type: 'broadcast',
      event: 'next_game',
      payload: { grid: newGrid, solutionToken: newSolutionToken },
    });
  }, []);

  const broadcastChat = useCallback((text: string) => {
    const currentState = useGameStore.getState();
    const currentUserId = currentState.userId;
    const currentUsername = currentState.username;
    if (!channelRef.current || !currentUserId || !currentUsername) return;
    const msg: ChatMessage = {
      id: Math.random().toString(36).substring(2, 9),
      userId: currentUserId,
      username: currentUsername,
      text,
      timestamp: Date.now()
    };

    // Update lokal instan + broadcast serentak
    currentState.addMessage(msg);
    channelRef.current.send({
      type: 'broadcast',
      event: 'chat',
      payload: msg,
    });
  }, []);

  return { broadcastCursor, broadcastMove, broadcastNote, lockCell, locks, broadcastChat, broadcastNextGame, realtimeStatus, connectionError };
}
