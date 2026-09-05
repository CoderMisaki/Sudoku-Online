"use client";

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, Send, LogIn } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useGlobalPresence } from '@/hooks/useGlobalPresence';
import { useGameStore } from '@/store/gameStore';
import { getOrCreateUserId } from '@/utils/uuid';
import { CenterInviteModals } from './CenterInviteModals';
import toast from 'react-hot-toast';

interface OnlinePlayersBoxProps {
  variant?: 'lobby' | 'room';
  roomId?: string;
}

export const OnlinePlayersBox: React.FC<OnlinePlayersBoxProps> = ({ variant = 'lobby', roomId }) => {
  const router = useRouter();
  const currentRoom = useGameStore((s) => s.room);
  const storeUserId = useGameStore((s) => s.userId);
  // Di lobby jangan pernah mengiklankan room lama dari storage — hanya
  // halaman room yang mengiklankan roomId via prop.
  const effectiveRoomId = variant === 'room' ? (roomId || currentRoom?.id || '').toUpperCase() : '';
  const { onlineUsers, sendInvite, pendingInvites, respondInvite, incomingJoinRequests, sendJoinRequest, respondJoinRequest, joinApproval, dismissJoinApproval, isSupabaseReady } =
    useGlobalPresence(effectiveRoomId);

  // Id sendiri untuk badge "Kamu" (fallback ke localStorage bila store belum siap)
  const selfId = useMemo(() => {
    if (storeUserId) return storeUserId;
    try {
      return getOrCreateUserId() || null;
    } catch {
      return null;
    }
  }, [storeUserId]);

  // Id yang sudah dikirimi permintaan izin (cooldown agar tidak spam)
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set());

  const roomPlayerIds = currentRoom ? new Set(Object.keys(currentRoom.players)) : new Set<string>();

  // Modal tengah hanya tampil 1 per 1 (antrian ditandai "+N lainnya")
  const activeInvite = pendingInvites[0] ?? null;
  const activeJoinRequest = incomingJoinRequests[0] ?? null;
  const myRoomCode = effectiveRoomId;

  const handleInvite = async (targetId: string) => {
    if (!effectiveRoomId) {
      return;
    }
    await sendInvite(targetId, effectiveRoomId);
  };

  const handleRequestJoin = async (targetId: string) => {
    const ok = await sendJoinRequest(targetId);
    if (ok) {
      setRequestedIds((prev) => new Set(prev).add(targetId));
      setTimeout(() => {
        setRequestedIds((prev) => {
          const next = new Set(prev);
          next.delete(targetId);
          return next;
        });
      }, 60000);
    }
  };

  const handleAcceptInvite = async () => {
    if (!activeInvite) return;
    const code = activeInvite.roomCode;
    const id = activeInvite.id;
    await respondInvite(id, true);
    router.push(`/room/${code}`);
  };

  const handleDeclineInvite = async () => {
    if (!activeInvite) return;
    await respondInvite(activeInvite.id, false);
  };

  const handleAcceptJoinRequest = async () => {
    if (!activeJoinRequest) return;
    const name = activeJoinRequest.fromUsername;
    const roomCode = await respondJoinRequest(activeJoinRequest.id, true);
    if (roomCode) {
      toast.success(`${name} diizinkan masuk room`);
    }
  };

  const handleDeclineJoinRequest = async () => {
    if (!activeJoinRequest) return;
    await respondJoinRequest(activeJoinRequest.id, false);
  };

  const handleAcceptApproval = () => {
    if (!joinApproval) return;
    const code = joinApproval.roomCode;
    dismissJoinApproval();
    router.push(`/room/${code}`);
  };

  if (!isSupabaseReady) {
    return (
      <Card className="w-full p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Users className="w-4 h-4" /> Player Online
        </div>
        <p className="text-xs text-secondary mt-2">Realtime tidak tersedia (Supabase env belum valid).</p>
      </Card>
    );
  }

  return (
    <>
      <Card className="w-full p-0 overflow-hidden">
        <div className="p-3 border-b border-border bg-background/50 flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <Users className="w-4 h-4" /> Player Online
          </h2>
          <span className="text-xs text-secondary bg-secondary/10 px-2 py-0.5 rounded-full">{onlineUsers.length}</span>
        </div>

        <div className="p-3">
          {onlineUsers.length === 0 ? (
            <p className="text-xs text-secondary text-center py-2">Belum ada player online</p>
          ) : (
            <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
              {onlineUsers.map((u) => {
                const isSelf = selfId != null && u.id === selfId;
                const isInRoom = roomPlayerIds.has(u.id);
                const showInvite = variant === 'room' && effectiveRoomId && !isInRoom && !isSelf;
                const alreadyRequested = requestedIds.has(u.id);
                return (
                  <div key={u.id} className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl hover:bg-secondary/10 transition-colors">
                    <div className="flex items-center gap-2 min-w-0">
                      {u.avatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={u.avatar} alt={u.username} className="w-6 h-6 rounded-full object-cover border border-border shrink-0" />
                      ) : (
                        <div className="w-6 h-6 rounded-full bg-secondary/20 border border-border flex items-center justify-center text-[10px] font-bold shrink-0">
                          {u.username.charAt(0)}
                        </div>
                      )}
                      <span className="text-xs font-medium truncate max-w-[120px]">{u.username}</span>
                    </div>
                    {isSelf ? (
                      <span className="text-[10px] text-secondary bg-secondary/10 px-1.5 py-0.5 rounded-full shrink-0">Kamu</span>
                    ) : showInvite ? (
                      <Button size="sm" variant="outline" onClick={() => handleInvite(u.id)} className="h-7 px-2.5 text-xs gap-1 shrink-0">
                        <Send className="w-3 h-3" /> Invite
                      </Button>
                    ) : variant === 'room' && isInRoom ? (
                      <span className="text-[10px] text-secondary bg-secondary/10 px-1.5 py-0.5 rounded-full shrink-0">Di room</span>
                    ) : variant === 'lobby' && u.roomId ? (
                      alreadyRequested ? (
                        <span className="text-[10px] text-amber-600 bg-amber-500/10 px-1.5 py-0.5 rounded-full shrink-0">Menunggu...</span>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => handleRequestJoin(u.id)} className="h-7 px-2.5 text-xs gap-1 shrink-0">
                          <LogIn className="w-3 h-3" /> Minta Izin
                        </Button>
                      )
                    ) : variant === 'lobby' ? (
                      <span className="text-[10px] text-secondary bg-secondary/10 px-1.5 py-0.5 rounded-full shrink-0">Lobby</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Card>

      {/* Notifikasi tengah layar: undangan + permintaan izin masuk + persetujuan */}
      <CenterInviteModals
        invite={activeInvite}
        inviteCount={pendingInvites.length}
        joinRequest={activeJoinRequest}
        joinRequestCount={incomingJoinRequests.length}
        myRoomCode={myRoomCode}
        approval={joinApproval}
        onAcceptInvite={handleAcceptInvite}
        onDeclineInvite={handleDeclineInvite}
        onAcceptJoinRequest={handleAcceptJoinRequest}
        onDeclineJoinRequest={handleDeclineJoinRequest}
        onAcceptApproval={handleAcceptApproval}
        onDismissApproval={dismissJoinApproval}
      />
    </>
  );
};
