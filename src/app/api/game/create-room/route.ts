import { NextResponse } from 'next/server';
import { generatePuzzle } from '../../../../utils/sudoku';
import { encryptSolution } from '../../../../utils/security';
import { Difficulty } from '../../../../types/game';

export async function POST(request: Request) {
  try {
    const { difficulty } = await request.json();

    if (!difficulty) {
      return NextResponse.json({ error: 'Difficulty is required' }, { status: 400 });
    }

    const { initialGrid, solutionGrid } = generatePuzzle(difficulty as Difficulty);
    const solutionToken = encryptSolution(solutionGrid);

    return NextResponse.json({
      initialGrid,
      solutionToken,
    });
  } catch (error) {
    console.error('Failed to create room:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
