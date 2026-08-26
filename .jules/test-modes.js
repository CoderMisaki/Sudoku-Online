// eslint-disable-next-line @typescript-eslint/no-require-imports
const { chromium } = require('playwright');

function log(tag, msg) {
  console.log(`[${new Date().toISOString().slice(11, 23)}][${tag}] ${msg}`);
}

async function attachObserver(page, tag) {
  page.on('console', (m) => {
    const t = m.text();
    if (t.includes('DEBUG-TOAST')) log(`${tag}`, t.slice(0, 250));
  });
  await page.addInitScript(() => {
    window.__toasts = [];
    const scan = () => {
      const c = document.querySelector('[data-rht-toaster]');
      if (c) {
        const txt = (c.innerText || '').trim();
        if (txt && window.__toasts[window.__toasts.length - 1] !== txt) {
          window.__toasts.push(txt);
        }
      }
    };
    const obs = new MutationObserver(scan);
    const start = () => obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  });
}

async function waitForToast(page, regex, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const toasts = await page.evaluate(() => window.__toasts || []);
    const hit = toasts.find((t) => regex.test(t));
    if (hit) return hit;
    await page.waitForTimeout(200);
  }
  return null;
}

async function makeMove(page) {
  const idx = await page.evaluate(() => {
    const board = document.querySelector('.grid.grid-cols-9');
    if (!board) return -1;
    const cells = Array.from(board.children);
    for (let i = 0; i < cells.length; i++) if (!cells[i].textContent.trim()) return i;
    return -1;
  });
  if (idx < 0) return false;
  await page.locator('.grid.grid-cols-9 > div').nth(idx).click();
  await page.keyboard.press('7');
  return true;
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  const MODES = ['collaborative', 'classic', 'competition', 'race', 'zen'];

  for (const mode of MODES) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await attachObserver(page, mode);

    await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);
    await page.getByPlaceholder('Contoh: Alex').fill('Solo');
    await page.getByText('Buat Room Baru').click();
    // select mode in the modal
    const selects = page.locator('select');
    await selects.nth(1).selectOption(mode); // 0=difficulty, 1=mode, 2=maxPlayers
    await page.getByRole('button', { name: 'Mulai Room' }).click();
    await page.waitForURL(/\/room\//, { timeout: 60000 });
    const boardOk = await page.waitForSelector('.grid.grid-cols-9', { timeout: 45000 }).then(() => true).catch(() => false);
    if (!boardOk) {
      log(mode, 'BOARD NEVER LOADED (snakes mode has no sudoku board or sync failed)');
      await ctx.close();
      continue;
    }
    await page.waitForTimeout(800);

    const moved = await makeMove(page);
    const toast = moved ? await waitForToast(page, /Jawaban (Benar|Salah)/, 6000) : null;
    log(mode, `move=${moved} answerToast=${toast ? JSON.stringify(toast) : 'NONE'}`);
    await ctx.close();
  }

  await browser.close();
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
