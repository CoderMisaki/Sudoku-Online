/**
 * Sound Effects Engine — Ular Tangga, Sudoku & Tic Tac Toe Sounds
 * ---------------------------------------------------
 * Semua efek suara disintesis langsung lewat Web Audio API (tanpa file asset),
 * sehingga:
 *  - bebas lisensi, ukuran bundle tetap kecil,
 *  - setiap klien memainkan karakter suara yang identik (deterministik),
 *  - aman dimainkan dari callback animasi (no-op bila AudioContext masih
 *    terkunci oleh browser autoplay policy).
 *
 * Desain suara dibuat "mewah": layer beberapa osilator + noise terfilter,
 * envelope halus, compressor di master bus, dan shimmer delay untuk chime.
 */

const STORAGE_KEY = 'sudoku_sfx_muted';

type AnyWindow = typeof window | undefined;

class SoundFX {
  private ctx: AudioContext | null = null;
  private master: AudioNode | null = null;
  /** Bus shimmer (delay + feedback) untuk chime/suara magis. */
  private shimmer: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private muted = false;
  private lastTickAt = 0;

  constructor() {
    try {
      const w = typeof window !== 'undefined' ? (window as AnyWindow) : undefined;
      this.muted = w?.localStorage?.getItem(STORAGE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  isMuted(): boolean {
    return this.muted;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(STORAGE_KEY, m ? '1' : '0');
      }
    } catch {
      /* localStorage tidak tersedia — abaikan */
    }
  }

  /**
   * Panggil dari gesture pengguna (klik/keyboard) untuk membuka AudioContext.
   * Aman dipanggil berulang kali.
   */
  unlock(): void {
    try {
      const ctx = this.ensureCtx();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume();
      }
    } catch {
      /* belum diizinkan browser — coba lagi di gesture berikutnya */
    }
  }

  private ensureCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (this.ctx) return this.ctx;

    const w = window as Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext || w.webkitAudioContext;
    if (!Ctor) return null;

    try {
      const ctx = new Ctor();
      // Master bus: compressor agar campuran beberapa suara tetap halus.
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.knee.value = 24;
      comp.ratio.value = 6;
      comp.attack.value = 0.004;
      comp.release.value = 0.18;
      const master = ctx.createGain();
      master.gain.value = 0.55;
      comp.connect(master);
      master.connect(ctx.destination);

      // Shimmer bus: delay pendek + feedback + highpass -> nuansa "airy".
      const shimmerIn = ctx.createGain();
      shimmerIn.gain.value = 1;
      const delay = ctx.createDelay(0.5);
      delay.delayTime.value = 0.115;
      const fb = ctx.createGain();
      fb.gain.value = 0.3;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1200;
      shimmerIn.connect(delay);
      delay.connect(fb);
      fb.connect(delay);
      delay.connect(hp);
      hp.connect(comp);

      this.ctx = ctx;
      this.master = comp;
      this.shimmer = shimmerIn;
      return ctx;
    } catch {
      return null;
    }
  }

  /** Siap dipakai? (ada ctx, berjalan, tidak di-mute) */
  private ready(): AudioContext | null {
    if (this.muted) return null;
    const ctx = this.ensureCtx();
    if (!ctx) return null;
    if (ctx.state !== 'running') {
      // Masih terkunci kebijakan autoplay — coba buka diam-diam, suara kali
      // ini dilewati; berikutnya (setelah gesture) akan terdengar normal.
      void ctx.resume().catch(() => undefined);
      return null;
    }
    return ctx;
  }

  private noise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuf) return this.noiseBuf;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }

  /** Sumber noise sekali pakai + filter + gain envelope. */
  private noiseBurst(
    ctx: AudioContext,
    out: AudioNode,
    t0: number,
    opts: {
      type?: BiquadFilterType;
      freq: number;
      freqEnd?: number;
      q?: number;
      dur: number;
      gain: number;
      attack?: number;
    }
  ): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise(ctx);
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd !== undefined) {
      f.frequency.exponentialRampToValueAtTime(Math.max(30, opts.freqEnd), t0 + opts.dur);
    }
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f);
    f.connect(g);
    g.connect(out);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  /** Osilator dengan envelope + sweep pitch opsional. */
  private tone(
    ctx: AudioContext,
    out: AudioNode,
    t0: number,
    opts: {
      type?: OscillatorType;
      freq: number;
      freqEnd?: number;
      dur: number;
      gain: number;
      attack?: number;
      shimmerSend?: number;
      vibratoHz?: number;
      vibratoDepth?: number;
    }
  ): void {
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.freq, t0);
    if (opts.freqEnd !== undefined) {
      o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.freqEnd), t0 + opts.dur);
    }
    if (opts.vibratoHz && opts.vibratoDepth) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = opts.vibratoHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = opts.vibratoDepth;
      lfo.connect(lfoGain);
      lfoGain.connect(o.frequency);
      lfo.start(t0);
      lfo.stop(t0 + opts.dur + 0.05);
    }
    const g = ctx.createGain();
    const atk = opts.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.gain, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    o.connect(g);
    g.connect(out);
    if (opts.shimmerSend && this.shimmer) {
      const send = ctx.createGain();
      send.gain.value = opts.shimmerSend;
      g.connect(send);
      send.connect(this.shimmer);
    }
    o.start(t0);
    o.stop(t0 + opts.dur + 0.05);
  }

  // ──────────────────────────── JALAN / LANGKAH ────────────────────────────
  /** Langkah santai di atas papan: "tap" halus bergantian kiri/kanan. */
  step(seq: number): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const alt = seq % 2 === 0 ? 1 : 0.88;
      this.tone(ctx, this.master, t, {
        type: 'triangle',
        freq: 290 * alt,
        freqEnd: 170 * alt,
        dur: 0.09,
        gain: 0.16,
      });
      this.noiseBurst(ctx, this.master, t, {
        freq: 1900,
        q: 1.2,
        dur: 0.045,
        gain: 0.07,
      });
    } catch {
      /* abaikan */
    }
  }

  // ─────────────────────────────── DADU ────────────────────────────────────
  /** "Klik" kecil saat dadu dikocok (di-throttle agar tidak bertumpuk). */
  diceTick(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    const now = performance.now();
    if (now - this.lastTickAt < 68) return;
    this.lastTickAt = now;
    try {
      const t = ctx.currentTime;
      const f = 1600 + Math.random() * 900;
      this.tone(ctx, this.master, t, { type: 'square', freq: f, dur: 0.02, gain: 0.028 });
      this.noiseBurst(ctx, this.master, t, { type: 'highpass', freq: 4200, dur: 0.02, gain: 0.05 });
    } catch {
      /* abaikan */
    }
  }

  /** Dadu mendarat: thud pendek + ping ringan. */
  diceLand(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      this.tone(ctx, this.master, t, { freq: 180, freqEnd: 72, dur: 0.12, gain: 0.24 });
      this.tone(ctx, this.master, t + 0.015, { type: 'triangle', freq: 1150, dur: 0.08, gain: 0.05 });
    } catch {
      /* abaikan */
    }
  }

  // ─────────────────────────────── TANGGA ──────────────────────────────────
  /** Hop kayu menaik di anak tangga — nada naik mengikuti urutan hop. */
  ladderHop(hopIndex: number): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const base = 330 * Math.pow(1.122, Math.min(hopIndex, 8));
      this.tone(ctx, this.master, t, { freq: base, dur: 0.11, gain: 0.17 });
      this.tone(ctx, this.master, t, { type: 'triangle', freq: base * 2, dur: 0.07, gain: 0.06 });
      this.noiseBurst(ctx, this.master, t, { freq: 950, q: 2, dur: 0.03, gain: 0.05 });
    } catch {
      /* abaikan */
    }
  }

  /** Sampai di puncak tangga: chime ceria dua nada + shimmer. */
  ladderArrive(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const notes = [987.77, 1318.51, 1975.53]; // B5, E6, B6
      notes.forEach((f, i) => {
        this.tone(ctx, this.master!, t + i * 0.07, {
          freq: f,
          dur: 0.34,
          gain: 0.1,
          shimmerSend: 0.5,
        });
      });
    } catch {
      /* abaikan */
    }
  }

  /** Tangga selesai dipakai lalu lenyap: desau magis naik + "pop" lembut. */
  ladderVanish(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      this.noiseBurst(ctx, this.master, t, {
        freq: 500,
        freqEnd: 3600,
        q: 1.4,
        dur: 0.36,
        gain: 0.08,
        attack: 0.06,
      });
      this.tone(ctx, this.master, t + 0.05, {
        freq: 620,
        freqEnd: 1240,
        dur: 0.3,
        gain: 0.07,
        shimmerSend: 0.4,
      });
      this.tone(ctx, this.master, t + 0.3, { type: 'triangle', freq: 340, freqEnd: 190, dur: 0.1, gain: 0.08 });
    } catch {
      /* abaikan */
    }
  }

  /** Tangga baru muncul di tempat lain: sparkle singkat. */
  ladderReveal(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      [1567.98, 2093.0].forEach((f, i) => {
        this.tone(ctx, this.master!, t + i * 0.05, {
          freq: f,
          dur: 0.22,
          gain: 0.05,
          shimmerSend: 0.35,
        });
      });
    } catch {
      /* abaikan */
    }
  }

  // ──────────────────────────────── ULAR ───────────────────────────────────
  /** Dimakan ular: "chomp" + slide-whistle turun + desis panjang. */
  snakeEaten(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      // Chomp: dua gigitan rendah dan cepat.
      this.tone(ctx, this.master, t, { type: 'square', freq: 150, freqEnd: 85, dur: 0.06, gain: 0.16 });
      this.tone(ctx, this.master, t + 0.09, { type: 'square', freq: 118, freqEnd: 68, dur: 0.07, gain: 0.15 });
      this.noiseBurst(ctx, this.master, t, { type: 'lowpass', freq: 1400, dur: 0.06, gain: 0.14 });
      // Slide-whistle meluncur turun (khas kartun, tetap elegan dengan vibrato).
      this.tone(ctx, this.master, t + 0.12, {
        freq: 720,
        freqEnd: 135,
        dur: 0.62,
        gain: 0.1,
        vibratoHz: 6.5,
        vibratoDepth: 14,
      });
      // Desis ular: noise bandpass menyapu turun.
      this.noiseBurst(ctx, this.master, t + 0.1, {
        freq: 2600,
        freqEnd: 480,
        q: 1.6,
        dur: 0.66,
        gain: 0.09,
        attack: 0.03,
      });
    } catch {
      /* abaikan */
    }
  }

  // ─────────────────────────────── RANJAU ──────────────────────────────────
  /** Ledakan ranjau capit: boom sub + semburan puing + denting logam. */
  mineBoom(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      // Boom rendah.
      this.tone(ctx, this.master, t, { freq: 150, freqEnd: 30, dur: 0.6, gain: 0.5, attack: 0.006 });
      // Semburan noise (ledakan utama).
      this.noiseBurst(ctx, this.master, t, {
        type: 'lowpass',
        freq: 6500,
        freqEnd: 130,
        dur: 0.5,
        gain: 0.32,
        attack: 0.004,
      });
      // Denting logam capit (beberapa ping tinggi).
      [2600, 3900, 5200].forEach((f, i) => {
        this.tone(ctx, this.master!, t + 0.03 + i * 0.045, {
          type: 'triangle',
          freq: f,
          freqEnd: f * 0.7,
          dur: 0.16,
          gain: 0.06,
        });
      });
      // Gemuruh sisa.
      this.noiseBurst(ctx, this.master, t + 0.12, {
        type: 'lowpass',
        freq: 420,
        freqEnd: 90,
        dur: 0.55,
        gain: 0.12,
        attack: 0.05,
      });
    } catch {
      /* abaikan */
    }
  }

  // ────────────────────────────── WORMHOLE ─────────────────────────────────
  /** Tersedot Black Hole: sedotan vakum turun + whoosh + dentum sub. */
  blackHoleSuck(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      this.tone(ctx, this.master, t, {
        freq: 920,
        freqEnd: 48,
        dur: 0.46,
        gain: 0.2,
        shimmerSend: 0.3,
      });
      this.noiseBurst(ctx, this.master, t, {
        freq: 1500,
        freqEnd: 120,
        q: 2.2,
        dur: 0.44,
        gain: 0.16,
        attack: 0.02,
      });
      this.tone(ctx, this.master, t + 0.34, { freq: 58, dur: 0.3, gain: 0.28, attack: 0.01 });
    } catch {
      /* abaikan */
    }
  }

  /** Keluar dari White Hole: arpeggio cahaya naik + desau lembut. */
  whiteHoleEmerge(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51]; // C major naik
      notes.forEach((f, i) => {
        this.tone(ctx, this.master!, t + i * 0.05, {
          freq: f,
          dur: 0.3,
          gain: 0.09,
          shimmerSend: 0.55,
        });
      });
      this.noiseBurst(ctx, this.master, t, {
        type: 'highpass',
        freq: 2800,
        dur: 0.4,
        gain: 0.045,
        attack: 0.12,
      });
    } catch {
      /* abaikan */
    }
  }

  // ─────────────────────────── TIC TAC TOE ──────────────────────────────────
  /** Menaruh simbol X atau O di papan: tactile pop dengan pitch berbeda. */
  ticTacToePlace(symbol: 'X' | 'O'): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const freq = symbol === 'X' ? 620 : 440;
      this.tone(ctx, this.master, t, {
        type: 'triangle',
        freq,
        freqEnd: freq * 0.85,
        dur: 0.08,
        gain: 0.2,
      });
      this.noiseBurst(ctx, this.master, t, {
        type: 'bandpass',
        freq: 2400,
        dur: 0.03,
        gain: 0.06,
      });
    } catch {
      /* abaikan */
    }
  }

  /** Menang Tic Tac Toe: fanfare kemenangan nada naik + shimmer */
  ticTacToeWin(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((f, i) => {
        this.tone(ctx, this.master!, t + i * 0.08, {
          freq: f,
          dur: 0.35,
          gain: 0.12,
          shimmerSend: 0.45,
        });
      });
    } catch {
      /* abaikan */
    }
  }

  /** Kalah dari Bot / Lawan: nada menurun */
  ticTacToeLose(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const notes = [440, 392, 349.23, 293.66];
      notes.forEach((f, i) => {
        this.tone(ctx, this.master!, t + i * 0.09, {
          type: 'sawtooth',
          freq: f,
          dur: 0.25,
          gain: 0.08,
        });
      });
    } catch {
      /* abaikan */
    }
  }

  /** Hasil Seri / Draw: dua nada harmonis tenang */
  ticTacToeDraw(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      this.tone(ctx, this.master, t, {
        freq: 440,
        dur: 0.3,
        gain: 0.1,
      });
      this.tone(ctx, this.master, t + 0.1, {
        freq: 554.37,
        dur: 0.3,
        gain: 0.09,
      });
    } catch {
      /* abaikan */
    }
  }

  // ─────────────────────── ARROW PUZZLE MASTER ───────────────────────────────
  /** Langkah benar: "whoosh" pendek yang nadanya naik mengikuti urutan langkah. */
  arrowStep(seq: number): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const base = 392 * Math.pow(2, Math.min(seq, 12) / 24); // naik perlahan tiap langkah
      this.tone(ctx, this.master, t, {
        type: 'triangle',
        freq: base,
        freqEnd: base * 1.5,
        dur: 0.11,
        gain: 0.16,
      });
      this.noiseBurst(ctx, this.master, t, {
        type: 'highpass',
        freq: 1800,
        freqEnd: 3200,
        dur: 0.07,
        gain: 0.05,
      });
    } catch {
      /* abaikan */
    }
  }

  /** Langkah salah: buzz kasar, makin dalam nadanya seiring salah beruntun. */
  arrowWrong(streak: number): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const base = 220 / Math.pow(2, Math.min(streak, 5) / 6);
      this.tone(ctx, this.master, t, {
        type: 'sawtooth',
        freq: base,
        freqEnd: base * 0.55,
        dur: 0.26,
        gain: 0.11,
      });
      this.noiseBurst(ctx, this.master, t, {
        type: 'lowpass',
        freq: 900,
        freqEnd: 320,
        dur: 0.18,
        gain: 0.09,
      });
    } catch {
      /* abaikan */
    }
  }

  /** Puzzle Arrow tuntas: fanfare empat nada + shimmer. */
  arrowComplete(): void {
    const ctx = this.ready();
    if (!ctx || !this.master) return;
    try {
      const t = ctx.currentTime;
      const notes = [587.33, 739.99, 880, 1174.66]; // D5, F#5, A5, D6
      notes.forEach((f, i) => {
        this.tone(ctx, this.master!, t + i * 0.09, {
          freq: f,
          dur: 0.4,
          gain: 0.12,
          shimmerSend: 0.5,
        });
      });
    } catch {
      /* abaikan */
    }
  }
}

/** Singleton — satu engine untuk seluruh aplikasi. */
export const sounds = new SoundFX();
