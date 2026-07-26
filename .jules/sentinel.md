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
