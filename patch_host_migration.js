const fs = require('fs');
const content = fs.readFileSync('src/hooks/useRealtime.ts', 'utf8');

const replacement = `
      .on('presence', { event: 'leave' }, ({ leftPresences }) => {
        const store = useGameStore.getState();
        if (store.room) {
          const newPlayers = { ...store.room.players };
          let changed = false;
          let hostLeft = false;

          leftPresences.forEach((p) => {
            if (newPlayers[p.user_id]) {
              newPlayers[p.user_id].status = 'offline';
              changed = true;
              if (store.room.hostId === p.user_id) {
                hostLeft = true;
              }
            }
          });

          if (changed) {
            let newHostId = store.room.hostId;
            if (hostLeft) {
              // Find the first online player to be the new host
              const onlinePlayers = Object.values(newPlayers).filter(p => p.status === 'online');
              if (onlinePlayers.length > 0) {
                newHostId = onlinePlayers[0].id;
                newPlayers[newHostId].isHost = true;
              }
            }

            const updatedRoom = { ...store.room, players: newPlayers, hostId: newHostId };
            store.setRoom(updatedRoom);
            if (newHostId === userId) {
                syncHostState();
            }
          }
        }
      })
`;

const updatedContent = content.replace(/\.on\('presence', \{ event: 'leave' \}, \(\{ leftPresences \}\) => \{[\s\S]*?\}\)[\s]*\.on\('broadcast', \{ event: 'request_state' \},/g, replacement.trim() + "\n      .on('broadcast', { event: 'request_state' },");

fs.writeFileSync('src/hooks/useRealtime.ts', updatedContent);
