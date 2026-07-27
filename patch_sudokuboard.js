const fs = require('fs');
const content = fs.readFileSync('src/components/game/SudokuBoard.tsx', 'utf8');

const updatedContent = content.replace(
  /\/\/ Cegah spam angka bila melanggar aturan blok\/baris\/kolom\s+if \(!isValidMove\(grid, row, col, val\)\) {\s+toast\.error\('Angka sudah ada di baris\/kolom\/blok!', { id: 'conflict', duration: 1500 }\);\s+return;\s+}/g,
  ``
);

fs.writeFileSync('src/components/game/SudokuBoard.tsx', updatedContent);
