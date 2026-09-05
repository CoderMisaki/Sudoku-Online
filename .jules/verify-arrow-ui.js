/**
 * Uji UI Arrow Puzzle Master: merender <ArrowPuzzleBoard /> yang SUNGGUHAN di
 * dalam jsdom, lalu menekan tombol-tombol kotaknya seperti pemain.
 *
 * Jalankan: npm run verify:arrow-ui
 * (mengompilasi komponen + dependensinya ke .tmp-arrow-build lebih dulu)
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert');

const BUILD = path.join(__dirname, '..', '.tmp-arrow-build');

// Komponen memakai alias "@/..." (dipetakan tsconfig Next). Arahkan ke hasil build.
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(request, ...rest) {
  if (typeof request === 'string' && request.startsWith('@/')) {
    return origResolve.call(this, path.join(BUILD, request.slice(2)), ...rest);
  }
  return origResolve.call(this, request, ...rest);
};

const { JSDOM } = require('jsdom');

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000/',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.navigator = dom.window.navigator;
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLButtonElement = dom.window.HTMLButtonElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.matchMedia =
  dom.window.matchMedia ||
  (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = React;

const { useGameStore } = require(path.join(BUILD, 'store/gameStore.js'));
const { ArrowPuzzleBoard } = require(path.join(BUILD, 'components/game/ArrowPuzzleBoard.js'));
const arrow = require(path.join(BUILD, 'utils/arrowPuzzle.js'));

const ME = 'verify-me';
const HOST = 'verify-host';
let checks = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  checks++;
};

function seedRoom(variant, difficulty) {
  const store = useGameStore.getState();
  const mode = variant === 'classic' ? 'arrow_classic' : 'arrow_competition';
  const startedAt = 1700000000000;
  store.setUserInfo(ME, 'AKU');
  store.setRoom({
    id: 'VERIFY',
    code: 'VERIFY',
    hostId: variant === 'classic' ? ME : HOST,
    difficulty,
    mode,
    maxPlayers: 4,
    status: 'playing',
    players: {
      [HOST]: { id: HOST, username: 'HOST', color: '#3b82f6', isHost: variant === 'competition', score: 0, hints: 3, status: 'online' },
      [ME]: { id: ME, username: 'AKU', color: '#ef4444', isHost: variant === 'classic', score: 0, hints: 3, status: 'online' },
    },
    createdAt: startedAt,
    startedAt,
  });
  store.replaceAllArrowPuzzleState(
    arrow.createArrowRound(difficulty, variant, arrow.buildArrowSeed('VERIFY', difficulty, startedAt), 0)
  );
}

function mount(containerId, props) {
  let container = document.getElementById(containerId);
  if (!container) {
    container = document.createElement('div');
    container.id = containerId;
    document.body.appendChild(container);
  }
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(ArrowPuzzleBoard, props));
  });
  return root;
}

function gridButtons(containerId) {
  const scope = containerId ? document.getElementById(containerId) : document;
  assert.ok(scope, `container ${containerId} harus ada`);
  const grid = Array.from(scope.querySelectorAll('div')).find((d) =>
    (d.getAttribute('style') || '').includes('grid-template-columns')
  );
  assert.ok(grid, 'grid papan panah harus ada di DOM');
  return Array.from(grid.children);
}

const idx = (size, r, c) => r * size + c;

async function click(buttons, size, r, c) {
  const btn = buttons[idx(size, r, c)];
  assert.ok(btn, `tombol (${r},${c}) harus ada`);
  await act(async () => {
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const myScore = () => useGameStore.getState().room.players[ME].score ?? 0;
const myState = () => useGameStore.getState().arrowPuzzleState;

// ─────────────────────────────────────────────────────────────────────────────
// 1. MODE CLASSIC — papan terender, panah sesuai state, tap menilai skor
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  seedRoom('classic', 'easy');
  const moves = [];
  const stats = [];
  const root = mount('root-classic', {
    sendArrowMove: (row, col, basePathLength) => moves.push({ row, col, basePathLength }),
    broadcastPlayerStats: (s) => stats.push(s),
  });

  const state = myState();
  const size = state.size;
  const buttons = gridButtons('root-classic');
  ok(buttons.length === size * size, `papan easy merender ${size * size} kotak (dapat ${buttons.length})`);
  ok(
    document.body.textContent.includes('Arrow Classic (Ko-op Realtime)'),
    'badge mode Arrow Classic tampil'
  );
  ok(document.body.textContent.includes('Skor kamu: 0'), 'skor awal 0 tampil');

  // Panah yang digambar harus sama dengan isi state
  let wallCount = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const btn = buttons[idx(size, r, c)];
      const dir = state.arrows[r][c];
      const isGoal = state.goal.row === r && state.goal.col === c;
      const isStart = state.start.row === r && state.start.col === c;
      const arrowSvg = btn.querySelector('svg.lucide-arrow-up');
      const flagSvg = btn.querySelector('svg.lucide-flag');

      if (dir === null) {
        wallCount++;
        ok(!arrowSvg && !flagSvg, `(${r},${c}) tembok digambar tanpa panah`);
      } else if (isGoal) {
        ok(Boolean(flagSvg), `(${r},${c}) GOAL digambar dengan ikon bendera`);
      } else {
        const style = arrowSvg ? arrowSvg.getAttribute('style') || '' : '';
        ok(style.includes(`rotate(${dir * 90}deg)`), `(${r},${c}) panah digambar rotate(${dir * 90}deg)`);
        if (isStart) ok(btn.textContent.includes('S'), 'kotak START diberi label S');
      }
    }
  }
  ok(wallCount > 0, `papan easy punya tembok (${wallCount} kotak)`);

  // Jalur solusi dari papan yang sama (pemain membaca panah, uji meniru itu)
  const steps = state.solutionPath.slice(1);
  const wrongCell = (() => {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (state.arrows[r][c] === null) continue;
        if (r === state.start.row && c === state.start.col) continue;
        if (steps[0].row === r && steps[0].col === c) continue;
        return { row: r, col: c };
      }
    }
    throw new Error('tidak ada kotak salah untuk diuji');
  })();

  // ── Tap benar pertama: +10
  await click(buttons, size, steps[0].row, steps[0].col);
  ok(myScore() === 10, `tap benar pertama +10 (skor ${myScore()})`);
  ok(myState().currentPath.length === 1, 'jejak bersama bertambah 1');
  ok(
    moves.length === 1 &&
      moves[0].row === steps[0].row &&
      moves[0].col === steps[0].col &&
      moves[0].basePathLength === 0,
    'mode Classic meneruskan tap ke pemain lain (sendArrowMove)'
  );
  ok(stats.length === 1 && stats[0].score === 10, 'skor disiarkan lewat player_stats');
  ok(document.body.textContent.includes('Skor kamu: 10'), 'skor 10 tampil di UI');
  console.log('  ✓ Classic: papan terender, tap benar +10, tap disiarkan realtime');

  // ── Tiga tap salah beruntun: -5, -10, -20
  await click(buttons, size, wrongCell.row, wrongCell.col);
  ok(myScore() === 5, `salah #1 -5 (skor ${myScore()})`);
  await click(buttons, size, wrongCell.row, wrongCell.col);
  ok(myScore() === -5, `salah #2 -10 (skor ${myScore()})`);
  await click(buttons, size, wrongCell.row, wrongCell.col);
  ok(myScore() === -25, `salah #3 -20 (skor ${myScore()})`);
  ok(
    document.body.textContent.includes('Salah beruntun ×3'),
    'peringatan salah beruntun ×3 tampil'
  );
  ok(document.body.textContent.includes('berikutnya -40'), 'ancaman penalti berikutnya -40 tampil');
  console.log('  ✓ Classic: salah beruntun -5 → -10 → -20, UI menampilkan ancaman -40');

  // ── Tap benar berikutnya: +10 dan streak kembali nol
  await click(buttons, size, steps[1].row, steps[1].col);
  ok(myScore() === -15, `tap benar setelah salah +10 (skor ${myScore()})`);
  ok(myState().wrongStreak[ME] === 0, 'salah beruntun direset setelah tap benar');

  await click(buttons, size, wrongCell.row, wrongCell.col);
  ok(myScore() === -20, `salah pertama setelah reset kembali -5 (skor ${myScore()})`);
  console.log('  ✓ Classic: tap benar mereset penalti ke -5');

  // ── Tuntaskan sisa jalur
  for (let i = 2; i < steps.length; i++) {
    await click(buttons, size, steps[i].row, steps[i].col);
  }
  const finalScore = -20 + (steps.length - 2) * 10 + arrow.ARROW_TEAM_BONUS;
  ok(myScore() === finalScore, `skor akhir ${finalScore} (dapat ${myScore()})`);
  ok(myState().completed === true, 'puzzle Classic ditandai selesai');
  ok(myState().winnerId === ME, 'winnerId = pemain penentu langkah terakhir');
  ok(
    document.body.textContent.includes('Puzzle Dituntaskan Bersama!'),
    'overlay selesai tampil'
  );
  const afterDone = myScore();
  await click(buttons, size, state.goal.row, state.goal.col);
  ok(myScore() === afterDone, 'tap setelah selesai tidak mengubah skor');
  console.log(`  ✓ Classic: ${steps.length} langkah tuntas, skor akhir ${finalScore} (+${arrow.ARROW_TEAM_BONUS} bonus tim)`);

  // ───────────────────────────────────────────────────────────────────────────
  // 2. MODE COMPETITION — papan sendiri, tanpa broadcast langkah, ada peringkat
  // ───────────────────────────────────────────────────────────────────────────
  act(() => root.unmount());
  seedRoom('competition', 'evil');
  const compMoves = [];
  const compRoot = mount('root-competition', {
    sendArrowMove: (row, col, basePathLength) => compMoves.push({ row, col, basePathLength }),
    broadcastPlayerStats: () => {},
  });

  const compState = myState();
  ok(compState.size === arrow.ARROW_DIFFICULTY.evil.size, `papan evil berukuran ${compState.size}×${compState.size}`);
  ok(gridButtons('root-competition').length === compState.size ** 2, 'papan evil merender semua kotak');
  ok(
    document.body.textContent.includes('Arrow Competition (Papan Sendiri)'),
    'badge mode Arrow Competition tampil'
  );
  ok(document.body.textContent.includes('Papan Peringkat'), 'papan peringkat tampil');

  const compSteps = compState.solutionPath.slice(1);
  const compButtons = gridButtons('root-competition');
  const firstWrong = (() => {
    for (let r = 0; r < compState.size; r++) {
      for (let c = 0; c < compState.size; c++) {
        if (compState.arrows[r][c] === null) continue;
        if (r === 0 && c === 0) continue;
        if (compSteps[0].row === r && compSteps[0].col === c) continue;
        return { row: r, col: c };
      }
    }
    throw new Error('tidak ada kotak salah');
  })();

  await click(compButtons, compState.size, firstWrong.row, firstWrong.col);
  ok(myScore() === -5, `competition: salah pertama -5 (skor ${myScore()})`);
  ok(compMoves.length === 0, 'competition TIDAK menyiarkan tap ke pemain lain (papan terisolasi)');

  for (let i = 0; i < compSteps.length; i++) {
    await click(compButtons, compState.size, compSteps[i].row, compSteps[i].col);
  }
  const compScore = -5 + compSteps.length * 10 + 100;
  ok(myScore() === compScore, `competition: skor akhir ${compScore} (dapat ${myScore()})`);
  ok(useGameStore.getState().room.players[ME].rank === 1, 'competition: finis pertama -> peringkat 1');
  ok(arrow.isArrowPuzzleFinished(myState(), ME), 'competition: puzzle selesai');
  ok(document.body.textContent.includes('Kamu Mencapai GOAL!'), 'overlay selesai competition tampil');
  ok(document.body.textContent.includes('🥇'), 'medali juara 1 tampil di papan peringkat');
  console.log(`  ✓ Competition: papan ${compState.size}×${compState.size} sendiri, salah -5, finis juara 1 dengan skor ${compScore}`);

  act(() => compRoot.unmount());

  // ───────────────────────────────────────────────────────────────────────────
  // 3. REGRESI: "Papan Baru" tidak boleh ditimpa ulang oleh effect inisialisasi
  //    (dulu: setiap update room memicu effect dan mengembalikan papan seed)
  // ───────────────────────────────────────────────────────────────────────────
  seedRoom('classic', 'medium');
  const broadcasts = [];
  const root3 = mount('host-classic-3', {
    sendArrowMove: () => {},
    broadcastPlayerStats: () => {},
    broadcastArrowPuzzleState: (st) => broadcasts.push(st.boardId),
  });

  const seededBoard = myState();
  const seededSeed = seededBoard.seed;
  const newBoardBtn = Array.from(document.querySelectorAll('#host-classic-3 button')).find((b) =>
    b.textContent.includes('Papan Baru')
  );
  ok(Boolean(newBoardBtn), 'tombol Papan Baru tersedia untuk host');

  await act(async () => {
    newBoardBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });

  const manualBoard = myState();
  ok(manualBoard.boardId !== seededBoard.boardId, 'Papan Baru menghasilkan boardId berbeda');
  ok(manualBoard.seed !== seededSeed, 'Papan Baru memakai seed manual (bukan seed ronde)');
  ok(broadcasts.length >= 1, 'host menyiarkan papan baru ke pemain lain');

  // Main satu langkah -> updatePlayer membuat objek room baru -> effect init jalan lagi.
  const step1 = manualBoard.solutionPath[1];
  await click(gridButtons('host-classic-3'), manualBoard.size, step1.row, step1.col);
  ok(myState().boardId === manualBoard.boardId, 'papan manual TIDAK ditimpa papan seed setelah ada update room');
  ok(myState().currentPath.length === 1, 'langkah di papan manual tetap tersimpan');
  console.log('  ✓ Regresi: Papan Baru bertahan setelah update room (tidak ditimpa seed)');

  act(() => root3.unmount());

  console.log(`\nSEMUA LOLOS — ${checks} assertions UI (komponen asli dirender di jsdom).`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
