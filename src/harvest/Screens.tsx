"use client";
// Orientation gate, loading & error screens.
import React from 'react';
import { RotateCw, RefreshCw } from 'lucide-react';
import { motion } from 'framer-motion';

export function OrientationGate() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#0d1826] via-[#0f1a2c] to-[#070d18] text-white text-center px-6 select-none overflow-hidden"
    >
      {/* decorative ambient glow — project palette only (emerald + amber) */}
      <div className="pointer-events-none absolute inset-0 opacity-40">
        <div className="absolute left-1/4 top-1/4 w-72 h-72 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute right-1/4 bottom-1/4 w-72 h-72 rounded-full bg-amber-400/10 blur-3xl" />
      </div>

      <div className="relative flex items-center justify-center">
        {/* spinning orbit ring */}
        <motion.div
          className="absolute w-44 h-44 rounded-full border-2 border-dashed border-emerald-300/25"
          animate={{ rotate: 360 }}
          transition={{ duration: 10, repeat: Infinity, ease: 'linear' }}
        >
          <span className="absolute -top-1 left-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-emerald-300 shadow-[0_0_12px_rgba(52,211,153,0.85)]" />
        </motion.div>

        {/* Phone that physically tilts toward landscape and back */}
        <motion.div
          className="relative w-20 h-32 sm:w-24 sm:h-36 rounded-2xl border-4 border-emerald-400/90 bg-emerald-500/10 shadow-[0_0_30px_rgba(52,211,153,0.3)] flex items-center justify-center"
          animate={{ rotate: [0, 90, 90, 0], scale: [1, 1.04, 1.04, 1] }}
          transition={{
            duration: 2.6,
            times: [0, 0.42, 0.58, 1],
            repeat: Infinity,
            repeatDelay: 0.35,
            ease: 'easeInOut',
          }}
        >
          {/* camera */}
          <div className="absolute top-2 w-6 h-1 bg-emerald-300/50 rounded-full" />
          {/* screen content */}
          <div className="w-8 h-8 rounded-full border-2 border-emerald-300/80 flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
          </div>
          {/* home button */}
          <div className="absolute bottom-2 w-3 h-3 rounded-full border border-emerald-300/50" />
        </motion.div>

        {/* small arrow gently pointing toward the rotation */}
        <motion.div
          className="absolute -right-7 -bottom-2 bg-emerald-400 text-emerald-950 p-2 rounded-full shadow-lg"
          animate={{ rotate: 360 }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
        >
          <RotateCw className="w-4 h-4" />
        </motion.div>
      </div>

      <div className="space-y-2 max-w-sm relative z-10">
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
          Mode Landscape Dibutuhkan
        </h2>
        <p className="text-sm sm:text-base text-white/80 leading-relaxed">
          Putar perangkatmu ke posisi <b className="text-emerald-300 font-bold">Landscape (Mendatar)</b> untuk memulai permainan.
        </p>
      </div>
    </div>
  );
}

export function LoadingScreen({
  status,
  failed = false,
  onRetry,
  onReload,
}: {
  status: string;
  /** true when the automatic retry budget is exhausted — show recovery actions, never auto-reload. */
  failed?: boolean;
  onRetry?: () => void;
  onReload?: () => void;
}) {
  const isReconnect = status === 'reconnecting';
  const title = failed
    ? 'Koneksi belum berhasil dipulihkan'
    : isReconnect
      ? 'Menghubungkan Kembali...'
      : status === 'connecting'
        ? 'Menghubungkan ke Server...'
        : status === 'syncing'
          ? 'Memuat Data Dunia...'
          : 'Menyiapkan Dunia...';
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-[#0d1826]/90 backdrop-blur-md text-white text-center px-6 select-none">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-emerald-400/20" />
        <div
          className={`absolute inset-0 rounded-full border-4 border-t-emerald-300 border-r-transparent border-b-transparent border-l-transparent ${
            isReconnect || failed ? 'animate-pulse' : 'animate-spin'
          }`}
        />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">{failed ? '📡' : '🌾'}</div>
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-bold">{title}</h2>
        <p className="text-xs text-white/60 max-w-xs">
          {failed
            ? 'Server tidak menjawab setelah beberapa kali percobaan. Data kamu aman — coba hubungkan ulang tanpa reload.'
            : isReconnect
              ? 'Koneksi terputus. Data kamu aman — kami menghubungkan kembali.'
              : 'Sinkronisasi world, farm, inventory, dan pemain lain.'}
        </p>
      </div>
      <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full bg-emerald-400 ${
            isReconnect || failed ? 'w-full animate-pulse' : 'w-1/3 animate-[loadbar_1.6s_ease-in-out_infinite]'
          }`}
        />
      </div>
      {failed ? (
        <div className="flex items-center gap-2">
          {onRetry && (
            <button
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-emerald-950 px-4 py-2 text-xs font-bold transition-colors cursor-pointer active:scale-95"
            >
              <RotateCw className="w-3.5 h-3.5" />
              Hubungkan Ulang
            </button>
          )}
          {onReload && (
            <button
              onClick={onReload}
              className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-95"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Muat Ulang Game
            </button>
          )}
        </div>
      ) : (
        onRetry && (
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-white/10 transition-colors cursor-pointer active:scale-95"
          >
            <RotateCw className="w-3.5 h-3.5" />
            Coba Sambungkan Lagi
          </button>
        )
      )}
    </div>
  );
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-[#101a2e] text-white text-center px-6 select-none">
      <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-400/30 flex items-center justify-center text-3xl">
        ⚠️
      </div>
      <div className="space-y-2 max-w-sm">
        <h2 className="text-xl font-bold">Tidak Bisa Terhubung</h2>
        <p className="text-sm text-white/70 leading-relaxed">
          {message || 'Game server sedang tidak tersedia atau koneksi terputus. Silakan coba muat ulang.'}
        </p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-sm transition-transform active:scale-95 cursor-pointer shadow-lg"
      >
        <RefreshCw className="w-4 h-4" /> Muat Ulang Halaman
      </button>
    </div>
  );
}
