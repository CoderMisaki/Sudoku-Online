import { NextResponse } from 'next/server';
import { z } from 'zod';
import { decryptSolution } from '../../../../utils/security';
import { checkServerRateLimit, validateSameOrigin, getClientIp } from '../../../../utils/serverSecurity';

const hintSchema = z.object({
  row: z.number().int().min(0).max(8),
  col: z.number().int().min(0).max(8),
  solutionToken: z.string().min(20),
  roomId: z.string().min(3).max(16).optional(),
});

export async function POST(request: Request) {
  try {
    if (!validateSameOrigin(request)) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }

    const ip = getClientIp(request);
    // Maksimal 15 hint per 30 detik
    if (!(await checkServerRateLimit(`hint:${ip}`, 15, 30000))) {
      return NextResponse.json({ error: 'Terlalu banyak permintaan hint' }, { status: 429 });
    }

    const body = await request.json();
    const validation = hintSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 });
    }

    const { row, col, solutionToken, roomId } = validation.data;
    const solution = decryptSolution(solutionToken, { expectedRoomId: roomId });

    if (!solution) {
      return NextResponse.json(
        { error: 'Token room tidak valid atau sudah kedaluwarsa' },
        { status: 403 }
      );
    }

    const value = solution[row][col];
    return NextResponse.json({ value });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
