"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase, isSupabaseEnvValid } from '@/services/supabase';
import { getOrCreateUserId } from '@/utils/uuid';
import { getStoredAvatar, isSafeDataUrl } from '@/utils/avatar';
import { useGameStore } from '@/store/gameStore';
import type { RealtimeChannel } from '@supabase/supabase-js';
import toast from 'react-hot-toast';

export interface OnlineUser {
  id: string;
  username: string;
  avatar: string | null;
  /** Kode room tempat user berada saat ini (null = di lobby / tidak di room). */
  roomId: string | null;
}

export interface PendingInvite {
  id: string;
  fromUserId: string;
  fromUsername: string;
  roomCode: string;
  timestamp: number;
}

export interface JoinRequest {
  id: string;
  fromUserId: string;
  fromUsername: string;
  timestamp: number;
}

export interface JoinApproval {
  id: string;
  fromUserId: string;
  fromUsername: string;
  roomCode: string;
  timestamp: number;
}

type PresencePayload = {
  username?: string;
  avatar?: string | null;
  roomId?: string | null;
};

/**
 * Global presence (lobby + room):
 * - daftar player online beserta room mereka,
 * - undangan masuk room (player_invite),
 * - permintaan izin masuk room (room_join_request) + jawabannya.
 *
 * @param currentRoomId kode room saat ini (UPPERCASE / '' bila di lobby).
 * Dipakai untuk mengisi presence `roomId` supaya player lain bisa
 * mengirim "Minta Izin Masuk".
 */
export function useGlobalPresence(currentRoomId?: string) {
  const username = useGameStore((s) => s.username);
  const userIdStore = useGameStore((s) => s.userId);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [incomingJoinRequests, setIncomingJoinRequests] = useState<JoinRequest[]>([]);
  const [joinApproval, setJoinApproval] = useState<JoinApproval | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);

  const userIdRef = useRef(userIdStore);
  const usernameRef = useRef(username);
  const roomIdRef = useRef((currentRoomId ?? '').trim().toUpperCase());

  // Mirror state ke ref supaya callback broadcast selalu baca data terbaru.
  const pendingInvitesRef = useRef<PendingInvite[]>([]);
  const joinRequestsRef = useRef<JoinRequest[]>([]);
  useEffect(() => {
    pendingInvitesRef.current = pendingInvites;
  }, [pendingInvites]);
  useEffect(() => {
    joinRequestsRef.current = incomingJoinRequests;
  }, [incomingJoinRequests]);

  useEffect(() => {
    userIdRef.current = userIdStore;
    usernameRef.current = username;
  }, [userIdStore, username]);

  useEffect(() => {
    roomIdRef.current = (currentRoomId ?? '').trim().toUpperCase();
  }, [currentRoomId]);

  const refreshOnlineList = useCallback((channel: RealtimeChannel) => {
    const state = channel.presenceState() as Record<string, Array<PresencePayload>>;
    const list: OnlineUser[] = [];
    Object.entries(state).forEach(([id, presences]) => {
      if (!presences || presences.length === 0) return;
      const last = presences[presences.length - 1] as PresencePayload | undefined;
      if (!last) return;
      let safeAvatar: string | null = null;
      if (typeof last.avatar === 'string' && last.avatar && isSafeDataUrl(last.avatar)) safeAvatar = last.avatar;
      // No fake name: empty until the player sets one (still listed online)
      const name = typeof last.username === 'string' ? last.username.trim().toUpperCase() : '';
      let room: string | null = null;
      if (typeof last.roomId === 'string' && last.roomId.trim()) {
        room = last.roomId.trim().toUpperCase().slice(0, 10);
      }
      list.push({ id, username: name, avatar: safeAvatar, roomId: room });
    });
    const selfId = userIdRef.current || getOrCreateUserId();
    list.sort((a, b) => {
      if (a.id === selfId) return -1;
      if (b.id === selfId) return 1;
      return a.username.localeCompare(b.username);
    });
    setOnlineUsers(list);
  }, []);

  const dismissInvite = useCallback((id: string) => {
    setPendingInvites((prev) => prev.filter((inv) => inv.id !== id));
  }, []);

  const dismissJoinRequest = useCallback((id: string) => {
    setIncomingJoinRequests((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const dismissJoinApproval = useCallback(() => {
    setJoinApproval(null);
  }, []);

  /** Track (ulang) presence dengan identitas + room terbaru. */
  const retrackPresence = useCallback(() => {
    const ch = channelRef.current;
    if (!ch) return;
    const currentId = userIdRef.current || getOrCreateUserId();
    const latestName = (usernameRef.current ?? localStorage.getItem('sudoku_username') ?? '').toUpperCase();
    const latestAvatar = getStoredAvatar();
    const latestRoom = roomIdRef.current || null;
    ch.untrack().catch(() => {}).finally(() => {
      ch.track({
        user_id: currentId,
        username: latestName,
        avatar: latestAvatar,
        roomId: latestRoom,
        online_at: new Date().toISOString(),
      }).catch(() => {});
    });
  }, []);

  useEffect(() => {
    if (!isSupabaseEnvValid) return;
    if (typeof window === 'undefined') return;
    isMountedRef.current = true;

    const storedName = localStorage.getItem('sudoku_username');
    const currentId = userIdRef.current || getOrCreateUserId();
    // Empty name is valid — never fabricate "Player"
    const currentName = usernameRef.current ?? storedName ?? '';
    const currentAvatar = getStoredAvatar();
    const currentRoom = roomIdRef.current || null;

    if (!userIdStore || username === null || username === undefined) {
      try {
        useGameStore.getState().setUserInfo(currentId, currentName);
      } catch {}
    }

    const channel = supabase.channel('global:online', {
      config: {
        presence: { key: currentId },
        broadcast: { self: false, ack: true },
      },
    });
    channelRef.current = channel;

    channel
      .on('presence', { event: 'sync' }, () => {
        if (!isMountedRef.current) return;
        refreshOnlineList(channel);
      })
      .on('presence', { event: 'join' }, () => {
        if (!isMountedRef.current) return;
        refreshOnlineList(channel);
      })
      .on('presence', { event: 'leave' }, () => {
        if (!isMountedRef.current) return;
        refreshOnlineList(channel);
      })
      // ── 1. Undangan masuk room: "<user> ingin mengundang anda ke dalam room" ──
      .on('broadcast', { event: 'player_invite' }, ({ payload }) => {
        const p = payload as { fromUserId?: string; fromUsername?: string; toUserId?: string; roomId?: string; roomCode?: string };
        const myId = userIdRef.current || getOrCreateUserId();
        if (!p || p.toUserId !== myId) return;
        const fromName = (p.fromUsername ?? '').toUpperCase();
        const code = (p.roomCode || p.roomId || '').toUpperCase();
        if (!code) return;
        const invite: PendingInvite = {
          id: `${p.fromUserId}-${code}-${Date.now()}`,
          fromUserId: p.fromUserId || '',
          fromUsername: fromName,
          roomCode: code,
          timestamp: Date.now(),
        };
        setPendingInvites((prev) => {
          // avoid duplicate invite for same room within 30s
          const recent = prev.find((x) => x.roomCode === code && Date.now() - x.timestamp < 30000);
          if (recent) return prev;
          return [invite, ...prev].slice(0, 5);
        });
        // NOTE: tidak pakai toast bawah — notifikasi tampil di tengah layar.
        try {
          sessionStorage.setItem('pending_invite_room', code);
        } catch {}
      })
      // ── Jawaban atas undanganku (untuk pengundang) ──
      .on('broadcast', { event: 'invite_response' }, ({ payload }) => {
        const p = payload as { toUserId?: string; fromUsername?: string; roomCode?: string; accepted?: boolean };
        const myId = userIdRef.current || getOrCreateUserId();
        if (!p || p.toUserId !== myId) return;
        const name = (p.fromUsername ?? '').toUpperCase() || 'Pemain';
        if (p.accepted) {
          toast.success(`${name} menerima undanganmu`, { duration: 3500, icon: '🎉' });
        } else {
          toast(`${name} menolak undanganmu`, { duration: 3500, icon: '👋' });
        }
      })
      // ── 2. Minta izin masuk room: "<user> Ingin Masuk ke dalam room anda" ──
      .on('broadcast', { event: 'room_join_request' }, ({ payload }) => {
        const p = payload as { requestId?: string; fromUserId?: string; fromUsername?: string; toUserId?: string };
        const myId = userIdRef.current || getOrCreateUserId();
        if (!p || p.toUserId !== myId) return;
        if (!p.fromUserId || p.fromUserId === myId) return;
        const req: JoinRequest = {
          id: p.requestId || `${p.fromUserId}-${Date.now()}`,
          fromUserId: p.fromUserId,
          fromUsername: (p.fromUsername ?? '').toUpperCase(),
          timestamp: Date.now(),
        };
        setIncomingJoinRequests((prev) => {
          // cegah spam: request dari user yang sama dalam 60 detik diabaikan
          const recent = prev.find((x) => x.fromUserId === req.fromUserId && Date.now() - x.timestamp < 60000);
          if (recent) return prev;
          return [req, ...prev].slice(0, 5);
        });
        // NOTE: tidak pakai toast bawah — notifikasi tampil di tengah layar.
      })
      // ── Jawaban atas permintaan izinku (untuk peminta) ──
      .on('broadcast', { event: 'room_join_response' }, ({ payload }) => {
        const p = payload as {
          requestId?: string;
          toUserId?: string;
          fromUserId?: string;
          fromUsername?: string;
          roomCode?: string;
          accepted?: boolean;
        };
        const myId = userIdRef.current || getOrCreateUserId();
        if (!p || p.toUserId !== myId) return;
        const name = (p.fromUsername ?? '').toUpperCase() || 'Pemain';
        const code = (p.roomCode ?? '').toUpperCase();
        if (p.accepted && code) {
          setJoinApproval({
            id: p.requestId || `${p.fromUserId}-${code}-${Date.now()}`,
            fromUserId: p.fromUserId || '',
            fromUsername: name,
            roomCode: code,
            timestamp: Date.now(),
          });
        } else {
          toast(`${name} menolak permintaan masukmu`, { duration: 3500, icon: '👋' });
        }
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              user_id: currentId,
              username: currentName.toUpperCase(),
              avatar: currentAvatar,
              roomId: currentRoom,
              online_at: new Date().toISOString(),
            });
          } catch {}
          refreshOnlineList(channel);
        }
      });

    const handleBeforeUnload = () => {
      try { channel.untrack(); } catch {}
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handleBeforeUnload);

    const interval = setInterval(() => {
      // Periodic refresh only — no re-track to avoid duplicate presence_refs
      refreshOnlineList(channel);
    }, 5000);

    return () => {
      isMountedRef.current = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handleBeforeUnload);
      clearInterval(interval);
      if (channelRef.current) {
        try { supabase.removeChannel(channelRef.current); } catch {}
        channelRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshOnlineList]);

  // Room berpindah (lobby <-> room): update presence supaya status roomId akurat.
  useEffect(() => {
    if (!channelRef.current) return;
    retrackPresence();
  }, [currentRoomId, retrackPresence]);

  useEffect(() => {
    if (!channelRef.current || username === null || username === undefined) return;
    retrackPresence();
  }, [username, retrackPresence]);

  // Listen for avatar changes via localStorage + custom event (from ProfileWidget)
  useEffect(() => {
    const handleAvatarChange = () => {
      if (!channelRef.current) return;
      retrackPresence();
      if (channelRef.current) refreshOnlineList(channelRef.current);
    };
    window.addEventListener('storage', (e) => {
      if (e.key === 'sudoku_avatar' || e.key === 'sudoku_username') handleAvatarChange();
    });
    window.addEventListener('avatarUpdated' as unknown as string, handleAvatarChange);
    return () => {
      window.removeEventListener('storage', handleAvatarChange as unknown as EventListener);
      window.removeEventListener('avatarUpdated' as unknown as string, handleAvatarChange);
    };
  }, [refreshOnlineList, retrackPresence]);

  const sendInvite = useCallback(async (toUserId: string, roomId: string) => {
    const fromId = userIdRef.current || getOrCreateUserId();
    const fromName = usernameRef.current ?? localStorage.getItem('sudoku_username') ?? '';
    const channel = channelRef.current;
    if (!channel) {
      toast.error('Koneksi realtime belum siap');
      return false;
    }
    try {
      await channel.send({
        type: 'broadcast',
        event: 'player_invite',
        payload: {
          fromUserId: fromId,
          fromUsername: fromName.toUpperCase(),
          toUserId,
          roomId,
          roomCode: roomId,
        },
      });
      toast.success('Undangan terkirim');
      return true;
    } catch {
      toast.error('Gagal mengirim undangan');
      return false;
    }
  }, []);

  /** Jawab undangan room (Yes = terima, No = tolak) + beri tahu pengundang. */
  const respondInvite = useCallback(async (inviteId: string, accepted: boolean) => {
    const invite = pendingInvitesRef.current.find((inv) => inv.id === inviteId);
    setPendingInvites((prev) => prev.filter((inv) => inv.id !== inviteId));
    if (inviteId && !invite) return;
    try {
      sessionStorage.removeItem('pending_invite_room');
    } catch {}
    const channel = channelRef.current;
    if (!channel || !invite || !invite.fromUserId) return;
    try {
      const myId = userIdRef.current || getOrCreateUserId();
      const myName = usernameRef.current ?? localStorage.getItem('sudoku_username') ?? '';
      await channel.send({
        type: 'broadcast',
        event: 'invite_response',
        payload: {
          toUserId: invite.fromUserId,
          fromUserId: myId,
          fromUsername: myName.toUpperCase(),
          roomCode: invite.roomCode,
          accepted,
        },
      });
    } catch {}
  }, []);

  /** Minta izin masuk room ke player lain (dari luar / lobby). */
  const sendJoinRequest = useCallback(async (toUserId: string) => {
    const fromId = userIdRef.current || getOrCreateUserId();
    const fromName = usernameRef.current ?? localStorage.getItem('sudoku_username') ?? '';
    if (!fromName.trim()) {
      toast.error('Isi nama kamu dulu sebelum meminta izin');
      return false;
    }
    const channel = channelRef.current;
    if (!channel) {
      toast.error('Koneksi realtime belum siap');
      return false;
    }
    try {
      await channel.send({
        type: 'broadcast',
        event: 'room_join_request',
        payload: {
          requestId: `${fromId}-${Date.now()}`,
          fromUserId: fromId,
          fromUsername: fromName.toUpperCase(),
          toUserId,
        },
      });
      toast.success('Permintaan izin terkirim, tunggu jawaban');
      return true;
    } catch {
      toast.error('Gagal mengirim permintaan');
      return false;
    }
  }, []);

  /**
   * Jawab permintaan izin masuk (Yes = izinkan, No = tolak).
   * Mengembalikan roomCode bila diizinkan, null bila ditolak / gagal.
   */
  const respondJoinRequest = useCallback(async (requestId: string, accepted: boolean): Promise<string | null> => {
    const req = joinRequestsRef.current.find((r) => r.id === requestId);
    setIncomingJoinRequests((prev) => prev.filter((r) => r.id !== requestId));
    const channel = channelRef.current;
    if (!channel || !req) return null;
    const myId = userIdRef.current || getOrCreateUserId();
    const myName = usernameRef.current ?? localStorage.getItem('sudoku_username') ?? '';
    const myRoom =
      roomIdRef.current || useGameStore.getState().room?.id?.toUpperCase() || '';
    if (accepted && !myRoom) {
      toast.error('Kamu tidak sedang di dalam room');
      try {
        await channel.send({
          type: 'broadcast',
          event: 'room_join_response',
          payload: {
            requestId: req.id,
            toUserId: req.fromUserId,
            fromUserId: myId,
            fromUsername: myName.toUpperCase(),
            roomCode: '',
            accepted: false,
          },
        });
      } catch {}
      return null;
    }
    try {
      await channel.send({
        type: 'broadcast',
        event: 'room_join_response',
        payload: {
          requestId: req.id,
          toUserId: req.fromUserId,
          fromUserId: myId,
          fromUsername: myName.toUpperCase(),
          roomCode: accepted ? myRoom : '',
          accepted,
        },
      });
    } catch {}
    return accepted ? myRoom : null;
  }, []);

  return {
    onlineUsers,
    sendInvite,
    pendingInvites,
    dismissInvite,
    respondInvite,
    incomingJoinRequests,
    dismissJoinRequest,
    sendJoinRequest,
    respondJoinRequest,
    joinApproval,
    dismissJoinApproval,
    isSupabaseReady: isSupabaseEnvValid,
  };
}
