import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const SALT = 'sudoku-secret-salt-secure-hash';
const TOKEN_MAX_AGE_MS = 1000 * 60 * 60 * 6; // Token berlaku maksimal 6 jam

function getDerivedKey(): Buffer {
  const secret = process.env.ROOM_SECRET_KEY;
  if (!secret || secret.length < 16) {
    throw new Error('ROOM_SECRET_KEY wajib disetel di environment variable (min 16 karakter).');
  }
  return crypto.scryptSync(secret, SALT, 32);
}

interface EncryptedPayload {
  solution: number[][];
  createdAt: number;
}

export function encryptSolution(solutionGrid: number[][]): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const payload: EncryptedPayload = {
    solution: solutionGrid,
    createdAt: Date.now(),
  };

  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  // Format: iv:authTag:encryptedData (Hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSolution(token: string): number[][] | null {
  try {
    const parts = token.split(':');
    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getDerivedKey();
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encryptedText = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(encryptedText),
      decipher.final(),
    ]);

    const payload: EncryptedPayload = JSON.parse(decrypted.toString('utf8'));

    // Anti-Replay: Validasi umur token
    if (Date.now() - payload.createdAt > TOKEN_MAX_AGE_MS) {
      return null;
    }

    return payload.solution;
  } catch {
    return null;
  }
}
