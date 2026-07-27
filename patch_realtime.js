const fs = require('fs');
const content = fs.readFileSync('src/hooks/useRealtime.ts', 'utf8');

const updatedContent = content.replace(
  /\.on\('broadcast', { event: 'move' }, \(\{ payload \}\) => {/,
  `.on('broadcast', { event: 'move' }, async ({ payload }) => {`
).replace(
  /\/\/ Terapkan hasil terverifikasi dari sender\s+store\.updateCellWithValidation\(payload\.row, payload\.col, payload\.value, payload\.userId, payload\.isCorrect\);/,
  `// Independently verify the move if it's from another user and not null
        let isCorrect = payload.isCorrect;
        if (payload.userId !== userId && payload.value !== null && store.solutionToken) {
          try {
            const res = await fetch('/api/game/verify', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                row: payload.row,
                col: payload.col,
                value: payload.value,
                solutionToken: store.solutionToken
              })
            });
            const data = await res.json();
            isCorrect = Boolean(data.isCorrect);
          } catch (e) {
            console.error('Failed to verify move independently', e);
          }
        }

        // Terapkan hasil terverifikasi
        store.updateCellWithValidation(payload.row, payload.col, payload.value, payload.userId, isCorrect);`
).replace(
  /if \(payload\.isCorrect\) {/g,
  `if (isCorrect) {`
);

fs.writeFileSync('src/hooks/useRealtime.ts', updatedContent);
