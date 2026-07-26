import { useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { useGameStore } from '../store/gameStore';
import { RealtimeChannel } from '@supabase/supabase-js';

export function useRealtime(roomId: string) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const userId = useGameStore((state) => state.userId);
  const username = useGameStore((state) => state.username);

  // Expose an active locks state
  const [locks, setLocks] = useState<Record<string, { userId: string, expiresAt: number }>>({});

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

    channel
      .on('presence', { event: 'sync' }, () => {
        // Here we could update players in room state based on presence
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        console.log('join', key, newPresences);
      })
      .on('presence', { event: 'leave' }, ({ key, leftPresences }) => {
        console.log('leave', key, leftPresences);
      })
      .on('broadcast', { event: 'cursor' }, ({ payload }) => {
        // payload: { userId, row, col }
        if (typeof payload.row !== "number" || typeof payload.col !== "number" || payload.row < 0 || payload.row > 8 || payload.col < 0 || payload.col > 8) return;
        useGameStore.getState().updatePlayer(payload.userId, {
          cursor: { row: payload.row, col: payload.col }
        });
      })
      .on('broadcast', { event: 'cell_lock' }, ({ payload }) => {
        // payload: { row, col, userId }
        if (typeof payload.row !== "number" || typeof payload.col !== "number" || payload.row < 0 || payload.row > 8 || payload.col < 0 || payload.col > 8) return;
        const key = `${payload.row}-${payload.col}`;
        setLocks(prev => ({
          ...prev,
          [key]: { userId: payload.userId, expiresAt: Date.now() + 5000 }
        }));
      })
      .on('broadcast', { event: 'move' }, ({ payload }) => {
        // payload: { row, col, value, userId }
        if (typeof payload.row !== "number" || typeof payload.col !== "number" || payload.row < 0 || payload.row > 8 || payload.col < 0 || payload.col > 8) return;
        if (payload.value !== null && (typeof payload.value !== "number" || payload.value < 1 || payload.value > 9)) return;
        useGameStore.getState().updateCell(payload.row, payload.col, payload.value, payload.userId);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: userId,
            username: username,
            online_at: new Date().toISOString(),
          });
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

  return { broadcastCursor, broadcastMove, lockCell, locks };
}
