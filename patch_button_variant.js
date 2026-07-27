const fs = require('fs');
let content = fs.readFileSync('src/app/room/[id]/page.tsx', 'utf8');

content = content.replace(
  /variant=\{isPencilMode \? "default" : "outline"\}/g,
  `variant={isPencilMode ? "primary" : "outline"}`
);

fs.writeFileSync('src/app/room/[id]/page.tsx', content);
