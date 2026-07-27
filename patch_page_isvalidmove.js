const fs = require('fs');
const content = fs.readFileSync('src/app/room/[id]/page.tsx', 'utf8');

const updatedContent = content.replace(
  /if \(currentGrid && !isValidMove\(currentGrid, row, col, num\)\) \{\s+toast\.error\('Angka sudah ada di baris\/kolom\/blok!', \{ id: 'conflict', duration: 1500 \}\);\s+return;\s+\}/g,
  ``
);

fs.writeFileSync('src/app/room/[id]/page.tsx', updatedContent);
