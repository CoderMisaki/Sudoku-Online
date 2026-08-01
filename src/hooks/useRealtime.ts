import { useEffect, useRef, useState } from 'react';
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
  const grid = useGameStore((state) => state.grid);
  const prevGridRef = useRef(grid);

  // Expose an active locks state
  const [locks, setLocks] = useState<Record<string, { userId: string, expiresAt: number }>>({});


  // Status koneksi WebSocket
  const [realtimeStatus, setRealtimeStatus] = useState<'CONNECTING' | 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'>('CONNECTING');
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    // Jika grid baru saja terisi (berubah dari null ke terisi) dan kita adalah host,
    // langsung broadcast sync_state seketika ke semua player yang mungkin sedang menunggu
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


    // Smart Presence Handler: mengecek presenceState secara instan di semua client
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

      // User saat ini di browser dipastikan online
      if (userId) {
        onlineUserIds.add(userId);
      }

      const currentPlayers = store.room.players;
      const newPlayers = { ...currentPlayers };
      let changed = false;

      const PLAYER_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6'];

      // 1. Update status online/offline secara presisi berdasarkan WebSocket Presence
      Object.keys(newPlayers).forEach((pId) => {
        const isOnline = onlineUserIds.has(pId);
        const targetStatus = isOnline ? 'online' : 'offline';
        if (newPlayers[pId].status !== targetStatus) {
          newPlayers[pId] = {
            ...newPlayers[pId],
            status: targetStatus,
          };
          changed = true;
        }
      });

      // 2. Tambahkan pemain baru jika belum ada di list
      Object.keys(presenceState).forEach((pId) => {
        const presences = presenceState[pId] as Array<{ username?: string; user_id?: string }>;
        const presObj = presences?.[0];
        const actualId = presObj?.user_id || pId;
        const uname = presObj?.username || 'Player';

        if (!newPlayers[actualId]) {
          newPlayers[actualId] = {
            id: actualId,
            username: uname,
            color: PLAYER_COLORS[Object.keys(newPlayers).length % PLAYER_COLORS.length],
            isHost: false,
            score: 0,
            hints: 3,
            status: 'online',
          };
          changed = true;
        }
      });

      // 3. Evaluasi Host Migration jika Host saat ini offline
      let currentHostId = store.room.hostId;
      const hostPlayer = newPlayers[currentHostId];
      const isHostOnline = hostPlayer && hostPlayer.status === 'online';

      if (!isHostOnline) {
        const onlinePlayers = Object.values(newPlayers).filter((p) => p.status === 'online');
        if (onlinePlayers.length > 0) {
          currentHostId = onlinePlayers[0].id;
          changed = true;
        }
      }

      Object.keys(newPlayers).forEach((pId) => {
        const shouldBeHost = pId === currentHostId;
        if (newPlayers[pId].isHost !== shouldBeHost) {
          newPlayers[pId] = {
            ...newPlayers[pId],
            isHost: shouldBeHost,
          };
          changed = true;
        }
      });

      if (changed) {
        const updatedRoom = {
          ...store.room,
          players: newPlayers,
          hostId: currentHostId,
        };
        store.setRoom(updatedRoom);

        if (currentHostId === userId) {
          syncHostState();
        }
      }
    };

    channel
      .on('presence', { event: 'sync' }, handlePresenceChange)
      .on('presence', { event: 'join' }, handlePresenceChange)
      .on('presence', { event: 'leave' }, handlePresenceChange)
      .on('broadcast', { event: 'request_state' }, ({ payload }) => {
        const store = useGameStore.getState();
        if (store.room && store.room.hostId === userId) {
          let updatedRoom = store.room;

          // Memastikan pemain yang meminta state langsung diset 'online' oleh Host
          if (payload?.userId && store.room.players[payload.userId]) {
            if (store.room.players[payload.userId].status !== 'online') {
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

        if (!payload?.room || payload.senderId !== payload.room.hostId) {
          return;
        }

        if (payload.room) {
          let incomingRoom = payload.room;

          // Pemain lokal tidak akan pernah menganggap dirinya sendiri 'offline' saat menerima sync_state
          if (userId && incomingRoom.players && incomingRoom.players[userId]) {
            if (incomingRoom.players[userId].status !== 'online') {
              incomingRoom = {
                ...incomingRoom,
                players: {
                  ...incomingRoom.players,
                  [userId]: {
                    ...incomingRoom.players[userId],
                    status: 'online',
                  },
                },
              };
            }
          }
          store.setRoom(incomingRoom);
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
        useGameStore.getState().toggleNote(payload.row, payload.col, payload.note);
      })
      // Handler Isian Optimistik Instan (~10-25ms)
      .on('broadcast', { event: 'move_optimistic' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;
        useGameStore.getState().setOptimisticMove(payload.row, payload.col, payload.value);
      })
      // Handler Isian Terverifikasi Final
      .on('broadcast', { event: 'move_verified' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;

        const store = useGameStore.getState();
        const isCorrect = Boolean(payload.isCorrect);

        store.updateCellWithValidation(payload.row, payload.col, payload.value, payload.userId, isCorrect);

        if (payload.value !== null && store.room && payload.userId !== userId) {
          const player = store.room.players[payload.userId];
          const playerName = player?.username || 'Pemain';

          if (isCorrect) {
            toast.success(`${playerName}: Jawaban benar ✅`, { id: `move-${payload.row}-${payload.col}-${payload.userId}`, duration: 1500 });
          } else {
            toast.error(`${playerName}: Jawaban salah ❌`, { id: `move-${payload.row}-${payload.col}-${payload.userId}`, duration: 1500 });
          }
        }
      })
      .on('broadcast', { event: 'move' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number") return;

        const store = useGameStore.getState();
        const isCorrect = Boolean(payload.isCorrect);

        store.updateCellWithValidation(payload.row, payload.col, payload.value, payload.userId, isCorrect);

        if (payload.value !== null && store.room && payload.userId !== userId) {
          const player = store.room.players[payload.userId];
          const playerName = player?.username || 'Pemain';

          if (isCorrect) {
            toast.success(`${playerName}: Jawaban benar ✅`, { id: `move-${payload.row}-${payload.col}-${payload.userId}`, duration: 1500 });
          } else {
            toast.error(`${playerName}: Jawaban salah ❌`, { id: `move-${payload.row}-${payload.col}-${payload.userId}`, duration: 1500 });
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

          // Jalankan perbaikan status secepatnya saat terhubung
          handlePresenceChange();

          // Jalankan perbaikan status secepatnya saat terhubung
          handlePresenceChange();

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

            // Tingkatkan batas waktu tunggu (25 detik) dengan jeda per-detik
            if (currentGrid || attempts >= 25) {
              if (retryRef.current) {
                clearInterval(retryRef.current);
                retryRef.current = null;
              }
              return;
            }

            sendRequest();
          }, 1000);
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
      if (retryRef.current) {
        clearInterval(retryRef.current);
        retryRef.current = null;
      }
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

    if (!moveRateLimiter.checkAllowed()) return;

    const store = useGameStore.getState();

    // Hapus Nilai (Eraser / Backspace) -> Instan
    if (value === null) {
      store.updateCellWithValidation(row, col, null, userId, false);
      channelRef.current.send({
        type: 'broadcast',
        event: 'move_verified',
        payload: { userId, row, col, value: null, isCorrect: false },
      });
      return;
    }

    // 1. Update UI Lokal secara Instan
    store.setOptimisticMove(row, col, value);

    // 2. Kirim Broadcast Instan ke Player Lain via WebSocket (Tanpa Menunggu Server API)
    channelRef.current.send({
      type: 'broadcast',
      event: 'move_optimistic',
      payload: { userId, row, col, value },
    });

    // 3. Verifikasi Jawaban ke Server secara Asinkron (Non-blocking)
    if (store.solutionToken) {
      fetch('/api/game/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          row,
          col,
          value,
          solutionToken: store.solutionToken
        })
      })
      .then(res => res.json())
      .then(data => {
        const isCorrect = Boolean(data.isCorrect);

        // Update State Lokal Final & Skor
        store.updateCellWithValidation(row, col, value, userId, isCorrect);

        if (isCorrect) {
          toast.success('Jawaban benar ✅', { id: `move-${row}-${col}`, duration: 1500 });
        } else {
          toast.error('Jawaban salah ❌', { id: `move-${row}-${col}`, duration: 1500 });
        }

        // Siarkan Hasil Verifikasi & Skor ke Seluruh Player
        channelRef.current?.send({
          type: 'broadcast',
          event: 'move_verified',
          payload: { userId, row, col, value, isCorrect },
        });
      })
      .catch(e => {
        console.error('Gagal verifikasi jawaban ke server', e);
      });
    }
  };

  const broadcastNote = (row: number, col: number, note: number) => {
    if (!channelRef.current || !userId) return;

    useGameStore.getState().toggleNote(row, col, note);

    channelRef.current.send({
      type: 'broadcast',
      event: 'note',
      payload: { userId, row, col, note },
    });
  };

  const broadcastNextGame = (newGrid: Grid, newSolutionToken: string) => {
    if (!channelRef.current || !userId) return;

    useGameStore.getState().startNextGame(newGrid, newSolutionToken);

    channelRef.current.send({
      type: 'broadcast',
      event: 'next_game',
      payload: { grid: newGrid, solutionToken: newSolutionToken },
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

    // Update lokal instan + broadcast serentak
    useGameStore.getState().addMessage(msg);
    channelRef.current.send({
      type: 'broadcast',
      event: 'chat',
      payload: msg,
    });
  };

  return { broadcastCursor, broadcastMove, broadcastNote, lockCell, locks, broadcastChat, broadcastNextGame, realtimeStatus, connectionError };
}
