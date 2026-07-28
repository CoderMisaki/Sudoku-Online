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
- Restored \`NEXT_PUBLIC_SUPABASE_URL\` and \`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\` in \`.env.local\` to allow the application to connect to Supabase. This aligns with standard secure practices as publishable keys are intended for frontend exposure. Added \`NEXT_PUBLIC_SUPABASE_ANON_KEY\` mapped to the publishable key.
- Fixed the eraser feature functionality by implementing an \`isEraserMode\` toggle. This mode correctly toggles pencil notes in a targeted cell without wiping the entire cell inadvertently when not intended. Tapping the Eraser button when selecting a filled cell clears the cell's main value.
- Improved the chat UI: replaced the plain text input with an auto-resizing \`textarea\` (max height 120px) preventing layout overflow, and refactored the auto-scrolling logic using \`requestAnimationFrame\` to eliminate abrupt screen shaking when a new message arrives, especially for long messages.
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
