import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generatePuzzle } from '../../../../utils/sudoku';
import { encryptSolution } from '../../../../utils/security';
import { checkServerRateLimit, validateSameOrigin, getClientIp } from '../../../../utils/serverSecurity';
import { Difficulty } from '../../../../types/game';

const createRoomSchema = z.object({
  difficulty: z.enum(['easy', 'medium', 'hard', 'expert', 'evil']),
});

export async function POST(request: Request) {
  try {
    if (!validateSameOrigin(request)) {
      return NextResponse.json({ error: 'Akses ditolak (Cross-Origin Request Blocked)' }, { status: 403 });
    }

    const ip = getClientIp(request);
    // Maksimal 12 room per 1 menit per IP
    if (!checkServerRateLimit(`create:${ip}`, 12, 60000)) {
      return NextResponse.json({ error: 'Terlalu banyak membuat room. Tunggu sebentar.' }, { status: 429 });
    }

    const body = await request.json();
    const validation = createRoomSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Tingkat kesulitan tidak valid' }, { status: 400 });
    }

    const { difficulty } = validation.data;
    const { initialGrid, solutionGrid } = generatePuzzle(difficulty as Difficulty);
    const solutionToken = encryptSolution(solutionGrid);

    return NextResponse.json({
      initialGrid,
      solutionToken,
    });
  } catch (error) {
    console.error('Create Room Error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
