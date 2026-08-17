2024-08-17 - [Sudoku Realtime: Snakes and Ladders Extension]
Implemented Snakes and Ladders game mode including dynamic turn-based logic, client-side dice rolling, bouncing logic at cell 100, and a 10x10 boustrophedon board layout. Broadcast channel events now handle dice rolling securely, ensuring proper synchronization of player movements and turn order. Fixed store duplication errors with TypeScript types and enforced safe React effect hooks to prevent unnecessary re-renders during state updates.

Key changes:
- `src/types/game.ts`: Added `snakes_and_ladders` GameMode and State interfaces.
- `src/store/gameStore.ts`: Defined `snakesState` and related actions for optimistic updates.
- `src/hooks/useRealtime.ts`: Created `broadcastSnakesDiceRoll` to sync dice values and positions.
- `src/components/game/SnakesAndLaddersBoard.tsx`: Developed component with visual board rendering, localized dice roll animation, player tokens, and bounds/finish logic.

2024-08-17 - [Sudoku Realtime: Snakes and Ladders Improvements]
Revamped Snakes and Ladders with new visual improvements and game mechanics:
- Next Game button automatically appears when a player hits 100 for the host.
- Designed realistic snakes from head to tail using a double S-curve.
- Implemented varied difficulties (easy to evil) standardizing the amount of snakes/ladders on the board.
- Parabolic hopping animations using framer-motion instead of abrupt translations.
- Player podiums (Medals) are supported for the top 3 finishers.
- Optimized 60 FPS performance by removing feDropShadows for SVG paths and applying hardware accelerated transform transitions for player pieces.
