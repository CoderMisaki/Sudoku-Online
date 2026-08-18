import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // Rekomendasi standar GCM 96-bit
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const TOKEN_TTL_MS = 6 * 60 * 60 * 1000; // 6 Jam masa berlaku token

function getSecretKey(): string {
  const secret = process.env.ROOM_SECRET_KEY;
  if (!secret || secret.trim().length < 16) {
    throw new Error('CRITICAL SECURITY ERROR: ROOM_SECRET_KEY tidak disetel atau terlalu pendek di environment!');
  }
  return secret;
}

/**
 * Enkripsi solusi Sudoku menggunakan AES-256-GCM dengan Dynamic Scrypt KDF dan Anti-Replay Timestamp
 */
export function encryptSolution(solutionGrid: number[][]): string {
  const secret = getSecretKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const salt = crypto.randomBytes(SALT_LENGTH);
  const nonce = crypto.randomBytes(8).toString('hex'); // Unique random nonce per token

  // Derive 256-bit key menggunakan Scrypt
  const key = crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const payload = JSON.stringify({
    grid: solutionGrid,
    createdAt: Date.now(),
    nonce,
  });

  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format Token: salt:iv:authTag:encrypted (Base64 Safe)
  return [
    salt.toString('base64'),
    iv.toString('base64'),
    authTag.toString('base64'),
    encrypted.toString('base64'),
  ].join(':');
}

/**
 * Dekripsi & Validasi Solusi Sudoku dengan Timing-Safe Checks dan Anti-Replay Expiry
 */
export function decryptSolution(token: string): number[][] | null {
  try {
    if (!token || typeof token !== 'string') return null;

    const parts = token.split(':');
    if (parts.length !== 4) return null;

    const [saltB64, ivB64, tagB64, encB64] = parts;
    const salt = Buffer.from(saltB64, 'base64');
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(tagB64, 'base64');
    const encrypted = Buffer.from(encB64, 'base64');

    if (iv.length !== IV_LENGTH || authTag.length !== TAG_LENGTH || salt.length !== SALT_LENGTH) {
      return null;
    }

    const secret = getSecretKey();
    const key = crypto.scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString('utf8'));

    // Anti-Replay: Validasi masa kadaluwarsa token
    if (!parsed.createdAt || typeof parsed.createdAt !== 'number') return null;
    if (Date.now() - parsed.createdAt > TOKEN_TTL_MS || parsed.createdAt > Date.now() + 60000) {
      return null; // Token expired atau manipulasi waktu masa depan
    }

    if (!Array.isArray(parsed.grid) || parsed.grid.length !== 9) return null;

    return parsed.grid;
  } catch {
    // Fail-closed jika terjadi modifikasi / tag mismatch
    return null;
  }
}
