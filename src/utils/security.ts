import crypto from 'crypto';
import { Grid, CellData } from '../types/game';

// Kunci internal dinamis berbasis random entropy saat runtime server berjalan
const RUNTIME_SALT = crypto.randomBytes(32);
const MASTER_ENTROPY = crypto.createHash('sha512').update(RUNTIME_SALT).digest();
const CIPHER_ALGO = 'aes-256-gcm';

function getDynamicSecretKey(): Buffer {
  // Menghasilkan key 256-bit kuat secara otomatis
  const envKey = process.env.ROOM_SECRET_KEY;
  if (envKey && envKey.trim().length >= 16) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  return MASTER_ENTROPY.subarray(0, 32);
}

/**
 * Mengenkripsi solution grid menjadi token aman tamper-proof (AES-256-GCM)
 */
export function encryptSolution(solutionGrid: Grid | number[][]): string {
  try {
    const key = getDynamicSecretKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(CIPHER_ALGO, key, iv);

    const serializedData = JSON.stringify(
      solutionGrid.map((row: CellData[] | number[]) =>
        row.map((cell: CellData | number) =>
          cell && typeof cell === 'object' && 'value' in cell ? cell.value : cell
        )
      )
    );

    let encrypted = cipher.update(serializedData, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    // Format: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('Encryption Error:', error);
    throw new Error('Gagal mengenkripsi data solusi');
  }
}

/**
 * Mendekripsi token solusi dan mengembalikan matriks angka
 */
export function decryptSolution(token: string): (number | null)[][] | null {
  try {
    const parts = token.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getDynamicSecretKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv(CIPHER_ALGO, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch (error) {
    console.error('Decryption Error:', error);
    return null;
  }
}
