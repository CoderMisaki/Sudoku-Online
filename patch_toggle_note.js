const fs = require('fs');
let content = fs.readFileSync('src/store/gameStore.ts', 'utf8');

const updatedContent = content.replace(
  /newGrid\[row\]\[col\] = {\s+\.\.\.newGrid\[row\]\[col\],\s+notes: hasNote\s+\? currentNotes\.filter\(n => n !== note\)\s+: \[\.\.\.currentNotes, note\]\.sort\(\)\s+};/g,
  `let updatedNotes = hasNote ? currentNotes.filter(n => n !== note) : [...currentNotes, note].sort();
        if (updatedNotes.length > 5) {
          updatedNotes = updatedNotes.slice(0, 5);
        }
        newGrid[row][col] = {
          ...newGrid[row][col],
          notes: updatedNotes
        };`
);

fs.writeFileSync('src/store/gameStore.ts', updatedContent);
