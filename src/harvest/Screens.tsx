"use client";
// Orientation gate, loading & error screens.
import React from 'react';
import { RotateCw, RefreshCw } from 'lucide-react';

export function OrientationGate() {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#101a2e] via-[#14243d] to-[#0f1a2c] text-white text-center px-6 select-none"
    >
      <div className="relative flex items-center justify-center">
        {/* Phone frame with smooth CSS rotation hint */}
        <div className="relative w-20 h-32 rounded-2xl border-4 border-emerald-400/90 bg-emerald-500/10 shadow-[0_0_30px_rgba(52,211,153,0.3)] flex items-center justify-center animate-[pulse_2s_ease-in-out_infinite]">
          <div className="w-8 h-8 rounded-full border-2 border-emerald-300/80 flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
          </div>
          <div className="absolute top-2 w-6 h-1 bg-emerald-300/50 rounded-full" />
          <div className="absolute bottom-2 w-3 h-3 rounded-full border border-emerald-300/50" />
        </div>
        <div className="absolute -right-5 -bottom-2 bg-emerald-400 text-emerald-950 p-2 rounded-full shadow-lg animate-spin" style={{ animationDuration: '4s' }}>
          <RotateCw className="w-4 h-4" />
        </div>
      </div>

      <div className="space-y-2 max-w-sm">
        <h2 className="text-xl sm:text-2xl font-black tracking-tight text-white">
          Mode Landscape Dibutuhkan
        </h2>
        <p className="text-sm sm:text-base text-white/80 leading-relaxed">
          Putar perangkatmu ke posisi <b className="text-emerald-300 font-bold">Landscape (Mendatar)</b> untuk memulai permainan.
        </p>
      </div>

      <div className="inline-flex items-center gap-2 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-xs text-white/60">
        <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
        Otomatis melanjutkan saat perangkat diputar
      </div>
    </div>
  );
}

export function LoadingScreen({ status }: { status: string }) {
  const isReconnect = status === 'reconnecting';
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-[#101a2e]/90 backdrop-blur-md text-white text-center px-6 select-none">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-emerald-400/20" />
        <div
          className={`absolute inset-0 rounded-full border-4 border-t-emerald-300 border-r-transparent border-b-transparent border-l-transparent ${
            isReconnect ? '' : 'animate-spin'
          }`}
        />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">🌾</div>
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-bold">
          {isReconnect ? 'Menghubungkan Kembali...' : status === 'connecting' ? 'Menghubungkan ke Server...' : 'Menyiapkan Dunia...'}
        </h2>
        <p className="text-xs text-white/60 max-w-xs">
          {isReconnect
            ? 'Koneksi terputus. Data kamu aman — kami menghubungkan kembali.'
            : 'Sinkronisasi world, farm, inventory, dan pemain lain.'}
        </p>
      </div>
      <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div
          className={`h-full rounded-full bg-emerald-400 ${
            isReconnect ? 'w-full animate-pulse' : 'w-1/3 animate-[loadbar_1.6s_ease-in-out_infinite]'
          }`}
        />
      </div>
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
