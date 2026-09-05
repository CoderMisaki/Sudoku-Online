"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, UserPlus, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import type { PendingInvite, JoinRequest, JoinApproval } from '@/hooks/useGlobalPresence';

interface CenterInviteModalsProps {
  /** Undangan aktif (tampilkan 1 per 1, antrian dihitung via inviteCount). */
  invite: PendingInvite | null;
  inviteCount: number;
  /** Permintaan izin masuk aktif. */
  joinRequest: JoinRequest | null;
  joinRequestCount: number;
  /** Kode room-ku (ditampilkan di modal permintaan masuk). */
  myRoomCode: string;
  /** Persetujuan atas permintaanku (ditampilkan ke peminta). */
  approval: JoinApproval | null;
  onAcceptInvite: () => void;
  onDeclineInvite: () => void;
  onAcceptJoinRequest: () => void;
  onDeclineJoinRequest: () => void;
  onAcceptApproval: () => void;
  onDismissApproval: () => void;
}

function CenterShell({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 0);
    return () => clearTimeout(t);
  }, []);
  // Kunci scroll body selama modal tampil
  useEffect(() => {
    if (!mounted) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 12 }}
        transition={{ type: 'spring', stiffness: 380, damping: 28 }}
        className="relative z-[91] w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-2xl"
      >
        {children}
      </motion.div>
    </div>,
    document.body
  );
}

function QueueHint({ count }: { count: number }) {
  if (count <= 1) return null;
  return <p className="mt-3 text-[11px] text-secondary">+{count - 1} lainnya menunggu</p>;
}

export const CenterInviteModals: React.FC<CenterInviteModalsProps> = ({
  invite,
  inviteCount,
  joinRequest,
  joinRequestCount,
  myRoomCode,
  approval,
  onAcceptInvite,
  onDeclineInvite,
  onAcceptJoinRequest,
  onDeclineJoinRequest,
  onAcceptApproval,
  onDismissApproval,
}) => {
  return (
    <>
      {/* ── 1. Diundang ke room: "<username> ingin mengundang anda ke dalam room" ── */}
      <AnimatePresence>
        {invite && (
          <CenterShell key={`invite-${invite.id}`}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/15">
              <Mail className="h-6 w-6 text-amber-500" />
            </div>
            <h2 className="text-lg font-bold">Undangan Room</h2>
            <p className="mt-2 text-sm leading-relaxed">
              <span className="font-bold">{invite.fromUsername || 'SESEORANG'}</span>
              {' '}ingin mengundang anda ke dalam room
            </p>
            <div className="mt-2 inline-block rounded-full bg-secondary/15 px-3 py-1 font-mono text-xs font-bold tracking-widest">
              ROOM {invite.roomCode}
            </div>
            <div className="mt-5 flex gap-3">
              <Button fullWidth size="lg" onClick={onAcceptInvite} className="bg-green-600 hover:bg-green-700 text-white">
                Yes
              </Button>
              <Button fullWidth size="lg" variant="outline" onClick={onDeclineInvite}>
                No
              </Button>
            </div>
            <QueueHint count={inviteCount} />
          </CenterShell>
        )}
      </AnimatePresence>

      {/* ── 2. Diminta izin masuk: "<username> Ingin Masuk ke dalam room anda" ── */}
      <AnimatePresence>
        {joinRequest && (
          <CenterShell key={`joinreq-${joinRequest.id}`}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-blue-500/15">
              <UserPlus className="h-6 w-6 text-blue-500" />
            </div>
            <h2 className="text-lg font-bold">Permintaan Masuk</h2>
            <p className="mt-2 text-sm leading-relaxed">
              <span className="font-bold">{joinRequest.fromUsername || 'SESEORANG'}</span>
              {' '}Ingin Masuk ke dalam room anda
            </p>
            {myRoomCode && (
              <div className="mt-2 inline-block rounded-full bg-secondary/15 px-3 py-1 font-mono text-xs font-bold tracking-widest">
                ROOM {myRoomCode}
              </div>
            )}
            <div className="mt-5 flex gap-3">
              <Button fullWidth size="lg" onClick={onAcceptJoinRequest} className="bg-green-600 hover:bg-green-700 text-white">
                Yes
              </Button>
              <Button fullWidth size="lg" variant="outline" onClick={onDeclineJoinRequest}>
                No
              </Button>
            </div>
            <QueueHint count={joinRequestCount} />
          </CenterShell>
        )}
      </AnimatePresence>

      {/* ── 3. Permintaanku disetujui: tampil di tengah + tombol Masuk ── */}
      <AnimatePresence>
        {approval && (
          <CenterShell key={`approval-${approval.id}`}>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-green-500/15">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
            </div>
            <h2 className="text-lg font-bold">Permintaan Disetujui</h2>
            <p className="mt-2 text-sm leading-relaxed">
              <span className="font-bold">{approval.fromUsername || 'PEMAIN'}</span>
              {' '}mengizinkanmu masuk ke room
            </p>
            <div className="mt-2 inline-block rounded-full bg-secondary/15 px-3 py-1 font-mono text-xs font-bold tracking-widest">
              ROOM {approval.roomCode}
            </div>
            <div className="mt-5 flex gap-3">
              <Button fullWidth size="lg" onClick={onAcceptApproval} className="bg-green-600 hover:bg-green-700 text-white">
                Masuk
              </Button>
              <Button fullWidth size="lg" variant="outline" onClick={onDismissApproval}>
                Nanti
              </Button>
            </div>
          </CenterShell>
        )}
      </AnimatePresence>
    </>
  );
};
