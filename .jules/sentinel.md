
2026-07-26 - Chat Input, Hint Enhancement, and Realtime Sync Fixes

- Replaced chat input field with an auto-expanding textarea supporting Shift+Enter.
- Updated `useHint` to only act on a selected cell.
- Changed cell highlight style for matching numbers to an outline rather than a solid block.
- Streamlined mobile header layout for room codes.
- Added host broadcast event on player joins to accurately sync the game state, solving the race condition.
2026-07-26 - Fix Chat UI, Sync Issues, Highlight colors

I fixed a few issues requested by the user:
- UI width for the Chat container has been widened by giving it a larger column span (2 columns) and setting the maximum height to `50vh`.
- Highlight color in Sudoku board to show the same values has been updated to use `bg-sky-500/20`, an opaque light blue color that does not block the text from showing.
- Online sync bug for new player joiners who see 0 players and no board. Handled real-time presence events (joins and leaves) so that host can broadcast a `sync_state` to all players, providing room data, grid, and solution to everyone when a new player joins. Players automatically check this state and populate their games.
- Show the Room ID in header instead of hiding it from smaller screens. It also has a copy room code button!

2026-07-26 - Fix Chat UI, Sync Issues, Highlight colors

I fixed a few issues requested by the user:
- UI width for the Chat container has been widened by giving it a larger column span (2 columns) and setting the maximum height to `50vh`.
- Highlight color in Sudoku board to show the same values has been updated to use `bg-sky-500/20`, an opaque light blue color that does not block the text from showing.
- Online sync bug for new player joiners who see 0 players and no board. Handled real-time presence events (joins and leaves) so that host can broadcast a `sync_state` to all players, providing room data, grid, and solution to everyone when a new player joins. Players automatically check this state and populate their games.
- Show the Room ID in header instead of hiding it from smaller screens. It also has a copy room code button!

2026-07-26 - UI Improvements and Connection Status Banner

- Fixed Highlight Number: Modified highlight `isSameValue && !isSelected` from a solid background to `ring-2 ring-sky-400 ring-inset bg-sky-500/10` so the number remains visible.
- Fixed Mobile Chat UI: Set `max-h-[140px]` on Players card and `min-h-[200px] max-h-[300px]` on the Chat card in `page.tsx` so the chat is comfortably readable on mobile.
- Handled Supabase Realtime Sync properly in `useRealtime.ts` by ensuring new players get a `sync_state` directly broadcast from the host.
- Added Connection Status Banners: Implemented checks for unconfigured or placeholder `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Created UI banners in `RoomPage` to display environment variable errors and Supabase WebSocket connection statuses ('CHANNEL_ERROR', 'TIMED_OUT', etc).
