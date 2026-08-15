import { NextResponse } from 'next/server';
import { decryptSolution } from '../../../../utils/security';

export async function POST(request: Request) {
  try {
    const { row, col, value, solutionToken } = await request.json();

    if (typeof row !== 'number' || typeof col !== 'number' || typeof value !== 'number' || !solutionToken) {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 });
    }

    const solution = decryptSolution(solutionToken);
    if (!solution) {
      return NextResponse.json({ error: 'Token room tidak valid atau sudah kedaluwarsa' }, { status: 403 });
    }

    const isCorrect = solution[row][col] === value;

    return NextResponse.json({ isCorrect });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
