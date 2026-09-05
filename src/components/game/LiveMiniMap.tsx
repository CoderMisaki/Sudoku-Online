"use client";

import React, { useMemo, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { Card } from '@/components/ui/Card';
import { Map as MapIcon, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Map realtime — menampilkan pergerakan & status SEMUA pemain secara live:
 * - Mode Ular Tangga: posisi bidak (kotak 1..100) di lintasan mini.
 * - Mode Sudoku/Arrow/TicTacToe: kursor live + progress %.
 * - Selalu: posisi avatar bebas (pos x/y) bila pemain menggerakkan joystick.
 *
 * Data diambil langsung dari store (terupdate via broadcast realtime),
 * dirender ringan (div biasa, tanpa canvas berat) agar smooth di HP kentang.
 */
export const LiveMiniMap: React.FC<{ className?: string }> = ({ className }) => {
  const room = useGameStore((s) => s.room);
  const snakes = useGameStore((s) => s.snakesState);
  const userId = useGameStore((s) => s.userId);
  const [collapsed, setCollapsed] = useState(false);
  const [showNames, setShowNames] = useState(true);

  const players = useMemo(() => Object.values(room?.players ?? {}), [room?.players]);
  const isSnakes = room?.mode === 'snakes_and_ladders';

  if (!room) return null;

  const hasRadar = (userId && room.players[userId]?.inventory?.includes('radar')) ?? false;
  const revealNames = showNames || hasRadar;

  return (
    <Card className={cn('w-full overflow-hidden', className)}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full p-2.5 border-b border-border bg-background/50 flex items-center justify-between cursor-pointer hover:bg-background/80 transition-colors"
        aria-expanded={!collapsed}
      >
        <span className="font-semibold text-sm flex items-center gap-2">
          <MapIcon className="w-4 h-4" /> Map Live
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              setShowNames((v) => !v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation();
                setShowNames((v) => !v);
              }
            }}
            className="text-[11px] text-secondary hover:text-foreground border border-border rounded-full px-2 py-0.5 cursor-pointer"
            title="Tampilkan/sembunyikan nama"
          >
            {revealNames ? 'Nama: ON' : 'Nama: OFF'}
          </span>
          {collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
        </span>
      </button>

      {!collapsed && (
        <div className="p-3 space-y-3">
          {/* ── Arena avatar bebas (joystick) — selalu live ── */}
          <div>
            <p className="text-[11px] font-semibold text-secondary mb-1.5">
              ARENA GERAK BEBAS {players.some((p) => p.pos) ? '' : '(gerak dengan joystick untuk muncul)'}
            </p>
            <div className="relative w-full aspect-[2/1] rounded-lg border border-border bg-background overflow-hidden">
              {/* grid halus */}
              <div
                className="absolute inset-0 opacity-40"
                style={{
                  backgroundImage:
                    'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
                  backgroundSize: '20px 20px',
                }}
              />
              {players
                .filter((p) => p.status !== 'left')
                .map((p) => {
                  const x = p.pos?.x ?? 50;
                  const y = p.pos?.y ?? 50;
                  const isMe = p.id === userId;
                  const hasGold = p.inventory?.includes('avatar_gold');
                  const hasFire = p.inventory?.includes('trail_fire');
                  return (
                    <div
                      key={p.id}
                      className="absolute transition-all duration-150 ease-out"
                      style={{
                        left: `calc(${Math.max(2, Math.min(98, x))}% - 11px)`,
                        top: `calc(${Math.max(4, Math.min(96, y))}% - 11px)`,
                        transitionProperty: 'left, top',
                      }}
                      title={`${p.username}${p.status !== 'online' ? ` (${p.status})` : ''}`}
                    >
                      {hasFire && (
                        <span className="absolute -left-3 top-1 text-xs opacity-70 animate-pulse">🔥</span>
                      )}
                      <div
                        className={cn(
                          'w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-bold text-white border-2 shadow-sm',
                          p.status !== 'online' && 'opacity-40 grayscale'
                        )}
                        style={{
                          backgroundColor: p.color,
                          borderColor: hasGold ? '#facc15' : isMe ? '#fff' : 'transparent',
                          boxShadow: isMe ? `0 0 0 2px ${p.color}55` : undefined,
                        }}
                      >
                        {(p.username || '?').slice(0, 1).toUpperCase()}
                      </div>
                      {revealNames && (
                        <div className="absolute top-[22px] left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] font-semibold bg-card/90 border border-border rounded px-1">
                          {p.username}
                          {isMe ? ' (kamu)' : ''}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </div>

          {/* ── Jalur Ular Tangga / Progress ── */}
          {isSnakes ? (
            <div>
              <p className="text-[11px] font-semibold text-secondary mb-1.5">JALUR ULAR TANGGA (1 → 100)</p>
              <div className="relative h-9 rounded-lg border border-border bg-background overflow-hidden">
                <div className="absolute inset-x-2 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-secondary/20" />
                <div
                  className="absolute left-2 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-green-500/60 transition-all duration-300"
                  style={{
                    width: `calc(${(Math.max(...Object.values(snakes?.playerPositions ?? { _: 1 }), 1) / 100) * 100}% * 0.94)`,
                  }}
                />
                {players
                  .filter((p) => p.status !== 'left')
                  .map((p, i) => {
                    const pos = snakes?.playerPositions?.[p.id] ?? 0;
                    const pct = Math.max(0, Math.min(100, pos));
                    return (
                      <div
                        key={p.id}
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 transition-all duration-300"
                        style={{ left: `calc(0.5rem + ${pct}% * 0.94)` }}
                        title={`${p.username}: kotak ${pos}`}
                      >
                        <div
                          className="w-5 h-5 rounded-full border-2 border-white shadow flex items-center justify-center text-[9px] font-black text-white"
                          style={{ backgroundColor: p.color, marginTop: (i % 2) * 10 - 5 }}
                        >
                          {pos}
                        </div>
                      </div>
                    );
                  })}
              </div>
              <div className="mt-1.5 space-y-1">
                {players
                  .filter((p) => p.status !== 'left')
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="font-medium truncate flex-1">
                        {p.username}
                        {p.id === snakes?.currentTurnUserId ? ' 🎲' : ''}
                      </span>
                      <span className="font-mono font-bold">#{snakes?.playerPositions?.[p.id] ?? 0}</span>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <div>
              <p className="text-[11px] font-semibold text-secondary mb-1.5">KURSOR & PROGRESS LIVE</p>
              <div className="space-y-1.5">
                {players
                  .filter((p) => p.status !== 'left')
                  .map((p) => (
                    <div key={p.id} className="flex items-center gap-2 text-[11px]">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
                      <span className="font-medium truncate w-24">
                        {p.username}
                        {p.id === userId ? ' (kamu)' : ''}
                      </span>
                      <div className="flex-1 h-2 rounded-full bg-secondary/15 overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-300"
                          style={{
                            width: `${Math.max(0, Math.min(100, p.progress ?? 0))}%`,
                            backgroundColor: p.color,
                          }}
                        />
                      </div>
                      <span className="font-mono w-14 text-right">
                        {p.cursor ? `(${p.cursor.row},${p.cursor.col})` : `${p.progress ?? 0}%`}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          )}
          <p className="text-[10px] text-secondary leading-snug">
            Update realtime setiap ada pergerakan — kursor, bidak, maupun avatar joystick.
          </p>
        </div>
      )}
    </Card>
  );
};
