// Blocky "pixel" character / animal builders built from THREE boxes.
import * as THREE from 'three';
import { CharDef } from './types';

const matCache = new Map<string, THREE.MeshLambertMaterial>();
export function lambert(color: string): THREE.MeshLambertMaterial {
  const key = color;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(key, m);
  }
  return m;
}

function box(w: number, h: number, d: number, color: string, parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Mesh {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, lambert(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}

export interface CharRig {
  group: THREE.Group;
  head: THREE.Group;
  body: THREE.Group;
  armL: THREE.Group;
  armR: THREE.Group;
  legL: THREE.Group;
  legR: THREE.Group;
  rod?: THREE.Group;
  shadow: THREE.Mesh;
  setAnim(anim: string, t: number, sprint: boolean): void;
  playOnce(anim: string): void;
  setEmote(emote: string | null): void;
  setOutfitColor(c: string): void;
}

function makeNameSprite(name: string, color: string): THREE.Sprite {
  const pad = 8;
  const fs = 18;
  const measurer = document.createElement('canvas');
  const mctx = measurer.getContext('2d')!;
  mctx.font = `bold ${fs}px Arial`;
  const w = mctx.measureText(name).width;
  const cw = Math.ceil(w) + pad * 2;
  const ch = fs + pad * 2;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d')!;
  ctx.clearRect(0, 0, cw, ch);
  ctx.font = `bold ${fs}px Arial`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(12, 18, 26, 0.72)';
  // rounded pill
  const r = 10;
  ctx.beginPath();
  ctx.moveTo(r, 0); ctx.lineTo(cw - r, 0); ctx.arcTo(cw, 0, cw, r, r);
  ctx.lineTo(cw, ch - r); ctx.arcTo(cw, ch, cw - r, ch, r);
  ctx.lineTo(r, ch); ctx.arcTo(0, ch, 0, ch - r, r);
  ctx.lineTo(0, r); ctx.arcTo(0, 0, r, 0, r);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(name, cw / 2, ch / 2 + 1);
  const tex = new THREE.CanvasTexture(cv);
  tex.minFilter = THREE.LinearFilter;
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  const scale = Math.min(2.4, cw / 34) * 0.8;
  spr.scale.set(scale, scale * (ch / cw), 1);
  spr.position.y = 1.9;
  spr.renderOrder = 20;
  return spr;
}

export function buildCharacter(char: CharDef, opts: { name?: string; nameColor?: string; isMine?: boolean } = {}): CharRig {
  const group = new THREE.Group();
  const skin = char.skin;
  const outfit = char.outfitColor;
  const hairC = char.hairColor;

  const body = new THREE.Group();
  group.add(body);
  // shadow blob
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.34, 12),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  (shadow as unknown as { renderOrder: number }).renderOrder = 1;
  group.add(shadow);

  const legW = char.gender === 'female' ? 0.085 : 0.095;
  const legL = new THREE.Group(); legL.position.set(-0.07, 0.34, 0); body.add(legL);
  const legR = new THREE.Group(); legR.position.set(0.07, 0.34, 0); body.add(legR);
  const shoeColor = char.shoes === 'sandals' ? '#7b4f2e' : char.shoes === 'clogs' ? '#a5714a' : char.shoes === 'sneakers' ? '#e8e8e8' : '#5a4632';
  const shoeH = char.shoes === 'sandals' ? 0.045 : 0.07;
  box(legW, 0.3, 0.11, outfit === '#3b82f6' ? char.gender === 'female' ? '#4a5a6a' : '#3a4a5a' : outfit, legL, 0, -0.15, 0);
  box(legW, 0.3, 0.11, outfit === '#3b82f6' ? char.gender === 'female' ? '#4a5a6a' : '#3a4a5a' : outfit, legR, 0, -0.15, 0);
  box(legW + 0.02, shoeH, 0.16, shoeColor, legL, 0, -0.31, 0.02);
  box(legW + 0.02, shoeH, 0.16, shoeColor, legR, 0, -0.31, 0.02);

  const torso = new THREE.Group(); torso.position.y = 0.55; body.add(torso);
  const torsoW = char.gender === 'female' ? 0.24 : 0.26;
  box(torsoW, 0.34, 0.14, outfit, torso, 0, 0, 0);
  // outfit details
  if (char.outfit === 'overall') {
    box(0.26, 0.1, 0.15, '#e8d9c0', torso, 0, -0.13, 0.005);
    box(0.06, 0.2, 0.02, '#e8d9c0', torso, -0.06, 0.05, 0.075);
    box(0.06, 0.2, 0.02, '#e8d9c0', torso, 0.06, 0.05, 0.075);
  } else if (char.outfit === 'apron') {
    box(0.2, 0.28, 0.02, '#fdf3d0', torso, 0, -0.02, 0.078);
  } else if (char.outfit === 'dress') {
    box(torsoW + 0.08, 0.12, 0.18, outfit, torso, 0, -0.2, 0);
    box(torsoW + 0.06, 0.06, 0.16, outfit, torso, 0, -0.28, 0);
  } else if (char.outfit === 'robe') {
    box(torsoW + 0.04, 0.3, 0.16, outfit, torso, 0, -0.04, 0);
  } else if (char.outfit === 'jacket') {
    box(0.05, 0.3, 0.15, '#3a4a5a', torso, -0.145, 0, 0.01);
    box(0.05, 0.3, 0.15, '#3a4a5a', torso, 0.145, 0, 0.01);
  }

  const head = new THREE.Group(); head.position.y = 0.95; body.add(head);
  const headW = 0.32;
  box(headW, 0.3, 0.26, skin, head, 0, 0.05, 0);
  // eyes
  const eyeColor = char.eye;
  const eyeW = char.eyeStyle === 'big' ? 0.055 : 0.045;
  const eyeH = char.eyeStyle === 'smile' ? 0.025 : char.eyeStyle === 'sharp' ? 0.028 : 0.04;
  box(eyeW, eyeH, 0.01, '#ffffff', head, -0.07, 0.05, 0.135);
  box(eyeW, eyeH, 0.01, '#ffffff', head, 0.07, 0.05, 0.135);
  const pupilY = char.eyeStyle === 'smile' ? 0.045 : 0.05;
  const pupilH = char.eyeStyle === 'big' ? 0.045 : 0.038;
  box(eyeW * 0.55, pupilH, 0.012, eyeColor, head, -0.07, pupilY, 0.14);
  box(eyeW * 0.55, pupilH, 0.012, eyeColor, head, 0.07, pupilY, 0.14);
  // mouth
  box(0.05, 0.014, 0.01, '#8a4a3a', head, 0, -0.03, 0.135);

  // hair (front/back panels per style)
  const hairBack = new THREE.Group(); head.add(hairBack);
  switch (char.hair) {
    case 'short':
      box(0.34, 0.1, 0.28, hairC, hairBack, 0, 0.2, 0.0);
      box(0.34, 0.08, 0.06, hairC, hairBack, 0, 0.12, 0.12);
      break;
    case 'long':
      box(0.34, 0.1, 0.28, hairC, hairBack, 0, 0.2, 0.0);
      box(0.36, 0.32, 0.08, hairC, hairBack, 0, 0.0, -0.13);
      box(0.05, 0.3, 0.06, hairC, hairBack, -0.17, 0.02, 0.06);
      box(0.05, 0.3, 0.06, hairC, hairBack, 0.17, 0.02, 0.06);
      break;
    case 'ponytail':
      box(0.34, 0.1, 0.28, hairC, hairBack, 0, 0.2, 0.0);
      box(0.1, 0.26, 0.08, hairC, hairBack, 0, 0.0, -0.18);
      box(0.08, 0.12, 0.07, hairC, hairBack, 0, -0.14, -0.18);
      break;
    case 'bun':
      box(0.34, 0.08, 0.28, hairC, hairBack, 0, 0.22, 0.0);
      box(0.12, 0.1, 0.12, hairC, hairBack, 0, 0.3, -0.06);
      break;
    case 'curly':
      for (let i = 0; i < 5; i++) {
        box(0.14, 0.1, 0.14, hairC, hairBack, -0.14 + i * 0.07, 0.19 + (i % 2) * 0.03, i % 2 ? 0.1 : -0.02);
      }
      break;
    case 'spiky':
      for (let i = 0; i < 4; i++) {
        const s = box(0.07, 0.12, 0.07, hairC, hairBack, -0.12 + i * 0.08, 0.24, 0.0);
        s.rotation.z = (i - 1.5) * 0.25;
      }
      box(0.34, 0.07, 0.28, hairC, hairBack, 0, 0.19, 0);
      break;
    case 'bob':
      box(0.34, 0.1, 0.28, hairC, hairBack, 0, 0.2, 0.0);
      box(0.36, 0.22, 0.07, hairC, hairBack, 0, 0.02, -0.12);
      box(0.06, 0.24, 0.1, hairC, hairBack, 0.16, 0.02, 0.05);
      box(0.06, 0.24, 0.1, hairC, hairBack, -0.16, 0.02, 0.05);
      break;
    case 'bald':
    default:
      break;
  }
  // accessories
  if (char.accessory === 'hat') {
    box(0.4, 0.03, 0.36, '#f2d24b', head, 0, 0.26, 0.01);
    const crown = box(0.26, 0.1, 0.24, '#f2d24b', head, 0, 0.31, 0.01);
    crown.position.y = 0.31;
  } else if (char.accessory === 'scarf') {
    box(0.28, 0.06, 0.16, '#e05b4b', head, 0, -0.06, 0.02);
  } else if (char.accessory === 'bandana') {
    box(0.32, 0.05, 0.26, '#4aa3df', head, 0, 0.13, 0.02);
  } else if (char.accessory === 'glasses') {
    box(0.07, 0.05, 0.02, '#ffffff', head, -0.07, 0.05, 0.145);
    box(0.07, 0.05, 0.02, '#ffffff', head, 0.07, 0.05, 0.145);
    box(0.03, 0.012, 0.02, '#5a4632', head, 0, 0.05, 0.145);
  } else if (char.accessory === 'flower') {
    box(0.05, 0.05, 0.05, '#f0a8c8', head, 0.1, 0.26, 0.03);
    box(0.02, 0.02, 0.02, '#f2c94c', head, 0.1, 0.26, 0.055);
  }

  const armL = new THREE.Group(); armL.position.set(-0.17, 0.82, 0); body.add(armL);
  const armR = new THREE.Group(); armR.position.set(0.17, 0.82, 0); body.add(armR);
  box(0.07, 0.26, 0.09, outfit, armL, 0, -0.13, 0);
  box(0.07, 0.26, 0.09, outfit, armR, 0, -0.13, 0);
  box(0.065, 0.07, 0.09, skin, armL, 0, -0.29, 0);
  box(0.065, 0.07, 0.09, skin, armR, 0, -0.29, 0);

  // fishing rod (visible during fishing)
  const rod = new THREE.Group();
  rod.position.set(0.02, -0.18, 0.1);
  const rodStick = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.9, 6), lambert('#6b4f2a'));
  rodStick.rotation.x = Math.PI / 2.4;
  rodStick.position.set(0, 0.1, 0.35);
  rod.add(rodStick);
  const line = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0.35, 0.75), new THREE.Vector3(0, -0.15, 1.2)]), new THREE.LineBasicMaterial({ color: 0xffffff }));
  rod.add(line);
  rod.visible = false;
  armR.add(rod);
  const rig: CharRig = {
    group, head, body, armL, armR, legL, legR, rod, shadow,
    setAnim: (anim, t, sprint) => {
      const speed = sprint ? 11 : 6.5;
      if (anim === 'walk' || anim === 'run') {
        const swing = Math.sin(t * speed) * (sprint ? 0.75 : 0.55);
        legL.rotation.x = swing; legR.rotation.x = -swing;
        armL.rotation.x = -swing * 0.7; armR.rotation.x = swing * 0.7;
        body.position.y = Math.abs(Math.sin(t * speed)) * (sprint ? 0.05 : 0.03);
        body.rotation.y = 0;
      } else if (anim === 'sleep') {
        legL.rotation.x = 1.3; legR.rotation.x = 1.3;
        armL.rotation.x = 1.2; armR.rotation.x = 1.2;
        body.rotation.x = 0;
      } else {
        const idle = Math.sin(t * 2.2) * 0.04;
        legL.rotation.x = 0; legR.rotation.x = 0;
        armL.rotation.x = idle; armR.rotation.x = -idle;
        body.position.y = idle * 0.4;
      }
    },
    playOnce: (anim) => {
      const start = performance.now();
      const dur = anim === 'fish' ? 1200 : 500;
      const tick = () => {
        const p = (performance.now() - start) / dur;
        if (p >= 1) { armR.rotation.x = 0; return; }
        const swing = Math.sin(p * Math.PI) * 0.9;
        armR.rotation.x = -swing;
        requestAnimationFrame(tick);
      };
      tick();
    },
    setEmote: (emote) => {
      // bubble sprite
      if (!emote) return;
      const text = emote === 'hearts' ? '♥♥' : emote === 'laugh' ? ':D' : emote === 'question' ? '?' : emote === 'sleep' ? 'zZ' : emote === 'dance' ? '♪' : emote === 'cheer' ? '!' : emote === 'sad' ? ':(' : '~';
      const cv = document.createElement('canvas');
      cv.width = 96; cv.height = 96;
      const ctx = cv.getContext('2d')!;
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.beginPath();
      ctx.arc(48, 48, 40, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = emote === 'hearts' ? '#e74f6f' : '#3b82f6';
      ctx.font = 'bold 44px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 48, 50);
      const tex = new THREE.CanvasTexture(cv);
      const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
      spr.scale.set(0.9, 0.9, 1);
      spr.position.y = 2.15;
      spr.renderOrder = 30;
      group.add(spr);
      setTimeout(() => { group.remove(spr); spr.material.map?.dispose(); spr.material.dispose(); }, 1800);
    },
    setOutfitColor: (c) => { void c; },
  };
  if (opts.name) {
    const spr = makeNameSprite(opts.name, opts.nameColor || '#9ee6a8');
    group.add(spr);
  }
  return rig;
}

// ─────────────────────────────────────────────────────────────────────────────
// Animals
// ─────────────────────────────────────────────────────────────────────────────
export interface AnimalRig {
  group: THREE.Group;
  shadow: THREE.Mesh;
  parts: { head: THREE.Group; body: THREE.Mesh; legs: THREE.Group[] };
  setAnim(anim: string, t: number): void;
}

export function buildAnimal(type: string, color: string): AnimalRig {
  const group = new THREE.Group();
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.4, 10),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15, depthWrite: false })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.01;
  group.add(shadow);
  const sizeMap: Record<string, number> = { cow: 1, chicken: 0.45, sheep: 0.9, goat: 0.85, horse: 1.25, cat: 0.5, dog: 0.55, rabbit: 0.4, bird: 0.18, deer: 1.1 };
  const s = sizeMap[type] || 1;
  group.scale.set(s, s, s);
  const bodyL = type === 'horse' ? 0.5 : type === 'cow' || type === 'sheep' ? 0.42 : 0.3;
  const bodyH = type === 'chicken' ? 0.16 : 0.24;
  const body = box(bodyL, bodyH, 0.24, type === 'sheep' ? '#f2f2f2' : color, group, 0, 0.3, 0);
  if (type === 'cow') {
    box(0.1, 0.12, 0.26, '#7b4f2e', group, -0.1, 0.32, 0.0);
    box(0.1, 0.12, 0.26, '#7b4f2e', group, 0.12, 0.32, 0.0);
  }
  const head = new THREE.Group();
  head.position.set(bodyL / 2 + 0.06, 0.45, 0);
  group.add(head);
  const headSize = type === 'chicken' ? 0.08 : 0.14;
  box(headSize * 2, headSize * 1.6, headSize * 1.4, color, head, 0, 0, 0);
  if (type === 'chicken') {
    box(0.05, 0.08, 0.05, '#e05b4b', head, 0, headSize * 1.4, 0);
    box(0.08, 0.02, 0.02, '#f2a03b', head, 0, -0.02, headSize * 0.75);
  } else {
    box(headSize * 0.9, headSize * 0.6, headSize * 0.7, type === 'goat' ? '#8a6a3f' : '#cbb8a0', head, 0, 0.04, headSize * 0.8);
    if (type === 'goat' || type === 'sheep') {
      boardHorn(head, type === 'goat' ? '#6b4f2a' : '#a5714a');
    }
    if (type === 'horse') {
      box(0.03, 0.3, 0.03, '#6b4f2a', head, -0.06, 0.24, -0.06);
      box(0.03, 0.3, 0.03, '#6b4f2a', head, 0.06, 0.24, -0.06);
    }
  }
  const legs: THREE.Group[] = [];
  const legCount = type === 'chicken' || type === 'bird' ? 2 : 4;
  for (let i = 0; i < legCount; i++) {
    const leg = new THREE.Group();
    const lx = (i % 2 === 0 ? -1 : 1) * (bodyL / 2 - 0.06);
    const lz = i < 2 ? 0.07 : -0.07;
    leg.position.set(lx, 0.2, lz);
    box(0.045, 0.22, 0.05, type === 'cow' ? '#fdf3d0' : color, leg, 0, -0.12, 0);
    group.add(leg);
    legs.push(leg);
  }
  if (type === 'horse') {
    // tail
    box(0.06, 0.26, 0.08, '#5a4632', group, -bodyL / 2 - 0.04, 0.3, 0);
  }
  if (type === 'rabbit') { box(0.06, 0.2, 0.05, color, head, -0.04, 0.24, -0.03); box(0.06, 0.2, 0.05, color, head, 0.04, 0.24, -0.03); }
  if (type === 'bird') { box(0.02, 0.06, 0.02, '#f2a03b', head, 0, 0.06, 0.0); }
  const parts: AnimalRig['parts'] = { head, body, legs };
  return {
    group, shadow, parts,
    setAnim: (anim, t) => {
      if (anim === 'walk') {
        legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 8 + i * Math.PI) * 0.5; });
        body.position.y = 0.3 + Math.abs(Math.sin(t * 8)) * 0.02;
      } else if (anim === 'eat') {
        head.rotation.z = Math.sin(t * 6) * 0.25;
        head.position.y = 0.42 + Math.sin(t * 6) * 0.02;
      } else if (anim === 'sleep') {
        group.rotation.x = 0.0;
        body.position.y = 0.18;
        head.position.y = 0.3;
        legs.forEach((leg) => { leg.rotation.x = 1.2; });
      } else {
        legs.forEach((leg) => { leg.rotation.x = 0; });
        body.position.y = 0.3 + Math.sin(t * 1.6) * 0.008;
        head.position.y = 0.45;
      }
    },
  };
}
function boardHorn(parent: THREE.Group, color: string) {
  box(0.04, 0.12, 0.04, color, parent, -0.06, 0.14, 0);
  box(0.04, 0.12, 0.04, color, parent, 0.06, 0.14, 0);
  box(0.05, 0.04, 0.05, color, parent, -0.08, 0.2, 0);
  box(0.05, 0.04, 0.05, color, parent, 0.08, 0.2, 0);
}
