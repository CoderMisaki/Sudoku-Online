# Harvest Moon — Orientation, PWA & Reconnect Architecture

This document is the authoritative reference for how the game handles
**screen orientation**, **installed-PWA launch**, and **WebSocket recovery**.
Read it before touching `src/harvest/orientation.ts`, `src/harvest/sync.ts`,
`src/harvest/session.ts`, `src/harvest/overlay.ts` or `src/harvest/Screens.tsx`.

---

## 1. Root causes that were fixed

| # | Symptom | Root cause | Fix |
|---|---------|-----------|-----|
| 1 | PWA opens in portrait and stays on "Mode Landscape Dibutuhkan" | The client called `screen.orientation.unlock()` on mount and the manifest said `"orientation": "any"` — nothing ever asked the platform for landscape | Removed `unlock()`. Tiered landscape strategy: manifest (`/manifest.harvest.json` → `"orientation": "landscape"`) → runtime `screen.orientation.lock('landscape')` → gate fallback |
| 2 | Stuck on "Menghubungkan Kembali…" after rotating | Rotation was treated as a *passive* signal: `ensureOpen()` returns immediately once the automatic retry budget is exhausted, so nothing ever retried. Meanwhile background-throttled heartbeats marked live sockets as unhealthy and forced needless reconnects | One recovery coordinator (`HarvestSession.recover`). Explicit resume signals (rotation into landscape, foreground, `online`, manual) always get a **fresh handshake** when the socket is unusable *or* the budget is exhausted; healthy sockets are **probed**, not torn down |
| 3 | "Coba Sambungkan Lagi" sometimes did nothing | The button called `forceReconnect()` while a stale retry timer / half-dead socket could still own the state; stale socket callbacks (and stale retry timers) could mutate state after a new socket existed | Socket **generation guard**: every socket, callback and timer carries a generation id; anything stale is inert. Manual retry cancels all timers, destroys the socket, resets the budget and opens exactly one fresh socket |
| 4 | Game canvas disappeared / never became visible | The canvas host `<div>` was rendered in two different positions (`loading|creator` vs `game`), so React unmounted the element the WebGL canvas was attached to on every screen transition. `setWorld()` also stacked a second copy of the scenery on every resync | One **persistent** canvas host + `WorldEngine.attachTo(host)` (re-attach, never rebuild) + `setWorld()` clears previous world visuals first (idempotent snapshots) |
| 5 | Loading overlay could hang forever | The UI treated "socket OPEN" as connected, and a handshake without a snapshot simply waited | `ready` is only emitted after `hello_ack`/`snapshot`; a snapshot watchdog resyncs (bounded) and then surfaces an actionable **FAILED** state; `overlay.ts` is the single truth for what covers the screen |
| 6 | Colourful orientation/reconnect screens | Hard-coded emerald/amber gradients | `Screens.tsx` is strictly monochrome and driven by the existing theme tokens (`--background`, `--card`, `--border`, `--foreground`, `--secondary`) so dark **and** light mode stay neutral |

---

## 2. Orientation strategy (tiered, never a hard dependency)

```
PWA manifest  ──►  runtime lock  ──►  OrientationGate (fallback)
   (tier 1)          (tier 2)             (tier 3)
```

1. **Manifest** — `/manifest.harvest.json` declares `"orientation": "landscape"`
   and is linked from `src/app/harvest/layout.tsx`. Installing the game from any
   `/harvest/*` URL therefore yields a PWA that Android launches already
   rotated. The root `/manifest.json` intentionally stays `"orientation": "any"`
   so the Sudoku lobby is never forced to rotate.
2. **Runtime lock** — `requestLandscapeLock()` (`orientation.ts`) calls
   `screen.orientation.lock('landscape')` (falling back to
   `'landscape-primary'`) on phones/tablets only. It is *fire-and-forget*:
   `locked | denied | unsupported | idle`. **`unlock()` is never called.**
3. **Gate** — when the platform refuses (iOS Safari, Firefox, plain browser tabs
   without fullscreen) the compact monochrome `OrientationGate` is shown. It
   never blocks the network layer: the handshake, snapshot and world keep
   running behind it, so rotating immediately reveals a live game.

Device classes:

| class | detection | gate | lock |
|-------|-----------|------|------|
| `desktop` | no touch points | never | never |
| `tablet` | touch + short side ≥ 600px | portrait only | attempted |
| `phone` | touch + short side < 600px | portrait only | attempted |

Detection is **dimensions-first** (`isLandscapeDevice()`): live viewport
(`innerWidth`/`visualViewport`/`documentElement`) beats `matchMedia`, which beats
`screen.orientation.type`. Installed PWAs frequently report a stale
`screen.orientation.type` right after a rotation.

---

## 3. Connection state machine

`SyncClient` (`sync.ts`) owns the transport; `HarvestSession` (`session.ts`)
maps it onto the store; `overlay.ts` maps the store onto the UI. There is
exactly **one** path:

```
        ┌──────────────┐   socket open   ┌────────┐  hello_ack | snapshot  ┌───────┐
        │ connecting   │ ───────────────►│  open  │ ─────────────────────► │ ready │  ◄── terminal
        │ recovering   │                 │ (hello │                        └───────┘
        │ reconnecting │                 │  sent) │                             │
        └──────────────┘                 └────────┘                             │
               ▲                                   │ drop                        │
               └───────────────────────────────────┘                             │
               │ retry budget exhausted (10 attempts, backoff ≤ 10s)             │
               ▼                                                                 │
            error  (FAILED — "Coba Sambungkan Lagi")  ──────────────────────────┘
```

Store statuses: `connecting | recovering | reconnecting | hello | syncing |
ready | error | closed`. UI overlay kinds (`overlay.ts`): `loading |
reconnecting | recovering | failed | null`.

Hard rules:

* **OPEN ≠ connected.** Only `hello_ack` or the authoritative `snapshot` moves
  the session to `ready`.
* A completed handshake **resets** the retry budget, cancels pending retry
  timers and clears the overlay.
* The **snapshot** is the only thing that may enter the game screen — never the
  orientation and never a bare socket event.
* `ready`/`connected`/`closed` always hide the overlay, whatever the screen is.
* No automatic `location.reload()` anywhere. The FAILED state offers
  "Coba Sambungkan Lagi" (fresh handshake) and an explicit "Muat Ulang Game".

### Recovery primitives

| primitive | when | behaviour |
|-----------|------|-----------|
| `ensureOpen()` | passive checks | health-check only; never opens a second socket; respects the exhausted budget |
| `probeAfterResume()` | foreground / rotation / `online` with an OPEN socket | sends a ping and grants `RESUME_GRACE_MS` (4s) to answer before tearing the socket down — a background-throttled heartbeat no longer triggers a needless reconnect |
| `forceReconnect()` | manual retry, dead socket, exhausted budget on resume | cancel timers → stop watchdogs → destroy socket → reset budget → **one** fresh socket → hello |
| snapshot watchdog | handshake done but no snapshot | bounded `req_state` resyncs, then FAILED |

### Lifecycle signals → one coordinator

`orientationchange`, `resize`, `visualViewport.resize`, `visibilitychange`,
`pageshow`, `focus`, `online` all funnel into `HarvestSession.recover(source,
aggressive)`, coalesced into a 1.5s window and executed after the viewport
settles (double `requestAnimationFrame`).

* **passive** (`resize`, `viewport`): `ensureOpen()` + resync only if the UI is
  not settled.
* **explicit** (`orientation`, `visibility`, `pageshow`, `focus`, `online`,
  `manual`): fresh handshake when the socket is unusable or the budget ran out,
  otherwise probe + conditional resync.

Rotation may **only**: read the new orientation, verify socket health, request a
resync. It must **never**: recreate the `SyncClient`, reset the store, change
`userId`/`roomId`/username, dispose the engine, or restart the creator flow.

---

## 4. Session invariants

* one `SyncClient` per room session (created in `HarvestSession.start()`, keyed
  on `roomId` only)
* one `WorldEngine` per session; the canvas is re-attached, never rebuilt
* one recovery coordinator; no independent reconnect loops
* snapshots are idempotent (`setWorld()` clears previous scenery, remote players
  are keyed by id, chat is deduplicated in the store)
* identity (`userId` from `localStorage.sudoku_user_id`, `roomId`, username) is
  resolved once per page life and reused by every reconnect — the server takes
  over the stale connection for the same `room+userId`, so a reconnect always
  resumes the existing player, farm and inventory

---

## 5. Debug logging

Tagged, dev-only (`NODE_ENV !== 'production'`, or
`localStorage.setItem('harvest_debug','1')` in production):

```
[harvest][orientation] detected portrait
[harvest][orientation] requesting landscape lock … success
[harvest][pwa]         orientation lock attempt source=mount n=1
[harvest][ws]          socket created id=42 attempt=1
[harvest][handshake]   hello sent id=42 room=AB12CD userId=…
[harvest][handshake]   snapshot received — handshake complete id=42
[harvest][recovery]    evaluate source=online aggressive=true socket=open handshake=true
[harvest][recovery]    force reconnect reason=lifecycle:online
[harvest][snapshot]    received n=2 char=true players=1
[harvest][engine]      canvas re-attached to live host
```

Errors (`derror`) are always logged — they are not spam.

---

## 6. Test map

| Spec test | Where it is verified |
|-----------|----------------------|
| A mobile portrait → gate | `tests/01` PART 1/4, `tests/mobile-lifecycle.spec.mjs` "A/B" |
| B mobile landscape → no gate, game continues | `tests/01` PART 1/4, spec "A/B" |
| C kill socket → overlay | `tests/09` PART 5, `tests/11` PART 3, spec "C/D" |
| D network back → hello → snapshot → overlay gone | `tests/09` PART 5, `tests/11` PART 3, spec "C/D" |
| E manual retry → fresh socket → game | `tests/09` PART 6, `tests/11` PART 4, spec "E" |
| F portrait → landscape, same user/room, no creator | `tests/09` PART 3, `tests/11` PART 5, spec "F/G/L" |
| G landscape → portrait → landscape, no stuck loading | `tests/01` PART 4, `tests/09` PART 3, spec "F/G/L" |
| H offline → online recovery | `tests/09` PART 5, spec "H" |
| I background → foreground | `tests/09` PART 7, `tests/11` PART 6, spec "I" |
| J snapshot → 0 overlays, canvas visible | `tests/09` PART 1/11, `tests/11` PART 1, spec "A/B" |
| K desktop → no gate | `tests/01` PART 1/3/4, `tests/09` PART 10, spec "K" |
| L rapid resize/orientation → one WebSocket | `tests/08` PART 8e, `tests/09` PART 4, spec "F/G/L" |
| M stale socket callback cannot corrupt state | `tests/08` PART 8d, `tests/09` PART 8, spec "M" |
| Monochrome overlays (dark + light) | `tests/10` |
| Real transport (server + client, no mocks) | `tests/11` |

Commands:

```bash
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm test              # all headless suites (01…11 + server suite)
npm run test:e2e      # Playwright (needs `npx playwright install chromium`)
```

The Playwright spec boots the real custom server (`PORT=3111 node
server/run.mjs`) via `playwright.config.mjs`.
