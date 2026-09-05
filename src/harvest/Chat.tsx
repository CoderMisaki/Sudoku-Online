"use client";
// Public + private chat. Private messages are delivered by the server only to
// the two participants — the client does not filter a room-wide broadcast.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Send, Users, Lock, MessageCircle } from 'lucide-react';
import { useHarvestStore } from './store';
import { audio } from './audio';
import type { UIApi } from './api';
import type { DeviceClass } from './orientation';

function fmtClock(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function ChatPanel({ api, device }: { api: UIApi; device: DeviceClass }) {
  const chatOpen = useHarvestStore((s) => s.chatOpen);
  const setChatOpen = useHarvestStore((s) => s.setChatOpen);
  const chat = useHarvestStore((s) => s.chat);
  const conversations = useHarvestStore((s) => s.conversations);
  const activeChannel = useHarvestStore((s) => s.activeChannel);
  const setActiveChannel = useHarvestStore((s) => s.setActiveChannel);
  const playersShort = useHarvestStore((s) => s.playersShort);
  const userId = useHarvestStore((s) => s.userId);
  const [text, setText] = useState('');
  const [tab, setTab] = useState<'chat' | 'people'>('chat');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const isMobile = device === 'mobile';

  // Messages for the currently selected channel.
  const visible = useMemo(() => {
    if (!activeChannel) return chat.filter((m) => m.channel === 'public');
    return chat.filter(
      (m) =>
        m.channel === 'private' &&
        ((m.playerId === activeChannel && m.targetPlayerId === userId) ||
          (m.playerId === userId && m.targetPlayerId === activeChannel)),
    );
  }, [chat, activeChannel, userId]);

  const totalUnread = useMemo(
    () => Object.values(conversations).reduce((n, c) => n + c.unread, 0),
    [conversations],
  );

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [visible.length, chatOpen, activeChannel]);

  // Mark the open conversation as read as soon as new messages land in it.
  useEffect(() => {
    if (chatOpen && activeChannel) useHarvestStore.getState().markConversationRead(activeChannel);
  }, [chatOpen, activeChannel, visible.length]);

  useEffect(() => {
    if (chatOpen) {
      const t = setTimeout(() => inputRef.current?.focus(), 60);
      return () => clearTimeout(t);
    }
  }, [chatOpen]);

  const send = useCallback(() => {
    const t = text.trim().slice(0, 200);
    if (!t) return;
    // Send only; the message appears when the server echoes it back. No fake
    // optimistic success — the server is the source of truth for chat.
    if (activeChannel) api.sendChat(t, 'private', activeChannel);
    else api.sendChat(t, 'public');
    setText('');
  }, [api, text, activeChannel]);

  const others = useMemo(
    () => Object.values(playersShort).filter((p) => p.id !== userId),
    [playersShort, userId],
  );

  const openPrivate = (peerId: string, peerName: string) => {
    audio.play('open');
    setActiveChannel(peerId);
    setTab('chat');
    void peerName;
  };

  if (!chatOpen) {
    const last = chat[chat.length - 1];
    return (
      <button
        onClick={() => { audio.play('open'); setChatOpen(true); }}
        aria-label="Buka chat"
        className="pointer-events-auto absolute left-3 bg-[#0d1826]/85 border border-white/12 rounded-2xl px-3 py-1.5 text-[10px] text-white/75 backdrop-blur cursor-pointer hover:bg-[#0d1826]/95 max-w-[46vw] truncate flex items-center gap-1.5"
        style={{ bottom: isMobile ? 'calc(env(safe-area-inset-bottom) + 148px)' : 'calc(env(safe-area-inset-bottom) + 156px)' }}
      >
        <MessageCircle className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
        {last ? <span className="truncate">{last.name}: {last.text}</span> : <span>Chat</span>}
        {totalUnread > 0 && (
          <span className="ml-0.5 shrink-0 bg-rose-500 text-white text-[9px] font-bold rounded-full px-1.5 py-px">{totalUnread}</span>
        )}
      </button>
    );
  }

  const peerName = activeChannel
    ? conversations[activeChannel]?.peerName || playersShort[activeChannel]?.name || 'Pemain'
    : '';

  return (
    <div
      className={`pointer-events-auto absolute rounded-2xl bg-[#101a2e]/97 backdrop-blur border border-white/15 shadow-2xl flex flex-col overflow-hidden ${
        isMobile ? 'inset-x-2' : 'left-3 w-[min(76vw,400px)]'
      }`}
      style={{
        bottom: isMobile ? 'calc(env(safe-area-inset-bottom) + 8px)' : 'calc(env(safe-area-inset-bottom) + 96px)',
        top: isMobile ? 'calc(env(safe-area-inset-top) + 8px)' : undefined,
        height: isMobile ? undefined : 'min(58vh, 300px)',
        maxHeight: isMobile ? undefined : '58vh',
      }}
    >
      {/* header */}
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 shrink-0">
        <button
          onClick={() => { audio.play('click'); setTab('chat'); }}
          className={`text-[11px] font-bold cursor-pointer px-2 py-1 rounded-lg transition-colors ${tab === 'chat' ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white'}`}
        >
          {activeChannel ? <span className="flex items-center gap-1"><Lock className="w-3 h-3" />{peerName}</span> : 'Chat Dunia'}
        </button>
        <button
          onClick={() => { audio.play('click'); setTab('people'); }}
          className={`text-[11px] font-bold cursor-pointer px-2 py-1 rounded-lg transition-colors flex items-center gap-1 ${tab === 'people' ? 'bg-white/10 text-white' : 'text-white/55 hover:text-white'}`}
        >
          <Users className="w-3 h-3" /> Pemain
          {totalUnread > 0 && <span className="bg-rose-500 text-white text-[9px] font-bold rounded-full px-1.5">{totalUnread}</span>}
        </button>
        <div className="flex-1" />
        {activeChannel && tab === 'chat' && (
          <button onClick={() => { audio.play('click'); setActiveChannel(null); }} className="text-[10px] text-emerald-300 hover:text-emerald-200 cursor-pointer">
            ← Publik
          </button>
        )}
        <button onClick={() => { audio.play('close'); setChatOpen(false); }} aria-label="Tutup chat" className="text-white/50 hover:text-white cursor-pointer p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      {tab === 'people' ? (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 min-h-0">
          {others.length === 0 && <p className="text-[11px] text-white/40 italic px-1">Belum ada pemain lain di world ini.</p>}
          {others.map((p) => {
            const conv = conversations[p.id];
            return (
              <div key={p.id} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-2.5 py-2">
                <span className={`w-2 h-2 rounded-full shrink-0 ${p.online ? 'bg-emerald-400' : 'bg-white/25'}`} title={p.online ? 'Online' : 'Offline'} />
                <span className="text-[11px] font-bold text-white truncate flex-1">{p.name || p.id.slice(0, 6)}</span>
                {conv && conv.unread > 0 && <span className="bg-rose-500 text-white text-[9px] font-bold rounded-full px-1.5 shrink-0">{conv.unread}</span>}
                <button
                  onClick={() => openPrivate(p.id, p.name)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-[10px] font-bold cursor-pointer shrink-0 active:scale-95 transition-transform"
                >
                  Message
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div ref={listRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 min-h-0">
          {visible.length === 0 && (
            <p className="text-[11px] text-white/40 italic">
              {activeChannel ? `Mulai percakapan pribadi dengan ${peerName}.` : 'Belum ada pesan. Sapa dunia! 🌾'}
            </p>
          )}
          {visible.map((m) => {
            const mine = m.playerId === userId;
            return (
              <div key={m.id} className="text-[11px] leading-snug">
                <span className={`font-bold ${m.channel === 'private' ? 'text-fuchsia-300' : mine ? 'text-sky-300' : 'text-emerald-300'}`}>
                  {m.channel === 'private' && '🔒 '}{mine ? 'Kamu' : m.name}:{' '}
                </span>
                <span className="text-white/85 break-words">{m.text}</span>
                <span className="text-white/25 ml-1 text-[9px] tabular-nums">{fmtClock(m.ts)}</span>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'chat' && (
        <div className="p-2 border-t border-white/10 flex gap-1.5 shrink-0">
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 200))}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') { e.preventDefault(); send(); }
              if (e.key === 'Escape') { e.preventDefault(); setChatOpen(false); }
            }}
            placeholder={activeChannel ? `Pesan pribadi ke ${peerName}...` : 'Tulis pesan...'}
            aria-label="Kotak pesan"
            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-emerald-300/40"
          />
          <button
            onClick={send}
            disabled={!text.trim()}
            aria-label="Kirim"
            className="w-10 h-9 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:bg-white/10 disabled:text-white/30 text-emerald-950 flex items-center justify-center cursor-pointer transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
