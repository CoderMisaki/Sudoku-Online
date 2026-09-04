import { NextResponse, NextRequest } from 'next/server';

function generateNonce(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  let bin = '';
  arr.forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

/**
 * Next.js 16 renamed `middleware.ts` -> `proxy.ts`.
 * Adds a per-request nonce based Content-Security-Policy.
 */
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const isDev = process.env.NODE_ENV !== 'production';

  const directives: string[] = [
    "default-src 'self'",
    // Dev needs eval (react refresh / turbopack); prod is nonce based + strict-dynamic
    isDev
      ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
      : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https:`,
    // Tailwind injects inline styles at runtime
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    isDev
      ? "connect-src 'self' https://*.supabase.co wss://*.supabase.co ws: wss:"
      : "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'self' data: blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // Dev/preview must stay embeddable (Arena live preview iframe); prod is locked down.
    isDev ? 'frame-ancestors *' : "frame-ancestors 'none'",
  ];

  if (!isDev) directives.push('upgrade-insecure-requests');

  const csp = directives.join('; ');

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('x-nonce', nonce);
  return response;
}

export const config = {
  matcher: [
    // Everything except static assets & image optimizer (they need no CSP nonce)
    {
      source: '/((?!_next/static|_next/image|favicon.ico|icon-192.png|icon-512.png|manifest.json|sw.js).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
