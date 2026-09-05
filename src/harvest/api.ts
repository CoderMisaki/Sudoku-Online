// Shared UI-facing API types (avoids circular imports between orchestrator & UI).
import type { WorldEngine } from './world';
import type { PlayerState, Defs, ChatChannel } from './types';

export interface UIApi {
  action(a: string, payload?: Record<string, unknown>): void;
  /** Gold/inventory-moving action carrying a client-generated idempotency key. */
  transact(a: string, payload?: Record<string, unknown>): void;
  interact(): void;
  move(vx: number, vy: number): void;
  select(itemId: string | null): void;
  /** Public chat, or a private message when `to` is a player id. */
  sendChat(text: string, channel?: ChatChannel, to?: string): void;
  emote(id: string): void;
  leave(): void;
  getEngine(): WorldEngine | null;
}

const TOOLS = ['tool_hoe', 'tool_can', 'tool_sickle', 'tool_axe', 'tool_pick', 'tool_rod', 'tool_net'];

export function getQuickSlots(me: PlayerState | null, defs: Defs | null): (string | null)[] {
  if (!me || !defs) return [];
  const owned = TOOLS.filter((t) => me.inv.some((i) => i.id === t));
  const seeds = me.inv.filter((i) => i.id.startsWith('seed_')).map((i) => i.id);
  return [...owned, ...seeds, null, null].slice(0, 8);
}
