"use client";
// Universal InputManager for Desktop (Keyboard/Mouse), Tablet, and Mobile (Virtual Joystick / Touch).

export interface RawInputState {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  interact: boolean;
}

export interface AnalogInput {
  x: number; // -1 .. 1
  y: number; // -1 .. 1
  magnitude: number; // 0 .. 1
}

export type DeviceType = 'mobile' | 'tablet' | 'desktop';

export function detectDeviceType(): DeviceType {
  if (typeof window === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  const hasTouch = 'ontouchstart' in window || (navigator.maxTouchPoints && navigator.maxTouchPoints > 0);
  const isTabletUA = /(ipad|tablet|(android(?!.*mobile))|(windows(?!.*phone)(.*touch))|kindle|playbook|silk)/i.test(ua);
  const minDim = Math.min(window.innerWidth, window.innerHeight);
  const maxDim = Math.max(window.innerWidth, window.innerHeight);

  if (isTabletUA || (hasTouch && minDim >= 600 && maxDim >= 880)) {
    return 'tablet';
  }
  if (hasTouch && (minDim < 600 || maxDim < 900)) {
    return 'mobile';
  }
  return 'desktop';
}

export class InputManager {
  private activeKeys = new Set<string>();
  private joystickAnalog: AnalogInput = { x: 0, y: 0, magnitude: 0 };
  private touchSprint = false;
  private touchInteractPending = false;
  private deadZone = 0.08;
  private onInteractCallback: (() => void) | null = null;
  private onShortcutCallback: ((shortcut: string) => void) | null = null;
  private isAttached = false;
  private deviceType: DeviceType = 'desktop';

  constructor(opts?: { onInteract?: () => void; onShortcut?: (key: string) => void }) {
    if (opts?.onInteract) this.onInteractCallback = opts.onInteract;
    if (opts?.onShortcut) this.onShortcutCallback = opts.onShortcut;
    this.deviceType = detectDeviceType();
  }

  attach() {
    if (this.isAttached || typeof window === 'undefined') return;
    this.isAttached = true;
    this.deviceType = detectDeviceType();

    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);
    window.addEventListener('blur', this.handleBlur);
    window.addEventListener('focus', this.handleFocus);
    document.addEventListener('visibilitychange', this.handleVisibility);
    window.addEventListener('pagehide', this.handleBlur);
    window.addEventListener('resize', this.handleResize, { passive: true });
  }

  detach() {
    if (!this.isAttached || typeof window === 'undefined') return;
    this.isAttached = false;
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
    window.removeEventListener('blur', this.handleBlur);
    window.removeEventListener('focus', this.handleFocus);
    document.removeEventListener('visibilitychange', this.handleVisibility);
    window.removeEventListener('pagehide', this.handleBlur);
    window.removeEventListener('resize', this.handleResize);
    this.reset();
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    // If user is typing in an input / textarea, do not consume game inputs
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
      if (e.key === 'Escape') {
        target.blur();
      }
      return;
    }

    const key = e.key.toLowerCase();
    const code = e.code.toLowerCase();

    // Prevent scrolling for navigation keys
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'space'].includes(code) || ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(key)) {
      e.preventDefault();
    }

    // Single trigger actions
    if (!e.repeat) {
      if (key === 'e' || key === ' ' || key === 'enter') {
        this.touchInteractPending = true;
        this.onInteractCallback?.();
      } else if (['i', 'tab', 'm', 'q', 'j', 'c', 'p', 'l', 'n', '1', '2', '3', '4', '5', '6', '7', '8', 'escape'].includes(key)) {
        this.onShortcutCallback?.(key);
      }
    }

    this.activeKeys.add(key);
    this.activeKeys.add(code);
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    const key = e.key.toLowerCase();
    const code = e.code.toLowerCase();
    this.activeKeys.delete(key);
    this.activeKeys.delete(code);
  };

  private handleBlur = () => {
    this.reset();
  };

  private handleFocus = () => {
    this.deviceType = detectDeviceType();
  };

  private handleVisibility = () => {
    if (document.hidden) {
      this.reset();
    } else {
      this.deviceType = detectDeviceType();
    }
  };

  private handleResize = () => {
    this.deviceType = detectDeviceType();
  };

  setJoystick(dx: number, dy: number) {
    const len = Math.hypot(dx, dy);
    if (len < this.deadZone) {
      this.joystickAnalog = { x: 0, y: 0, magnitude: 0 };
    } else {
      const mag = Math.min(1, (len - this.deadZone) / (1 - this.deadZone));
      const nx = dx / len;
      const ny = dy / len;
      this.joystickAnalog = { x: nx, y: ny, magnitude: mag };
    }
  }

  setTouchSprint(sprint: boolean) {
    this.touchSprint = sprint;
  }

  triggerInteract() {
    this.touchInteractPending = true;
    this.onInteractCallback?.();
  }

  getDeviceType(): DeviceType {
    return this.deviceType;
  }

  /**
   * Produce the unified RawInputState.
   */
  getRawInput(): RawInputState {
    const keys = this.activeKeys;
    const keyUp = keys.has('w') || keys.has('arrowup') || keys.has('keyw');
    const keyDown = keys.has('s') || keys.has('arrowdown') || keys.has('keys');
    const keyLeft = keys.has('a') || keys.has('arrowleft') || keys.has('keya');
    const keyRight = keys.has('d') || keys.has('arrowright') || keys.has('keyd');
    const keySprint = keys.has('shift') || keys.has('shiftleft') || keys.has('shiftright');
    const keyInteract = keys.has('e') || keys.has('keye') || keys.has(' ') || keys.has('space') || keys.has('enter');

    const joy = this.joystickAnalog;
    const joyUp = joy.magnitude > 0 && joy.y < -0.3;
    const joyDown = joy.magnitude > 0 && joy.y > 0.3;
    const joyLeft = joy.magnitude > 0 && joy.x < -0.3;
    const joyRight = joy.magnitude > 0 && joy.x > 0.3;

    const interact = this.touchInteractPending || keyInteract;
    this.touchInteractPending = false; // consume one-shot flag

    return {
      up: keyUp || joyUp,
      down: keyDown || joyDown,
      left: keyLeft || joyLeft,
      right: keyRight || joyRight,
      sprint: keySprint || this.touchSprint,
      interact,
    };
  }

  /**
   * Get the combined movement vector in screen-space (x: -1..1, y: -1..1, mag: 0..1)
   */
  getMoveVector(): AnalogInput {
    const joy = this.joystickAnalog;
    if (joy.magnitude > 0.01) {
      return joy;
    }

    const keys = this.activeKeys;
    let kx = 0;
    let ky = 0;
    if (keys.has('w') || keys.has('arrowup') || keys.has('keyw')) ky -= 1;
    if (keys.has('s') || keys.has('arrowdown') || keys.has('keys')) ky += 1;
    if (keys.has('a') || keys.has('arrowleft') || keys.has('keya')) kx -= 1;
    if (keys.has('d') || keys.has('arrowright') || keys.has('keyd')) kx += 1;

    const len = Math.hypot(kx, ky);
    if (len > 0) {
      return { x: kx / len, y: ky / len, magnitude: 1 };
    }

    return { x: 0, y: 0, magnitude: 0 };
  }

  isSprinting(): boolean {
    const keys = this.activeKeys;
    return this.touchSprint || keys.has('shift') || keys.has('shiftleft') || keys.has('shiftright');
  }

  reset() {
    this.activeKeys.clear();
    this.joystickAnalog = { x: 0, y: 0, magnitude: 0 };
    this.touchInteractPending = false;
  }
}
