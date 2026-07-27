import { NextResponse } from 'next/server';
import crypto from 'crypto';

const SECRET_KEY = process.env.ROOM_SECRET_KEY || 'sudoku-together-secret-key-2026';

// Dekripsi token jawaban secara aman di Node.js runtime
export function decryptSolution(token: string): number[][] | null {
  try {
    const textParts = token.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(SECRET_KEY.padEnd(32, '0').slice(0, 32)), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString());
  } catch (err) {
    return null;
  }
}

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
  } catch (error) {
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
