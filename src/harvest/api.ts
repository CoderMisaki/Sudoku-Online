// Shared UI-facing API types (avoids circular imports between orchestrator & UI).
import type { WorldEngine } from './world';
import type { PlayerState, Defs } from './types';

export interface UIApi {
  action(a: string, payload?: Record<string, unknown>): void;
  interact(): void;
  move(vx: number, vy: number): void;
  select(itemId: string | null): void;
  sendChat(text: string): void;
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
