"use client";

import React, { useMemo, useState } from 'react';
import { useGameStore } from '@/store/gameStore';
import { SHOP_ITEMS, STARTING_COINS, getShopItem } from '@/data/shop';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Backpack, Coins, ShoppingBag, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/utils/cn';
import toast from 'react-hot-toast';

interface InventoryPanelProps {
  onBuy?: (itemId: string) => boolean;
  onUse?: (itemId: string) => void;
  className?: string;
}

/**
 * Inventory + Shop + Koin.
 * - Koin awal cukup (STARTING_COINS) + bonus jawaban benar/menang ronde.
 * - Beli item -> tersimpan di inventory pemain & tersinkron ke semua pemain.
 * - Pakai item -> efek langsung (hint/coffe/koin) atau tersimpan (sekali pakai).
 */
export const InventoryPanel: React.FC<InventoryPanelProps> = ({ onBuy, onUse, className }) => {
  const userId = useGameStore((s) => s.userId);
  const room = useGameStore((s) => s.room);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'shop' | 'mine'>('shop');

  const me = userId ? room?.players[userId] : undefined;
  const coins = me?.coins ?? STARTING_COINS;
  const owned = useMemo(() => me?.inventory ?? [], [me?.inventory]);

  const ownedCounts = useMemo(() => {
    const m: Record<string, number> = {};
    owned.forEach((id) => {
      m[id] = (m[id] ?? 0) + 1;
    });
    return m;
  }, [owned]);

  const handleBuy = (id: string) => {
    const item = getShopItem(id);
    if (!item) return;
    if (onBuy) {
      const ok = onBuy(id);
      if (!ok) toast.error('Koin tidak cukup!');
      return;
    }
    // Fallback lokal bila tanpa sinkronisasi
    if (coins < item.price) {
      toast.error('Koin tidak cukup!');
      return;
    }
    useGameStore.getState().updatePlayer(userId!, {
      coins: coins - item.price,
      inventory: [...owned, id],
    });
    toast.success(`${item.icon} ${item.name} dibeli!`);
  };

  const handleUse = (id: string) => {
    if (onUse) {
      onUse(id);
      return;
    }
    const item = getShopItem(id);
    toast.success(`${item?.icon ?? '🎒'} ${item?.name ?? id} dipakai!`);
  };

  return (
    <Card className={cn('w-full overflow-hidden', className)}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full p-2.5 border-b border-border bg-background/50 flex items-center justify-between cursor-pointer hover:bg-background/80 transition-colors"
        aria-expanded={open}
      >
        <span className="font-semibold text-sm flex items-center gap-2">
          <Backpack className="w-4 h-4" /> Inventory
          {owned.length > 0 && (
            <span className="text-[11px] bg-foreground text-background rounded-full px-1.5 py-0.5 font-bold">
              {owned.length}
            </span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs font-bold text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 rounded-full px-2 py-0.5">
            <Coins className="w-3.5 h-3.5" /> {coins}
          </span>
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div className="p-3 space-y-2.5">
          <div className="flex items-center gap-1 bg-secondary/10 p-1 rounded-lg">
            <button
              onClick={() => setTab('shop')}
              className={cn(
                'flex-1 h-7 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1',
                tab === 'shop' ? 'bg-card shadow-sm' : 'text-secondary hover:text-foreground'
              )}
            >
              <ShoppingBag className="w-3.5 h-3.5" /> Shop
            </button>
            <button
              onClick={() => setTab('mine')}
              className={cn(
                'flex-1 h-7 rounded-md text-xs font-semibold transition-all cursor-pointer flex items-center justify-center gap-1',
                tab === 'mine' ? 'bg-card shadow-sm' : 'text-secondary hover:text-foreground'
              )}
            >
              <Backpack className="w-3.5 h-3.5" /> Milikku ({owned.length})
            </button>
          </div>

          {tab === 'shop' ? (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-0.5">
              {SHOP_ITEMS.map((item) => {
                const afford = coins >= item.price;
                const count = ownedCounts[item.id] ?? 0;
                return (
                  <div
                    key={item.id}
                    className="flex items-center gap-2.5 p-2 rounded-lg border border-border bg-background/60"
                  >
                    <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center text-xl flex-shrink-0">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">
                        {item.name}
                        {count > 0 && <span className="ml-1 text-[10px] text-secondary">x{count}</span>}
                      </p>
                      <p className="text-[11px] text-secondary leading-snug line-clamp-2">{item.description}</p>
                    </div>
                    <Button
                      size="sm"
                      disabled={!afford}
                      onClick={() => handleBuy(item.id)}
                      className={cn('h-8 text-xs flex-shrink-0', afford ? '' : 'opacity-50')}
                      title={afford ? `Beli seharga ${item.price} koin` : 'Koin tidak cukup'}
                    >
                      🪙 {item.price}
                    </Button>
                  </div>
                );
              })}
              <p className="text-[10px] text-secondary leading-snug">
                Uang selalu cukup untuk mulai: modal {STARTING_COINS} koin + bonus tiap jawaban benar & menang ronde.
              </p>
            </div>
          ) : owned.length === 0 ? (
            <p className="text-xs text-secondary italic text-center py-4">
              Inventory kosong — beli item di tab Shop.
            </p>
          ) : (
            <div className="space-y-2 max-h-[320px] overflow-y-auto pr-0.5">
              {Object.entries(ownedCounts).map(([id, count]) => {
                const item = getShopItem(id);
                if (!item) return null;
                return (
                  <div
                    key={id}
                    className="flex items-center gap-2.5 p-2 rounded-lg border border-border bg-background/60"
                  >
                    <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center text-xl flex-shrink-0">
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold truncate">
                        {item.name} <span className="text-secondary">x{count}</span>
                      </p>
                      <p className="text-[11px] text-secondary leading-snug">{item.effect ?? item.description}</p>
                    </div>
                    <Button size="sm" onClick={() => handleUse(id)} className="h-8 text-xs flex-shrink-0">
                      Pakai
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
