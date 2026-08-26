"use client";

export interface ErrorLogEntry {
  id: string;
  timestamp: number;
  level: 'error' | 'warn' | 'info';
  message: string;
  stack?: string;
  source?: string;
}

const STORAGE_KEY = 'sudoku_error_logs';
const MAX_LOGS = 100;

let logs: ErrorLogEntry[] = [];
const listeners = new Set<() => void>();
let initialized = false;

function persist() {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs.slice(0, MAX_LOGS)));
    }
  } catch {}
}

function loadFromStorage() {
  try {
    if (typeof window !== 'undefined') {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as ErrorLogEntry[];
        if (Array.isArray(parsed)) logs = parsed.slice(0, MAX_LOGS);
      }
    }
  } catch {}
}

function notify() {
  listeners.forEach((cb) => {
    try { cb(); } catch {}
  });
}

function genId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function addErrorLog(entry: Omit<ErrorLogEntry, 'id' | 'timestamp'> & { timestamp?: number }) {
  const log: ErrorLogEntry = {
    id: genId(),
    timestamp: entry.timestamp ?? Date.now(),
    level: entry.level,
    message: entry.message,
    stack: entry.stack,
    source: entry.source,
  };
  logs = [log, ...logs].slice(0, MAX_LOGS);
  persist();
  notify();
  // Also echo to console for debugging (not exposed to non-admin UI)
  if (log.level === 'error') console.error(`[ErrorLog] ${log.message}`, log.stack || '');
  return log;
}

export function getErrorLogs(): ErrorLogEntry[] {
  return [...logs];
}

export function clearErrorLogs() {
  logs = [];
  persist();
  notify();
}

export function subscribeErrorLogs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Initialize global capture once
export function initErrorLogger() {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  loadFromStorage();

  // Capture window errors
  window.addEventListener('error', (event) => {
    addErrorLog({
      level: 'error',
      message: event.message || 'Window error',
      stack: event.error?.stack,
      source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : 'window.onerror',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    const msg = reason instanceof Error ? reason.message : String(reason);
    const stack = reason instanceof Error ? reason.stack : undefined;
    addErrorLog({
      level: 'error',
      message: `Unhandled Promise: ${msg}`,
      stack,
      source: 'unhandledrejection',
    });
  });

  // Monkey-patch console.error to also log
  const origError = console.error;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (console as any).error = (...args: unknown[]) => {
    try {
      const msg = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
      // Avoid infinite loop: don't double-log if already from addErrorLog
      if (!msg.startsWith('[ErrorLog]')) {
        addErrorLog({
          level: 'error',
          message: msg.slice(0, 500),
          source: 'console.error',
        });
      }
    } catch {}
    origError(...args);
  };
}

// Helper for API/server side to log via client fetch
export async function logServerError(message: string, source = 'server') {
  addErrorLog({ level: 'error', message, source });
}
