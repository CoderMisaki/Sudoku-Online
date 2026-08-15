import crypto from 'crypto';

function getSecretKey(): Buffer {
  const SECRET_KEY = process.env.ROOM_SECRET_KEY;

  if (!SECRET_KEY || SECRET_KEY.length < 32) {
    throw new Error('ROOM_SECRET_KEY wajib diisi dan minimal 32 karakter');
  }

  // Derive a proper 32-byte key
  const salt = crypto.createHash('sha256').update(SECRET_KEY).digest().slice(0, 16);
  return crypto.scryptSync(SECRET_KEY, salt, 32);
}

// Evaluated lazily to prevent Next.js build errors when ROOM_SECRET_KEY is not set in CI
let cachedKey: Buffer | null = null;
function getKey(): Buffer {
  if (!cachedKey) {
    cachedKey = getSecretKey();
  }
  return cachedKey;
}

export function encryptSolution(solution: number[][]): string {
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM standard IV size is 12 bytes
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(JSON.stringify(solution), 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');

  // Format: iv:authTag:ciphertext
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decryptSolution(token: string): number[][] | null {
  try {
    const key = getKey();
    const parts = token.split(':');
    if (parts.length === 2) {
      return null;
    }

    if (parts.length !== 3) return null;

    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return JSON.parse(decrypted);
  } catch {
    return null;
  }
}
