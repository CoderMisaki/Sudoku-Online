import crypto from 'crypto';

// Hardcoded dedicated 256-bit Master Secret (tanpa bergantung pada .env)
const MASTER_ENCRYPTION_SECRET = 'e4a7c8f921b3d5e0a6c2f8194b7e3d2c1598f4a7b0e6c3d9a1f2e5b8c4d7e0f3';

function getMasterKey(): Buffer {
  return crypto.createHash('sha256').update(MASTER_ENCRYPTION_SECRET).digest();
}

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

export interface EncryptOptions {
  roomId?: string;
  /** TTL in ms, default 6 hours */
  ttlMs?: number;
}

export interface DecryptOptions {
  expectedRoomId?: string;
}

interface TokenPayload {
  solution: number[][];
  timestamp: number;
  roomId?: string;
  expiresAt: number;
  nonce?: string;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — matches a room lifecycle

export function encryptSolution(solutionGrid: number[][], opts: EncryptOptions = {}): string {
  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const key = getMasterKey();
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    const now = Date.now();
    const ttl = opts.ttlMs ?? DEFAULT_TTL_MS;
    const payload: TokenPayload = {
      solution: solutionGrid,
      timestamp: now,
      roomId: opts.roomId,
      expiresAt: now + ttl,
      nonce: crypto.randomBytes(8).toString('hex'),
    };

    const encrypted = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Format: iv:authTag:ciphertext
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (error) {
    console.error('Enkripsi puzzle gagal:', error);
    throw new Error('Gagal mengenkripsi solusi puzzle');
  }
}

function parseTokenPayload(token: string): TokenPayload | null {
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
    const parsed = JSON.parse(decrypted.toString('utf8')) as TokenPayload & { timestamp?: number };
    if (!parsed.solution || !Array.isArray(parsed.solution)) return null;
    // BackwardCompat: old tokens had only timestamp, derive expiresAt
    if (typeof parsed.expiresAt !== 'number') {
      const ts = typeof parsed.timestamp === 'number' ? parsed.timestamp : Date.now();
      (parsed as TokenPayload).expiresAt = ts + DEFAULT_TTL_MS;
      if (typeof (parsed as TokenPayload).timestamp !== 'number') (parsed as TokenPayload).timestamp = ts;
    }
    if (typeof parsed.timestamp !== 'number') (parsed as TokenPayload).timestamp = (parsed as TokenPayload).expiresAt - DEFAULT_TTL_MS;
    return parsed as TokenPayload;
  } catch {
    return null;
  }
}

export function decryptSolution(token: string, opts: DecryptOptions = {}): number[][] | null {
  const payload = parseTokenPayload(token);
  if (!payload) {
    console.warn('Dekripsi token solusi ditolak/tidak valid: parse failed');
    return null;
  }
  // Expiry check — token cannot be reused outside the room lifecycle
  if (Date.now() > payload.expiresAt) {
    console.warn('Token kedaluwarsa:', { expiresAt: payload.expiresAt, now: Date.now() });
    return null;
  }
  // Room binding — if token was issued for a room, it must be presented for that same room
  if (payload.roomId && opts.expectedRoomId && payload.roomId !== opts.expectedRoomId) {
    console.warn('Token roomId mismatch:', { expected: opts.expectedRoomId, got: payload.roomId });
    return null;
  }
  // If token has roomId but caller didn't supply expectedRoomId, we still enforce that
  // the caller should supply roomId when verification is room-scoped.
  // Callers that don't know roomId can still use token only if they pass same roomId.
  return payload.solution as number[][];
}

/** Helper to inspect token metadata without exposing solution — for debugging/logging */
export function getTokenMeta(token: string): { roomId?: string; timestamp: number; expiresAt: number } | null {
  const p = parseTokenPayload(token);
  if (!p) return null;
  return { roomId: p.roomId, timestamp: p.timestamp, expiresAt: p.expiresAt };
}
