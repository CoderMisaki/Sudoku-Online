"use client";

import React from 'react';
import { useRouter } from 'next/navigation';
import { Users, Send, X, Mail } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useGlobalPresence } from '@/hooks/useGlobalPresence';
import { useGameStore } from '@/store/gameStore';

interface OnlinePlayersBoxProps {
  variant?: 'lobby' | 'room';
  roomId?: string;
}

export const OnlinePlayersBox: React.FC<OnlinePlayersBoxProps> = ({ variant = 'lobby', roomId }) => {
  const router = useRouter();
  const currentRoom = useGameStore((s) => s.room);
  const effectiveRoomId = roomId || currentRoom?.id || '';
  const { onlineUsers, sendInvite, pendingInvites, dismissInvite, isSupabaseReady } = useGlobalPresence();

  const roomPlayerIds = currentRoom ? new Set(Object.keys(currentRoom.players)) : new Set<string>();

  const handleInvite = async (targetId: string) => {
    if (!effectiveRoomId) {
      // If not in room, go to join? For lobby, invite means create room? For now, just toast.
      return;
    }
    await sendInvite(targetId, effectiveRoomId);
  };

  const handleAcceptInvite = (code: string, inviteId: string) => {
    dismissInvite(inviteId);
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
    <Card className="w-full p-0 overflow-hidden">
      <div className="p-3 border-b border-border bg-background/50 flex items-center justify-between">
        <h2 className="font-semibold text-sm flex items-center gap-2">
          <Users className="w-4 h-4" /> Player Online
        </h2>
        <span className="text-xs text-secondary bg-secondary/10 px-2 py-0.5 rounded-full">{onlineUsers.length}</span>
      </div>

      {/* Pending invites (incoming) */}
      {pendingInvites.length > 0 && (
        <div className="p-2 bg-amber-500/10 border-b border-amber-500/20 space-y-2">
          {pendingInvites.map((inv) => (
            <div key={inv.id} className="flex items-center justify-between gap-2 bg-card border border-border rounded-xl px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="text-xs font-medium truncate">
                  {inv.fromUsername} → Room {inv.roomCode}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" onClick={() => handleAcceptInvite(inv.roomCode, inv.id)} className="h-7 px-2.5 text-xs">
                  Join
                </Button>
                <button onClick={() => dismissInvite(inv.id)} className="p-1 rounded-full hover:bg-secondary/10 cursor-pointer" aria-label="Tutup">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="p-3">
        {onlineUsers.length === 0 ? (
          <p className="text-xs text-secondary text-center py-2">Belum ada player online</p>
        ) : (
          <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto">
            {onlineUsers.map((u) => {
              const isInRoom = roomPlayerIds.has(u.id);
              const showInvite = variant === 'room' && effectiveRoomId && !isInRoom;
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
                  {showInvite ? (
                    <Button size="sm" variant="outline" onClick={() => handleInvite(u.id)} className="h-7 px-2.5 text-xs gap-1 shrink-0">
                      <Send className="w-3 h-3" /> Invite
                    </Button>
                  ) : variant === 'room' && isInRoom ? (
                    <span className="text-[10px] text-secondary bg-secondary/10 px-1.5 py-0.5 rounded-full">Di room</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Card>
  );
};
