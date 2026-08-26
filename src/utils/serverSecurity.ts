interface RateLimitRecord {
  timestamps: number[];
}

const rateLimitMap = new Map<string, RateLimitRecord>();

// Auto garbage collection setiap 5 menit untuk mencegah Memory Leak (fallback path)
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, record] of rateLimitMap.entries()) {
      record.timestamps = record.timestamps.filter(t => now - t < 120000);
      if (record.timestamps.length === 0) {
        rateLimitMap.delete(key);
      }
    }
  }, 300000);
}

// ---- Distributed Redis helper (Upstash) ----
let redisClient: { incr: (k: string) => Promise<number>; expire: (k: string, s: number) => Promise<unknown>; pexpire?: (k: string, ms: number) => Promise<unknown> } | null = null;
let redisInitDone = false;

function tryInitRedis(): void {
  if (redisInitDone) return;
  redisInitDone = true;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_TOKEN;
  if (!url || !token) return;
  try {
    // Lazy import to avoid bundling issues when env not set
    // Use Upstash REST via fetch — no persistent connection needed
    redisClient = {
      incr: async (k: string) => {
        const res = await fetch(`${url}/incr/${encodeURIComponent(k)}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        const data = (await res.json()) as { result?: number };
        return typeof data.result === 'number' ? data.result : 1;
      },
      expire: async (k: string, s: number) => {
        await fetch(`${url}/expire/${encodeURIComponent(k)}/${s}`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: 'no-store',
        });
        return 1;
      },
    };
  } catch {
    redisClient = null;
  }
}

function checkMemoryLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  let record = rateLimitMap.get(key);
  if (!record) {
    record = { timestamps: [] };
    rateLimitMap.set(key, record);
  }
  record.timestamps = record.timestamps.filter(t => now - t < windowMs);
  if (record.timestamps.length >= limit) return false;
  record.timestamps.push(now);
  return true;
}

/**
 * Sliding Window Server-Side Rate Limiter — distributed via Upstash Redis when
 * env vars are present, otherwise falls back to in-memory map.
 * Returns Promise<boolean> for compatibility with Redis path.
 */
export async function checkServerRateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  tryInitRedis();
  if (redisClient) {
    try {
      const redisKey = `ratelimit:${key}`;
      const count = await redisClient.incr(redisKey);
      if (count === 1) {
        // First hit — set TTL to window
        const ttlSec = Math.ceil(windowMs / 1000);
        await redisClient.expire(redisKey, ttlSec);
      }
      return count <= limit;
    } catch {
      // Redis failed — fallback to memory
      return checkMemoryLimit(key, limit, windowMs);
    }
  }
  return checkMemoryLimit(key, limit, windowMs);
}

/** Sync variant for call-sites that cannot await (fallback-only, no Redis) */
export function checkServerRateLimitSync(key: string, limit: number, windowMs: number): boolean {
  return checkMemoryLimit(key, limit, windowMs);
}

/**
 * Validasi Same-Origin & Anti-CSRF Guard
 */
export function validateSameOrigin(request: Request): boolean {
  const secFetchSite = request.headers.get('sec-fetch-site');
  if (secFetchSite && secFetchSite === 'cross-site') {
    return false;
  }

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');

  if (!origin || !host) return true; // Request non-browser atau direct same-origin

  try {
    const originUrl = new URL(origin);
    return originUrl.host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Ekstraksi Client IP
 */
export function getClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || '127.0.0.1';
}
