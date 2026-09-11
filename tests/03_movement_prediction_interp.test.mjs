import assert from 'assert';

console.log('--- TEST SUITE 3: MOVEMENT PREDICTION & INTERPOLATION ---');

// Emulate client prediction logic
class ClientPredictor {
  constructor(startX = 24.0, startY = 24.0) {
    this.x = startX;
    this.y = startY;
    this.seq = 0;
    this.pendingInputs = [];
  }

  applyInput(vx, vy, isRunning, dt) {
    this.seq++;
    const speed = isRunning ? 7.2 : 4.4;
    const dx = vx * speed * dt;
    const dy = vy * speed * dt;
    this.x += dx;
    this.y += dy;
    this.pendingInputs.push({ seq: this.seq, dx, dy });
    return { x: this.x, y: this.y, seq: this.seq };
  }

  reconcile(serverAckSeq, authoritativeX, authoritativeY) {
    this.pendingInputs = this.pendingInputs.filter(inp => inp.seq > serverAckSeq);
    let rx = authoritativeX;
    let ry = authoritativeY;
    for (const inp of this.pendingInputs) {
      rx += inp.dx;
      ry += inp.dy;
    }
    this.x = rx;
    this.y = ry;
  }
}

// Emulate remote player interpolator logic
class RemotePlayerInterpolator {
  constructor() {
    this.buffer = []; // [{ts, x, y, dir, anim}]
    this.renderDelayMs = 100;
  }

  pushSnapshot(serverTs, x, y, dir, anim) {
    this.buffer.push({ ts: serverTs, x: Number(x), y: Number(y), dir, anim });
    if (this.buffer.length > 20) this.buffer.shift();
  }

  sample(renderTs) {
    const targetTs = renderTs - this.renderDelayMs;
    if (this.buffer.length === 0) return null;
    if (this.buffer.length === 1) return this.buffer[0];

    // Find surrounding snapshots
    let p0 = this.buffer[0];
    let p1 = this.buffer[this.buffer.length - 1];

    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i].ts <= targetTs && this.buffer[i + 1].ts >= targetTs) {
        p0 = this.buffer[i];
        p1 = this.buffer[i + 1];
        break;
      }
    }

    if (p0.ts === p1.ts) return p0;

    const span = p1.ts - p0.ts;
    const alpha = Math.max(0, Math.min(1, (targetTs - p0.ts) / span));

    return {
      x: p0.x + (p1.x - p0.x) * alpha,
      y: p0.y + (p1.y - p0.y) * alpha,
      dir: alpha > 0.5 ? p1.dir : p0.dir,
      anim: p1.anim,
    };
  }
}

// 1. Client prediction & reconciliation test
{
  const predictor = new ClientPredictor(20.0, 20.0);
  predictor.applyInput(1, 0, false, 0.05); // move right
  predictor.applyInput(1, 0, false, 0.05);
  predictor.applyInput(1, 0, false, 0.05);

  assert(predictor.x > 20.6, 'Client predicted forward positions');

  // Server acknowledges seq 2 with authoritative position
  predictor.reconcile(2, 20.44, 20.0);
  assert(predictor.pendingInputs.length === 1, 'Acknowledged inputs removed');
  assert(predictor.x > 20.6 && predictor.x < 20.7, 'Reconciled smoothly without jitter');
  console.log('✔ Client prediction and server reconciliation verified');
}

// 2. Remote player interpolation test
{
  const interp = new RemotePlayerInterpolator();
  const t0 = 1000;
  interp.pushSnapshot(t0, 10.0, 10.0, 2, 'walk');
  interp.pushSnapshot(t0 + 100, 11.0, 10.0, 2, 'walk');
  interp.pushSnapshot(t0 + 200, 12.0, 10.0, 2, 'walk');

  // Sample exactly in the middle between t0 and t0+100 (renderTs = t0 + 150 -> targetTs = t0 + 50)
  const mid = interp.sample(t0 + 150);
  assert.strictEqual(mid.x, 10.5, 'Interpolated exactly midpoint coordinate');
  assert.strictEqual(mid.y, 10.0);

  // Sample at t0 + 250 -> targetTs = t0 + 150 (midpoint between 11.0 and 12.0)
  const mid2 = interp.sample(t0 + 250);
  assert.strictEqual(mid2.x, 11.5);
  console.log('✔ Remote player snapshot buffer and smooth interpolation verified');
}

console.log('SUITE 3 PASSED!\n');
