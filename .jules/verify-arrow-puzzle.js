/**
 * Verifikasi runtime engine Arrow Puzzle Master.
 * Dijalankan lewat `node .jules/verify-arrow-puzzle.js` setelah `npm run verify:arrow`
 * (lihat package.json) yang mengompilasi src/utils/arrowPuzzle.ts lebih dulu.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const assert = require('node:assert');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path');

// eslint-disable-next-line @typescript-eslint/no-require-imports
const engine = require(path.join(__dirname, '..', '.tmp-arrow-build', 'utils', 'arrowPuzzle.js'));

const {
  ARROW_DIRS,
  ARROW_DIFFICULTY,
  generateArrowPuzzle,
  countArrowPaths,
  applyArrowMove,
  evaluateArrowTap,
  getArrowProgress,
  getPlayerArrowPath,
  getExpectedNextCell,
  isArrowPuzzleFinished,
  getArrowNextPenalty,
  getArrowWrongPenalty,
  isLegalArrowStep,
  buildArrowSeed,
} = engine;

let checks = 0;
const ok = (cond, label) => {
  assert.ok(cond, label);
  checks++;
};

// ── 1. Generator: unik, sah, deterministik ────────────────────────────────────
const difficulties = ['easy', 'medium', 'hard', 'expert', 'evil'];

for (const diff of difficulties) {
  for (let i = 0; i < 200; i++) {
    const seed = buildArrowSeed(`ROOM${i}`, diff, i);
    const puzzle = generateArrowPuzzle(diff, i % 2 === 0 ? 'classic' : 'competition', seed);
    const cfg = ARROW_DIFFICULTY[diff];

    ok(puzzle.size === cfg.size, `${diff} #${i}: ukuran papan ${puzzle.size} == ${cfg.size}`);
    ok(puzzle.arrows.length === cfg.size, `${diff} #${i}: baris arrows`);
    ok(puzzle.arrows.every((row) => row.length === cfg.size), `${diff} #${i}: kolom arrows`);
    ok(puzzle.difficulty === diff, `${diff} #${i}: difficulty tersimpan`);
    ok(puzzle.variant === (i % 2 === 0 ? 'classic' : 'competition'), `${diff} #${i}: variant tersimpan`);

    // START tidak pernah tembok & GOAL selalu berbeda dari START
    ok(puzzle.arrows[puzzle.start.row][puzzle.start.col] !== null, `${diff} #${i}: START bukan tembok`);
    ok(puzzle.arrows[puzzle.goal.row][puzzle.goal.col] !== null, `${diff} #${i}: GOAL bukan tembok`);
    ok(
      puzzle.goal.row !== puzzle.start.row || puzzle.goal.col !== puzzle.start.col,
      `${diff} #${i}: GOAL != START`
    );

    // Hanya ada SATU jalur sah
    ok(
      countArrowPaths(puzzle.arrows, puzzle.start, puzzle.goal, 3) === 1,
      `${diff} #${i}: jumlah jalur sah harus 1`
    );

    // solutionPath: mulai di START, berakhir di GOAL, tiap langkah menempel + sah
    const sp = puzzle.solutionPath;
    ok(sp[0].row === puzzle.start.row && sp[0].col === puzzle.start.col, `${diff} #${i}: path mulai di START`);
    ok(
      sp[sp.length - 1].row === puzzle.goal.row && sp[sp.length - 1].col === puzzle.goal.col,
      `${diff} #${i}: path berakhir di GOAL`
    );
    for (let s = 1; s < sp.length; s++) {
      const from = sp[s - 1];
      const to = sp[s];
      ok(Math.abs(from.row - to.row) + Math.abs(from.col - to.col) === 1, `${diff} #${i}: langkah ${s} menempel`);
      ok(isLegalArrowStep(puzzle, from, to), `${diff} #${i}: langkah ${s} sah menurut panah`);
    }
    ok(sp.length >= 3, `${diff} #${i}: jalur minimal 3 kotak (dapat ${sp.length})`);

    // Deterministik: seed sama -> papan sama
    const twin = generateArrowPuzzle(diff, puzzle.variant, seed);
    ok(JSON.stringify(twin.arrows) === JSON.stringify(puzzle.arrows), `${diff} #${i}: seed deterministik`);
    ok(
      JSON.stringify(twin.solutionPath) === JSON.stringify(puzzle.solutionPath),
      `${diff} #${i}: jalur deterministik`
    );
    ok(twin.goal.row === puzzle.goal.row && twin.goal.col === puzzle.goal.col, `${diff} #${i}: GOAL deterministik`);
  }
  console.log(`  ✓ ${diff}: 200 puzzle unik + sah + deterministik`);
}

// ── 2. Tabel penalti kelipatan 2x ─────────────────────────────────────────────
ok(getArrowWrongPenalty(1) === 5, 'salah #1 = -5');
ok(getArrowWrongPenalty(2) === 10, 'salah #2 = -10');
ok(getArrowWrongPenalty(3) === 20, 'salah #3 = -20');
ok(getArrowWrongPenalty(4) === 40, 'salah #4 = -40');
ok(getArrowWrongPenalty(5) === 80, 'salah #5 = -80');
ok(getArrowWrongPenalty(9) === 80, 'salah #9 tetap -80 (batas atas)');
console.log('  ✓ penalti 5 → 10 → 20 → 40 → 80 (maks)');

// ── 3. Simulasi tap: benar +10, salah -5/-10/-20, streak reset ────────────────
{
  const seed = buildArrowSeed('SCORE', 'easy', 1);
  const base = generateArrowPuzzle('easy', 'classic', seed);
  const me = 'p1';
  let state = base;
  let score = 0;

  const firstStep = base.solutionPath[1];

  // Salah #1 -> -5
  let r = applyArrowMove(state, me, base.start, 'P1');
  ok(r.correct === false, 'tap kotak sendiri = salah');
  ok(r.scoreDelta === -5 && r.penalty === 5, `salah pertama -5 (dapat ${r.scoreDelta})`);
  score += r.scoreDelta;
  state = r.state;
  ok(getArrowNextPenalty(state, me) === 10, 'ancaman penalti berikutnya -10');

  // Salah #2 -> -10
  r = applyArrowMove(state, me, base.start, 'P1');
  ok(r.scoreDelta === -10, `salah kedua -10 (dapat ${r.scoreDelta})`);
  score += r.scoreDelta;
  state = r.state;

  // Salah #3 -> -20
  r = applyArrowMove(state, me, base.start, 'P1');
  ok(r.scoreDelta === -20, `salah ketiga -20 (dapat ${r.scoreDelta})`);
  score += r.scoreDelta;
  state = r.state;
  ok(score === -35, `total setelah 3 salah = -35 (dapat ${score})`);

  // Benar -> +10 dan streak kembali nol
  r = applyArrowMove(state, me, firstStep, 'P1');
  ok(r.correct === true && r.scoreDelta === 10, `benar +10 (dapat ${r.scoreDelta})`);
  score += r.scoreDelta;
  state = r.state;
  ok(getArrowNextPenalty(state, me) === 5, 'streak salah direset setelah benar');
  ok(getPlayerArrowPath(state, me).length === 1, 'jalur bertambah 1 kotak');
  console.log(`  ✓ simulasi skor: 3x salah (-5,-10,-20) lalu benar (+10) = ${score}`);
}

// ── 4. Menuntaskan puzzle Classic (ko-op dua pemain bergantian) ───────────────
{
  const seed = buildArrowSeed('COOP', 'medium', 7);
  let state = generateArrowPuzzle('medium', 'classic', seed);
  const scores = { p1: 0, p2: 0 };
  const steps = state.solutionPath.slice(1);

  steps.forEach((cell, i) => {
    const who = i % 2 === 0 ? 'p1' : 'p2';
    const res = applyArrowMove(state, who, cell, who.toUpperCase());
    assert.ok(res.correct, `langkah ${i + 1} oleh ${who} harus benar`);
    scores[who] += res.scoreDelta;
    state = res.state;

    if (i === steps.length - 1) {
      ok(res.justFinished === true, 'langkah terakhir menandai justFinished');
      ok(res.justCompleted === true, 'langkah terakhir menandai justCompleted');
      ok(res.scoreDelta === 60, `finis Classic = +10 langkah & +50 bonus tim (dapat ${res.scoreDelta})`);
    } else {
      ok(res.scoreDelta === 10, `langkah biasa +10 (dapat ${res.scoreDelta})`);
    }
  });

  ok(state.completed === true, 'puzzle Classic selesai');
  const lastMover = (steps.length - 1) % 2 === 0 ? 'p1' : 'p2';
  ok(state.winnerId === lastMover, `winnerId = penentu langkah terakhir (${lastMover})`);
  ok(state.currentPath.length === state.solutionPath.length - 1, 'jejak bersama penuh (START tidak dihitung sebagai langkah)');
  ok(getArrowProgress(state, 'p1') === 100, 'progress 100%');
  ok(getArrowProgress(state, 'p2') === 100, 'progress bersama 100% untuk semua pemain');
  ok(scores.p1 + scores.p2 === steps.length * 10 + 50, 'total poin tim = 10/langkah + bonus 50');
  console.log(`  ✓ Classic ko-op: ${steps.length} langkah tuntas, skor tim ${scores.p1 + scores.p2}`);

  // Tap setelah selesai ditolak tanpa mengubah skor
  const extra = applyArrowMove(state, 'p1', state.goal, 'P1');
  ok(extra.scoreDelta === 0 && extra.state === state, 'tap setelah selesai tidak mengubah apa pun');
}

// ── 5. Competition: papan per pemain, ranking finis ───────────────────────────
{
  const seed = buildArrowSeed('RACE', 'hard', 3);
  let state = generateArrowPuzzle('hard', 'competition', seed);
  const steps = state.solutionPath.slice(1);
  const scores = { a: 0, b: 0 };

  // Pemain B salah dua kali dulu, pemain A jalan mulus
  let res = applyArrowMove(state, 'b', state.start, 'B');
  scores.b += res.scoreDelta;
  state = res.state;
  res = applyArrowMove(state, 'b', state.start, 'B');
  scores.b += res.scoreDelta;
  state = res.state;
  ok(scores.b === -15, `B: -5 lalu -10 = -15 (dapat ${scores.b})`);

  steps.forEach((cell) => {
    res = applyArrowMove(state, 'a', cell, 'A');
    scores.a += res.scoreDelta;
    state = res.state;
  });

  ok(isArrowPuzzleFinished(state, 'a'), 'A selesai');
  ok(!isArrowPuzzleFinished(state, 'b'), 'B belum selesai (jalur sendiri)');
  ok(getPlayerArrowPath(state, 'b').length === 0, 'jalur B tidak terpengaruh langkah A');
  ok(res.rank === 1, 'A finis pertama -> rank 1');
  ok(scores.a === steps.length * 10 + 100, `A: ${steps.length}×10 + bonus juara 100 = ${scores.a}`);
  ok(state.winners[0] === 'a', 'winners[0] = A');
  ok(state.winnerId === 'a', 'winnerId = A');
  ok(getArrowProgress(state, 'a') === 100, 'progress A 100%');
  ok(getArrowProgress(state, 'b') === 0, 'progress B 0%');

  // B menyusul finis -> rank 2, bonus 60
  steps.forEach((cell) => {
    res = applyArrowMove(state, 'b', cell, 'B');
    scores.b += res.scoreDelta;
    state = res.state;
  });
  ok(res.rank === 2, 'B finis kedua -> rank 2');
  ok(scores.b === -15 + steps.length * 10 + 60, `B: -15 + ${steps.length}×10 + 60 = ${scores.b}`);
  console.log(`  ✓ Competition: A=${scores.a} (juara 1), B=${scores.b} (juara 2)`);
}

// ── 6. Evaluasi tap memberi alasan yang tepat ─────────────────────────────────
{
  const seed = buildArrowSeed('REASON', 'easy', 11);
  const state = generateArrowPuzzle('easy', 'classic', seed);
  const me = 'x';
  const expected = getExpectedNextCell(state, me);
  ok(expected !== null, 'ada kotak tujuan berikutnya');
  ok(evaluateArrowTap(state, me, expected).correct === true, 'tap kotak tujuan = benar');
  ok(evaluateArrowTap(state, me, state.start).reason.length > 0, 'tap salah punya pesan alasan');
  ok(evaluateArrowTap(state, me, state.goal).correct === false, 'lompat langsung ke GOAL = salah');
  console.log('  ✓ evaluateArrowTap memberi alasan tiap tap salah');
}

// ── 7. Panah tiap sel tree menunjuk ke induknya (invarian desain) ─────────────
{
  const seed = buildArrowSeed('INVARIANT', 'evil', 42);
  const puzzle = generateArrowPuzzle('evil', 'classic', seed);
  for (let s = 1; s < puzzle.solutionPath.length; s++) {
    const from = puzzle.solutionPath[s - 1];
    const to = puzzle.solutionPath[s];
    const dir = puzzle.arrows[to.row][to.col];
    ok(dir !== null, 'kotak di jalur punya panah');
    ok(
      to.row + ARROW_DIRS[dir].dr === from.row && to.col + ARROW_DIRS[dir].dc === from.col,
      `panah kotak (${to.row},${to.col}) menunjuk balik ke (${from.row},${from.col})`
    );
  }
  console.log('  ✓ invarian panah: setiap kotak jalur menunjuk ke kotak sebelumnya');
}

console.log(`\nSEMUA LOLOS — ${checks} assertions, 1000 puzzle diverifikasi.`);
