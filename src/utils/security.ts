import crypto from 'crypto';
import { Grid, CellData } from '../types/game';

let runtimeSecret: string | null = null;

export function getSecretKey(): string {
  const secret = process.env.ROOM_SECRET_KEY;
  if (secret && secret.trim().length >= 16) {
    return secret;
  }
  if (!runtimeSecret) {
    runtimeSecret = crypto.randomBytes(32).toString('hex');
  }
  return runtimeSecret;
}

const ALGORITHM = 'aes-256-gcm';

export function encryptSolution(solutionGrid: Grid | number[][]): string {
  try {
    const secret = getSecretKey();
    const key = crypto.createHash('sha256').update(secret).digest();
    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const textData = JSON.stringify(
      solutionGrid.map((row: CellData[] | number[]) =>
        row.map((cell: CellData | number) =>
          cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell
        )
      )
    );

    let encrypted = cipher.update(textData, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag().toString('hex');

    // Format: iv:encryptedData:authTag
    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
  } catch (error) {
    console.error('[Security] Gagal mengenkripsi solution:', error);
    throw error;
  }
}

export function decryptSolution(token: string): (number | null)[][] | null {
  try {
    if (!token) return null;

    const secret = getSecretKey();
    const key = crypto.createHash('sha256').update(secret).digest();

    const parts = token.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, encryptedHex, authTagHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('[Security] Gagal mendeskripsi token:', error);
    return null;
  }
}
