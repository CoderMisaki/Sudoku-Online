"use client";
// Orientation gate, connection/loading & error screens.
//
// VISUAL RULE: strictly MONOCHROME, driven by the project's existing theme
// tokens (`--background`, `--card`, `--border`, `--foreground`, `--secondary`)
// so dark and light mode both stay neutral. No emerald/green glow, no coloured
// gradients, no neon — these screens are system chrome, not game identity.
import React from 'react';
import { AlertTriangle, RefreshCw, RotateCw, Smartphone, WifiOff } from 'lucide-react';
import { motion } from 'framer-motion';
import type { OverlayState } from './overlay';

/**
 * Compact, monochrome fallback gate.
 *
 * It is only rendered when the device is a phone/tablet AND the viewport is
 * portrait AND the automatic `screen.orientation.lock('landscape')` has not
 * (yet) succeeded. `locking` shows the "settling" copy while a lock attempt is
 * in flight, so on platforms that support it the user never has to touch a
 * system setting.
 */
export function OrientationGate({ locking = false }: { locking?: boolean }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="orientation-gate"
      className="absolute inset-0 z-50 flex items-center justify-center bg-background/95 px-6 text-foreground backdrop-blur-sm select-none"
    >
      <div className="w-full max-w-[17rem] rounded-2xl border border-border bg-card px-5 py-6 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-xl border border-border bg-background text-secondary">
          <motion.div
            animate={locking ? { rotate: 0 } : { rotate: [0, 90, 90, 0] }}
            transition={
              locking
                ? { duration: 0.2 }
                : {
                    duration: 2.8,
                    times: [0, 0.4, 0.6, 1],
                    repeat: Infinity,
                    repeatDelay: 0.4,
                    ease: 'easeInOut',
                  }
            }
          >
            <Smartphone className="h-6 w-6" strokeWidth={1.75} />
          </motion.div>
        </div>
        <h2 className="text-sm font-bold tracking-tight text-foreground">
          {locking ? 'Menyesuaikan orientasi…' : 'Putar perangkat ke Landscape'}
        </h2>
        <p className="mt-1.5 text-xs leading-relaxed text-secondary">
          {locking
            ? 'Game ini berjalan mendatar. Sedang menyesuaikan layar…'
            : 'Game ini berjalan mendatar. Putar perangkatmu untuk melanjutkan — koneksi dan progres tetap aman.'}
        </p>
      </div>
    </div>
  );
}

/**
 * Single connection overlay for every non-terminal state:
 * connecting / handshake / reconnecting / recovering / FAILED.
 *
 * `failed` is the only state offering a page reload — and it is never triggered
 * automatically.
 */
export function LoadingScreen({
  overlay,
  onRetry,
  onReload,
}: {
  overlay: OverlayState;
  onRetry?: () => void;
  onReload?: () => void;
}) {
  const failed = overlay.kind === 'failed';
  const busy = overlay.kind === 'loading' || overlay.kind === 'recovering';
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="connection-overlay"
      data-kind={overlay.kind}
      className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-background/92 px-6 text-center text-foreground backdrop-blur-md select-none"
    >
      <div className="relative flex h-14 w-14 items-center justify-center">
        <div className="absolute inset-0 rounded-full border-2 border-border" />
        <div
          className={`absolute inset-0 rounded-full border-2 border-transparent border-t-foreground/70 ${
            busy ? 'animate-spin' : 'animate-pulse'
          }`}
        />
        <div className="text-secondary">
          {failed ? (
            <WifiOff className="h-5 w-5" strokeWidth={1.75} />
          ) : (
            <Smartphone className="h-5 w-5" strokeWidth={1.75} />
          )}
        </div>
      </div>

      <div className="max-w-xs space-y-1.5">
        <h2 className="text-sm font-bold tracking-tight">{overlay.title}</h2>
        <p className="text-xs leading-relaxed text-secondary">{overlay.hint}</p>
      </div>

      <div className="h-1 w-48 overflow-hidden rounded-full border border-border bg-card">
        <div
          className={`h-full rounded-full bg-foreground/50 ${
            busy ? 'w-1/3 animate-[loadbar_1.6s_ease-in-out_infinite]' : 'w-full animate-pulse'
          }`}
        />
      </div>

      <div className="flex items-center gap-2">
        {onRetry && (
          <button
            type="button"
            onClick={onRetry}
            data-testid="overlay-retry"
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full px-4 py-2 text-xs font-bold transition-opacity active:scale-95 ${
              failed
                ? 'bg-foreground text-background hover:opacity-90'
                : 'border border-border bg-card text-secondary hover:text-foreground'
            }`}
          >
            <RotateCw className="h-3.5 w-3.5" strokeWidth={2} />
            Coba Sambungkan Lagi
          </button>
        )}
        {failed && onReload && (
          <button
            type="button"
            onClick={onReload}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs text-secondary transition-colors hover:text-foreground active:scale-95"
          >
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            Muat Ulang Game
          </button>
        )}
      </div>
    </div>
  );
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      data-testid="error-screen"
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-background px-6 text-center text-foreground select-none"
    >
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card text-secondary">
        <AlertTriangle className="h-6 w-6" strokeWidth={1.75} />
      </div>
      <div className="max-w-sm space-y-2">
        <h2 className="text-base font-bold tracking-tight">Tidak Bisa Terhubung</h2>
        <p className="text-sm leading-relaxed text-secondary">
          {message || 'Game server sedang tidak tersedia atau koneksi terputus. Silakan coba muat ulang.'}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="flex cursor-pointer items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-bold text-background transition-opacity hover:opacity-90 active:scale-95"
      >
        <RefreshCw className="h-4 w-4" strokeWidth={2} /> Muat Ulang Halaman
      </button>
    </div>
  );
}
