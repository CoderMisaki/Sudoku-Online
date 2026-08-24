// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('playwright');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('fs');
const SHOT_DIR = '.jules/screenshots';
if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(11, 23)}][${tag}] ${msg}`);
}

async function attachDebug(page, tag) {
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('DEBUG-TOAST') || t.includes('TOASTOBSERVER') || t.includes('Realtime Logs') || /error/i.test(t)) {
      log(`${tag} console`, t.slice(0, 300));
    }
  });
  page.on('pageerror', (e) => log(`${tag} pageerror`, e.message));
  // Observe the real toaster container (react-hot-toast renders go* classes, not _toastItem)
  await page.addInitScript(() => {
    window.__toasts = [];
    const scan = () => {
      const c = document.querySelector('[data-rht-toaster]');
      if (c) {
        const txt = (c.innerText || '').trim();
        if (txt && window.__toasts[window.__toasts.length - 1] !== txt) {
          window.__toasts.push(txt);
          console.log('TOASTOBSERVER: ' + txt.replace(/\n/g, ' | '));
        }
      }
    };
    const obs = new MutationObserver(scan);
    const start = () => obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  });
}

async function dumpPlayers(page, tag, label) {
  const txt = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('main > div > div'));
    const playersCard = cards.find((c) => c.querySelector('h2')?.textContent?.includes('Players'));
    if (!playersCard) return '(players card not found)';
    return playersCard.innerText;
  }).catch(() => '(evaluate failed)');
  log(tag, `--- PLAYERS (${label}) ---\n${txt}\n----------------------`);
}

async function waitForBoard(page, tag, timeoutMs = 45000) {
  try {
    await page.waitForSelector('.grid.grid-cols-9', { timeout: timeoutMs });
    log(tag, 'board visible');
    return true;
  } catch {
    log(tag, 'BOARD NOT VISIBLE after timeout');
    return false;
  }
}

async function waitForToast(page, tag, regex, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const toasts = await page.evaluate(() => window.__toasts || []);
    const hit = toasts.find((t) => regex.test(t));
    if (hit) {
      log(tag, `TOAST SEEN: "${hit}"`);
      return hit;
    }
    await page.waitForTimeout(250);
  }
  const all = await page.evaluate(() => window.__toasts || []);
  log(tag, `NO TOAST matching ${regex} within ${timeoutMs}ms. All toasts seen: ${JSON.stringify(all)}`);
  return null;
}

async function clickEmptyCellAndType(page, tag, digit) {
  const idx = await page.evaluate(() => {
    const board = document.querySelector('.grid.grid-cols-9');
    if (!board) return -1;
    const cells = Array.from(board.children);
    for (let i = 0; i < cells.length; i++) {
      if (!cells[i].textContent.trim()) return i;
    }
    return -1;
  });
  if (idx < 0) {
    log(tag, 'no empty cell found!');
    return false;
  }
  await page.locator('.grid.grid-cols-9 > div').nth(idx).click();
  await page.keyboard.press(String(digit));
  log(tag, `clicked cell #${idx} and typed ${digit}`);
  return true;
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  });

  // ---------------- HOST ----------------
  const hostCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const host = await hostCtx.newPage();
  await attachDebug(host, 'HOST');

  log('HOST', 'open home');
  await host.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await host.waitForTimeout(4000); // allow hydration
  await host.getByPlaceholder('Contoh: Alex').fill('HostTest');
  await host.waitForTimeout(300);
  log('HOST', 'username value = ' + (await host.getByPlaceholder('Contoh: Alex').inputValue()));
  await host.screenshot({ path: `${SHOT_DIR}/debug-host-home.png` });
  await host.getByText('Buat Room Baru').click();
  await host.waitForTimeout(1000);
  await host.screenshot({ path: `${SHOT_DIR}/debug-host-modal.png` });
  await host.getByRole('button', { name: 'Mulai Room' }).click({ timeout: 30000 });
  await host.waitForURL(/\/room\/[A-Z0-9]{5}/, { timeout: 60000 });
  const roomUrl = host.url();
  const roomId = roomUrl.split('/room/')[1];
  log('HOST', `room created: ${roomId}`);

  await waitForBoard(host, 'HOST');

  // ---------------- GUEST ----------------
  const guestCtx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const guest = await guestCtx.newPage();
  await attachDebug(guest, 'GUEST');

  log('GUEST', 'open home');
  await guest.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded', timeout: 120000 });
  await guest.waitForTimeout(4000); // allow hydration
  await guest.getByPlaceholder('Contoh: Alex').fill('GuestTest');
  await guest.getByText('Gabung Room').click();
  await guest.waitForTimeout(1000);
  await guest.screenshot({ path: `${SHOT_DIR}/debug-guest-modal.png` });
  await guest.getByPlaceholder('Masukan code room...').fill(roomId);
  await guest.getByRole('button', { name: 'Masuk Room' }).click({ timeout: 30000 });
  await guest.waitForURL(new RegExp(`/room/${roomId}`), { timeout: 60000 });
  log('GUEST', `joined room page: ${guest.url()}`);
  await waitForBoard(guest, 'GUEST');

  // give presence some time to propagate
  await host.waitForTimeout(5000);

  // ===== BUG 2 CHECK =====
  log('CHECK', '=== BUG 2: player list on host ===');
  await dumpPlayers(host, 'HOST', 'host view');
  await dumpPlayers(guest, 'GUEST', 'guest view');
  await host.screenshot({ path: `${SHOT_DIR}/bug2-host-players.png`, fullPage: true });

  const hostList = await host.evaluate(() => document.querySelector('main').innerText);
  const bug2Missing = !hostList.includes('GuestTest');
  const bug2Disconnect = hostList.includes('( Disconnect )') || hostList.includes('( Leave Room )');
  log('CHECK', `BUG2 summary: guest missing on host=${bug2Missing}, marked disconnected/left=${bug2Disconnect}`);

  // ===== BUG 1 CHECK (host makes moves) =====
  log('CHECK', '=== BUG 1: answer toasts ===');

  // Move 1: arbitrary digit (likely WRONG)
  const moved1 = await clickEmptyCellAndType(host, 'HOST', 9);
  await host.waitForTimeout(600);
  const toasterNow = await host.evaluate(() => document.querySelector('[data-rht-toaster]')?.innerText || '(empty)');
  log('HOST', `toaster DOM right after move: "${toasterNow.replace(/\n/g, ' | ')}"`);
  const hostToast1 = moved1 ? await waitForToast(host, 'HOST', /Jawaban (Benar|Salah)/) : false;
  const guestToast1 = moved1 ? await waitForToast(guest, 'GUEST', /Jawaban (Benar|Salah)/, 10000) : false;

  // Move 2: use HINT on the same selected cell -> guaranteed correct value
  await host.getByRole('button', { name: /Hint/ }).click();
  const hostToast2 = await waitForToast(host, 'HOST', /(Jawaban Benar|Hint digunakan|sudah benar)/);
  const guestToast2 = await waitForToast(guest, 'GUEST', /Jawaban Benar/, 10000);

  await host.screenshot({ path: `${SHOT_DIR}/bug1-host-after-moves.png`, fullPage: true });
  await guest.screenshot({ path: `${SHOT_DIR}/bug1-guest-after-moves.png`, fullPage: true });

  log('RESULT', JSON.stringify({
    roomId,
    bug2_guestMissingOnHost: bug2Missing,
    bug2_markedDisconnected: bug2Disconnect,
    bug1_hostToast_move: hostToast1,
    bug1_guestToast_move: guestToast1,
    bug1_hostToast_hint: hostToast2,
    bug1_guestToast_hint: guestToast2,
  }, null, 2));

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
