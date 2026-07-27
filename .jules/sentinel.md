2024-07-27 - [Sudoku Realtime Logic and Feedback Improvements]
- Found that toast notifications during an answer verification check (`broadcastMove`) were missing for the player who actually submitted the answer, preventing immediate feedback on success or failure.
- Updated `src/hooks/useRealtime.ts` to trigger a local `toast.success` and `toast.error` during `broadcastMove` so the initiating player can receive visual validation of their correctness locally, just before or simultaneously as the move is broadcasted globally.
- Cleaned up unneeded Vercel boilerplate SVGs and implemented a custom minimalist Sudoku SVG grid as `icon.svg`.
- Resolved linting errors (`@typescript-eslint/no-unused-vars`) in `hint` and `verify` API routes that surfaced from unutilized `error`/`err` variables in `catch` blocks.
