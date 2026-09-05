"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { MessageCircle, Lock } from 'lucide-react';
import { cn } from '@/utils/cn';
import type { ChatMessage } from '@/types/game';

interface GameChatProps {
  /** Kirim chat. Teruskan toUserId untuk whisper pribadi. */
  onSend: (text: string, toUserId?: string | null) => void;
  className?: string;
  compact?: boolean;
}

/**
 * Chat dalam game: Publik + Pribadi (whisper).
 * - Tab "Publik": semua pemain melihat.
 * - Tab "Pribadi": pilih pemain tujuan, pesan hanya tampil untuk pengirim & penerima.
 * - Realtime via event chat_message yang sama (payload membawa toUserId/isPrivate).
 */
export const GameChat: React.FC<GameChatProps> = ({ onSend, className, compact }) => {
  const messages = useGameStore((s) => s.messages);
  const room = useGameStore((s) => s.room);
  const userId = useGameStore((s) => s.userId);

  const [tab, setTab] = useState<'public' | 'private'>('public');
  const [targetId, setTargetId] = useState<string>('');
  const [input, setInput] = useState('');
  const [unreadPrivate, setUnreadPrivate] = useState(0);
  const [newMsgNotif, setNewMsgNotif] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);
  const joinAtRef = useRef(0);

  useEffect(() => {
    if (joinAtRef.current === 0) joinAtRef.current = Date.now();
  }, []);

  const others = useMemo(
    () =>
      Object.values(room?.players ?? {}).filter(
        (p) => p.id !== userId && p.status !== 'left'
      ),
    [room?.players, userId]
  );

  // Target efektif: pilihan user, atau pemain lain pertama (tanpa setState dalam effect).
  const effectiveTargetId = targetId || others[0]?.id || '';

  const visible = useMemo(() => {
    if (tab === 'public') return messages.filter((m) => !m.isPrivate);
    // private: hanya yang melibatkan saya
    return messages.filter(
      (m) =>
        m.isPrivate &&
        (m.userId === userId || m.toUserId === userId)
    );
  }, [messages, tab, userId]);

  const privateCounts = useMemo(() => {
    const map: Record<string, number> = {};
    messages.forEach((m: ChatMessage) => {
      if (!m.isPrivate) return;
      const peer = m.userId === userId ? m.toUserId : m.userId;
      if (peer) map[peer] = (map[peer] ?? 0) + 1;
    });
    return map;
  }, [messages, userId]);

  // Auto-scroll (sinkron DOM, tanpa setState) — notifikasi dijadwalkan async
  // agar tidak memicu cascading render (setTimeout = event, bukan effect body).
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      if (nearBottom) el.scrollTop = el.scrollHeight;
    }
    if (messages.length > prevCountRef.current) {
      if (prevCountRef.current > 0) {
        const last = messages[messages.length - 1];
        const mine = last && last.userId === userId;
        const involved =
          last && (!last.isPrivate || last.userId === userId || last.toUserId === userId);
        if (last && !mine && involved && last.timestamp >= joinAtRef.current) {
          const isPrivateAway = last.isPrivate && tab !== 'private';
          const t = window.setTimeout(() => {
            if (isPrivateAway) {
              setUnreadPrivate((n) => n + 1);
            } else {
              setNewMsgNotif(true);
              window.setTimeout(() => setNewMsgNotif(false), 2000);
            }
          }, 0);
          prevCountRef.current = messages.length;
          return () => window.clearTimeout(t);
        }
      }
      prevCountRef.current = messages.length;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, userId]);

  const switchTab = (next: 'public' | 'private') => {
    setTab(next);
    if (next === 'private') setUnreadPrivate(0);
  };

  const submit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const text = input.trim().slice(0, 500);
    if (!text) return;
    if (tab === 'private') {
      if (!effectiveTargetId) return;
      onSend(text, effectiveTargetId);
    } else {
      onSend(text, null);
    }
    setInput('');
    requestAnimationFrame(() => {
      const el = containerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const targetName =
    others.find((p) => p.id === effectiveTargetId)?.username ?? 'Pilih pemain';

  return (
    <Card className={cn('flex flex-col overflow-hidden w-full', compact ? 'h-[320px]' : 'h-[380px]', className)}>
      <div className="p-2.5 border-b border-border bg-background/50 flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-sm flex items-center gap-2">
            <MessageCircle className="w-4 h-4" /> Chat
          </h2>
          {newMsgNotif && (
            <span className="text-xs bg-foreground text-background font-semibold px-2 py-0.5 rounded-full animate-pulse">
              ✉️ +1
            </span>
          )}
        </div>
        {/* Tabs Publik / Pribadi */}
        <div className="flex items-center gap-1 bg-secondary/10 p-1 rounded-lg" role="tablist" aria-label="Mode chat">
          <button
            role="tab"
            aria-selected={tab === 'public'}
            onClick={() => switchTab('public')}
            className={cn(
              'flex-1 h-7 rounded-md text-xs font-semibold transition-all cursor-pointer',
              tab === 'public' ? 'bg-card shadow-sm text-foreground' : 'text-secondary hover:text-foreground'
            )}
          >
            🌍 Publik
          </button>
          <button
            role="tab"
            aria-selected={tab === 'private'}
            onClick={() => switchTab('private')}
            className={cn(
              'flex-1 h-7 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1',
              tab === 'private' ? 'bg-card shadow-sm text-foreground' : 'text-secondary hover:text-foreground'
            )}
          >
            <Lock className="w-3 h-3" /> Pribadi
            {unreadPrivate > 0 && (
              <span className="ml-1 min-w-5 h-5 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
                {unreadPrivate}
              </span>
            )}
          </button>
        </div>
        {tab === 'private' && (
          <select
            value={effectiveTargetId}
            onChange={(e) => setTargetId(e.target.value)}
            aria-label="Chat pribadi ke pemain"
            className="w-full h-9 rounded-lg border border-border bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-foreground"
          >
            {others.length === 0 && <option value="">(Belum ada pemain lain)</option>}
            {others.map((p) => (
              <option key={p.id} value={p.id}>
                ✉️ ke {p.username}
                {privateCounts[p.id] ? ` (${privateCounts[p.id]})` : ''}
              </option>
            ))}
          </select>
        )}
      </div>

      <div ref={containerRef} className="flex-1 p-3 flex flex-col overflow-y-auto space-y-2 text-xs sm:text-sm min-h-0">
        {visible.length === 0 ? (
          <div className="text-secondary italic text-center my-auto">
            {tab === 'public' ? 'Belum ada pesan publik.' : `Belum ada chat pribadi${targetName ? ` dengan ${targetName}` : ''}.`}
          </div>
        ) : (
          visible.map((msg) => {
            const mine = msg.userId === userId;
            return (
              <div key={msg.id} className={cn('flex flex-col', mine && 'items-end')}>
                <span className="font-semibold text-[11px] text-secondary flex items-center gap-1">
                  {msg.isPrivate && <Lock className="w-2.5 h-2.5" />}
                  {mine ? 'Kamu' : msg.username}
                  {msg.isPrivate && (
                    <span className="text-[10px] opacity-70">
                      → {mine ? msg.toUsername ?? 'pribadi' : 'kamu'}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    'px-2.5 py-1 rounded-md w-fit max-w-full break-words text-xs',
                    msg.isPrivate
                      ? mine
                        ? 'bg-purple-500/20 border border-purple-500/30'
                        : 'bg-purple-500/10 border border-purple-500/20'
                      : 'bg-secondary/10'
                  )}
                >
                  {msg.text}
                </span>
              </div>
            );
          })
        )}
      </div>

      <div className="p-2.5 border-t border-border flex-shrink-0">
        <form onSubmit={submit} className="flex items-center gap-2">
          <textarea
            id="chat-textarea"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = '40px';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              tab === 'private' ? `Pesan pribadi ke ${targetName}...` : 'Ketik pesan publik...'
            }
            maxLength={500}
            rows={1}
            className="flex-1 bg-background border border-border rounded-lg px-3 py-1.5 text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-foreground resize-none min-h-[40px] max-h-[120px] overflow-y-auto"
          />
          <Button type="submit" size="sm" className="h-8 px-3 text-xs flex-shrink-0">
            {tab === 'private' ? 'Whisper' : 'Kirim'}
          </Button>
        </form>
      </div>
    </Card>
  );
};
