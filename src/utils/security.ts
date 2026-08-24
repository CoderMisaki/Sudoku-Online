import crypto from 'crypto';

// Hardcoded dedicated 256-bit Master Secret (tanpa bergantung pada .env)
const MASTER_ENCRYPTION_SECRET = 'e4a7c8f921b3d5e0a6c2f8194b7e3d2c1598f4a7b0e6c3d9a1f2e5b8c4d7e0f3';

function getMasterKey(): Buffer {
  return crypto.createHash('sha256').update(MASTER_ENCRYPTION_SECRET).digest();
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export function encryptSolution(solutionGrid: number[][]): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getMasterKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const payload = JSON.stringify({
      solution: solutionGrid,
      timestamp: Date.now(),
    });

    const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (error) {
    console.error('Enkripsi puzzle gagal:', error);
    throw new Error('Gagal mengenkripsi solusi puzzle');
  }
}

export function decryptSolution(token: string): number[][] | null {
  try {
    const parts = token.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    if (iv.length !== IV_LENGTH || authTag.length !== 16) return null;

    const key = getMasterKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString('utf8'));

    return parsed.solution as number[][];
  } catch (error) {
    console.warn('Dekripsi token solusi ditolak/tidak valid:', error);
    return null;
  }
}
