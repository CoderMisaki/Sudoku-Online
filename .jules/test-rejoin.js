// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('playwright');

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(11, 23)}][${tag}] ${msg}`);
}

async function playersText(page) {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('main > div > div'));
    const playersCard = cards.find((c) => c.querySelector('h2')?.textContent?.includes('Players'));
    return playersCard ? playersCard.innerText.replace(/\n/g, ' | ') : '(no players card)';
  });
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const hostCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const host = await hostCtx.newPage();
  await host.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await host.waitForTimeout(3500);
  await host.getByPlaceholder('Contoh: Alex').fill('HostTest');
  await host.getByText('Buat Room Baru').click();
  await host.getByRole('button', { name: 'Mulai Room' }).click();
  await host.waitForURL(/\/room\/[A-Z0-9]{5}/, { timeout: 60000 });
  const roomId = host.url().split('/room/')[1];
  await host.waitForSelector('.grid.grid-cols-9', { timeout: 45000 });

  // Guest in SAME context (same userId) joins -> leaves -> rejoins
  const g = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const guest = await g.newPage();
  const joinRoom = async () => {
    await guest.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await guest.waitForTimeout(3500);
    const nameInput = guest.getByPlaceholder('Contoh: Alex');
    await nameInput.fill('GuestTest');
    await guest.getByText('Gabung Room').click();
    await guest.waitForTimeout(500);
    await guest.getByPlaceholder('Masukan code room...').fill(roomId);
    await guest.getByRole('button', { name: 'Masuk Room' }).click();
    await guest.waitForURL(new RegExp(`/room/${roomId}`), { timeout: 60000 });
  };

  await joinRoom();
  await host.waitForTimeout(5000);
  log('JOIN1', 'HOST: ' + (await playersText(host)));

  await guest.getByRole('button', { name: /Leave/ }).click();
  await guest.waitForURL('http://localhost:3000/', { timeout: 30000 });
  await host.waitForTimeout(3000);
  log('LEFT', 'HOST: ' + (await playersText(host)));

  await joinRoom();
  await host.waitForTimeout(8000);
  const hl = await playersText(host);
  const gl = await playersText(guest);
  log('REJOIN', 'HOST: ' + hl);
  log('REJOIN', 'GUEST: ' + gl);
  log('REJOIN', 'host_guest_left_stuck=' + hl.includes('( Leave Room )') + ' playerCount=' + (hl.match(/GuestTest/g) || []).length);
  await host.screenshot({ path: '.jules/screenshots/s5-host-rejoin-same-id.png' });

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
