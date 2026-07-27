const fs = require('fs');
let content = fs.readFileSync('src/components/game/SudokuBoard.tsx', 'utf8');

content = content.replace(
  /interface SudokuBoardProps \{[\s\S]*?locks: Record<string, \{ userId: string, expiresAt: number \}>;\n\}/g,
  `interface SudokuBoardProps {
  broadcastMove: (row: number, col: number, value: number | null) => void;
  broadcastNote: (row: number, col: number, note: number) => void;
  broadcastCursor: (row: number, col: number) => void;
  lockCell: (row: number, col: number) => boolean | void;
  locks: Record<string, { userId: string, expiresAt: number }>;
  isPencilMode: boolean;
}`
);

content = content.replace(
  /export const SudokuBoard: React\.FC<SudokuBoardProps> = \(\{ broadcastMove, broadcastCursor, lockCell, locks \}\) => \{/g,
  `export const SudokuBoard: React.FC<SudokuBoardProps> = ({ broadcastMove, broadcastNote, broadcastCursor, lockCell, locks, isPencilMode }) => {`
);

content = content.replace(
  /if \(e\.key >= '1' && e\.key <= '9'\) \{\s+const val = parseInt\(e\.key\);\s+if \(!cell\.isLocked\) \{\s+broadcastMove\(row, col, val\);\s+\}\s+\}/g,
  `if (e.key >= '1' && e.key <= '9') {
      const val = parseInt(e.key);
      if (!cell.isLocked) {
        if (isPencilMode && cell.value === null) {
          broadcastNote(row, col, val);
        } else {
          broadcastMove(row, col, val);
        }
      }
    }`
);

content = content.replace(
  /\[selectedCell, grid, userId, locks, broadcastMove, handleCellClick\]/g,
  `[selectedCell, grid, userId, locks, broadcastMove, broadcastNote, handleCellClick, isPencilMode]`
);

fs.writeFileSync('src/components/game/SudokuBoard.tsx', content);
