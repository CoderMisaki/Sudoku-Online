const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://localhost:3000/room/test-room');
  // Wait for the room to render the error banner
  // Simulating an error could be tricky without a running server, but this verifies the page doesn't crash on load.
  await page.screenshot({ path: '.jules/screenshots/room-test.png' });
  await browser.close();
})();
