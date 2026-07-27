import { NextResponse } from 'next/server';
import { decryptSolution } from '../verify/route';

export async function POST(request: Request) {
  try {
    const { row, col, solutionToken } = await request.json();

    if (typeof row !== 'number' || typeof col !== 'number' || !solutionToken) {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 });
    }

    const solution = decryptSolution(solutionToken);
    if (!solution) {
      return NextResponse.json({ error: 'Token room tidak valid atau sudah kedaluwarsa' }, { status: 403 });
    }

    const value = solution[row][col];

    return NextResponse.json({ value });
  } catch {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
