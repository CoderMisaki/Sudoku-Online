// Unified input abstraction for desktop keyboard, mobile/tablet joystick and
// on-screen buttons. Everything funnels into ONE internal frame state that the
// game loop reads by reference — never through React state, so movement never
// costs a re-render.

export interface InputFrame {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  sprint: boolean;
  interact: boolean;
  /** analog axes, screen space: x right-positive, y up-positive, both -1..1 */
  x: number;
  y: number;
  /** 0..1 analog magnitude — drives movement speed */
  magnitude: number;
}

export type InputAction = 'inventory' | 'map' | 'chat' | 'interact' | 'quests' | 'journal' | 'crafting' | 'relationships' | 'settings' | 'close';

const MOVE_KEYS: Record<string, keyof Pick<InputFrame, 'up' | 'down' | 'left' | 'right'>> = {
  keyw: 'up', arrowup: 'up',
  keys: 'down', arrowdown: 'down',
  keya: 'left', arrowleft: 'left',
  keyd: 'right', arrowright: 'right',
};

/** Shortcut keys → semantic action. Uses e.code so it is keyboard-layout safe. */
const ACTION_KEYS: Record<string, InputAction> = {
  keyi: 'inventory',
  tab: 'inventory',
  keym: 'map',
  enter: 'chat',
  numpadenter: 'chat',
  keye: 'interact',
  space: 'interact',
  keyq: 'quests',
  keyj: 'journal',
  keyc: 'crafting',
  keyp: 'relationships',
  keyl: 'relationships',
  keyn: 'settings',
  escape: 'close',
};

export const JOYSTICK_DEAD_ZONE = 0.16;

type ActionListener = (action: InputAction, ev?: KeyboardEvent) => void;
type QuickSlotListener = (index: number) => void;

export class InputManager {
  /** Mutable frame read by the game loop. Never replaced, only mutated. */
  readonly frame: InputFrame = {
    up: false, down: false, left: false, right: false,
    sprint: false, interact: false, x: 0, y: 0, magnitude: 0,
  };

  private keysDown = new Set<string>();
  private joystick = { x: 0, y: 0, magnitude: 0, active: false };
  private touchSprint = false;
  private actionListeners = new Set<ActionListener>();
  private quickSlotListeners = new Set<QuickSlotListener>();
  private attached = false;
  /** When true (menu/chat/dialogue open) movement is suppressed but not lost. */
  private suppressed = false;

  // ── lifecycle ──
  attach() {
    if (this.attached || typeof window === 'undefined') return;
    this.attached = true;
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.releaseAll);
    window.addEventListener('pagehide', this.releaseAll);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  detach() {
    if (!this.attached || typeof window === 'undefined') return;
    this.attached = false;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.releaseAll);
    window.removeEventListener('pagehide', this.releaseAll);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.releaseAll();
    this.actionListeners.clear();
    this.quickSlotListeners.clear();
  }

  // ── subscriptions ──
  onAction(fn: ActionListener): () => void {
    this.actionListeners.add(fn);
    return () => { this.actionListeners.delete(fn); };
  }
  onQuickSlot(fn: QuickSlotListener): () => void {
    this.quickSlotListeners.add(fn);
    return () => { this.quickSlotListeners.delete(fn); };
  }

  /** Movement is ignored while a modal owns the screen — but keys stay tracked. */
  setSuppressed(v: boolean) {
    if (this.suppressed === v) return;
    this.suppressed = v;
    if (v) {
      // Zero the movement immediately so the avatar cannot drift under a modal.
      this.joystick.x = 0; this.joystick.y = 0; this.joystick.magnitude = 0; this.joystick.active = false;
    }
    this.recompute();
  }
  isSuppressed() { return this.suppressed; }

  // ── keyboard ──
  private codeOf(e: KeyboardEvent): string {
    // e.code is layout-independent; fall back to e.key for synthetic events.
    return (e.code || e.key || '').toLowerCase();
  }

  private onKeyDown = (e: KeyboardEvent) => {
    const target = e.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const code = this.codeOf(e);

    if (typing) {
      // While typing, only Escape is a game action; everything else belongs to the field.
      if (code === 'escape') this.emitAction('close', e);
      return;
    }

    if (code === 'shiftleft' || code === 'shiftright') {
      this.keysDown.add(code);
      this.recompute();
      return;
    }

    if (MOVE_KEYS[code]) {
      e.preventDefault();
      // Key repeat must not re-trigger anything; the Set already holds it.
      if (!e.repeat) {
        this.keysDown.add(code);
        this.recompute();
      }
      return;
    }

    // Quick slots 1..8
    if (/^digit[1-8]$/.test(code)) {
      const idx = Number(code.slice(-1)) - 1;
      for (const fn of this.quickSlotListeners) fn(idx);
      return;
    }

    const action = ACTION_KEYS[code];
    if (action) {
      if (code === 'space' || code === 'tab') e.preventDefault();
      if (!e.repeat) this.emitAction(action, e);
      if (action === 'interact') {
        this.frame.interact = true;
        // interact is edge-triggered; consumers read and clear it.
      }
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    const code = this.codeOf(e);
    if (this.keysDown.delete(code)) this.recompute();
    if (ACTION_KEYS[code] === 'interact') this.frame.interact = false;
  };

  /**
   * Root-cause fix for stuck keys: any time the window loses focus, the tab is
   * hidden, or the page is being frozen, we drop every held key. Browsers do not
   * deliver keyup for keys released while unfocused.
   */
  releaseAll = () => {
    const had = this.keysDown.size > 0 || this.joystick.magnitude > 0 || this.touchSprint;
    this.keysDown.clear();
    this.joystick = { x: 0, y: 0, magnitude: 0, active: false };
    this.touchSprint = false;
    this.frame.interact = false;
    if (had) this.recompute();
    else this.recompute();
  };

  private onVisibility = () => {
    if (document.hidden) this.releaseAll();
  };

  // ── joystick (mobile / tablet) ──
  /** Raw axes from the joystick widget: x right-positive, y up-positive. */
  setJoystick(x: number, y: number) {
    const len = Math.hypot(x, y);
    if (len < JOYSTICK_DEAD_ZONE) {
      this.joystick = { x: 0, y: 0, magnitude: 0, active: len > 0 };
    } else {
      // Rescale past the dead zone so the analog range stays full 0..1.
      const clamped = Math.min(1, len);
      const scaled = (clamped - JOYSTICK_DEAD_ZONE) / (1 - JOYSTICK_DEAD_ZONE);
      this.joystick = { x: (x / len) * scaled, y: (y / len) * scaled, magnitude: scaled, active: true };
    }
    this.recompute();
  }
  releaseJoystick() {
    this.joystick = { x: 0, y: 0, magnitude: 0, active: false };
    this.recompute();
  }

  setTouchSprint(v: boolean) {
    this.touchSprint = v;
    this.recompute();
  }
  getTouchSprint() { return this.touchSprint; }

  // ── derived frame ──
  private recompute() {
    const f = this.frame;
    if (this.suppressed) {
      f.up = f.down = f.left = f.right = false;
      f.x = 0; f.y = 0; f.magnitude = 0;
      f.sprint = false;
      return;
    }

    const kUp = this.keysDown.has('keyw') || this.keysDown.has('arrowup');
    const kDown = this.keysDown.has('keys') || this.keysDown.has('arrowdown');
    const kLeft = this.keysDown.has('keya') || this.keysDown.has('arrowleft');
    const kRight = this.keysDown.has('keyd') || this.keysDown.has('arrowright');

    if (this.joystick.magnitude > 0) {
      // Analog wins while the stick is engaged.
      f.x = this.joystick.x;
      f.y = this.joystick.y;
      f.magnitude = this.joystick.magnitude;
      f.up = f.y > 0.35; f.down = f.y < -0.35;
      f.right = f.x > 0.35; f.left = f.x < -0.35;
    } else {
      let x = (kRight ? 1 : 0) - (kLeft ? 1 : 0);
      let y = (kUp ? 1 : 0) - (kDown ? 1 : 0);
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      f.x = x; f.y = y;
      f.magnitude = Math.min(1, len);
      f.up = kUp; f.down = kDown; f.left = kLeft; f.right = kRight;
    }

    f.sprint = this.touchSprint || this.keysDown.has('shiftleft') || this.keysDown.has('shiftright');
  }

  private emitAction(action: InputAction, ev?: KeyboardEvent) {
    for (const fn of this.actionListeners) fn(action, ev);
  }

  /** Programmatic interact (touch button). */
  pulseInteract() {
    this.emitAction('interact');
  }
}

export const inputManager = new InputManager();
