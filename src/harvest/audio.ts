/**
 * Procedural audio engine — 100% synthesized (WebAudio), no external assets.
 * - SFX synth helpers
 * - Generative, season-aware background music (pentatonic pluck + pad)
 * - Ambient beds: rain/snow noise, crickets at night, bird chirps
 */

interface AmbientState { weather: string; night: boolean; inMine: boolean; }

class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseGain: GainNode | null = null;
  private noiseSrc: AudioBufferSourceNode | null = null;
  private ambTimer: number | null = null;
  private musicTimer: number | null = null;
  private musicOn = true;
  private musicVol = 0.5;
  private sfxVol = 0.8;
  private lastChirp = 0;
  private lastStep = 0;
  private scale: number[] = [0, 2, 4, 7, 9, 12, 14, 16]; // major pentatonic (semitones)
  private baseNote = 220;

  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.32 * this.musicVol;
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.gain.value = this.sfxVol;
      this.sfxGain.connect(this.master);
      this.noiseGain = this.ctx.createGain();
      this.noiseGain.gain.value = 0;
      this.noiseGain.connect(this.master);
      this.createNoiseBuffer();
      this.startMusicLoop();
    } catch {
      this.ctx = null;
    }
  }

  private createNoiseBuffer() {
    if (!this.ctx || !this.noiseGain) return;
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1200;
    src.connect(filter);
    filter.connect(this.noiseGain);
    src.start();
    this.noiseSrc = src;
  }

  setMusicVolume(v: number) {
    this.musicVol = v;
    if (this.musicGain) this.musicGain.gain.value = 0.32 * v;
  }
  setSfxVolume(v: number) {
    this.sfxVol = v;
    if (this.sfxGain) this.sfxGain.gain.value = v;
  }
  setMusicEnabled(on: boolean) {
    this.musicOn = on;
    if (this.musicGain) this.musicGain.gain.value = on ? 0.32 * this.musicVol : 0;
  }

  private env(gainNode: GainNode, t0: number, dur: number, peak: number) {
    const g = gainNode.gain;
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.01);
    g.exponentialRampToValueAtTime(0.0001, t0 + dur);
  }

  private note(freq: number, t0: number, dur: number, vol: number, type: OscillatorType = 'triangle', dest?: AudioNode) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    this.env(g, t0, dur, vol);
    osc.connect(g);
    g.connect(dest || this.sfxGain!);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private startMusicLoop() {
    if (!this.ctx) return;
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicOn || !this.musicGain) return;
      const t = this.ctx.currentTime;
      const bar = Math.floor(t / 4) % 8;
      // pad chord every 4s
      if (bar % 2 === 0) {
        const root = this.baseNote / 2;
        [1, 1.25, 1.5].forEach((m) => this.note(root * m, t, 3.6, 0.05, 'sine', this.musicGain!));
      }
      // melody pluck
      if (Math.random() < 0.8) {
        const deg = this.scale[Math.floor(Math.random() * this.scale.length)];
        const oct = Math.random() < 0.25 ? 2 : 1;
        this.note(this.baseNote * Math.pow(2, deg / 12) * oct, t + (Math.random() * 1.2), 0.9, 0.1, 'triangle', this.musicGain!);
      }
    }, 900);
  }

  applySeason(season: string) {
    const map: Record<string, number> = { spring: 293.66, summer: 329.63, autumn: 261.63, winter: 246.94 };
    this.baseNote = map[season] || 293.66;
  }

  setAmbience(st: AmbientState) {
    if (!this.ctx || !this.noiseGain || !this.noiseSrc) return;
    const isWet = st.weather === 'rain' || st.weather === 'storm' || st.weather === 'snow';
    const target = isWet ? (st.weather === 'storm' ? 0.06 : 0.035) : 0;
    this.noiseGain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.5);
    if (this.ambTimer == null) {
      this.ambTimer = window.setInterval(() => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        if (st.night && !st.inMine && Math.random() < 0.35) {
          // cricket chirp
          for (let i = 0; i < 3; i++) this.note(4200 + Math.random() * 800, t + i * 0.06, 0.04, 0.02, 'sine');
        } else if (!st.night && !st.inMine && this.lastChirp !== 0 && t - this.lastChirp > 4 && Math.random() < 0.3) {
          this.note(2400 + Math.random() * 900, t, 0.18, 0.02, 'sine');
          this.note(2600 + Math.random() * 900, t + 0.22, 0.16, 0.015, 'sine');
          this.lastChirp = t;
        }
      }, 1200);
    }
  }

  // ── SFX ──
  play(name: string) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'click': this.note(660, t, 0.06, 0.12, 'square'); break;
      case 'open': this.note(440, t, 0.08, 0.1, 'square'); this.note(660, t + 0.07, 0.1, 0.1, 'square'); break;
      case 'close': this.note(520, t, 0.07, 0.1, 'square'); this.note(390, t + 0.06, 0.09, 0.1, 'square'); break;
      case 'step': {
        const now = performance.now();
        if (now - this.lastStep < 220) return;
        this.lastStep = now;
        this.note(90 + Math.random() * 30, t, 0.08, 0.05, 'sine');
        break;
      }
      case 'till': this.noiseBurst(t, 0.25, 0.14, 700); break;
      case 'plant': this.note(520, t, 0.08, 0.1, 'triangle'); this.note(780, t + 0.08, 0.09, 0.08); break;
      case 'water': this.noiseBurst(t, 0.4, 0.16, 2400); break;
      case 'harvest': {
        this.note(620, t, 0.07, 0.12);
        this.note(830, t + 0.07, 0.07, 0.12);
        this.note(980, t + 0.15, 0.12, 0.12);
        break;
      }
      case 'chop': this.noiseBurst(t, 0.2, 0.16, 500); this.note(160, t, 0.14, 0.16, 'sine'); break;
      case 'mine': this.noiseBurst(t, 0.3, 0.2, 1800); this.note(120, t, 0.2, 0.2, 'sine'); break;
      case 'fish_cast': this.note(300, t, 0.3, 0.08, 'sine'); this.noiseBurst(t, 0.25, 0.05, 3000); break;
      case 'fish_bite': this.note(880, t, 0.05, 0.14, 'square'); this.note(880, t + 0.09, 0.05, 0.14, 'square'); break;
      case 'fish_catch': {
        this.note(620, t, 0.08, 0.13); this.note(780, t + 0.09, 0.08, 0.13); this.note(1040, t + 0.18, 0.16, 0.13);
        break;
      }
      case 'fish_fail': this.note(300, t, 0.2, 0.1, 'sawtooth'); this.note(220, t + 0.12, 0.25, 0.08, 'sawtooth'); break;
      case 'buy': this.note(700, t, 0.07, 0.12); this.note(900, t + 0.07, 0.1, 0.1); break;
      case 'sell': this.note(520, t, 0.07, 0.12); this.note(700, t + 0.07, 0.1, 0.1); break;
      case 'craft': this.note(440, t, 0.09, 0.1); this.noiseBurst(t + 0.05, 0.18, 0.08, 900); this.note(660, t + 0.2, 0.12, 0.1); break;
      case 'cook': this.noiseBurst(t, 0.3, 0.08, 1000); this.note(520, t + 0.2, 0.1, 0.08); break;
      case 'levelup': {
        [523, 659, 784, 1046].forEach((f, i) => this.note(f, t + i * 0.09, 0.16, 0.12));
        break;
      }
      case 'quest': this.note(587, t, 0.14, 0.1); this.note(880, t + 0.12, 0.2, 0.1); break;
      case 'talk': this.note(700, t, 0.05, 0.08, 'square'); this.note(760, t + 0.06, 0.05, 0.08, 'square'); break;
      case 'gift': this.note(660, t, 0.08, 0.1); this.note(990, t + 0.09, 0.14, 0.1); break;
      case 'emote': this.note(523, t, 0.09, 0.1); this.note(659, t + 0.09, 0.1, 0.1); this.note(784, t + 0.2, 0.14, 0.1); break;
      case 'sleep': this.note(392, t, 0.3, 0.08, 'sine'); this.note(330, t + 0.25, 0.4, 0.06, 'sine'); break;
      case 'error': this.note(180, t, 0.18, 0.12, 'sawtooth'); break;
      case 'storm': this.noiseBurst(t, 0.6, 0.2, 500); break;
      case 'pet': this.note(880, t, 0.06, 0.1); this.note(1174, t + 0.07, 0.08, 0.1); break;
      case 'chat': this.note(880, t, 0.06, 0.06, 'sine'); break;
      default: break;
    }
  }

  private noiseBurst(t0: number, dur: number, vol: number, freq: number) {
    if (!this.ctx || !this.sfxGain) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.sfxGain);
    src.start(t0);
  }
}

export const audio = new AudioEngine();
