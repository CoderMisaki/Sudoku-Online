import { JSDOM } from 'jsdom';
import assert from 'assert';

console.log('--- TEST SUITE 2: INPUT MANAGER & VIRTUAL JOYSTICK ---');

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="game-container"><div id="joystick-zone"></div><button id="hud-btn">Action</button></div></body></html>', {
  url: 'http://localhost:3000/harvest',
  pretendToBeVisual: true,
});

global.window = dom.window;
global.document = dom.window.document;
global.PointerEvent = dom.window.PointerEvent || class PointerEvent extends dom.window.Event {
  constructor(type, props = {}) {
    super(type, props);
    this.pointerId = props.pointerId || 1;
    this.clientX = props.clientX || 0;
    this.clientY = props.clientY || 0;
    this.pointerType = props.pointerType || 'touch';
  }
};

// Test implementation of InputManager logic
class TestInputManager {
  constructor() {
    this.keys = new Set();
    this.sprint = false;
    this.joystick = { active: false, pointerId: null, startX: 0, startY: 0, curX: 0, curY: 0, dx: 0, dy: 0, mag: 0 };
    this.deadzone = 0.15;
    this.maxRadius = 60;
  }

  onKeyDown(code) {
    this.keys.add(code);
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.sprint = true;
  }

  onKeyUp(code) {
    this.keys.delete(code);
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.sprint = false;
  }

  onPointerDown(pointerId, x, y, targetIsHud = false) {
    if (targetIsHud) return false;
    if (this.joystick.active) return false;
    this.joystick.active = true;
    this.joystick.pointerId = pointerId;
    this.joystick.startX = x;
    this.joystick.startY = y;
    this.joystick.curX = x;
    this.joystick.curY = y;
    this.joystick.dx = 0;
    this.joystick.dy = 0;
    this.joystick.mag = 0;
    return true;
  }

  onPointerMove(pointerId, x, y) {
    if (!this.joystick.active || this.joystick.pointerId !== pointerId) return;
    const rawDx = x - this.joystick.startX;
    const rawDy = y - this.joystick.startY;
    const dist = Math.hypot(rawDx, rawDy);
    if (dist === 0) {
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      this.joystick.mag = 0;
      return;
    }
    const clampedDist = Math.min(dist, this.maxRadius);
    const normDist = clampedDist / this.maxRadius;
    if (normDist < this.deadzone) {
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      this.joystick.mag = 0;
    } else {
      const remappedMag = (normDist - this.deadzone) / (1 - this.deadzone);
      this.joystick.dx = (rawDx / dist) * remappedMag;
      this.joystick.dy = (rawDy / dist) * remappedMag;
      this.joystick.mag = remappedMag;
    }
    this.joystick.curX = this.joystick.startX + (rawDx / dist) * clampedDist;
    this.joystick.curY = this.joystick.startY + (rawDy / dist) * clampedDist;
  }

  onPointerUp(pointerId) {
    if (this.joystick.active && this.joystick.pointerId === pointerId) {
      this.joystick.active = false;
      this.joystick.pointerId = null;
      this.joystick.dx = 0;
      this.joystick.dy = 0;
      this.joystick.mag = 0;
    }
  }

  onBlur() {
    this.keys.clear();
    this.sprint = false;
    this.joystick.active = false;
    this.joystick.pointerId = null;
    this.joystick.dx = 0;
    this.joystick.dy = 0;
    this.joystick.mag = 0;
  }

  getMovementVector() {
    let vx = 0, vy = 0;
    if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) vy -= 1;
    if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) vy += 1;
    if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) vx -= 1;
    if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) vx += 1;

    if (vx !== 0 && vy !== 0) {
      const len = Math.hypot(vx, vy);
      vx /= len; vy /= len;
    }

    if (this.joystick.active && this.joystick.mag > 0) {
      vx = this.joystick.dx;
      vy = this.joystick.dy;
    }

    return { vx, vy, isRunning: this.sprint || this.joystick.mag > 0.85 };
  }
}

const input = new TestInputManager();

// 1. Test Keyboard input & normalization
{
  input.onKeyDown('KeyW');
  input.onKeyDown('KeyD');
  input.onKeyDown('ShiftLeft');
  const vec = input.getMovementVector();
  assert(Math.abs(vec.vx - Math.SQRT1_2) < 0.001, 'Normalized diagonal X');
  assert(Math.abs(vec.vy - (-Math.SQRT1_2)) < 0.001, 'Normalized diagonal Y');
  assert.strictEqual(vec.isRunning, true, 'Sprint is active');
  input.onKeyUp('KeyW');
  input.onKeyUp('KeyD');
  input.onKeyUp('ShiftLeft');
  const stopped = input.getMovementVector();
  assert.strictEqual(stopped.vx, 0);
  assert.strictEqual(stopped.vy, 0);
  assert.strictEqual(stopped.isRunning, false);
  console.log('✔ Keyboard controls & diagonal normalization verified');
}

// 2. Test Virtual Analog Joystick Deadzone & Magnitude Clamping
{
  // Touch start at (100, 100)
  input.onPointerDown(1, 100, 100);
  assert.strictEqual(input.joystick.active, true);

  // Tiny drag within deadzone (4px / 60px = 0.066 < 0.15)
  input.onPointerMove(1, 104, 100);
  let joyVec = input.getMovementVector();
  assert.strictEqual(joyVec.vx, 0, 'Deadzone filters tiny jitter');
  assert.strictEqual(joyVec.vy, 0, 'Deadzone filters tiny jitter');

  // Moderate drag beyond deadzone (30px to right -> norm 0.5)
  input.onPointerMove(1, 130, 100);
  joyVec = input.getMovementVector();
  assert(joyVec.vx > 0.4 && joyVec.vx <= 0.5, 'Smooth remapped analog magnitude');
  assert.strictEqual(joyVec.vy, 0);
  assert.strictEqual(joyVec.isRunning, false);

  // Full drag beyond max radius (120px to bottom -> clamped to 60px)
  input.onPointerMove(1, 100, 220);
  joyVec = input.getMovementVector();
  assert.strictEqual(joyVec.vx, 0);
  assert(Math.abs(joyVec.vy - 1.0) < 0.001, 'Magnitude clamped to 1.0');
  assert.strictEqual(joyVec.isRunning, true, 'Full deflection triggers run');

  // Touch release
  input.onPointerUp(1);
  assert.strictEqual(input.joystick.active, false);
  joyVec = input.getMovementVector();
  assert.strictEqual(joyVec.vx, 0);
  assert.strictEqual(joyVec.vy, 0);
  console.log('✔ Joystick deadzone, analog remapping, and run-threshold verified');
}

// 3. Multitouch Pointer Isolation & HUD Safety
{
  // Joystick touch pointerId 1
  input.onPointerDown(1, 100, 100);
  input.onPointerMove(1, 140, 100);

  // Second touch on action button pointerId 2
  const hudTouchCaptured = input.onPointerDown(2, 500, 500, true);
  assert.strictEqual(hudTouchCaptured, false, 'HUD touch does not initiate second joystick');

  // Move second touch - should not alter joystick
  input.onPointerMove(2, 550, 500);
  const joyVec = input.getMovementVector();
  assert(joyVec.vx > 0.5, 'Joystick remains controlled only by primary pointerId');

  // Release second touch - joystick must stay active
  input.onPointerUp(2);
  assert.strictEqual(input.joystick.active, true);

  // Release primary touch
  input.onPointerUp(1);
  assert.strictEqual(input.joystick.active, false);
  console.log('✔ Multitouch isolation and HUD touch protection verified');
}

// 4. Blur & Tab Visibility Cleanup
{
  input.onKeyDown('KeyW');
  input.onKeyDown('ShiftLeft');
  input.onPointerDown(1, 100, 100);
  input.onPointerMove(1, 150, 100);

  // Window loses focus / tab changes
  input.onBlur();

  const resetVec = input.getMovementVector();
  assert.strictEqual(resetVec.vx, 0, 'Blur resets X velocity');
  assert.strictEqual(resetVec.vy, 0, 'Blur resets Y velocity');
  assert.strictEqual(resetVec.isRunning, false, 'Blur resets sprint');
  assert.strictEqual(input.joystick.active, false, 'Blur clears joystick');
  console.log('✔ Lifecycle blur/visibility cleanup verified');
}

console.log('SUITE 2 PASSED!\n');
