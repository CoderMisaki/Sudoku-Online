import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';
import { checkServerRateLimit, validateSameOrigin, getClientIp } from '../../../../utils/serverSecurity';
import { relocateTriggeredItem } from '../../../../utils/snakesAndLaddersData';
import type { SnakesState, SnakeItem, WormholePair } from '../../../../types/game';

const snakeSchema = z.object({
  id: z.string(),
  head: z.number().int().min(1).max(100),
  tail: z.number().int().min(1).max(100),
  waveStrength: z.number().optional(),
});
const ladderSchema = z.object({
  id: z.string(),
  start: z.number().int().min(1).max(100),
  end: z.number().int().min(1).max(100),
});
const wormholeSchema = z.object({
  id: z.string(),
  blackHole: z.number().int().min(1).max(100),
  whiteHole: z.number().int().min(1).max(100),
});

const snakesStateSchema = z.object({
  diceValue: z.number().nullable().optional(),
  playerPositions: z.record(z.string(), z.number().int().min(1).max(100)),
  currentTurnUserId: z.string().nullable().optional(),
  winnerId: z.string().nullable().optional(),
  winners: z.array(z.string()).optional(),
  isRolling: z.boolean().optional(),
  isAnimating: z.boolean().optional(),
  ladders: z.array(ladderSchema).optional(),
  snakes: z.array(snakeSchema).optional(),
  mines: z.array(z.number().int().min(1).max(100)).optional(),
  wormholes: z.array(wormholeSchema).optional(),
  frozenTurns: z.record(z.string(), z.number()).optional(),
  revision: z.number().int().min(0).optional(),
});

const schema = z.object({
  roomId: z.string().min(3).max(16),
  userId: z.string().min(1).max(64),
  snakesState: snakesStateSchema,
  activePlayerIds: z.array(z.string()).optional(),
});

function secureDice(): number {
  // crypto-secure 1-6
  const n = crypto.randomInt(1, 7);
  return n;
}

export async function POST(request: Request) {
  try {
    if (!validateSameOrigin(request)) {
      return NextResponse.json({ error: 'Akses ditolak (Cross-Origin Blocked)' }, { status: 403 });
    }
    const ip = getClientIp(request);
    if (!(await checkServerRateLimit(`snakes-roll:${ip}`, 20, 10000))) {
      return NextResponse.json({ error: 'Terlalu banyak lemparan dadu' }, { status: 429 });
    }

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Payload tidak valid', details: parsed.error.flatten() }, { status: 400 });
    }

    const { roomId: _roomId, userId, snakesState, activePlayerIds } = parsed.data as {
      roomId: string;
      userId: string;
      snakesState: SnakesState;
      activePlayerIds?: string[];
    };
    void _roomId;

    // Validate turn ownership server-side
    const currentTurn = snakesState.currentTurnUserId;
    if (currentTurn && currentTurn !== userId) {
      return NextResponse.json({ error: 'Bukan giliran kamu' }, { status: 403 });
    }
    if (snakesState.isAnimating) {
      return NextResponse.json({ error: 'Papan sedang animasi' }, { status: 409 });
    }

    const frozenCount = snakesState.frozenTurns?.[userId] || 0;
    if (frozenCount > 0) {
      return NextResponse.json({ error: 'Kamu sedang terkena freeze', frozenCount }, { status: 403 });
    }

    const winners: string[] = snakesState.winners ?? (snakesState.winnerId ? [snakesState.winnerId] : []);
    if (winners.includes(userId)) {
      return NextResponse.json({ error: 'Kamu sudah finish' }, { status: 403 });
    }

    // Server-authoritative dice
    const finalDice = secureDice();

    const activeIds = activePlayerIds && activePlayerIds.length > 0
      ? activePlayerIds
      : Object.keys(snakesState.playerPositions || {});

    const currentPos = snakesState.playerPositions?.[userId] ?? 1;
    let steppedPos = currentPos + finalDice;
    if (steppedPos > 100) {
      steppedPos = 100 - (steppedPos - 100);
    }

    let finalPos = steppedPos;
    let eventMessage = '';
    let updatedObstacles: Partial<SnakesState> = {};
    const newFrozen = { ...(snakesState.frozenTurns || {}) };
    let specialHitType: 'snake' | 'wormhole' | 'ladder' | 'mine' | undefined;
    let hitSnake: SnakeItem | undefined;
    let hitWormhole: WormholePair | undefined;

    const ladderHit = snakesState.ladders?.find((l) => l.start === steppedPos);
    const snakeHit = snakesState.snakes?.find((s) => s.head === steppedPos);
    const mineHit = snakesState.mines?.includes(steppedPos);
    const wormholeHit = snakesState.wormholes?.find((w) => w.blackHole === steppedPos);

    // Generic subject only — never fabricate a player name from userId.
    // The message text stays identical across all clients (sync-safe).
    const playerLabel = 'Pemain';

    if (ladderHit) {
      finalPos = ladderHit.end;
      eventMessage = `🪜 ${playerLabel} memanjat tangga ke kotak ${finalPos}!`;
      updatedObstacles = relocateTriggeredItem(snakesState, 'ladder', ladderHit.id);
      specialHitType = 'ladder';
    } else if (snakeHit) {
      finalPos = snakeHit.tail;
      eventMessage = `🐍 ${playerLabel} dimakan ular meluncur ke kotak ${finalPos}!`;
      updatedObstacles = relocateTriggeredItem(snakesState, 'snake', snakeHit.id);
      specialHitType = 'snake';
      hitSnake = snakeHit;
    } else if (wormholeHit) {
      finalPos = wormholeHit.whiteHole;
      eventMessage = `🌀 ${playerLabel} tersedot Black Hole ke kotak ${finalPos}!`;
      updatedObstacles = relocateTriggeredItem(snakesState, 'wormhole', wormholeHit.id);
      specialHitType = 'wormhole';
      hitWormhole = wormholeHit;
    } else if (mineHit) {
      newFrozen[userId] = 3;
      eventMessage = `💣 ${playerLabel} terinjak Ranjau Capit! Terjebak 3 turn!`;
      updatedObstacles = relocateTriggeredItem(snakesState, 'mine', steppedPos);
      specialHitType = 'mine';
    }

    const hasWon = finalPos === 100;
    const newWinners = [...winners];
    if (hasWon && !newWinners.includes(userId)) newWinners.push(userId);

    // Determine next turn (mirror client logic: 6 gives extra turn unless mine hit)
    let nextTurnId = userId;
    const remainingUnfinished = activeIds.filter((id) => !newWinners.includes(id));
    if (remainingUnfinished.length > 0) {
      if (hasWon) {
        nextTurnId = remainingUnfinished[0];
      } else if (finalDice !== 6 || mineHit) {
        const curIdx = remainingUnfinished.indexOf(userId);
        const nextIdx = curIdx >= 0 ? (curIdx + 1) % remainingUnfinished.length : 0;
        nextTurnId = remainingUnfinished[nextIdx];
      } else {
        // extra turn on 6
        nextTurnId = userId;
      }
    }

    const currentRevision = typeof snakesState.revision === 'number' ? snakesState.revision : 0;
    const newRevision = currentRevision + 1;

    const actionPayload = {
      id: `${userId}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
      userId,
      dice: finalDice,
      startPos: currentPos,
      steppedPos,
      finalPos,
      specialHitType,
      hitSnake,
      hitWormhole,
      eventMessage,
      timestamp: Date.now(),
    };

    // Construct authoritative full new state
    const newSnakesState: SnakesState = {
      ...snakesState,
      ...updatedObstacles,
      diceValue: finalDice,
      playerPositions: {
        ...snakesState.playerPositions,
        [userId]: finalPos,
      },
      currentTurnUserId: nextTurnId,
      winnerId: newWinners[0] || snakesState.winnerId || null,
      winners: newWinners,
      frozenTurns: newFrozen,
      isAnimating: false,
      isRolling: false,
      revision: newRevision,
      // Keep lastAction at top level for broadcast convenience (will be merged)
    } as SnakesState & { lastAction: typeof actionPayload };

    // Attach lastAction for broadcast (not part of SnakesState type but used as Extended)
    (newSnakesState as unknown as Record<string, unknown>).lastAction = actionPayload;

    return NextResponse.json({
      success: true,
      dice: finalDice,
      startPos: currentPos,
      steppedPos,
      finalPos,
      hasWon,
      nextTurnId,
      newWinners,
      newFrozen,
      updatedObstacles,
      actionPayload,
      isExtraTurn: finalDice === 6 && !hasWon && !mineHit,
      newRevision,
      newSnakesState,
    });
  } catch (e) {
    console.error('snakes-roll error', e);
    return NextResponse.json({ error: 'Gagal memproses lemparan dadu' }, { status: 500 });
  }
}
