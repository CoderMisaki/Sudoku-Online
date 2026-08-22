import crypto from 'crypto';
import { Grid, CellData } from '../types/game';

// 1. Inisialisasi Master Fallback Key di level memori server runtime
let runtimeMasterSecret: string | null = null;

function getRuntimeFallbackSecret(): string {
  if (!runtimeMasterSecret) {
    // Generate 256-bit entropy buffer aman
    runtimeMasterSecret = crypto.randomBytes(32).toString('hex');
  }
  return runtimeMasterSecret;
}

export function getSecretKey(): string {
  // Alur: Fallback Master Ready -> Cek ENV -> Jika Error/Invalid -> Balik ke Fallback
  try {
    const envSecret = process.env.ROOM_SECRET_KEY;
    if (envSecret && envSecret.trim().length >= 16) {
      return envSecret.trim();
    }
  } catch (err) {
    console.warn('[Security] Gagal membaca ROOM_SECRET_KEY dari env, beralih ke dynamic fallback.', err);
  }

  return getRuntimeFallbackSecret();
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
