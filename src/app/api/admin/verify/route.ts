import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { z } from 'zod';
import { checkServerRateLimit, getClientIp, validateSameOrigin } from '@/utils/serverSecurity';

// SHA256("Operatorqq") — server-side only, never exposed to client bundle
const DEFAULT_HASH_HEX = '587b322059a2d04ef424fbfce773f95f032d2919181cc44d443bbd3c7fe3a79b';
// Optional override via env: ADMIN_PASSWORD_HASH (hex) or ADMIN_PASSWORD (plain, will be hashed)
function getExpectedHash(): string {
  const envHash = process.env.ADMIN_PASSWORD_HASH;
  if (envHash && /^[a-f0-9]{64}$/i.test(envHash.trim())) return envHash.trim().toLowerCase();
  const envPlain = process.env.ADMIN_PASSWORD;
  if (envPlain) return crypto.createHash('sha256').update(envPlain).digest('hex');
  return DEFAULT_HASH_HEX;
}

const schema = z.object({
  username: z.string().min(1).max(32).optional(),
  password: z.string().min(1).max(64),
});

export async function POST(request: Request) {
  try {
    if (!validateSameOrigin(request)) {
      return NextResponse.json({ error: 'Akses ditolak' }, { status: 403 });
    }
    const ip = getClientIp(request);
    // Rate limit brute force: 10 per menit per IP
    if (!(await checkServerRateLimit(`admin-verify:${ip}`, 10, 60000))) {
      return NextResponse.json({ error: 'Terlalu banyak percobaan' }, { status: 429 });
    }

    const body = await request.json().catch(() => null);
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Payload tidak valid' }, { status: 400 });
    }

    const { username, password } = parsed.data;

    // Only ADMIN username is allowed to attempt
    if (username && username.toUpperCase() !== 'ADMIN') {
      return NextResponse.json({ ok: false, error: 'Username bukan Admin' }, { status: 403 });
    }

    const expectedHex = getExpectedHash();
    const inputHex = crypto.createHash('sha256').update(password).digest('hex');

    // timingSafeEqual to prevent timing attacks
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    const inputBuf = Buffer.from(inputHex, 'hex');
    let isMatch = false;
    if (expectedBuf.length === inputBuf.length) {
      isMatch = crypto.timingSafeEqual(expectedBuf, inputBuf);
    }

    // Add tiny artificial delay to further obscure timing
    await new Promise((r) => setTimeout(r, 120));

    if (!isMatch) {
      return NextResponse.json({ ok: false, error: 'Password salah' }, { status: 401 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('admin verify error', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
