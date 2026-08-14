# Sentinel

2024-07-27 - [Sudoku Realtime Logic and Feedback Improvements]
- Found that toast notifications during an answer verification check (`broadcastMove`) were missing for the player who actually submitted the answer, preventing immediate feedback on success or failure.
- Updated `src/hooks/useRealtime.ts` to trigger a local `toast.success` and `toast.error` during `broadcastMove` so the initiating player can receive visual validation of their correctness locally, just before or simultaneously as the move is broadcasted globally.
- Cleaned up unneeded Vercel boilerplate SVGs and implemented a custom minimalist Sudoku SVG grid as `icon.svg`.
- Resolved linting errors (`@typescript-eslint/no-unused-vars`) in `hint` and `verify` API routes that surfaced from unutilized `error`/`err` variables in `catch` blocks.

2026-07-27 - [Sudoku Security and Feature Improvements]
- Addressed a critical security anomaly where `ROOM_SECRET_KEY` was exposed to the client by migrating room generation and solution token encryption to a new server-side API route (`/api/game/create-room`).
- Fixed vulnerability regarding payload spoofing in `useRealtime.ts` by independently validating incoming move broadcasts directly through the `/api/game/verify` route using the encrypted `solutionToken`.
- Removed fallback keys in `src/services/supabase.ts` for environment variable safety and corrected `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- Corrected a single point of failure in the host synchronization logic in `useRealtime.ts`, enabling seamless Host Migration when the current host disconnects.
- Cleaned up state storage inconsistencies in `gameStore.ts` `partialize` configuration to only persist `messages` across reloads to avoid visual glitches or desync behavior.
- Softened strict validations in `SudokuBoard.tsx` allowing intentional conflicting numbers by users.
- Introduced `Pencil/Eraser` utilities integrated deeply into `useRealtime.ts` (with a new `note` event type for broadcasting) and `gameStore.ts` (keeping a 5-note limit for cells in memory state).

2024-07-28 - [Sudoku Environment Variables and UX Fixes]
- Restored `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local` to allow the application to connect to Supabase. This aligns with standard secure practices as publishable keys are intended for frontend exposure. Added `NEXT_PUBLIC_SUPABASE_ANON_KEY` mapped to the publishable key.
- Fixed the eraser feature functionality by implementing an `isEraserMode` toggle. This mode correctly toggles pencil notes in a targeted cell without wiping the entire cell inadvertently when not intended. Tapping the Eraser button when selecting a filled cell clears the cell's main value.
- Improved the chat UI: replaced the plain text input with an auto-resizing `textarea` (max height 120px) preventing layout overflow, and refactored the auto-scrolling logic using `requestAnimationFrame` to eliminate abrupt screen shaking when a new message arrives, especially for long messages.
- Added a visual unread message notification (✉️ +1) beside the chat title that momentarily appears for 1.5s when a new message is received from other players.
2023-10-25 - [Supabase Realtime with Next.js]
- To prevent Supabase channel subscription errors ('cannot add presence callbacks... after subscribe()'), the `useRealtime` hook must only be called once per room in the component tree. Hoist the hook to a parent component and pass its state and functions down as props to children components.
2026-07-28 - [Supabase Realtime with Next.js]
- To reset a realtime game, the host can trigger an API call to generate a new puzzle and then broadcast a `next_game` event to all players using the same channel, avoiding the need to tear down and recreate rooms or WebSocket connections.

2026-07-28 - [Obfuscate Supabase Credentials and Adjust UI Highlights]
- Replaced `process.env` references for Supabase URL and keys with inline obfuscated strings (reversed strings) in `src/services/supabase.ts` per explicit user request.
- Adjusted cell highlighting in `src/components/game/SudokuBoard.tsx` to fix a UX issue where the background highlight for matching numbers obscured the numbers themselves. Changed the highlight logic to apply a light pink text color instead of a background color, keeping the number fully visible.

2026-07-28 - [Optimistic UI and Realtime Delay Fixes]
- Implemented an optimistic UI update for `broadcastMove` in `src/hooks/useRealtime.ts` by decoupling the API verification call (`fetch`) from blocking the local UI rendering. The move is immediately rendered using a new `setOptimisticMove` in `src/store/gameStore.ts` before verifying with the server via an asynchronous `.then()` chain.
- Reduced significant multiplayer latency by eliminating redundant, independent server verifications for incoming `move` broadcasts in `useRealtime.ts`, trusting the payload's `isCorrect` status distributed by the initiator instead.
- Added an `isPending` state to `CellData` in `src/types/game.ts` to manage optimistic state handling during validations inside `updateCellWithValidation`.

2026-07-28 - [Sudoku Synchronization and Latency Optimizations]
- Resolved "Delay Isian Kotak" by implementing a dual-stage optimistic broadcast in `useRealtime.ts`. Player moves are instantly broadcast via a new `move_optimistic` event, bypassing the backend server verification delay and updating UI globally within ~10-25ms.
- Final server verifications execute asynchronously in the background. Once completed, a `move_verified` event updates the formal game score and error indicators.
- Adjusted action rate limiting in `rateLimiter.ts` by reducing the `cooldownMs` from 150ms to 40ms and increasing the action count threshold from 3 to 10 to better support fast typing (bursts) and rapid pencil mode entries without ignoring dropped commands.
- Added a `animate-pulse` visual effect on the `SudokuBoard` for cells while they are `isPending` (optimistically drawn but waiting on server verification), enhancing real-time responsiveness feedback.

2026-08-01 - [Fix Player Stuck in Leave Room Status]
- Identified an issue where a player (including the host) would get stuck in the `( Leave Room )` or 'offline' status upon reconnecting, because the `sync_state` received back from the host still contained the old 'offline' state.
- Updated `src/hooks/useRealtime.ts` to implement a centralized `handlePresenceChange` function. This leverages the WebSocket `channel.presenceState()` as the source of truth, updating client local state correctly during `sync`, `join`, and `leave` events.
- Ensured that both the host sending the `sync_state` and the client receiving it automatically mark themselves and the requesting user as 'online' instantly, avoiding the status freeze.

2024-03-08 - [Sudoku Competition Mode Feature Addition]
- Added "Competition" game mode to the application allowing players to solve unique individual puzzles while seeing real-time progress percentages and ranks of other players, instead of scores.
- Extended the `Player` interface in `gameStore` with `progress` and `rank` properties to support competition tracking.
- Decoupled real-time game board interactions (e.g., cursor, locks, cell modifications) in `useRealtime` and `SudokuBoard.tsx` for the "competition" mode.
- Fixed a bug where progressing to the next game using `startNextGame` would reset all chat messages, preserving communication history between sessions.
- Trigger individual server calls in `/api/game/create-room` on `next_game` for players in "competition" mode instead of receiving one shared puzzle broadcast.

2026-08-01 - [Fix Host Migration, Spectator Mode, and Lobby Settings]
- Resolved an issue with excessive host migrations by refactoring the host demotion logic into `cancelHostMigration` and `scheduleHostMigration` delays within `useRealtime.ts`. A new host is only chosen after a 7000ms grace period or an explicit `leave_room` broadcast.
- Modified the competition mode wrong-move interaction: incorrect inputs are now removed off the board similar to classic mode while retaining the correct ones, simplifying gameplay readability.
- Implemented Spectator Mode functionality. When maximum active players are exceeded, users connect seamlessly as spectators. Adjusted event broadcasts to reject inputs, removed interactive UI components, and displayed spectator indicators on the board interface for non-players.
- Updated Next Game functionality allowing hosts to tweak `nextDifficulty`, `nextMode`, and `nextMaxPlayers` directly via the endgame UI lobby controls before deploying `handleApplyNextGame`. Avoids re-creating a whole new room and connection.

2024-05-30 - [Bugfix and Spectator Mode]
- Handled edge cases for spectator mode, where multiple events need to be suppressed for spectators.
- Identified standard validation steps and updated `gameStore` rejecting moves appropriately based on mode ('competition').

2026-08-11 - [Next Game Customization Modal]
- Added a settings customization modal for the "Next Game" action for the host. The modal replaces a simple direct restart, allowing the host to select the Difficulty, Game Mode, and Max Players before starting the next round. State flows between 'confirm' (continue directly without changes) and 'settings' (adjust configurations), updating `GameStore` and making `broadcastNextGame` calls locally.

2024-05-30 - [Update Realtime Connection Status and Host Persistence]
- Changed player status logic to include 'disconnected' and 'left' states alongside 'online' and 'offline' to represent varying forms of unreachability, specifically when closing tabs or explicitly leaving.
- Updated `useRealtime.ts` to freeze host assignment when the host disconnects rather than shifting it dynamically.
- Implemented robust `broadcastLeaveRoom` handling for explicit room departure.
- Added visual status tags for 'Disconnect' and 'Leave Room' within the player list UI (`RoomPage`).

2024-05-30 - [New Game Modes: Race and Zen]
- Introduced Race mode. It emphasizes speed with a combo/streak system (progressively multiplying points per correct move under 4s) and punishes wrong moves heavily by imposing a 3-second lockout/stun. Board greyscales during this stun.
- Introduced Zen mode. It removes scores, penalties for wrong moves, and hint limitations. It alters incorrect input highlights to a relaxing orange instead of aggressive red. Added an Auto-Note helper to inject valid candidate choices into blank cells.
