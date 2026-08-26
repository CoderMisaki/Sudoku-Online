import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generatePuzzle } from '../../../../utils/sudoku';
import { encryptSolution } from '../../../../utils/security';
import { checkServerRateLimit, validateSameOrigin, getClientIp } from '../../../../utils/serverSecurity';
import { Difficulty } from '../../../../types/game';

const createRoomSchema = z.object({
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert', 'evil']).default('medium'),
  roomId: z.string().min(3).max(16).optional(),
});

export async function POST(request: Request) {
  try {
    if (!validateSameOrigin(request)) {
      return NextResponse.json({ error: 'Akses ditolak (Cross-Origin Blocked)' }, { status: 403 });
    }

    const ip = getClientIp(request);
    if (!(await checkServerRateLimit(`create:${ip}`, 30, 60000))) {
      return NextResponse.json({ error: 'Terlalu banyak permintaan room. Tunggu sebentar.' }, { status: 429 });
    }

    let difficulty: Difficulty = 'medium';
    let roomId: string | undefined;
    try {
      const body = await request.json();
      const validation = createRoomSchema.safeParse(body);
      if (validation.success) {
        difficulty = validation.data.difficulty as Difficulty;
        roomId = validation.data.roomId;
      }
    } catch {
      // Fallback ke default bila body kosong
    }

    const { initialGrid, solutionGrid } = generatePuzzle(difficulty);
    const solutionToken = encryptSolution(solutionGrid, { roomId });

    return NextResponse.json({
      success: true,
      initialGrid,
      solutionToken,
    });
  } catch (error) {
    console.error('Create Room Error:', error);
    return NextResponse.json({ error: 'Gagal membuat puzzle baru' }, { status: 500 });
  }
}
