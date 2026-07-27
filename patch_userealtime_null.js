const fs = require('fs');
let content = fs.readFileSync('src/hooks/useRealtime.ts', 'utf8');

content = content.replace(
  /if \(store\.room\.hostId === p\.user_id\) \{/g,
  `if (store.room && store.room.hostId === p.user_id) {`
);

fs.writeFileSync('src/hooks/useRealtime.ts', content);
