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

function analyze(hostList, guestList) {
  return {
    host_sees_guest: hostList.includes('GuestTest'),
    host_guest_disconnected: hostList.includes('( Disconnect )'),
    host_guest_left: hostList.includes('( Leave Room )'),
    guest_sees_self: guestList.includes('GuestTest'),
    guest_marked_disconnected: guestList.includes('( Disconnect )'),
    guest_marked_left: guestList.includes('( Leave Room )'),
  };
}

async function joinAsGuest(browser, roomId) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500); // hydration
  await page.getByPlaceholder('Contoh: Alex').fill('GuestTest');
  await page.getByText('Gabung Room').click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('Masukan code room...').fill(roomId);
  await page.getByRole('button', { name: 'Masuk Room' }).click();
  await page.waitForURL(new RegExp(`/room/${roomId}`), { timeout: 60000 });
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ===== S3: guest joins while host is still loading =====
  log('S3', '=== guest joins while host still loading puzzle ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.getByPlaceholder('Contoh: Alex').fill('HostTest');
    await page.getByText('Buat Room Baru').click();
    await page.getByRole('button', { name: 'Mulai Room' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}/, { timeout: 60000 });
    const roomId = page.url().split('/room/')[1];
    log('S3', `room ${roomId}, guest joins NOW (host board not loaded yet)`);

    const g = await joinAsGuest(browser, roomId);
    await page.waitForSelector('.grid.grid-cols-9', { timeout: 45000 });
    await page.waitForTimeout(10000);
    const hl = await playersText(page);
    const gl = await playersText(g.page);
    log('S3', 'HOST list: ' + hl);
    log('S3', 'GUEST list: ' + gl);
    log('S3', 'result: ' + JSON.stringify(analyze(hl, gl)));
    await page.screenshot({ path: '.jules/screenshots/s3-host.png' });
    await g.page.screenshot({ path: '.jules/screenshots/s3-guest.png' });
    await ctx.close(); await g.ctx.close();
  }

  // ===== S4: guest leaves, then rejoins the same room =====
  log('S4', '=== guest leaves then rejoins (sticky left check) ===');
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    await page.getByPlaceholder('Contoh: Alex').fill('HostTest');
    await page.getByText('Buat Room Baru').click();
    await page.getByRole('button', { name: 'Mulai Room' }).click();
    await page.waitForURL(/\/room\/[A-Z0-9]{5}/, { timeout: 60000 });
    const roomId = page.url().split('/room/')[1];
    await page.waitForSelector('.grid.grid-cols-9', { timeout: 45000 });

    const g = await joinAsGuest(browser, roomId);
    await page.waitForTimeout(5000);
    log('S4', 'after first join: ' + JSON.stringify(analyze(await playersText(page), await playersText(g.page))));

    // Guest leaves
    await g.page.getByRole('button', { name: /Leave/ }).click();
    await g.page.waitForURL('http://localhost:3000/', { timeout: 30000 });
    await page.waitForTimeout(3000);
    log('S4', 'after guest left HOST list: ' + (await playersText(page)));

    // Guest rejoins same room
    const g2 = await joinAsGuest(browser, roomId);
    await page.waitForTimeout(8000);
    const hl = await playersText(page);
    const gl = await playersText(g2.page);
    log('S4', 'after rejoin HOST list: ' + hl);
    log('S4', 'after rejoin GUEST list: ' + gl);
    log('S4', 'result: ' + JSON.stringify(analyze(hl, gl)));
    await page.screenshot({ path: '.jules/screenshots/s4-host-rejoin.png' });
    await g2.page.screenshot({ path: '.jules/screenshots/s4-guest-rejoin.png' });
    await ctx.close(); await g2.ctx.close();
  }

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
