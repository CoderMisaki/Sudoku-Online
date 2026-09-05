"use client";

import React, { useState } from 'react';
import { useOrientation } from '@/hooks/useOrientation';
import { Button } from '@/components/ui/Button';
import { Smartphone, RotateCw, X, MonitorSmartphone } from 'lucide-react';
import { cn } from '@/utils/cn';

const DISMISS_KEY = 'sudoku_orientation_hint_dismissed';

/**
 * Banner orientasi NON-BLOKIR — perbaikan bug "mode miring tidak terbaca /
 * game stuck tidak mulai":
 *
 * - Game SELALU bisa dimulai & dimainkan di portrait maupun landscape.
 * - Komponen ini hanya memberi saran ramah + tombol "Aktifkan Landscape"
 *   (screen.orientation.lock bila didukung) — tidak pernah mengunci alur game.
 * - Pembacaan orientasi memakai useOrientation (3 sumber + listener ganda)
 *   sehingga tidak ada lagi kasus "sudah miring tapi tidak terbaca".
 */
export const OrientationHint: React.FC<{ className?: string }> = ({ className }) => {
  const { orientation, isPortrait, isLandscape, device, isTouch, requestLandscape } = useOrientation();
  // Baca status dismiss saat inisialisasi (lazy) agar tidak setState dalam effect.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return typeof window !== 'undefined' && sessionStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [locking, setLocking] = useState(false);
  const [lockedOk, setLockedOk] = useState<boolean | null>(null);

  const dismiss = () => {
    setDismissed(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {}
  };

  if (dismissed) return null;
  // Hanya tampil di perangkat sentuh + portrait (tempat landscape paling membantu).
  // Desktop & landscape tidak diganggu sama sekali.
  if (!isTouch || !isPortrait) return null;

  const handleLandscape = async () => {
    setLocking(true);
    setLockedOk(null);
    const ok = await requestLandscape();
    setLockedOk(ok);
    setLocking(false);
    if (ok) {
      // Berhasil landscape -> sembunyikan banner otomatis
      window.setTimeout(dismiss, 800);
    }
  };

  return (
    <div
      className={cn(
        'w-full rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs sm:text-sm',
        'flex items-center gap-3 shadow-sm',
        className
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-500/15 flex items-center justify-center">
        {device === 'tablet' ? (
          <MonitorSmartphone className="w-5 h-5 text-amber-600 dark:text-amber-400" />
        ) : (
          <Smartphone className="w-5 h-5 text-amber-600 dark:text-amber-400 rotate-90" />
        )}
      </div>
      <div className="flex-1 min-w-0 text-left">
        <p className="font-semibold text-amber-700 dark:text-amber-300">
          Mode miring terdeteksi: portrait ({orientation})
        </p>
        <p className="text-amber-700/80 dark:text-amber-200/70 text-[11px] sm:text-xs leading-snug">
          Game tetap bisa dimainkan. Miringkan HP untuk area papan lebih lega — atau lanjutkan di sini.
        </p>
        {lockedOk === false && (
          <p className="text-[11px] mt-1 text-secondary">
            Perangkat tidak mengizinkan kunci otomatis — cukup miringkan manual, game langsung menyesuaikan.
          </p>
        )}
        {isLandscape && <p className="text-[11px] mt-1 text-green-600">✅ Landscape terbaca. Selamat bermain!</p>}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={handleLandscape}
          disabled={locking}
          className="h-8 text-xs border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/15"
        >
          <RotateCw className={cn('w-3.5 h-3.5 mr-1', locking && 'animate-spin')} />
          {locking ? '...' : 'Landscape'}
        </Button>
        <button
          onClick={dismiss}
          aria-label="Tutup saran orientasi"
          className="p-1.5 rounded-lg text-secondary hover:text-foreground hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
