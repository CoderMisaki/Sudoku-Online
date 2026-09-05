"use client";
// Character creation flow: WELCOME → NAME/GENDER → APPEARANCE → FARM NAME → CONFIRM → SPAWN.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useHarvestStore } from './store';
import { CharDef } from './types';
import {
  GENDERS, HAIR_STYLES, HAIR_COLORS, SKIN_TONES, EYE_COLORS, OUTFITS, OUTFIT_COLORS,
  SHOES, EYE_STYLES, ACCESSORIES, DEFAULT_CHAR, sanitizeName, validateChar,
} from './charOptions';
import { buildCharacter, CharRig } from './charModel';
import { audio } from './audio';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';

type Step = 'welcome' | 'name' | 'appearance' | 'farm' | 'confirm';

function swatch(colors: string[], value: string, onChange: (c: string) => void) {
  return colors.map((c) => (
    <button
      key={c}
      onClick={() => { onChange(c); audio.play('click'); }}
      className={`w-7 h-7 rounded-lg border-2 transition-transform cursor-pointer active:scale-90 ${value.toLowerCase() === c.toLowerCase() ? 'border-white scale-110 shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'border-white/20 hover:border-white/50'}`}
      style={{ background: c }}
      aria-label={`warna ${c}`}
    />
  ));
}

function Preview({ char }: { char: CharDef }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rigRef = useRef<CharRig | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.OrthographicCamera | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 260, host.clientHeight || 300, false);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const sun = new THREE.DirectionalLight(0xfff2d0, 1.2);
    sun.position.set(4, 8, 6);
    scene.add(sun);
    const cam = new THREE.OrthographicCamera(-1.6, 1.6, 1.9, -1.9, 0.1, 30);
    cam.position.set(2.4, 2.2, 3.4);
    cam.lookAt(0, 0.8, 0);
    rendererRef.current = renderer;
    sceneRef.current = scene;
    camRef.current = cam;
    return () => {
      renderer.dispose();
      if (renderer.domElement.parentElement === host) host.removeChild(renderer.domElement);
      rendererRef.current = null;
      sceneRef.current = null;
      camRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (rigRef.current) scene.remove(rigRef.current.group);
    const rig = buildCharacter(char);
    rig.group.position.y = 0;
    rigRef.current = rig;
    scene.add(rig.group);
  }, [char]);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const t = (performance.now() - start) / 1000;
      const scene = sceneRef.current, cam = camRef.current, renderer = rendererRef.current;
      const rig = rigRef.current;
      if (!scene || !cam || !renderer) return;
      if (rig) {
        rig.group.rotation.y = t * 0.6;
        rig.setAnim('idle', t, false);
      }
      renderer.render(scene, cam);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div ref={hostRef} className="w-full h-full min-h-[220px] relative">
      <div className="absolute inset-x-0 bottom-4 h-5 bg-gradient-to-t from-black/30 to-transparent rounded-full blur-sm" />
    </div>
  );
}

export function CharacterCreator() {
  const setScreen = useHarvestStore((s) => s.setScreen);
  const status = useHarvestStore((s) => s.status);
  const [step, setStep] = useState<Step>('welcome');
  const [char, setChar] = useState<CharDef>({ ...DEFAULT_CHAR });
  const [name, setName] = useState('');
  const [farmName, setFarmName] = useState('');
  const [err, setErr] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const patch = (p: Partial<CharDef>) => { setChar((c) => ({ ...c, ...p })); audio.play('click'); };

  const ch = useMemo(() => ({ ...char, name: sanitizeName(name, 16), farmName: sanitizeName(farmName, 24) }), [char, name, farmName]);

  const next = () => {
    setErr('');
    if (step === 'name') {
      if (!ch.name || ch.name.length < 2) { setErr('Nama minimal 2 huruf.'); return; }
      if (!/^[a-zA-Z0-9 _-]+$/.test(ch.name)) { setErr('Nama hanya huruf, angka, spasi, - dan _.'); return; }
      setStep('appearance');
    } else if (step === 'appearance') {
      setStep('farm');
    } else if (step === 'farm') {
      if (!ch.farmName || ch.farmName.length < 2) { setErr('Nama farm minimal 2 huruf.'); return; }
      if (!/^[a-zA-Z0-9 _'-]+$/.test(ch.farmName)) { setErr('Nama farm tidak valid.'); return; }
      setStep('confirm');
    } else {
      setStep(step === 'welcome' ? 'name' : 'confirm');
    }
    audio.play('open');
  };
  const back = () => {
    setErr('');
    audio.play('close');
    if (step === 'confirm') setStep('farm');
    else if (step === 'farm') setStep('appearance');
    else if (step === 'appearance') setStep('name');
    else if (step === 'name') setStep('welcome');
  };

  const submit = () => {
    const vErr = validateChar(ch);
    if (vErr) { setErr(vErr); return; }
    setSubmitting(true);
    // create action → server responds snapshot → game starts
    const store = useHarvestStore.getState();
    void store;
    // Find sync client via window event bridge (orchestrator handles action creation):
    // CharacterCreator sends the create message through a custom event that HarvestMoonGame listens to.
    window.dispatchEvent(new CustomEvent('harvest-create', { detail: { char: ch, farmName: ch.farmName } }));
    setErr('Membuat karakter & memasuki dunia...');
  };

  useEffect(() => {
    const onMsg = (ev: Event) => {
      const detail = (ev as CustomEvent<{ ok?: boolean; msg?: string }>).detail;
      if (detail?.ok) { setSubmitting(true); setScreen('loading'); }
      else if (detail?.msg) { setSubmitting(false); setErr(detail.msg); }
    };
    window.addEventListener('harvest-create-ack', onMsg);
    return () => window.removeEventListener('harvest-create-ack', onMsg);
  }, [setScreen]);

  const steps: Step[] = ['welcome', 'name', 'appearance', 'farm', 'confirm'];
  const idx = steps.indexOf(step);

  return (
    <div className="absolute inset-0 z-40 bg-gradient-to-br from-[#12233c] via-[#101a2e] to-[#0c1424] text-white flex items-center justify-center p-2 sm:p-4 overflow-hidden">
      {/* decorative glow */}
      <div className="absolute -top-24 -left-24 w-96 h-96 rounded-full bg-emerald-500/10 blur-3xl" />
      <div className="absolute -bottom-24 -right-24 w-96 h-96 rounded-full bg-violet-500/10 blur-3xl" />
      <div className="relative w-[min(96vw,900px)] max-h-[94dvh] rounded-3xl bg-[#0f1a2c]/90 border border-white/10 shadow-2xl overflow-hidden flex flex-col">
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
            <h1 className="font-black text-base tracking-tight">Harvest Moon — Character Creation</h1>
          </div>
          <div className="flex items-center gap-1.5">
            {steps.map((s, i) => (
              <span key={s} className={`h-1.5 rounded-full transition-all ${i <= idx ? 'bg-emerald-400' : 'bg-white/15'}`} style={{ width: i === idx ? 18 : 8 }} />
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto grid md:grid-cols-[300px_1fr] gap-0 md:gap-4 p-4">
          {/* preview panel */}
          <div className="rounded-2xl bg-gradient-to-b from-sky-900/30 to-emerald-900/20 border border-white/10 p-2 order-2 md:order-1">
            <Preview char={ch} />
            <div className="flex justify-center gap-2 pb-1 text-[9px] text-white/50">
              <span className="bg-white/5 rounded-full px-2 py-0.5">{ch.name || 'Nama'}</span>
              <span className="bg-white/5 rounded-full px-2 py-0.5">{ch.gender}</span>
              <span className="bg-white/5 rounded-full px-2 py-0.5">{ch.outfit}</span>
              <span className="bg-white/5 rounded-full px-2 py-0.5">{ch.farmName || 'Farm'}</span>
            </div>
          </div>

          {/* steps */}
          <div className="order-1 md:order-2 min-w-0">
            {step === 'welcome' && (
              <div className="h-full flex flex-col items-center justify-center text-center p-4 space-y-4">
                <div className="text-5xl animate-bounce">🌾</div>
                <h2 className="text-2xl font-black">Selamat datang di Harvest Moon!</h2>
                <p className="text-sm text-white/60 max-w-sm">
                  Dunia open-world farming & life sim yang bisa dihuni bersama teman. Bangun farm-mu, kenali penduduk desa,
                  jelajahi hutan, sungai, pantai & tambang, dan jadilah bagian dari cerita dunia ini.
                </p>
                <button onClick={next} className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black text-sm transition-all active:scale-95 cursor-pointer shadow-[0_4px_20px_rgba(16,185,129,0.4)]">
                  <Sparkles className="w-4 h-4" /> Mulai Pembuatan Karakter
                </button>
              </div>
            )}

            {step === 'name' && (
              <div className="space-y-4 p-2">
                <div>
                  <h3 className="font-bold text-sm">📛 Nama Karakter</h3>
                  <p className="text-[11px] text-white/50 mt-0.5">Ditampilkan di atas kepala karaktermu di dunia.</p>
                </div>
                <input
                  value={name}
                  onChange={(e) => setName(sanitizeName(e.target.value, 16))}
                  maxLength={16}
                  placeholder="Contoh: MILA"
                  className="w-full rounded-2xl bg-white/5 border border-white/15 px-4 py-3 text-sm font-bold focus:outline-none focus:border-emerald-300/60 placeholder:text-white/25"
                  autoFocus
                />
                <div>
                  <h3 className="font-bold text-sm mb-2">⚥ Gender</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {GENDERS.map((g) => (
                      <button
                        key={g.id}
                        onClick={() => patch({ gender: g.id })}
                        className={`rounded-2xl border px-2 py-3 text-xs font-bold transition-all cursor-pointer ${char.gender === g.id ? 'border-emerald-300/70 bg-emerald-400/15 text-emerald-100' : 'border-white/10 bg-white/[0.03] text-white/60 hover:bg-white/[0.08]'}`}
                      >
                        <span className="block text-lg">{g.icon}</span>
                        {g.label}
                      </button>
                    ))}
                  </div>
                  <p className="text-[10px] text-white/40 mt-1.5">Gender hanya memengaruhi opsi presentasi — tidak ada bonus gameplay.</p>
                </div>
              </div>
            )}

            {step === 'appearance' && (
              <div className="space-y-4 p-2">
                <Field label="💇 Gaya Rambut">
                  <div className="flex flex-wrap gap-1.5">
                    {HAIR_STYLES.map((h) => (
                      <button key={h.id} onClick={() => patch({ hair: h.id })} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold cursor-pointer transition-colors ${char.hair === h.id ? 'bg-emerald-400 text-emerald-950' : 'bg-white/5 text-white/65 hover:bg-white/10'}`}>{h.label}</button>
                    ))}
                  </div>
                </Field>
                <Field label="Warna Rambut">
                  <div className="flex flex-wrap gap-1.5">{swatch(HAIR_COLORS, char.hairColor, (c) => patch({ hairColor: c }))}</div>
                </Field>
                <Field label="Warna Kulit">
                  <div className="flex flex-wrap gap-1.5">{swatch(SKIN_TONES, char.skin, (c) => patch({ skin: c }))}</div>
                </Field>
                <Field label="👁 Mata">
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {EYE_STYLES.map((s2) => (
                      <button key={s2.id} onClick={() => patch({ eyeStyle: s2.id })} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${char.eyeStyle === s2.id ? 'bg-emerald-400 text-emerald-950' : 'bg-white/5 text-white/60'}`}>{s2.label}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">{swatch(EYE_COLORS, char.eye, (c) => patch({ eye: c }))}</div>
                </Field>
                <Field label="👕 Outfit">
                  <div className="flex flex-wrap gap-1.5 mb-1.5">
                    {OUTFITS.map((o) => (
                      <button key={o.id} onClick={() => patch({ outfit: o.id })} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${char.outfit === o.id ? 'bg-emerald-400 text-emerald-950' : 'bg-white/5 text-white/60'}`}>{o.label}</button>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">{swatch(OUTFIT_COLORS, char.outfitColor, (c) => patch({ outfitColor: c }))}</div>
                </Field>
                <Field label="🥾 Sepatu">
                  <div className="flex flex-wrap gap-1.5">
                    {SHOES.map((s2) => (
                      <button key={s2.id} onClick={() => patch({ shoes: s2.id })} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${char.shoes === s2.id ? 'bg-emerald-400 text-emerald-950' : 'bg-white/5 text-white/60'}`}>{s2.label}</button>
                    ))}
                  </div>
                </Field>
                <Field label="🎀 Aksesoris">
                  <div className="flex flex-wrap gap-1.5">
                    {ACCESSORIES.map((a) => (
                      <button key={a.id} onClick={() => patch({ accessory: a.id })} className={`px-2.5 py-1 rounded-lg text-[10px] font-bold cursor-pointer ${char.accessory === a.id ? 'bg-emerald-400 text-emerald-950' : 'bg-white/5 text-white/60'}`}>{a.label}</button>
                    ))}
                  </div>
                </Field>
              </div>
            )}

            {step === 'farm' && (
              <div className="space-y-4 p-2">
                <div>
                  <h3 className="font-bold text-sm">🌾 Nama Farm</h3>
                  <p className="text-[11px] text-white/50 mt-0.5">Nama ini muncul di rumahmu dan di profil duniamu.</p>
                </div>
                <input
                  value={farmName}
                  onChange={(e) => setFarmName(sanitizeName(e.target.value, 24))}
                  maxLength={24}
                  placeholder="Contoh: Sunrise Farm"
                  className="w-full rounded-2xl bg-white/5 border border-white/15 px-4 py-3 text-sm font-bold focus:outline-none focus:border-emerald-300/60 placeholder:text-white/25"
                  autoFocus
                />
                <div className="flex flex-wrap gap-1.5 text-[10px] text-white/45">
                  {['Sunrise Farm', 'Moon Orchard', 'Kelp Bay', 'Starfield Farm'].map((s) => (
                    <button key={s} onClick={() => { setFarmName(s); audio.play('click'); }} className="bg-white/5 hover:bg-white/10 border border-white/10 rounded-full px-2.5 py-1 cursor-pointer">{s}</button>
                  ))}
                </div>
              </div>
            )}

            {step === 'confirm' && (
              <div className="space-y-4 p-2">
                <h3 className="font-bold text-sm">✓ Konfirmasi Karakter</h3>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <Info label="Nama" value={ch.name} />
                  <Info label="Gender" value={ch.gender} />
                  <Info label="Rambut" value={`${ch.hair} · ${ch.hairColor}`} />
                  <Info label="Outfit" value={`${ch.outfit} · ${ch.outfitColor}`} />
                  <Info label="Mata" value={`${ch.eyeStyle} · ${ch.eye}`} />
                  <Info label="Sepatu" value={ch.shoes} />
                  <Info label="Aksesoris" value={ch.accessory} />
                  <Info label="Farm" value={ch.farmName} />
                </div>
                <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3 text-[11px] text-emerald-100 space-y-1">
                  <p>✨ Kamu mulai dengan 250 G, Hoe, Watering Can, dan benih Turnip + Potato.</p>
                  <p>🏡 Rumah Lv 1 di area farm — upgrade dengan kayu, batu & gold.</p>
                  <p>🌍 World persisten: semua pemain melihat farm & aksi kamu secara realtime.</p>
                </div>
              </div>
            )}

            {/* footer nav */}
            <div className="flex items-center gap-2 pt-3 pb-1">
              {step !== 'welcome' && (
                <button onClick={back} className="flex items-center gap-1 px-4 py-2.5 rounded-2xl bg-white/5 hover:bg-white/10 text-white/70 text-xs font-bold cursor-pointer transition-colors">
                  <ChevronLeft className="w-4 h-4" /> Kembali
                </button>
              )}
              <div className="flex-1" />
              {err && <span className="text-[11px] text-red-300 font-bold px-1">{err}</span>}
              {step === 'confirm' ? (
                <button
                  onClick={submit}
                  disabled={submitting}
                  className="flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-emerald-950 font-black text-sm transition-all active:scale-95 cursor-pointer disabled:opacity-60"
                >
                  {submitting ? 'Memasuki dunia...' : '🚀 START ADVENTURE'}
                </button>
              ) : (
                <button onClick={next} className="flex items-center gap-1.5 px-5 py-2.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-emerald-950 font-black text-xs transition-all active:scale-95 cursor-pointer">
                  Lanjut <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
      {status === 'error' && (
        <div className="absolute bottom-3 inset-x-4 text-center text-[11px] text-red-300 bg-red-500/10 border border-red-400/20 rounded-xl py-1.5">
          Server tidak dapat dihubungi — coba muat ulang halaman.
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-bold text-white/70 mb-1.5">{label}</p>
      {children}
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/[0.04] border border-white/10 px-2.5 py-1.5">
      <p className="text-[9px] text-white/40 uppercase">{label}</p>
      <p className="font-bold text-white text-[11px] truncate">{value}</p>
    </div>
  );
}
