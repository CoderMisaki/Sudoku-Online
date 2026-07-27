const fs = require('fs');
const content = fs.readFileSync('src/store/gameStore.ts', 'utf8');

const updatedContent = content.replace(
  /partialize: \(state\) => \(\{ room: state\.room, grid: state\.grid, messages: state\.messages \}\),/g,
  `partialize: (state) => ({ messages: state.messages }),`
);

fs.writeFileSync('src/store/gameStore.ts', updatedContent);
