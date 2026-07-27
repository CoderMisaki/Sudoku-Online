const fs = require('fs');
let content = fs.readFileSync('src/hooks/useRealtime.ts', 'utf8');

const eventHandler = `
      .on('broadcast', { event: 'note' }, ({ payload }) => {
        if (typeof payload.row !== "number" || typeof payload.col !== "number" || typeof payload.note !== "number") return;
        useGameStore.getState().toggleNote(payload.row, payload.col, payload.note);
      })
`;

content = content.replace(/\.on\('broadcast', { event: 'move' }/g, eventHandler.trim() + "\n      .on('broadcast', { event: 'move' }");

const broadcastFunction = `
  const broadcastNote = (row: number, col: number, note: number) => {
    if (!channelRef.current || !userId) return;

    useGameStore.getState().toggleNote(row, col, note);

    channelRef.current.send({
      type: 'broadcast',
      event: 'note',
      payload: { userId, row, col, note },
    });
  };
`;

content = content.replace(/const broadcastChat =/g, broadcastFunction.trim() + "\n\n  const broadcastChat =");
content = content.replace(/return \{ broadcastCursor, broadcastMove, lockCell, locks, broadcastChat, realtimeStatus, connectionError \};/g,
"return { broadcastCursor, broadcastMove, broadcastNote, lockCell, locks, broadcastChat, realtimeStatus, connectionError };");

fs.writeFileSync('src/hooks/useRealtime.ts', content);
