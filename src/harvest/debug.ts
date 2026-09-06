// Structured, dev-only diagnostics for the Harvest realtime stack.
//
// Every log line is tagged so a single subsystem can be filtered in the
// console / in E2E assertions:
//
//   [harvest][orientation] detected portrait
//   [harvest][ws]          socket created id=42
//   [harvest][handshake]   hello_ack received id=42
//   [harvest][recovery]    source=online socket unhealthy
//   [harvest][pwa]         display-mode=standalone
//
// Production stays silent unless the user explicitly opts in with
// `localStorage.setItem('harvest_debug', '1')`.
export type HarvestLogTag =
  | 'orientation'
  | 'ws'
  | 'handshake'
  | 'recovery'
  | 'pwa'
  | 'session'
  | 'snapshot'
  | 'engine';

const STORAGE_KEY = 'harvest_debug';

let cached: boolean | null = null;

/** Force-enable/disable logging (used by tests). `null` restores auto-detect. */
export function setHarvestDebug(value: boolean | null): void {
  cached = value;
}

export function isHarvestDebugEnabled(): boolean {
  if (cached !== null) return cached;
  let on = false;
  try {
    on = process.env.NODE_ENV !== 'production';
  } catch {
    on = false;
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage?.getItem(STORAGE_KEY) === '1') on = true;
  } catch {
    /* private mode / SSR — ignore */
  }
  return on;
}

function format(tag: HarvestLogTag, msg: string, data?: Record<string, unknown>): string {
  if (!data) return `[harvest][${tag}] ${msg}`;
  const extra = Object.entries(data)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  return extra ? `[harvest][${tag}] ${msg} ${extra}` : `[harvest][${tag}] ${msg}`;
}

export function dlog(tag: HarvestLogTag, msg: string, data?: Record<string, unknown>): void {
  if (!isHarvestDebugEnabled()) return;
  try {
    console.log(format(tag, msg, data));
  } catch {
    /* console unavailable */
  }
}

export function dwarn(tag: HarvestLogTag, msg: string, data?: Record<string, unknown>): void {
  if (!isHarvestDebugEnabled()) return;
  try {
    console.warn(format(tag, msg, data));
  } catch {
    /* console unavailable */
  }
}

export function derror(tag: HarvestLogTag, msg: string, err?: unknown): void {
  try {
    if (err !== undefined) console.error(format(tag, msg), err);
    else console.error(format(tag, msg));
  } catch {
    /* console unavailable */
  }
}
