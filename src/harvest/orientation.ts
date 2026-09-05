// Layered, authoritative orientation detection.
//
// No single browser API is reliable across mobile browsers:
//  - matchMedia('(orientation: landscape)') lies while the soft keyboard is open,
//  - screen.orientation is missing on older iOS Safari,
//  - orientationchange fires *before* innerWidth/innerHeight update.
// So we combine every signal we have and let raw geometry win the tie-break,
// because geometry is what actually determines whether the game is playable.

export type DeviceClass = 'mobile' | 'tablet' | 'desktop';

export interface OrientationSnapshot {
  landscape: boolean;
  width: number;
  height: number;
  device: DeviceClass;
  /** true once we have measured the viewport at least once on the client */
  ready: boolean;
}

const FALLBACK: OrientationSnapshot = {
  landscape: true,
  width: 1280,
  height: 720,
  device: 'desktop',
  ready: false,
};

/** Coarse pointer / no hover ⇒ touch device. Cached: it cannot change at runtime. */
let touchCache: boolean | null = null;
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  if (touchCache !== null) return touchCache;
  // NOTE: `'ontouchstart' in window` is NOT a reliable signal — it is true in
  // jsdom and in desktop Chrome with touch-events enabled, which would wrongly
  // gate desktop players behind the rotate overlay. Require an actual coarse
  // pointer or real touch points instead.
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const touchPoints = (navigator.maxTouchPoints || 0) > 0;
  touchCache = Boolean(coarse || touchPoints);
  return touchCache;
}

export function classifyDevice(w: number, h: number): DeviceClass {
  if (!isTouchDevice()) return 'desktop';
  // Use the *longest* edge so the class never flips when rotating.
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (long >= 1000 && short >= 600) return 'tablet';
  return 'mobile';
}

/**
 * The one authoritative answer to "is this device usable in landscape right now?".
 * Desktop / non-touch is always considered landscape — a narrow desktop window is
 * a resize, not a rotation, and must never gate the game.
 */
export function isLandscapeDevice(): boolean {
  if (typeof window === 'undefined') return true;

  const w = window.innerWidth || 0;
  const h = window.innerHeight || 0;

  // 1) Non-touch device → never gate.
  if (!isTouchDevice()) return true;

  // 2) Raw geometry (most trustworthy signal — it is what we render into).
  const geometryLandscape = w > h;

  // 3) matchMedia
  let mediaLandscape: boolean | null = null;
  if (typeof window.matchMedia === 'function') {
    try {
      mediaLandscape = window.matchMedia('(orientation: landscape)').matches;
    } catch {
      mediaLandscape = null;
    }
  }

  // 4) screen.orientation.type / legacy window.orientation
  let screenLandscape: boolean | null = null;
  const so = (typeof screen !== 'undefined' ? screen.orientation : undefined) as ScreenOrientation | undefined;
  if (so && typeof so.type === 'string') {
    screenLandscape = so.type.startsWith('landscape');
  } else if (typeof (window as unknown as { orientation?: number }).orientation === 'number') {
    const angle = Math.abs((window as unknown as { orientation: number }).orientation);
    screenLandscape = angle === 90;
  }

  // Majority vote, geometry breaking ties. A landscape reading from *any* of the
  // orientation APIs combined with landscape geometry is enough to start the game,
  // which is what kills the "rotated but still gated" bug.
  const votes = [geometryLandscape, mediaLandscape, screenLandscape].filter((v): v is boolean => v !== null);
  const yes = votes.filter(Boolean).length;
  if (yes * 2 === votes.length) return geometryLandscape;
  return yes * 2 > votes.length;
}

export function readOrientation(): OrientationSnapshot {
  if (typeof window === 'undefined') return FALLBACK;
  const width = window.innerWidth || 0;
  const height = window.innerHeight || 0;
  return {
    landscape: isLandscapeDevice(),
    width,
    height,
    device: classifyDevice(width, height),
    ready: true,
  };
}

type Listener = (s: OrientationSnapshot) => void;

/**
 * Single shared observer. Every consumer subscribes to the *same* debounced
 * listener set, so we never attach N copies of resize/orientationchange and
 * never leak listeners across React strict-mode double mounts.
 */
class OrientationObserver {
  private listeners = new Set<Listener>();
  private snapshot: OrientationSnapshot = FALLBACK;
  private attached = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private raf = 0;
  private mq: MediaQueryList | null = null;

  get current(): OrientationSnapshot {
    return this.snapshot;
  }

  /**
   * Cached snapshot for useSyncExternalStore. MUST return a referentially stable
   * object between real changes, otherwise React re-renders forever.
   */
  getSnapshot = (): OrientationSnapshot => {
    if (!this.snapshot.ready && typeof window !== 'undefined') {
      this.snapshot = readOrientation();
    }
    return this.snapshot;
  };

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    this.attach();
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0) this.detach();
    };
  }

  /** Recompute now, bypassing the debounce (used on pageshow/visibility). */
  refresh = () => {
    const next = readOrientation();
    const prev = this.snapshot;
    if (
      prev.ready === next.ready &&
      prev.landscape === next.landscape &&
      prev.width === next.width &&
      prev.height === next.height &&
      prev.device === next.device
    ) {
      return; // identical → no notify → no React re-render loop
    }
    this.snapshot = next;
    for (const fn of this.listeners) fn(next);
  };

  /**
   * Debounced + rAF-aligned. orientationchange on iOS fires before the viewport
   * metrics update, so we always re-measure on the next frame after the delay.
   */
  private schedule = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.refresh);
    }, 90);
  };

  private onVisibility = () => {
    if (!document.hidden) this.refresh();
  };

  private attach() {
    if (this.attached || typeof window === 'undefined') return;
    this.attached = true;
    this.snapshot = readOrientation();
    window.addEventListener('resize', this.schedule);
    window.addEventListener('orientationchange', this.schedule);
    window.addEventListener('pageshow', this.refresh);
    window.addEventListener('focus', this.refresh);
    document.addEventListener('visibilitychange', this.onVisibility);
    if (typeof window.matchMedia === 'function') {
      try {
        this.mq = window.matchMedia('(orientation: landscape)');
        this.mq.addEventListener('change', this.schedule);
      } catch {
        this.mq = null;
      }
    }
    const so = (typeof screen !== 'undefined' ? screen.orientation : undefined) as ScreenOrientation | undefined;
    if (so && typeof so.addEventListener === 'function') {
      try { so.addEventListener('change', this.schedule); } catch { /* unsupported */ }
    }
    if (typeof window.visualViewport !== 'undefined' && window.visualViewport) {
      window.visualViewport.addEventListener('resize', this.schedule);
    }
  }

  private detach() {
    if (!this.attached || typeof window === 'undefined') return;
    this.attached = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.schedule);
    window.removeEventListener('orientationchange', this.schedule);
    window.removeEventListener('pageshow', this.refresh);
    window.removeEventListener('focus', this.refresh);
    document.removeEventListener('visibilitychange', this.onVisibility);
    if (this.mq) {
      try { this.mq.removeEventListener('change', this.schedule); } catch { /* noop */ }
      this.mq = null;
    }
    const so = (typeof screen !== 'undefined' ? screen.orientation : undefined) as ScreenOrientation | undefined;
    if (so && typeof so.removeEventListener === 'function') {
      try { so.removeEventListener('change', this.schedule); } catch { /* unsupported */ }
    }
    if (typeof window.visualViewport !== 'undefined' && window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this.schedule);
    }
  }
}

export const orientationObserver = new OrientationObserver();
