/**
 * Uji UI Arrow Puzzle Master (ARROW REMOVAL): merender <ArrowPuzzleBoard /> yang
 * SUNGGUHAN di jsdom, lalu mengetuk arrow (pointer/touch/mouse) seperti pemain.
 *
 * Jalankan: npm run verify:arrow-ui
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const path = require('node:path');
const Module = require('node:module');
const assert = require('node:assert');

const BUILD = path.join(__dirname, '..', '.tmp-arrow-build');

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
global.SVGElement = dom.window.SVGElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.Event = dom.window.Event;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
global.cancelAnimationFrame = (id) => clearTimeout(id);
global.matchMedia =
  dom.window.matchMedia ||
  (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
global.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom belum punya PointerEvent: pakai MouseEvent sebagai dasar (React membaca type saja).
if (!dom.window.PointerEvent) {
  dom.window.PointerEvent = class PointerEvent extends dom.window.MouseEvent {
    constructor(type, init = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  };
}
global.PointerEvent = dom.window.PointerEvent;
// Viewport ponsel (portrait) untuk memastikan render tidak bergantung pada layar lebar.
Object.defineProperty(dom.window, 'innerWidth', { value: 390, configurable: true });
Object.defineProperty(dom.window, 'innerHeight', { value: 844, configurable: true });

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
const eq = (a, b, label) => {
  assert.strictEqual(a, b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  checks++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function seedRoom(variant, difficulty, extra = {}) {
  const store = useGameStore.getState();
  // 'practice' memakai papan sendiri (variant competition) tapi mode arrow_practice
  // — di sinilah tombol Auto & All tersedia (mode belajar).
  const mode = variant === 'classic' ? 'arrow_classic' : variant === 'practice' ? 'arrow_practice' : 'arrow_competition';
  const boardVariant = variant === 'classic' ? 'classic' : 'competition';
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
      [HOST]: { id: HOST, username: 'HOST', color: '#3b82f6', isHost: variant === 'competition' || variant === 'practice', score: 0, hints: 3, status: 'online' },
      [ME]: { id: ME, username: 'AKU', color: '#ef4444', isHost: variant === 'classic', score: 0, hints: 3, status: 'online' },
    },
    createdAt: startedAt,
    startedAt,
    ...extra,
  });
  store.replaceAllArrowPuzzleState(
    arrow.createArrowRound(difficulty, boardVariant, arrow.buildArrowSeed('VERIFY', difficulty, startedAt), 0)
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
  return { root, container };
}

const arrowEls = (container, state) =>
  Array.from(container.querySelectorAll(`[data-arrow-id]${state ? `[data-arrow-state="${state}"]` : ''}`));
const arrowEl = (container, id, state = 'idle') =>
  container.querySelector(`[data-arrow-id="${id}"][data-arrow-state="${state}"]`);

async function tap(el, pointerType = 'mouse') {
  assert.ok(el, 'elemen arrow harus ada');
  await act(async () => {
    el.dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType }));
  });
}

const myScore = () => useGameStore.getState().room.players[ME].score ?? 0;
const myState = () => useGameStore.getState().arrowPuzzleState;

async function waitExits(container, ms = 900) {
  // Beri waktu animasi framer (dalam jsdom animasi berjalan via setTimeout/raf) menyelesaikan onComplete.
  const start = Date.now();
  while (Date.now() - start < ms) {
    await act(async () => {
      await sleep(40);
    });
    if (arrowEls(container, 'exiting').length === 0) break;
  }
}

(async () => {
  // ───────────────────────────────────────────────────────────────────────────
  // 1. CLASSIC — papan SVG terender, tap arrow bebas keluar, blocked ditolak
  // ───────────────────────────────────────────────────────────────────────────
  {
    seedRoom('classic', 'easy');
    const moves = [];
    const stats = [];
    const { root, container } = mount('root-classic', {
      sendArrowMove: (arrowId, baseRevision) => moves.push({ arrowId, baseRevision }),
      broadcastPlayerStats: (s) => stats.push(s),
    });

    const state = myState();
    ok(container.querySelector('[data-testid="arrow-board"]'), 'papan arrow terender');
    ok(container.querySelector('svg'), 'papan memakai SVG (bukan grid tombol)');
    ok(!container.querySelector('svg.lucide-flag'), 'tidak ada ikon flag GOAL');
    ok(!container.textContent.includes('GOAL') && !container.textContent.includes('START'), 'tidak ada teks START/GOAL');
    ok(!container.textContent.includes('Langkah'), 'tidak ada progress langkah START→GOAL');
    ok(container.textContent.includes('Puzzle') , 'header Arrow Puzzle');
    ok(!container.textContent.includes('Sudoku'), 'tidak ada teks Sudoku di Arrow Mode');

    const idle = arrowEls(container, 'idle');
    eq(idle.length, state.arrows.length, 'semua arrow aktif terender sebagai elemen tap');
    for (const a of state.arrows) {
      const el = arrowEl(container, a.id);
      ok(el, `arrow ${a.id} terender`);
      ok(el.querySelector('polygon'), `arrow ${a.id} punya kepala panah`);
      ok(el.querySelector('path[stroke="#1f2a48"]'), `arrow ${a.id} track dark navy`);
      eq(el.getAttribute('role'), 'button', `arrow ${a.id} bisa ditap (role=button)`);
    }

    const movable = arrow.getMovableArrowIds(state, ME);
    const blockedId = state.arrows.map((a) => a.id).find((id) => !movable.includes(id));
    ok(blockedId, 'ada arrow yang terhalang di awal');
    ok(movable.length > 0, 'ada arrow yang bebas di awal');

    // Tap arrow terhalang -> tidak keluar, penalti -5, tidak dikirim ke pemain lain
    await tap(arrowEl(container, blockedId));
    eq(myScore(), -5, 'blocked tap: skor -5');
    eq(arrow.getRemovedArrowIds(myState(), ME).length, 0, 'blocked tap: arrow tidak dihapus');
    ok(arrowEl(container, blockedId, 'idle'), 'blocked tap: arrow masih di papan');
    eq(moves.length, 0, 'blocked tap: tidak dibroadcast');
    ok(container.textContent.includes('Terhalang'), 'blocked tap: feedback teks kecil tampil');

    // Tap arrow bebas -> masuk state exiting, skor +10, dibroadcast
    const freeId = movable[0];
    const rev = myState().revision;
    await tap(arrowEl(container, freeId), 'touch');
    eq(myScore(), 5, 'free tap (touch): skor -5 + 10 = 5');
    ok(arrow.getRemovedArrowIds(myState(), ME).includes(freeId), 'free tap: arrow tercatat keluar');
    eq(moves.length, 1, 'free tap: dikirim ke pemain lain');
    eq(moves[0].arrowId, freeId, 'free tap: arrowId benar');
    eq(moves[0].baseRevision, rev, 'free tap: baseRevision benar');
    ok(arrowEl(container, freeId, 'exiting'), 'free tap: arrow beranimasi keluar (bukan langsung hilang)');
    ok(!arrowEl(container, freeId, 'idle'), 'free tap: arrow tidak lagi bisa ditap');
    ok(stats.length >= 2 && stats[stats.length - 1].score === 5, 'stats dibroadcast');

    // Double tap saat animasi -> tidak ada efek
    const scoreBefore = myScore();
    const exitingEl = arrowEl(container, freeId, 'exiting');
    await tap(exitingEl);
    eq(myScore(), scoreBefore, 'double tap saat exiting: skor tidak berubah');
    eq(moves.length, 1, 'double tap saat exiting: tidak ada broadcast ganda');
    eq(arrow.getRemovedArrowIds(myState(), ME).filter((id) => id === freeId).length, 1, 'tidak ada double removal');

    // Tunggu animasi: arrow benar-benar dihapus dari DOM
    await waitExits(container, 1500);
    ok(!container.querySelector(`[data-arrow-id="${freeId}"]`), 'setelah animasi: arrow dihapus dari papan');
    eq(arrowEls(container, 'idle').length, state.arrows.length - 1, 'sisa arrow tetap di posisi');

    // Realtime: pemain lain (HOST) mengeluarkan arrow -> client ini melihat animasinya
    const s2 = myState();
    const otherFree = arrow.getMovableArrowIds(s2, HOST)[0];
    const r = arrow.applyArrowMove(s2, HOST, otherFree, 'HOST');
    await act(async () => {
      useGameStore.getState().replaceAllArrowPuzzleState(r.state);
    });
    ok(arrowEl(container, otherFree, 'exiting'), 'realtime classic: arrow milik pemain lain beranimasi keluar di client ini');
    await waitExits(container, 1500);
    ok(!container.querySelector(`[data-arrow-id="${otherFree}"]`), 'realtime classic: arrow lawan dihapus setelah animasi');
    eq(myScore(), 5, 'realtime classic: skor saya tidak berubah karena langkah pemain lain');

    // Selesaikan sisa dengan urutan solver -> overlay Puzzle Complete
    let cur = myState();
    let guard = 0;
    while (!arrow.isArrowPuzzleFinished(cur, ME) && guard++ < 50) {
      const next = arrow.getMovableArrowIds(cur, ME)[0];
      await tap(arrowEl(container, next));
      await waitExits(container, 1500);
      cur = myState();
    }
    ok(arrow.isArrowPuzzleFinished(cur, ME), 'classic: semua arrow keluar');
    ok(cur.completed, 'classic: completed=true');
    eq(arrowEls(container).length, 0, 'classic: papan kosong dari arrow');
    await act(async () => {
      await sleep(250);
    });
    ok(container.textContent.includes('Puzzle Complete'), 'classic: overlay Puzzle Complete tampil');
    ok(!container.textContent.includes('GOAL'), 'classic: tidak ada teks GOAL saat selesai');
    const totalRemovedByMe = state.arrows.length - 1; // satu dikeluarkan HOST
    eq(myScore(), -5 + totalRemovedByMe * 10 + arrow.ARROW_TEAM_BONUS, 'classic: skor akhir = penalti + 10/arrow + bonus tim');

    act(() => root.unmount());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. COMPETITION — papan sendiri, tidak mengirim langkah, isolasi dari lawan
  // ───────────────────────────────────────────────────────────────────────────
  {
    seedRoom('competition', 'medium');
    const moves = [];
    const { root, container } = mount('root-comp', {
      sendArrowMove: (arrowId, baseRevision) => moves.push({ arrowId, baseRevision }),
      broadcastPlayerStats: () => {},
    });
    const state = myState();
    const movable = arrow.getMovableArrowIds(state, ME);
    await tap(arrowEl(container, movable[0]));
    eq(moves.length, 0, 'competition: tap TIDAK dibroadcast sebagai arrow_move');
    eq(myScore(), 10, 'competition: +10');
    eq(arrow.getRemovedArrowIds(myState(), HOST).length, 0, 'competition: papan lawan tidak terpengaruh');
    eq(myState().removedArrowIds.length, 0, 'competition: removedArrowIds bersama kosong');
    ok(arrowEl(container, movable[0], 'exiting'), 'competition: animasi keluar');
    await waitExits(container, 1500);

    // Simulasi lawan menyelesaikan papannya: papan saya tidak berubah
    let s = myState();
    const solved = arrow.solveArrowPuzzle(s.arrows, s.size);
    for (const id of solved) s = arrow.applyArrowMove(s, HOST, id, 'HOST').state;
    await act(async () => {
      useGameStore.getState().replaceAllArrowPuzzleState(s);
    });
    eq(arrowEls(container, 'idle').length, state.arrows.length - 1, 'competition: langkah lawan tidak menghapus arrow di papan saya');
    ok(!container.textContent.includes('Puzzle Complete'), 'competition: overlay tidak muncul karena lawan selesai');
    ok(!container.querySelector('[data-testid="arrow-auto"]') && !container.querySelector('[data-testid="arrow-all"]'), 'competition: tombol Auto/All TIDAK ada (bukan mode belajar)');

    act(() => root.unmount());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2b. CLASSIC — juga tanpa tombol Auto/All (fitur belajar hanya di Practice)
  // ───────────────────────────────────────────────────────────────────────────
  {
    seedRoom('classic', 'easy');
    const { root, container } = mount('root-classic-noauto', { broadcastPlayerStats: () => {} });
    ok(!container.querySelector('[data-testid="arrow-auto"]') && !container.querySelector('[data-testid="arrow-all"]'), 'classic: tombol Auto/All TIDAK ada (bukan mode belajar)');
    act(() => root.unmount());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. AUTO / ALL — menyelesaikan puzzle otomatis satu per satu
  // ───────────────────────────────────────────────────────────────────────────
  {
    seedRoom('practice', 'easy');
    const { root, container } = mount('root-auto', { broadcastPlayerStats: () => {} });
    const total = myState().arrows.length;
    const autoBtn = container.querySelector('[data-testid="arrow-auto"]');
    const allBtn = container.querySelector('[data-testid="arrow-all"]');
    ok(autoBtn && allBtn, 'tombol Auto & All tersedia');

    await act(async () => {
      autoBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    eq(arrow.getRemovedArrowIds(myState(), ME).length, 1, 'Auto: mengeluarkan tepat satu arrow');
    eq(myScore(), 0, 'Auto: tanpa poin');
    eq(arrowEls(container, 'exiting').length, 1, 'Auto: satu arrow beranimasi');
    ok(autoBtn.disabled && allBtn.disabled, 'Auto: tombol terkunci selama animasi');
    await waitExits(container, 1500);
    await act(async () => {
      await sleep(550);
    });
    ok(!container.querySelector('[data-testid="arrow-all"]').disabled, 'Auto: tombol terbuka lagi setelah animasi');

    await act(async () => {
      container.querySelector('[data-testid="arrow-all"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    // All berjalan bertahap (satu per satu), bukan sekaligus
    ok(arrow.getRemovedArrowIds(myState(), ME).length < total, 'All: tidak teleport semua arrow sekaligus');
    const start = Date.now();
    while (!arrow.isArrowPuzzleFinished(myState(), ME) && Date.now() - start < 8000) {
      await act(async () => {
        await sleep(60);
      });
    }
    ok(arrow.isArrowPuzzleFinished(myState(), ME), 'All: puzzle selesai');
    await waitExits(container, 2000);
    await act(async () => {
      await sleep(300);
    });
    eq(arrowEls(container).length, 0, 'All: semua arrow hilang dari papan');
    ok(container.textContent.includes('Puzzle Complete'), 'All: overlay Puzzle Complete');

    act(() => root.unmount());
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. State format lama (START/GOAL) ditolak store
  // ───────────────────────────────────────────────────────────────────────────
  {
    seedRoom('classic', 'easy');
    const before = myState();
    useGameStore.getState().replaceAllArrowPuzzleState({
      boardId: 'legacy', seed: 'x', size: 5, arrows: [[0, 1], [null, 2]],
      start: { row: 0, col: 0 }, goal: { row: 1, col: 1 }, solutionPath: [], revision: 999,
    });
    ok(myState() === before, 'store menolak snapshot maze lama');
  }

  console.log(`\n✅ verify-arrow-ui: ${checks} pemeriksaan lulus`);
  process.exit(0);
})().catch((err) => {
  console.error('❌ verify-arrow-ui gagal:', err);
  process.exit(1);
});
