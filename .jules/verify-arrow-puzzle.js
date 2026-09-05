/**
 * Verifikasi runtime engine Arrow Puzzle Master (ARROW REMOVAL PUZZLE).
 * Jalankan: npm run verify:arrow
 * (mengompilasi src/utils/arrowPuzzle.ts ke .tmp-arrow-build lebih dulu)
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert');
const path = require('node:path');

const engine = require(path.join(__dirname, '..', '.tmp-arrow-build', 'utils', 'arrowPuzzle.js'));

const {
  ARROW_DIRS,
  ARROW_DIFFICULTY,
  ARROW_CORRECT_POINTS,
  ARROW_TEAM_BONUS,
  ARROW_FINISH_BONUS,
  generateArrowPuzzle,
  generateArrowPuzzleDetailed,
  solveArrowPuzzle,
  isValidArrowGeometry,
  getArrowSweep,
  getArrowExitDistance,
  findBlockers,
  isArrowFree,
  applyArrowMove,
  evaluateArrowTap,
  getActiveArrows,
  getMovableArrowIds,
  getArrowProgress,
  getRemovedArrowIds,
  isArrowPuzzleFinished,
  getArrowWrongPenalty,
  getArrowNextPenalty,
  buildArrowSeed,
  isValidArrowPuzzleState,
  createArrowRound,
} = engine;

let checks = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  checks++;
};
const eq = (a, b, label) => {
  assert.strictEqual(a, b, `${label} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
  checks++;
};

const difficulties = ['easy', 'medium', 'hard', 'expert', 'evil'];
const SAMPLES = { easy: 120, medium: 100, hard: 60, expert: 40, evil: 20 };

// ── 1. Generator: solvable, geometri valid, deterministik, sesuai difficulty ─
for (const diff of difficulties) {
  const cfg = ARROW_DIFFICULTY[diff];
  let totalBlocked = 0;
  let totalArrows = 0;
  let shapesWithTurn = 0;
  const dirsSeen = new Set();

  for (let i = 0; i < SAMPLES[diff]; i++) {
    const seed = buildArrowSeed(`ROOM${i}`, diff, i);
    const { state, solutionOrder } = generateArrowPuzzleDetailed(diff, i % 2 === 0 ? 'classic' : 'competition', seed);

    eq(state.size, cfg.size, `${diff} #${i}: ukuran papan`);
    eq(state.difficulty, diff, `${diff} #${i}: difficulty tersimpan`);
    ok(state.arrows.length >= 3, `${diff} #${i}: minimal 3 arrow`);
    ok(!state.boardId.includes('fallback'), `${diff} #${i}: bukan fallback`);
    ok(isValidArrowPuzzleState(state), `${diff} #${i}: state valid`);

    // Geometri valid & tidak ada sel yang dipakai dua arrow
    const occ = new Set();
    for (const a of state.arrows) {
      ok(isValidArrowGeometry(a, state.size), `${diff} #${i}: geometri ${a.id} valid`);
      ok(a.cells.length >= 2, `${diff} #${i}: ${a.id} minimal 2 sel`);
      for (const c of a.cells) {
        const k = `${c.row}:${c.col}`;
        ok(!occ.has(k), `${diff} #${i}: sel ${k} tidak tumpang tindih`);
        occ.add(k);
      }
      dirsSeen.add(a.direction);
      const rows = new Set(a.cells.map((c) => c.row));
      const cols = new Set(a.cells.map((c) => c.col));
      if (rows.size > 1 && cols.size > 1) shapesWithTurn++;
    }
    const ids = new Set(state.arrows.map((a) => a.id));
    eq(ids.size, state.arrows.length, `${diff} #${i}: id unik`);

    // Solvable: solver menemukan urutan dan urutan internal generator valid
    const solved = solveArrowPuzzle(state.arrows, state.size);
    ok(solved && solved.length === state.arrows.length, `${diff} #${i}: solvable`);
    eq(solutionOrder.length, state.arrows.length, `${diff} #${i}: solution order lengkap`);

    // Mainkan solution order internal lewat applyArrowMove -> harus tuntas
    let s = state;
    for (const id of solutionOrder) {
      const r = applyArrowMove(s, 'p1', id, 'P1');
      ok(r.correct, `${diff} #${i}: solution step ${id} sukses`);
      s = r.state;
    }
    ok(isArrowPuzzleFinished(s, 'p1'), `${diff} #${i}: selesai setelah solution order`);
    eq(getActiveArrows(s, 'p1').length, 0, `${diff} #${i}: activeArrows kosong`);

    // Tidak semua arrow bebas di awal, tetapi ada yang bebas
    const movable = getMovableArrowIds(state, 'p1');
    ok(movable.length >= 1, `${diff} #${i}: ada arrow bebas di awal`);
    ok(movable.length < state.arrows.length, `${diff} #${i}: tidak semua arrow bebas di awal`);
    totalBlocked += state.arrows.length - movable.length;
    totalArrows += state.arrows.length;

    // Deterministik
    const again = generateArrowPuzzle(diff, 'classic', seed);
    eq(JSON.stringify(again.arrows), JSON.stringify(state.arrows), `${diff} #${i}: deterministik`);

    // Solution order tidak bocor ke state
    ok(!('solutionOrder' in state) && !('solutionPath' in state), `${diff} #${i}: solusi tidak ada di state`);
  }
  eq(dirsSeen.size, 4, `${diff}: keempat arah muncul`);
  ok(shapesWithTurn > 0, `${diff}: ada arrow berbentuk siku/zig-zag`);
  console.log(
    `  ${diff.padEnd(6)} avg arrows ${(totalArrows / SAMPLES[diff]).toFixed(1)}, avg blocked ${(totalBlocked / SAMPLES[diff]).toFixed(1)}`
  );
}

// Progression: makin sulit makin banyak arrow
for (let i = 1; i < difficulties.length; i++) {
  ok(
    ARROW_DIFFICULTY[difficulties[i]].arrowCount > ARROW_DIFFICULTY[difficulties[i - 1]].arrowCount,
    `progression arrowCount ${difficulties[i - 1]} < ${difficulties[i]}`
  );
}

// ── 2. Collision engine — kasus geometri buatan tangan ─────────────────────
const SIZE = 6;
// A: horizontal (1,0)-(1,2) keluar kanan. B: vertikal (0,4)-(2,4) keluar atas -> menghalangi A.
const A = { id: 'A', cells: [{ row: 1, col: 0 }, { row: 1, col: 1 }, { row: 1, col: 2 }], direction: 1 };
const B = { id: 'B', cells: [{ row: 2, col: 4 }, { row: 1, col: 4 }, { row: 0, col: 4 }], direction: 0 };
// C: L-shape ekor (5,1)->(4,1)->(4,2) keluar kanan; lintasan baris 4 & 5 ke kanan
const C = { id: 'C', cells: [{ row: 5, col: 1 }, { row: 4, col: 1 }, { row: 4, col: 2 }], direction: 1 };
// D: vertikal (5,5)-(4,5) keluar bawah -> berada di lintasan C (baris 5 kolom 5 & baris 4 kolom 5)
const D = { id: 'D', cells: [{ row: 4, col: 5 }, { row: 5, col: 5 }], direction: 2 };

eq(JSON.stringify(findBlockers(A, [A, B, C, D], SIZE)), '["B"]', 'A terhalang B (horizontal vs vertikal)');
ok(isArrowFree(B, [A, B, C, D], SIZE), 'B bebas ke atas');
eq(JSON.stringify(findBlockers(C, [A, B, C, D], SIZE)), '["D"]', 'L-shape C terhalang D lewat sel ekornya');
ok(isArrowFree(D, [A, B, C, D], SIZE), 'D bebas ke bawah');
ok(isArrowFree(A, [A, C, D], SIZE), 'setelah B keluar, A bebas (arrow keluar bukan obstacle lagi)');
ok(isArrowFree(C, [A, B, C], SIZE), 'setelah D keluar, C bebas');

// Sweep A = baris 1 kolom 3..5
eq(JSON.stringify(getArrowSweep(A, SIZE)), JSON.stringify([{ row: 1, col: 3 }, { row: 1, col: 4 }, { row: 1, col: 5 }]), 'sweep A');
eq(getArrowExitDistance(A, SIZE), 6, 'jarak keluar A = 6 (ekor di kolom 0)');
eq(getArrowExitDistance(B, SIZE), 3, 'jarak keluar B = 3');

// U-shape: (0,0)->(1,0)->(1,1)->(0,1) keluar atas. E di (0,3) keluar kiri menghalangi? tidak (baris 0 kolom 3 bukan di sweep U).
const Ushape = { id: 'U', cells: [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 1, col: 1 }, { row: 0, col: 1 }], direction: 0 };
ok(isValidArrowGeometry(Ushape, SIZE), 'U-shape geometri valid');
ok(isArrowFree(Ushape, [Ushape, B], SIZE), 'U-shape bebas ke atas');
// Arrow tepat di depan kepala U (tidak mungkin karena baris 0 = tepi), coba U dipindah ke bawah 1 baris
const U2 = { id: 'U2', cells: [{ row: 1, col: 0 }, { row: 2, col: 0 }, { row: 2, col: 1 }, { row: 1, col: 1 }], direction: 0 };
const blockerU = { id: 'X', cells: [{ row: 0, col: 1 }, { row: 0, col: 2 }], direction: 1 };
eq(JSON.stringify(findBlockers(U2, [U2, blockerU], SIZE)), '["X"]', 'U-shape terhalang arrow tepat di depan kepalanya');
const blockerU0 = { id: 'Y', cells: [{ row: 0, col: 0 }, { row: 0, col: 5 }].slice(0, 1).concat([{ row: 0, col: 0 }]).slice(0, 1), direction: 3 };
blockerU0.cells = [{ row: 0, col: 0 }];
eq(JSON.stringify(findBlockers(U2, [U2, blockerU0], SIZE)), '["Y"]', 'U-shape terhalang arrow di depan EKORNYA (benda kaku)');

// Zig-zag
const Z = {
  id: 'Z',
  cells: [{ row: 3, col: 0 }, { row: 3, col: 1 }, { row: 2, col: 1 }, { row: 2, col: 2 }, { row: 1, col: 2 }, { row: 1, col: 3 }],
  direction: 1,
};
ok(isValidArrowGeometry(Z, SIZE), 'zig-zag geometri valid');
eq(getArrowSweep(Z, SIZE).length, 4 + 3 + 2, 'sweep zig-zag mencakup semua baris tubuhnya');

// Geometri tidak valid
ok(!isValidArrowGeometry({ id: 'bad1', cells: [{ row: 0, col: 0 }, { row: 2, col: 0 }], direction: 0 }, SIZE), 'sel lompat = invalid');
ok(!isValidArrowGeometry({ id: 'bad2', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }], direction: 0 }, SIZE), 'kepala tidak segaris = invalid');
ok(!isValidArrowGeometry({ id: 'bad3', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 0 }], direction: 3 }, SIZE), 'tumpang tindih diri = invalid');
ok(!isValidArrowGeometry({ id: 'bad4', cells: [{ row: -1, col: 0 }, { row: 0, col: 0 }], direction: 2 }, SIZE), 'di luar papan = invalid');

// Deadlock terdeteksi solver: dua arrow saling menghalangi
const L1 = { id: 'L1', cells: [{ row: 0, col: 0 }, { row: 0, col: 1 }], direction: 1 };
const L2 = { id: 'L2', cells: [{ row: 0, col: 3 }, { row: 0, col: 2 }], direction: 3 };
eq(solveArrowPuzzle([L1, L2], 4), null, 'solver mendeteksi deadlock');

// ── 3. applyArrowMove — Classic ───────────────────────────────────────────
function mkState(variant, arrows, size = SIZE) {
  return {
    boardId: 'T', seed: 't', size, arrows, variant, difficulty: 'easy',
    removedArrowIds: [], playerRemoved: {}, wrongStreak: {}, winnerId: null, winners: [],
    completed: false, revision: 1, lastMove: null,
  };
}

{
  let s = mkState('classic', [A, B, C, D]);
  // Blocked tap
  let r = applyArrowMove(s, 'u1', 'A', 'U1');
  ok(!r.correct, 'classic: A blocked -> ditolak');
  eq(r.penalty, 5, 'classic: penalti pertama 5');
  eq(r.scoreDelta, -5, 'classic: skor -5');
  eq(JSON.stringify(r.blockers), '["B"]', 'classic: blockers dilaporkan');
  eq(getRemovedArrowIds(r.state, 'u1').length, 0, 'classic: arrow blocked tidak dihapus');
  ok(r.state !== s, 'classic: state baru (streak) walau blocked');
  s = r.state;
  r = applyArrowMove(s, 'u1', 'A', 'U1');
  eq(r.penalty, 10, 'classic: penalti kedua 10');
  s = r.state;
  eq(getArrowNextPenalty(s, 'u1'), 20, 'classic: penalti berikutnya 20');
  eq(getArrowWrongPenalty(6), 80, 'penalti dibatasi 80');

  // Free tap
  r = applyArrowMove(s, 'u1', 'B', 'U1');
  ok(r.correct, 'classic: B bebas -> keluar');
  eq(r.scoreDelta, ARROW_CORRECT_POINTS, 'classic: +10');
  eq(JSON.stringify(r.state.removedArrowIds), '["B"]', 'classic: B tercatat keluar');
  eq(getActiveArrows(r.state, 'u1').length, 3, 'classic: 3 arrow aktif tersisa');
  eq(r.state.wrongStreak.u1, 0, 'classic: streak reset');
  eq(getArrowProgress(r.state, 'u1'), 25, 'classic: progress 25%');
  s = r.state;

  // Double tap / tap ke arrow yang sudah keluar -> no-op total
  const dbl = applyArrowMove(s, 'u2', 'B', 'U2');
  ok(dbl.state === s, 'double tap arrow yang sudah keluar = no-op');
  eq(dbl.scoreDelta, 0, 'double tap tanpa skor');
  eq(dbl.penalty, 0, 'double tap tanpa penalti');

  // Sekarang A bebas; pemain lain (u2) mengeluarkannya -> papan bersama
  r = applyArrowMove(s, 'u2', 'A', 'U2');
  ok(r.correct, 'classic: setelah B keluar, A bebas untuk pemain lain');
  s = r.state;
  eq(getArrowProgress(s, 'u1'), 50, 'classic: progress bersama untuk u1');
  eq(getArrowProgress(s, 'u2'), 50, 'classic: progress bersama untuk u2');

  r = applyArrowMove(s, 'u1', 'C', 'U1');
  ok(!r.correct, 'classic: C masih terhalang D');
  s = r.state;
  r = applyArrowMove(s, 'u1', 'D', 'U1');
  ok(r.correct, 'classic: D keluar');
  s = r.state;
  r = applyArrowMove(s, 'u2', 'C', 'U2');
  ok(r.correct && r.justFinished && r.justCompleted, 'classic: arrow terakhir -> completed');
  eq(r.scoreDelta, ARROW_CORRECT_POINTS + ARROW_TEAM_BONUS, 'classic: +10 + bonus tim');
  ok(r.state.completed, 'classic: completed=true');
  eq(r.state.winnerId, 'u2', 'classic: winner = pengetuk terakhir');
  eq(getActiveArrows(r.state, 'u1').length, 0, 'classic: activeArrows.length === 0');
  s = r.state;
  const after = applyArrowMove(s, 'u1', 'A', 'U1');
  ok(after.state === s, 'classic: tap setelah selesai = no-op');
  eq(after.reason, 'Puzzle sudah selesai', 'classic: alasan selesai');
}

// ── 4. applyArrowMove — Competition (isolasi papan) ──────────────────────
{
  let s = mkState('competition', [A, B, C, D]);
  let r = applyArrowMove(s, 'p1', 'B', 'P1');
  ok(r.correct, 'comp: p1 keluarkan B');
  s = r.state;
  eq(JSON.stringify(getRemovedArrowIds(s, 'p1')), '["B"]', 'comp: p1 removed [B]');
  eq(getRemovedArrowIds(s, 'p2').length, 0, 'comp: p2 tidak terpengaruh');
  eq(s.removedArrowIds.length, 0, 'comp: removedArrowIds bersama tetap kosong');
  // p2 tetap terhalang untuk A karena B masih ada di papan p2
  r = applyArrowMove(s, 'p2', 'A', 'P2');
  ok(!r.correct, 'comp: p2 masih terhalang B (isolasi)');
  s = r.state;
  // p1: A kini bebas
  r = applyArrowMove(s, 'p1', 'A', 'P1');
  ok(r.correct, 'comp: p1 A bebas');
  s = r.state;
  r = applyArrowMove(s, 'p1', 'D', 'P1'); s = r.state;
  r = applyArrowMove(s, 'p1', 'C', 'P1');
  ok(r.correct && r.justFinished, 'comp: p1 selesai');
  eq(r.rank, 1, 'comp: p1 juara 1');
  eq(r.scoreDelta, ARROW_CORRECT_POINTS + ARROW_FINISH_BONUS[0], 'comp: +10 + bonus juara 1');
  ok(!r.justCompleted, 'comp: justCompleted hanya untuk classic');
  ok(!r.state.completed, 'comp: completed bersama tidak di-set');
  s = r.state;
  eq(getArrowProgress(s, 'p2'), 0, 'comp: progress p2 tetap 0');
  // p2 menyelesaikan -> juara 2
  for (const id of ['B', 'A', 'D', 'C']) { r = applyArrowMove(s, 'p2', id, 'P2'); s = r.state; }
  eq(r.rank, 2, 'comp: p2 juara 2');
  eq(JSON.stringify(s.winners), '["p1","p2"]', 'comp: winners urut');
  // silentScore (Auto/All): tanpa poin
  const s2 = mkState('competition', [A, B, C, D]);
  const silent = applyArrowMove(s2, 'p1', 'B', 'P1', { silentScore: true });
  ok(silent.correct && silent.scoreDelta === 0, 'silentScore: sukses tanpa poin');
  const silentBlocked = applyArrowMove(s2, 'p1', 'A', 'P1', { silentScore: true });
  ok(!silentBlocked.correct && silentBlocked.penalty === 0 && silentBlocked.scoreDelta === 0, 'silentScore: blocked tanpa penalti');
}

// ── 5. evaluateArrowTap & validasi state lama ─────────────────────────────
{
  const s = mkState('classic', [A, B]);
  eq(evaluateArrowTap(s, 'u', 'A').correct, false, 'evaluate: A blocked');
  eq(evaluateArrowTap(s, 'u', 'B').correct, true, 'evaluate: B free');
  eq(evaluateArrowTap(s, 'u', 'nope').reason, 'Arrow tidak dikenal', 'evaluate: id asing');
  ok(!isValidArrowPuzzleState({ size: 5, arrows: [[0, 1], [null, 2]], start: { row: 0, col: 0 }, goal: { row: 1, col: 1 }, solutionPath: [] }), 'state format lama START/GOAL ditolak');
  ok(isValidArrowPuzzleState(s), 'state baru diterima');
  const round = createArrowRound('hard', 'classic', 'seed-x', 7);
  ok(round.revision >= 8, 'createArrowRound menaikkan revision');
  ok(ARROW_DIRS.length === 4, 'ARROW_DIRS 4 arah');
}

console.log(`\n✅ verify-arrow-puzzle: ${checks} pemeriksaan lulus`);
