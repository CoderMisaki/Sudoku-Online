2025-07-26 - State Pollution and Synchronization

Learnings:
- Next.js multiplayer application logic relying on Zustand's `persist` store without scoping to room IDs can leak state across differently generated rooms.
- Realtime web socket events without validating matching room identifiers will process broadcast messages meant for other isolated instances.
- Missing chat-input checks allows global keyboard listeners intended for the game board to intercept users typings, interfering with the board.
- When creating state-machine synchronizations using web sockets, joiners might experience a race condition requesting game state if there isn't a robust retry mechanism.

Findings:
- State scopes for different rooms leaked through Zustand's unconstrained global memory persistence.
- Sudoku board keyboard handlers intercepted input intended for chat textareas.
- Sync logic for late joiners relied on a single 800ms delayed ping which, if missed, froze the room connection.

Vulnerability Patterns:
- **Improper State Isolation:** Global state persistence across distinct conceptual bounds without validation.
- **Missing Event Scoping:** Web socket listener processing broadcast commands regardless of destination contexts (missing room validation checks in `sync_state`).
- **Global Listener Interception:** Failing to ignore targeted text inputs within document-level `keydown` events.

2024-07-27 - UI Input Constraints Hiding Global Game Logic

Learnings:
- UI components should not perform validation checks that bypass core global game rules (e.g. `isValidMove` in the UI intercepted bad moves before the store's `classic` mode logic could catch them and apply scoring penalties).

Findings:
- `isValidMove` in `SudokuBoard.tsx` blocked wrong inputs early, preventing the `-5` score penalty defined in `gameStore.ts` from applying.

Vulnerability Patterns:
- **Scattered Validation Logic:** Having partial validation in the view layer preventing necessary logic located in the central state/domain layer from executing.
