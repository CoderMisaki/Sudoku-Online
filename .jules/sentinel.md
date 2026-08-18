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
