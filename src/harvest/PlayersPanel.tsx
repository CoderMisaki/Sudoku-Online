"use client";
// Online player roster. Entry point for starting a private conversation.
import React, { useMemo } from 'react';
import { MessageSquare, Circle } from 'lucide-react';
import { useHarvestStore } from './store';
import { audio } from './audio';

export function PlayersPanel() {
  const playersShort = useHarvestStore((s) => s.playersShort);
  const conversations = useHarvestStore((s) => s.conversations);
  const userId = useHarvestStore((s) => s.userId);
  const setActiveChannel = useHarvestStore((s) => s.setActiveChannel);
  const setChatOpen = useHarvestStore((s) => s.setChatOpen);
  const setMenu = useHarvestStore((s) => s.setMenu);

  const list = useMemo(() => {
    const all = Object.values(playersShort);
    return [
      ...all.filter((p) => p.id === userId),
      ...all.filter((p) => p.id !== userId).sort((a, b) => Number(b.online) - Number(a.online)),
    ];
  }, [playersShort, userId]);

  const message = (peerId: string) => {
    audio.play('open');
    setActiveChannel(peerId);
    setChatOpen(true);
    setMenu(null);
  };

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-white/50">
        {list.length} pemain di world ini. Kirim <b className="text-white/75">pesan pribadi</b> — hanya kamu dan penerima yang bisa melihatnya.
      </p>
      <div className="space-y-1.5">
        {list.map((p) => {
          const isMe = p.id === userId;
          const conv = conversations[p.id];
          return (
            <div key={p.id} className="flex items-center gap-2.5 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
              <Circle className={`w-2.5 h-2.5 shrink-0 ${p.online ? 'fill-emerald-400 text-emerald-400' : 'fill-white/25 text-white/25'}`} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-bold text-white truncate">
                  {p.name || p.id.slice(0, 8)} {isMe && <span className="text-[9px] text-emerald-300 font-normal">(kamu)</span>}
                </p>
                <p className="text-[9px] text-white/40">{p.online ? 'Online' : 'Offline'}</p>
              </div>
              {conv && conv.unread > 0 && (
                <span className="bg-rose-500 text-white text-[9px] font-bold rounded-full px-1.5 py-0.5 shrink-0">{conv.unread}</span>
              )}
              {!isMe && (
                <button
                  onClick={() => message(p.id)}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-[11px] font-bold cursor-pointer shrink-0 active:scale-95 transition-transform"
                >
                  <MessageSquare className="w-3 h-3" /> Message
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
