const fs = require('fs');
let content = fs.readFileSync('src/app/room/[id]/page.tsx', 'utf8');

// Import Edit2 (Pencil) and Eraser icons
content = content.replace(
  /import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb, AlertTriangle, WifiOff } from 'lucide-react';/g,
  `import { Copy, Users, Settings, LogOut, CheckCircle2, Lightbulb, AlertTriangle, WifiOff, Edit2, Eraser } from 'lucide-react';`
);

// Add isPencilMode state
content = content.replace(
  /const \[theme, setTheme\] = useState<'light' \| 'dark' \| 'system'>\('system'\);/g,
  `const [theme, setTheme] = useState<'light' | 'dark' | 'system'>('system');\n  const [isPencilMode, setIsPencilMode] = useState(false);`
);

// Update handleNumpadClick
content = content.replace(
  /const handleNumpadClick = useCallback\(\(num: number\) => \{[\s\S]*?broadcastMove\(row, col, num\);\n  \}, \[selectedCell, userId, broadcastMove, locks\]\);/g,
  `const handleNumpadClick = useCallback((num: number) => {
    if (!selectedCell || !userId) return;
    const { row, col } = selectedCell;
    const key = \`\${row}-\${col}\`;
    const currentLock = locks[key];

    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
      return;
    }

    const currentGrid = useGameStore.getState().grid;
    if (currentGrid && currentGrid[row][col].isLocked) return;

    if (isPencilMode && currentGrid && currentGrid[row][col].value === null) {
      broadcastNote(row, col, num);
    } else {
      broadcastMove(row, col, num);
    }
  }, [selectedCell, userId, broadcastMove, broadcastNote, locks, isPencilMode]);

  const handleEraserClick = useCallback(() => {
    if (!selectedCell || !userId) return;
    const { row, col } = selectedCell;
    const key = \`\${row}-\${col}\`;
    const currentLock = locks[key];

    if (currentLock && currentLock.userId !== userId && currentLock.expiresAt > Date.now()) {
      return;
    }

    const currentGrid = useGameStore.getState().grid;
    if (currentGrid && currentGrid[row][col].isLocked) return;

    // Broadcast null to clear cell value
    broadcastMove(row, col, null);
  }, [selectedCell, userId, broadcastMove, locks]);
  `
);

// Add broadcastNote destructuring
content = content.replace(
  /const \{ broadcastMove, broadcastCursor, lockCell, locks, broadcastChat, realtimeStatus, connectionError \} = useRealtime\(roomId\);/g,
  `const { broadcastMove, broadcastNote, broadcastCursor, lockCell, locks, broadcastChat, realtimeStatus, connectionError } = useRealtime(roomId);`
);

// Update SudokuBoard component props
content = content.replace(
  /<SudokuBoard\s+broadcastMove=\{broadcastMove\}\s+broadcastCursor=\{broadcastCursor\}\s+lockCell=\{lockCell\}\s+locks=\{locks\}\s+\/>/g,
  `<SudokuBoard
              broadcastMove={broadcastMove}
              broadcastNote={broadcastNote}
              broadcastCursor={broadcastCursor}
              lockCell={lockCell}
              locks={locks}
              isPencilMode={isPencilMode}
            />`
);

// Add Pencil & Eraser buttons to Controls
content = content.replace(
  /<Button variant="outline" size="sm" onClick=\{handleHint\} disabled=\{hintsRemaining <= 0\}>\s*<Lightbulb className="w-4 h-4 mr-2" \/> Hint \(\{hintsRemaining\}\)\s*<\/Button>/g,
  `<Button variant="outline" size="sm" onClick={handleHint} disabled={hintsRemaining <= 0}>
                  <Lightbulb className="w-4 h-4 mr-2" /> Hint ({hintsRemaining})
                </Button>
                <Button variant={isPencilMode ? "default" : "outline"} size="sm" onClick={() => setIsPencilMode(!isPencilMode)}>
                  <Edit2 className="w-4 h-4 mr-2" /> Note
                </Button>
                <Button variant="outline" size="sm" onClick={handleEraserClick}>
                  <Eraser className="w-4 h-4 mr-2" /> Eraser
                </Button>`
);

fs.writeFileSync('src/app/room/[id]/page.tsx', content);
