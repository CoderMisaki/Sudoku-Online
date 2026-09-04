2024-05-24 - [Initial Sentinel File]
Created sentinel file to track security learnings and vulnerabilities.

2024-05-24 - [In-Memory Rate Limiter in Serverless Environment]
Issue: `checkServerRateLimit` uses local memory, which means in a serverless deployment each instance has a separate limit, allowing attackers to bypass limits via burst connections.
Recommendation: Use a distributed rate limiter like Redis (e.g., Upstash Redis) at the edge.

2024-05-24 - [CSP Allows Unsafe Directives]
Issue: `next.config.ts` headers allow 'unsafe-eval' and 'unsafe-inline'.
Recommendation: Implement nonce-based CSP for stronger XSS protection.

2024-05-24 - [Lack of Expiration on Solution Token]
Issue: If a `solutionToken` is intercepted, it can be reused indefinitely because it lacks timestamp or room lifetime metadata.

2024-05-24 - [Dice Manipulation Vulnerability in Snakes & Ladders]
Issue: Dice calculation and target position logic in `SnakesAndLaddersBoard.tsx` are calculated client-side and then broadcasted. Attackers can modify the client code to always roll 6 or jump to 100.
Recommendation: Move dice rolling logic to a server-side Next.js API Route or Supabase Edge Function to calculate the roll, verify the turn, and broadcast the result.

2024-05-24 - [Type-Casting Minor in Zustand Store]
Issue: `(useGameStore as any).persist?.clearStorage?.()` is used, bypassing type safety.
Recommendation: Create a typed helper method like `clearStorage()` within the gameStore interface.

2026-07-26 - [Realtime WebSocket Room Synchronization & Orphan Host Handshake]
Issue: Guest players joining a room could experience race conditions where `REQUEST_SYNC` was sent before channel subscription completion or when host presence had dropped without migrating host status, causing guests to get stuck on loading screens.
Recommendation: Implement two-way handshakes with immediate `sync_state` emission upon `SUBSCRIBED` and presence `join` events, include game-mode-aware state polling in guest retry loops, and implement orphan room host promotion fallbacks when no active host presence is detected.

2026-07-26 - [Dynamic Cryptographic Secret Fallback for Room Encryption]
Issue: Hard enforcement of `ROOM_SECRET_KEY` in environment variables caused 500 API crashes and infinite React re-render loops (#185) on deployments missing env configuration.
Recommendation: Generate a dynamic 256-bit runtime master entropy buffer using `crypto.randomBytes` and `crypto.createHash` as a secure fallback when `ROOM_SECRET_KEY` is omitted, while retaining AES-256-GCM authenticated encryption.

2026-09-04 - [Nonce-based CSP Enabled via proxy.ts Matcher]
Issue: `proxy.ts` built a CSP but its `config.matcher` was commented out, so no Content-Security-Policy header was ever emitted.
Resolution: Enabled the matcher (excluding static assets), added `strict-dynamic` + `upgrade-insecure-requests` in production, and kept `frame-ancestors *` / no `X-Frame-Options` in development only so local and sandbox previews stay embeddable.

2026-09-04 - [Solution Token Expiry Hardening]
Issue: Tokens without `expiresAt` were silently granted a fresh 6h TTL at decrypt time, and room-scoped tokens could be redeemed by callers that omitted `roomId`.
Resolution: Default TTL lowered to 2h with a 12h hard ceiling, legacy tokens lacking lifetime metadata are rejected, future-dated `timestamp` beyond 5m skew is rejected, and a token carrying a `roomId` now REQUIRES the caller to present a matching `expectedRoomId`. Master key reads `ROOM_SECRET_KEY` first, falling back to the built-in constant.

2026-09-04 - [Competition Mode Information Leak]
Issue: In `competition` mode each player solves their own puzzle, yet the host broadcast its `grid`/`solutionToken` via `sync_state`, and peers received opponents' answer toasts, cursor positions and cell locks.
Resolution: `sync_state` omits grid/solutionToken for competition rooms (and receivers refuse to adopt them), and `cell_move` toasts, `cursor_move` and `cell_lock` are all short-circuited. A new `player_stats` broadcast carries only score/progress/rank so the leaderboard still works without exposing board contents.
