import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useGameStore } from '../store/gameStore';
import { RealtimeChannel } from '@supabase/supabase-js';
import { ChatMessage } from '../types/game';

export function useRealtime(roomId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userId = useGameStore((state) => state.userId);
  const username = useGameStore((state) => state.username);

  // Expose an active locks state
  const [locks, setLocks] = useState<Record<string, { userId: string, expiresAt: number }>>({});
  const [messages, setMessages] = useState<ChatMessage[]>([]);


  // Status koneksi WebSocket
  const [realtimeStatus, setRealtimeStatus] = useState<'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'>('CONNECTING');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {

    if (!roomId || !userId || !username) return;

    const channel = supabase.channel(`room:${roomId}`, {
      config: {
        presence: {
          key: userId,
        },
      },
    });

    channelRef.current = channel;

    const syncHostState = () => {
      const store = useGameStore.getState();
      if (store.room && store.grid && store.solution) {
        channel.send({
          type: 'broadcast',
          event: 'sync_state',
          payload: { room: store.room, grid: store.grid, solution: store.solution }
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

          newPresences.forEach((p) => {
            const pid = p.user_id;
            if (!newPlayers[pid]) {
              newPlayers[pid] = {
                id: pid,
                username: p.username || 'Player',
                color: PLAYER_COLORS[Object.keys(newPlayers).length % PLAYER_COLORS.length],
                isHost: false,
                score: 0,
                hints: 3,
                status: 'online'
              };
              changed = true;
            } else if (newPlayers[pid].status !== 'online') {
              newPlayers[pid].status = 'online';
              changed = true;
            }
          });

          if (changed) {
            const updatedRoom = { ...store.room, players: newPlayers };
            store.setRoom(updatedRoom);
            channel.send({
              type: 'broadcast',
              event: 'sync_state',
              payload: { room: updatedRoom, grid: store.grid, solution: store.solution }
            });
          }
        }
      })
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const store = useGameStore.getState();
        if (store.room && store.room.hostId === userId) {
          const newPlayers = { ...store.room.players };
          let changed = false;
          leftPresences.forEach((p) => {
            if (newPlayers[p.user_id]) {
              newPlayers[p.user_id].status = 'offline';
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
      .on('broadcast', { event: 'request_state' }, () => {
        const store = useGameStore.getState();
        if (store.room && store.room.hostId === userId) {
          channel.send({
            type: 'broadcast',
            event: 'sync_state',
            payload: { room: store.room, grid: store.grid, solution: store.solution }
          });
        }
      })
      .on('broadcast', { event: 'sync_state' }, ({ payload }) => {
        const store = useGameStore.getState();
        if (payload.room) {
          store.setRoom(payload.room);
        }
        if (payload.grid && payload.solution) {
          store.setGameData(payload.grid, payload.solution);
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
      .on('broadcast', { event: 'move' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;
        useGameStore.getState().updateCell(payload.row, payload.col, payload.value, payload.userId);
      })
      .on('broadcast', { event: 'chat' }, ({ payload }) => {
        setMessages(prev => [...prev, payload]);
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

          channel.send({
            type: 'broadcast',
            event: 'request_state',
            payload: { userId }
          });
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
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [roomId, userId, username]);


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

    // Don't broadcast if already locked by someone else
    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
      return false; // Could not lock
    }

    channelRef.current.send({
      type: 'broadcast',
      event: 'cell_lock',
      payload: { userId, row, col },
    });

    // Optimistic lock
    setLocks(prev => ({
      ...prev,
      [key]: { userId, expiresAt: Date.now() + 5000 }
    }));
    return true; // Locked successfully
  };

  const broadcastMove = (row: number, col: number, value: number | null) => {
    if (!channelRef.current || !userId) return;
    channelRef.current.send({
      type: 'broadcast',
      event: 'move',
      payload: { userId, row, col, value },
    });
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
    channelRef.current.send({
      type: 'broadcast',
      event: 'chat',
      payload: msg,
    });
    setMessages(prev => [...prev, msg]);
  };

return { broadcastCursor, broadcastMove, lockCell, locks, messages, broadcastChat, realtimeStatus, connectionError };
}
