"use client";
// Orientation gate, loading & error screens.
import React, { useEffect, useState } from 'react';
import { Smartphone, RefreshCw } from 'lucide-react';

export function OrientationGate() {
  const [angle, setAngle] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setAngle((a) => (a + 360) % 720), 1400);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-[#101a2e] via-[#14243d] to-[#0f1a2c] text-white text-center px-6">
      <div
        className="relative w-20 h-32 sm:w-24 sm:h-36 rounded-xl border-4 border-emerald-300/80 bg-emerald-400/10 flex items-center justify-center"
        style={{ transform: `rotate(${angle}deg)`, transition: 'transform 1.2s ease-in-out' }}
      >
        <div className="w-8 h-8 rounded-full border-4 border-emerald-300/80" />
        <div className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-10 h-1 bg-emerald-300/60 rounded-full" />
      </div>
      <div className="space-y-2">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight">Harvest Moon</h2>
        <p className="text-sm sm:text-base text-white/80 max-w-xs">
          Putar perangkatmu ke mode <b className="text-emerald-300">landscape</b> untuk bermain.
        </p>
      </div>
      <button
        onClick={() => setAngle((a) => a + 90)}
        className="text-xs text-white/60 hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer"
      >
        <Smartphone className="w-3.5 h-3.5" /> Rotate device → enjoy the world
      </button>
    </div>
  );
}

export function LoadingScreen({ status }: { status: string }) {
  const isReconnect = status === 'reconnecting';
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-5 bg-[#101a2e]/85 backdrop-blur-sm text-white text-center px-6">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border-4 border-emerald-400/20" />
        <div className={`absolute inset-0 rounded-full border-4 border-t-emerald-300 border-r-transparent border-b-transparent border-l-transparent ${isReconnect ? '' : 'animate-spin'}`} />
        <div className="absolute inset-0 flex items-center justify-center text-2xl">🌾</div>
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-bold">
          {isReconnect ? 'Reconnecting...' : status === 'connecting' ? 'Menghubungkan ke Dunia...' : 'Menyiapkan World...'}
        </h2>
        <p className="text-xs text-white/60">
          {isReconnect
            ? 'Koneksi terputus. Progress kamu aman — kami menghubungkan kembali.'
            : 'Memuat village, farm, dan dunia persisten kamu.'}
        </p>
      </div>
      <div className="w-56 h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full w-1/3 rounded-full bg-emerald-400 ${isReconnect ? '' : 'animate-[loadbar_1.6s_ease-in-out_infinite]'}`} style={isReconnect ? { width: '100%' } : { animation: 'loadbar 1.6s ease-in-out infinite' }} />
      </div>
    </div>
  );
}

export function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setT((x) => x + 1), 40);
    return () => clearInterval(iv);
  }, []);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-5 bg-[#101a2e] text-white text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-red-500/15 border border-red-400/30 flex items-center justify-center text-3xl">⚠️</div>
      <div className="space-y-2 max-w-sm">
        <h2 className="text-xl font-bold">Tidak bisa terhubung</h2>
        <p className="text-sm text-white/70">{message || 'Game server sedang tidak tersedia. Coba lagi sebentar.'}</p>
      </div>
      <button
        onClick={onRetry}
        className="flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-bold text-sm transition-colors cursor-pointer active:scale-95"
      >
        <RefreshCw className="w-4 h-4" style={{ transform: `rotate(${t}deg)` }} /> Muat Ulang
      </button>
    </div>
  );
}
