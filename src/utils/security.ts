import crypto from 'crypto';
import { Grid, CellData } from '../types/game';

// Fallback Key 2 (Hardcoded default master secret)
const FALLBACK_SECRET_KEY_2 = 'sudoku-multiplayer-hardcoded-master-fallback-key-2026-secure';

// Dynamic in-memory key jika kedua env kosong
let dynamicRuntimeKey: Buffer | null = null;

/**
 * Mengambil key 32-byte (256-bit) yang selalu valid untuk AES-256-GCM.
 * Prioritas:
 * 1. process.env.ROOM_SECRET_KEY (Key 1 - Env Utama)
 * 2. process.env.ROOM_SECRET_KEY2 (Key 2 - Env Cadangan)
 * 3. FALLBACK_SECRET_KEY_2 + Runtime Hash (Hardcoded / Auto-Generated Fallback)
 */
function getSecretKey(): Buffer {
  const envKey1 = process.env.ROOM_SECRET_KEY;
  const envKey2 = process.env.ROOM_SECRET_KEY2;

  let rawKey: string;

  if (envKey1 && envKey1.trim().length >= 16) {
    rawKey = envKey1.trim();
  } else if (envKey2 && envKey2.trim().length >= 16) {
    rawKey = envKey2.trim();
  } else {
    // Fallback otomatis jika env tidak terpasang
    if (!dynamicRuntimeKey) {
      // Buat entropy acak yang aman (crypto-secure) digabung fallback key
      const randomEntropy = crypto.randomBytes(32).toString('hex');
      dynamicRuntimeKey = crypto
        .createHash('sha256')
        .update(`${FALLBACK_SECRET_KEY_2}:${randomEntropy}`)
        .digest();
    }
    return dynamicRuntimeKey;
  }

  // Hash key input ke SHA-256 agar selalu tepat 32 bytes (256-bit) untuk AES-256-GCM
  return crypto.createHash('sha256').update(rawKey).digest();
}

/**
 * Enkripsi Solusi Sudoku Grid menggunakan AES-256-GCM
 */
export function encryptSolution(solutionGrid: Grid | number[][]): string {
  try {
    const key = getSecretKey();
    const iv = crypto.randomBytes(12); // 12 bytes IV standar untuk AES-GCM
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

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

    // Format token: iv:authTag:encryptedData
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
  } catch (error) {
    console.error('[Security] Gagal mengenkripsi solusi:', error);
    // Fallback darurat: Encode base64 aman agar flow room tetap jalan
    return Buffer.from(JSON.stringify(solutionGrid)).toString('base64');
  }
}

/**
 * Dekripsi Solusi Sudoku Grid menggunakan AES-256-GCM
 */
export function decryptSolution(token: string): (number | null)[][] | null {
  try {
    if (!token) return null;

    // Cek format AES-256-GCM (iv:authTag:encrypted)
    const parts = token.split(':');
    if (parts.length === 3) {
      const [ivHex, authTagHex, encryptedHex] = parts;
      const key = getSecretKey();
      const iv = Buffer.from(ivHex, 'hex');
      const authTag = Buffer.from(authTagHex, 'hex');

      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAuthTag(authTag);

      let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return JSON.parse(decrypted);
    }

    // Fallback dekripsi jika token berupa base64
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    return JSON.parse(decoded);
  } catch (error) {
    console.error('[Security] Gagal mendekripsi token:', error);
    return null;
  }
}
