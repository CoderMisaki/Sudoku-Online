import { NextResponse } from 'next/server';
import { z } from 'zod';
import { decryptSolution } from '../../../../utils/security';
import { checkServerRateLimit, validateSameOrigin, getClientIp } from '../../../../utils/serverSecurity';

const verifySchema = z.object({
  row: z.number().int().min(0).max(8),
  col: z.number().int().min(0).max(8),
  value: z.number().int().min(1).max(9),
  solutionToken: z.string().min(20),
  roomId: z.string().min(3).max(16).optional(),
});

export async function POST(request: Request) {
  try {
    if (!validateSameOrigin(request)) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    const ip = getClientIp(request);
    // Rate limit cepat (45 verifikasi per 10 detik) untuk mendukung fast-typing/burst move
    if (!(await checkServerRateLimit(`verify:${ip}`, 45, 10000))) {
      return NextResponse.json({ error: 'Input terlalu cepat (Rate limited)' }, { status: 429 });
    }

    const body = await request.json();
    const validation = verifySchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 });
    }

    const { row, col, value, solutionToken, roomId } = validation.data;
    const solution = decryptSolution(solutionToken, { expectedRoomId: roomId });

    if (!solution) {
      return NextResponse.json(
        { error: 'Token room tidak valid atau sudah kedaluwarsa' },
        { status: 403 }
      );
    }

    const isCorrect = solution[row][col] === value;

    return NextResponse.json({ isCorrect });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
