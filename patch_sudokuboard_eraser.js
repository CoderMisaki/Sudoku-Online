const fs = require('fs');
let content = fs.readFileSync('src/components/game/SudokuBoard.tsx', 'utf8');

content = content.replace(
  /if \(e\.key === 'Backspace' \|\| e\.key === 'Delete'\) \{\s+if \(!cell\.isLocked\) \{\s+broadcastMove\(row, col, null\);\s+\}\s+\}/g,
  `if (e.key === 'Backspace' || e.key === 'Delete') {
      if (!cell.isLocked) {
        broadcastMove(row, col, null);
      }
    }`
);

fs.writeFileSync('src/components/game/SudokuBoard.tsx', content);
