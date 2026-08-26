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
}

export interface PendingInvite {
  id: string;
  fromUserId: string;
  fromUsername: string;
  roomCode: string;
  timestamp: number;
}

export function useGlobalPresence() {
  const username = useGameStore((s) => s.username);
  const userIdStore = useGameStore((s) => s.userId);
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const isMountedRef = useRef(true);

  const userIdRef = useRef(userIdStore);
  const usernameRef = useRef(username);

  useEffect(() => {
    userIdRef.current = userIdStore;
    usernameRef.current = username;
  }, [userIdStore, username]);

  const refreshOnlineList = useCallback((channel: RealtimeChannel) => {
    const state = channel.presenceState() as Record<string, Array<{ username?: string; avatar?: string | null }>>;
    const list: OnlineUser[] = [];
    Object.entries(state).forEach(([id, presences]) => {
      if (!presences || presences.length === 0) return;
      const last = presences[presences.length - 1] as { username?: string; avatar?: string | null } | undefined;
      if (!last) return;
      let safeAvatar: string | null = null;
      if (typeof last.avatar === 'string' && last.avatar && isSafeDataUrl(last.avatar)) safeAvatar = last.avatar;
      // No fake name: empty until the player sets one (still listed online)
      const name = typeof last.username === 'string' ? last.username.trim().toUpperCase() : '';
      list.push({ id, username: name, avatar: safeAvatar });
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

  useEffect(() => {
    if (!isSupabaseEnvValid) return;
    if (typeof window === 'undefined') return;
    isMountedRef.current = true;

    const storedName = localStorage.getItem('sudoku_username');
    const currentId = userIdRef.current || getOrCreateUserId();
    // Empty name is valid — never fabricate "Player"
    const currentName = usernameRef.current ?? storedName ?? '';
    const currentAvatar = getStoredAvatar();

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
        toast.success(`Undangan dari ${fromName} — Room ${code}`, {
          duration: 5000,
          icon: '✉️',
        });
        try {
          sessionStorage.setItem('pending_invite_room', code);
        } catch {}
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          try {
            await channel.track({
              user_id: currentId,
              username: currentName.toUpperCase(),
              avatar: currentAvatar,
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

  useEffect(() => {
    if (!channelRef.current || username === null || username === undefined) return;
    const currentId = userIdRef.current || getOrCreateUserId();
    const avatar = getStoredAvatar();
    // Use untrack+track to ensure presence is updated not duplicated
    const ch = channelRef.current;
    ch.untrack().catch(() => {}).finally(() => {
      ch.track({
        user_id: currentId,
        username: (username ?? '').toUpperCase(),
        avatar,
        online_at: new Date().toISOString(),
      }).catch(() => {});
    });
  }, [username]);

  // Listen for avatar changes via localStorage + custom event (from ProfileWidget)
  useEffect(() => {
    const handleAvatarChange = () => {
      if (!channelRef.current) return;
      const currentId = userIdRef.current || getOrCreateUserId();
      const latestName = localStorage.getItem('sudoku_username') ?? usernameRef.current ?? '';
      const latestAvatar = getStoredAvatar();
      const ch = channelRef.current;
      ch.untrack().catch(() => {}).finally(() => {
        ch.track({
          user_id: currentId,
          username: latestName.toUpperCase(),
          avatar: latestAvatar,
          online_at: new Date().toISOString(),
        }).catch(() => {});
      });
      if (ch) refreshOnlineList(ch);
    };
    window.addEventListener('storage', (e) => {
      if (e.key === 'sudoku_avatar' || e.key === 'sudoku_username') handleAvatarChange();
    });
    window.addEventListener('avatarUpdated' as unknown as string, handleAvatarChange);
    return () => {
      window.removeEventListener('storage', handleAvatarChange as unknown as EventListener);
      window.removeEventListener('avatarUpdated' as unknown as string, handleAvatarChange);
    };
  }, [refreshOnlineList]);

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

  return { onlineUsers, sendInvite, pendingInvites, dismissInvite, isSupabaseReady: isSupabaseEnvValid };
}
