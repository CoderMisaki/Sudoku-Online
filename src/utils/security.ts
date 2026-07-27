import crypto from 'crypto';

const SECRET_KEY = process.env.ROOM_SECRET_KEY || 'sudoku-together-secret-key-2026';

export function encryptSolution(solution: number[][]): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(SECRET_KEY.padEnd(32, '0').slice(0, 32)), iv);
  let encrypted = cipher.update(JSON.stringify(solution));
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}
