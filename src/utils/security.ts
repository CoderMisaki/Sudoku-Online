import crypto from 'crypto';

let runtimeEntropyFallback: string | null = null;

export function getSecretKey(): string {
  const envSecret = process.env.ROOM_SECRET_KEY;
  if (envSecret && envSecret.trim().length >= 16) {
    return envSecret.trim();
  }

  // Fallback aman untuk local dev / unconfigured serverless instance
  if (!runtimeEntropyFallback) {
    runtimeEntropyFallback = crypto.randomBytes(32).toString('hex');
    console.warn('[Security] ROOM_SECRET_KEY tidak disetel. Menggunakan dynamic runtime master key fallback.');
  }

  return runtimeEntropyFallback;
}

function getMasterKey(): Buffer {
  const secret = getSecretKey();
  return crypto.createHash('sha256').update(secret).digest();
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
