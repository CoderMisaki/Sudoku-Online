// Harvest Moon — 3D world engine (three.js, orthographic-ish hybrid camera).
import * as THREE from 'three';
import { TILE, InteractionHint, Defs, WorldState, PlayerState } from './types';
import { buildCharacter, buildAnimal, CharRig, AnimalRig } from './charModel';
import { buildGroundTexture } from './sprites';
import { inputManager } from './input';

const WORLD_Y = 0;

export interface EngineOpts {
  userId: string;
  quality: 'high' | 'low';
  onAction(a: string, payload: Record<string, unknown>): void;
  onMove(x: number, y: number, dir: number, anim: string, sprint: boolean, seq: number): void;
  onHint(h: InteractionHint): void;
  onSfx(name: string): void;
  onZoneChange(zone: string): void;
}

interface CropSprite {
  group: THREE.Group;
  cropId: string;
  stage: number;
  colorDef: string[];
  water: number;
}

interface TreeSprite { group: THREE.Group; canopy: THREE.Mesh; left: number; }

/** One received position sample for a remote player. */
interface RemoteSample { t: number; x: number; z: number; dir: number; }

interface RemotePlayer {
  rig: CharRig;
  target: THREE.Vector3;
  anim: string;
  sprint: boolean;
  visible: boolean;
  /** Ring of recent samples, oldest first, used for interpolation. */
  buffer: RemoteSample[];
  dir: number;
  lastSeen: number;
}

const WALK_SPEED = 4.4;
const SPRINT_SPEED = 7.2;

/** Recursively free GPU resources for a subtree — prevents WebGL memory leaks. */
export function disposeObject(root: THREE.Object3D) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}

function hashColor(seedStr: string): number {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) { h ^= seedStr.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export class WorldEngine {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private container: HTMLElement;
  private opts: EngineOpts;
  private disposed = false;
  private rafId = 0;

  // world
  private W = 224;
  private H = 224;
  private tiles!: Uint8Array;
  private ground!: THREE.Mesh;
  private waterMesh!: THREE.Mesh;
  private waterTex: THREE.Texture | null = null;
  private sceneRoot = new THREE.Group();

  // dynamic visuals
  private tilledMeshes = new Map<string, THREE.Mesh>();
  private cropMeshes = new Map<string, CropSprite>();
  private forageMeshes = new Map<string, THREE.Mesh>();
  private treeMeshes = new Map<string, TreeSprite>();
  private festivalMeshes = new Map<string, THREE.Mesh>();

  // entities
  private myRig: CharRig | null = null;
  private myPos = new THREE.Vector3(0, 0, 0);
  private myVel = new THREE.Vector2(0, 0);
  private myDir = 2; // 0 up,1 right,2 down,3 left
  private myAnim = 'idle';
  private mySprint = false;
  private remote = new Map<string, RemotePlayer>();
  /** Render remote players this far behind server time so we always interpolate
   *  between two known samples instead of extrapolating. */
  private readonly INTERP_DELAY_MS = 120;
  private npcRigs = new Map<string, { rig: CharRig; target: THREE.Vector3; anim: string }>();
  private animalRigs = new Map<string, AnimalRig>();
  private entityRoot = new THREE.Group();

  /** Scratch vectors reused across frames (zero per-frame allocations). */
  private _tmpVec = new THREE.Vector3();

  // camera
  private camTarget = new THREE.Vector3();
  private camZoom = 1;
  private camZoomTarget = 1;

  // environment
  private sun: THREE.DirectionalLight;
  private ambient: THREE.HemisphereLight;
  private timeOfDay = 6 * 60;
  private weather = 'sunny';
  private rain!: THREE.Points;
  private snow!: THREE.Points;
  private rainOn = false;
  private snowOn = false;
  private flashT = 0;

  // input — read from the shared InputManager frame (no React state per frame)
  private panActive = false;
  /** Client-side prediction bookkeeping. */
  private inputSeq = 0;
  private pendingInputs: { seq: number; dx: number; dz: number }[] = [];
  private lastServerSeq = 0;
  /** Paused while portrait / tab hidden: we skip render+sim but keep the socket. */
  private paused = false;

  // state
  private defs: Defs | null = null;
  private world: WorldState | null = null;
  private hintTimer = 0;
  private hintCurrent: InteractionHint = { kind: null, label: '', x: 0, y: 0 };
  private lastSentMove = 0;
  private lastSentPos = { x: -999, y: -999 };
  private lastSentAnim = '';
  private selectedItem: string | null = null;
  private inMine = false;
  private mine: { S: number; grid: number[]; ores: Record<string, string>; depth: number } | null = null;
  private mineRoot = new THREE.Group();
  private mineOffset = new THREE.Vector3(600, 0, 600);
  private zone = 'village';
  private quality: 'high' | 'low';
  private burstPool: THREE.Mesh[] = [];
  private burstAt: number[] = [];
  private emoteTimer = 0;

  constructor(container: HTMLElement, opts: EngineOpts) {
    this.container = container;
    this.opts = opts;
    this.quality = opts.quality;
    const rect = container.getBoundingClientRect();
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.setPixelRatio(this.quality === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    this.renderer.setSize(rect.width || 800, rect.height || 450, false);
    this.renderer.shadowMap.enabled = this.quality === 'high';
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.touchAction = 'none';

    const aspect = Math.max(1, (rect.width || 16) / (rect.height || 9));
    this.camera = new THREE.OrthographicCamera(-16 * aspect * this.camZoom, 16 * aspect * this.camZoom, 9 * this.camZoom, -9 * this.camZoom, 0.1, 400);
    this.scene.add(this.sceneRoot);
    this.sceneRoot.add(this.entityRoot);
    this.sceneRoot.add(this.mineRoot);
    this.mineRoot.visible = false;

    this.ambient = new THREE.HemisphereLight(0xbfd9ff, 0x8a7a5a, 0.9);
    this.scene.add(this.ambient);
    this.sun = new THREE.DirectionalLight(0xfff2d0, 1.3);
    this.sun.position.set(-30, 60, 20);
    this.sun.castShadow = this.quality === 'high';
    if (this.sun.castShadow) {
      this.sun.shadow.mapSize.set(1024, 1024);
      this.sun.shadow.camera.left = -30; this.sun.shadow.camera.right = 30;
      this.sun.shadow.camera.top = 30; this.sun.shadow.camera.bottom = -30;
      this.sun.shadow.camera.far = 160;
    }
    this.scene.add(this.sun);
    this.scene.fog = new THREE.Fog(0xbcd6e8, 60, 130);

    this.initRain();
    this.initSnow();

    window.addEventListener('resize', this.onResize);
    this.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.onPointerEnd);
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerEnd);
    this.camera.position.set(0, 30, 30);
    this.loop();
  }

  // ── lifecycle ──
  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('wheel', this.onWheel);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.onPointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.onPointerEnd);
    this.renderer.domElement.removeEventListener('pointercancel', this.onPointerEnd);
    for (const r of this.remote.values()) { this.entityRoot.remove(r.rig.group); disposeObject(r.rig.group); }
    this.remote.clear();
    for (const r of this.npcRigs.values()) { this.entityRoot.remove(r.rig.group); disposeObject(r.rig.group); }
    this.npcRigs.clear();
    for (const r of this.animalRigs.values()) { this.entityRoot.remove(r.group); disposeObject(r.group); }
    this.animalRigs.clear();
    if (this.myRig) { this.entityRoot.remove(this.myRig.group); disposeObject(this.myRig.group); this.myRig = null; }
    disposeObject(this.scene);
    this.waterTex?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    if (this.renderer.domElement.parentElement === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
    this.cropMeshes.clear();
    this.tilledMeshes.clear();
  }

  setQuality(q: 'high' | 'low') {
    this.quality = q;
    this.renderer.setPixelRatio(q === 'high' ? Math.min(window.devicePixelRatio || 1, 2) : 1);
    this.renderer.shadowMap.enabled = q === 'high';
  }

  // ── world build ──
  setWorld(world: WorldState, defs: Defs) {
    this.defs = defs;
    this.world = world;
    this.W = world.size[0];
    this.H = world.size[1];
    // decode tiles
    const grid = new Uint8Array(this.W * this.H);
    let p = 0; let i = 0;
    const rle = world.tileRLE;
    while (i + 1 < rle.length && p < grid.length) {
      const v = rle.charCodeAt(i);
      const run = rle.charCodeAt(i + 1);
      i += 2;
      for (let k = 0; k < run && p < grid.length; k++) grid[p++] = v;
    }
    this.tiles = grid;
    // ground
    if (this.ground) this.sceneRoot.remove(this.ground);
    const tex = buildGroundTexture(grid, this.W, this.H);
    const geo = new THREE.PlaneGeometry(this.W, this.H);
    geo.rotateX(-Math.PI / 2);
    geo.translate(this.W / 2 - 0.5, 0, this.H / 2 - 0.5);
    this.ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    this.ground.receiveShadow = this.quality === 'high';
    this.sceneRoot.add(this.ground);
    // water shimmy layer
    const wGeo = new THREE.PlaneGeometry(this.W, this.H);
    wGeo.rotateX(-Math.PI / 2);
    wGeo.translate(this.W / 2 - 0.5, 0.06, this.H / 2 - 0.5);
    this.waterMesh = new THREE.Mesh(wGeo, new THREE.MeshBasicMaterial({
      color: 0x66aee6, transparent: true, opacity: 0.18, depthWrite: false,
    }));
    this.sceneRoot.add(this.waterMesh);

    this.buildFarmDecor(world);
    this.buildStructures(world);
    this.buildCrops(world);
    this.buildForage(world);
    this.buildTrees(world);
    this.buildNpcs();
    this.spawnMyPlayer(world);
    // initial camera position
    this.camTarget.set(this.myPos.x, 0, this.myPos.z);
    this.camera.position.set(this.myPos.x + 18, 34, this.myPos.z + 18);
  }

  private buildFarmDecor(world: WorldState) {
    // fence around the farm area (visual)
    const f = world.farmArea;
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0xa5714a });
    const postGeo = new THREE.BoxGeometry(0.12, 0.5, 0.12);
    const rails: THREE.Mesh[] = [];
    for (let x = f.x0; x <= f.x1; x += 2) {
      const post = new THREE.Mesh(postGeo, fenceMat);
      post.position.set(x + 0.5, 0.25, f.y0 - 0.3);
      post.castShadow = this.quality === 'high';
      this.sceneRoot.add(post);
    }
    for (let x = f.x0; x <= f.x1 - 1; x += 2) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.08, 0.08), fenceMat);
      rail.position.set(x + 1.2, 0.42, f.y0 - 0.3);
      rail.castShadow = false;
      this.sceneRoot.add(rail);
      rails.push(rail);
    }
  }

  private buildStructures(world: WorldState) {
    const vc = world.villageCenter;
    // fountain
    this.addBuilding(vc.x - 4, vc.y + 2, 2.2, 1, 2.2, 0x8d8d94, 0x7c8ba0, true);
    // houses around plaza
    const houses: [number, number, string][] = [
      [vc.x - 9, vc.y - 6, '#c98a5b'], [vc.x - 1, vc.y - 9, '#b2704a'], [vc.x + 8, vc.y - 5, '#c98a5b'],
      [vc.x + 10, vc.y + 5, '#a5714a'], [vc.x + 3, vc.y + 11, '#c98a5b'], [vc.x - 7, vc.y + 9, '#b2704a'],
    ];
    houses.forEach(([x, y, c], i) => this.addBuilding(x, y, 3, 2, 2.6, c, this.roofColor(i)));
    // shops: merchant + chef stalls
    this.addBuilding(vc.x + 6, vc.y - 12, 2.4, 1.4, 2, 0xd9a05b, 0x9a5b2e, true);
    this.addBuilding(vc.x - 12, vc.y + 2, 2.4, 1.4, 2, 0xe05b4b, 0x8a3a3a, true);
    this.addBuilding(vc.x + 12, vc.y + 2, 2.4, 1.4, 2, 0x4aa3df, 0x3a5a8a, true);
    // quest board
    const board = new THREE.Group();
    const bmat = new THREE.MeshLambertMaterial({ color: 0x8a6a3f });
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), bmat);
    leg1.position.set(-0.7, 0.55, 0);
    const leg2 = leg1.clone(); leg2.position.x = 0.7;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.1, 0.12), new THREE.MeshLambertMaterial({ color: 0xc08a4e }));
    panel.position.y = 1.2;
    board.add(leg1, leg2, panel);
    const deco = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.4), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    deco.position.set(-0.4, 1.25, 0.07);
    board.add(deco);
    board.position.set(vc.x + 1.5, 0, vc.y - 8.5);
    board.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = this.quality === 'high'; });
    this.sceneRoot.add(board);

    // mine entrance
    const door = world.mineDoor;
    this.addBuilding(door.x + 1, door.y + 1, 3.2, 2.4, 3, 0x7c6f64, 0x4a423a, true);
    const dark = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.8), new THREE.MeshBasicMaterial({ color: 0x0a0a12 }));
    dark.position.set(door.x + 1, 0.8, door.y + 0.1);
    this.sceneRoot.add(dark);

    // bridge (only when built)
    const bridge = world.bridge;
    this.bridgeGroup = null;
    if (world.community?.cp_bridge?.done) this.buildBridge(bridge.x, bridge.y);
    // town hall, market, park, harbor — appear when community projects complete
    if (world.community?.cp_townhall?.done) this.addBuilding(vc.x, vc.y - 13, 4.5, 3, 3.4, 0xb8c4c9, 0x6b7a80, true);
    if (world.community?.cp_market?.done) {
      this.addBuilding(vc.x - 13, vc.y + 12, 3.4, 1.6, 2.4, 0xf2c94c, 0xc08a4e, true);
    }
    if (world.community?.cp_park?.done) {
      const rng = hashColor('park-world-' + this.W + 'x' + this.H);
      for (let i = 0; i < 14; i++) {
        const x = vc.x + 4 + ((rng >> i) % 10);
        const y = vc.y - 4 - ((rng >> (i + 3)) % 8);
        const fl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.1, 0.16), new THREE.MeshLambertMaterial({ color: ['#f0a8c8', '#f2d24b', '#ffffff', '#e05b4b'][i % 4] }));
        fl.position.set(x + 0.5, 0.05, y + 0.5);
        this.sceneRoot.add(fl);
      }
    }
    if (world.community?.cp_harbor?.done) {
      this.addBuilding(200, 130, 3.2, 1.8, 2.4, 0x9a7b4f, 0x6b4f2a, true);
    }
    // player farm houses are added by spawnMyPlayer
  }

  private bridgeGroup: THREE.Group | null = null;
  private buildBridge(x: number, y: number) {
    if (this.bridgeGroup) this.sceneRoot.remove(this.bridgeGroup);
    const g = new THREE.Group();
    const wood = new THREE.MeshLambertMaterial({ color: 0xa5714a });
    for (let dy = -6; dy <= 6; dy++) {
      const plank = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 1.0), wood);
      plank.position.set(x + 0.5, 0.12, y + dy + 0.5);
      plank.castShadow = this.quality === 'high';
      g.add(plank);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 14), wood);
    rail.position.set(x + 0.1, 0.4, y + 0.5);
    g.add(rail);
    const rail2 = rail.clone(); rail2.position.x = x + 1.0;
    g.add(rail2);
    this.sceneRoot.add(g);
    this.bridgeGroup = g;
  }

  private roofColor(i: number) { return ['#8a4a3a', '#5a6a8a', '#4a7a4a', '#8a6a3a', '#6a5a8a', '#8a5a5a'][i % 6]; }

  private addBuilding(x: number, y: number, w: number, h: number, d: number, wall: THREE.ColorRepresentation, roof: THREE.ColorRepresentation, door = false) {
    const g = new THREE.Group();
    const wallMesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color: wall }));
    wallMesh.position.y = h / 2;
    wallMesh.castShadow = this.quality === 'high';
    wallMesh.receiveShadow = this.quality === 'high';
    g.add(wallMesh);
    const roofMesh = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.78, 1.1, 4), new THREE.MeshLambertMaterial({ color: roof, flatShading: true }));
    roofMesh.position.y = h + 0.55;
    roofMesh.rotation.y = Math.PI / 4;
    roofMesh.castShadow = this.quality === 'high';
    g.add(roofMesh);
    if (door) {
      const dm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1, 0.06), new THREE.MeshBasicMaterial({ color: 0x4a3626 }));
      dm.position.set(0, 0.5, d / 2 + 0.04);
      g.add(dm);
      const winMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.05), winMat);
      win.position.set(-w * 0.28, h * 0.66, d / 2 + 0.04);
      g.add(win);
      const win2 = win.clone(); win2.position.x = w * 0.28;
      g.add(win2);
    }
    g.position.set(x + 0.5, 0, y + 0.5);
    this.sceneRoot.add(g);
    return g;
  }

  // ── crops & tiles & forage & trees ──
  private buildCrops(world: WorldState) {
    for (const [key, c] of Object.entries(world.crops)) {
      const [x, y] = key.split(',').map(Number);
      this.addCrop(x, y, c.crop, c.stage, c.water);
    }
  }
  private cropGeoCached = new Map<string, THREE.BoxGeometry>();
  private addCrop(x: number, y: number, cropId: string, stage: number, water: number) {
    const def = this.defs?.crops?.[cropId];
    const key = x + ',' + y;
    if (this.cropMeshes.has(key)) this.removeCropMesh(key);
    const g = new THREE.Group();
    const colors = def?.colors || ['#7fae4e', '#8fb957', '#a0c460', '#b0cf6a', '#c3d877'];
    const idx = Math.min(colors.length - 1, stage);
    const mat = new THREE.MeshLambertMaterial({ color: colors[idx] });
    const s = 0.2 + stage * 0.09;
    const h = 0.12 + stage * 0.1;
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, h, s), mat);
    body.position.y = h / 2;
    body.castShadow = this.quality === 'high';
    g.add(body);
    if (idx >= 3) {
      const top = new THREE.Mesh(new THREE.BoxGeometry(s * 1.4, 0.06, s * 1.4), mat);
      top.position.y = h + 0.04;
      g.add(top);
    }
    if (water > 0) {
      const wet = new THREE.Mesh(new THREE.BoxGeometry(s + 0.12, 0.02, s + 0.12), new THREE.MeshLambertMaterial({ color: 0x5a7da0, transparent: true, opacity: 0.35 }));
      wet.position.y = 0.02;
      g.add(wet);
    }
    g.position.set(x + 0.5, 0, y + 0.5);
    this.sceneRoot.add(g);
    this.cropMeshes.set(key, { group: g, cropId, stage, colorDef: colors, water });
  }
  private removeCropMesh(key: string) {
    const c = this.cropMeshes.get(key);
    if (c) { this.sceneRoot.remove(c.group); this.cropMeshes.delete(key); }
  }

  private buildForage(world: WorldState) {
    for (const [key, f] of Object.entries(world.forage)) {
      if (f.respawnAt > Date.now()) continue;
      const [x, y] = key.split(',').map(Number);
      this.addForage(x, y, f.item);
    }
  }
  private addForage(x: number, y: number, item: string) {
    const def = this.defs?.items?.[item];
    const key = x + ',' + y;
    if (this.forageMeshes.has(key)) return;
    const color = def?.color || '#f0a8c8';
    const g = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), new THREE.MeshLambertMaterial({ color }));
    g.position.set(x + 0.5, 0.08, y + 0.5);
    g.castShadow = this.quality === 'high';
    if ((item === 'crystal' || item.startsWith('artifact') || item === 'honey')) {
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.3, 0.32), new THREE.MeshBasicMaterial({ color: '#fff6c0', transparent: true, opacity: 0.25 }));
      g.add(glow);
    }
    this.sceneRoot.add(g);
    this.forageMeshes.set(key, g);
  }

  private buildTrees(world: WorldState) {
    for (const [key, t] of Object.entries(world.trees)) {
      if (t.left <= 0) continue;
      const [x, y] = key.split(',').map(Number);
      this.addTree(x, y, t.left);
    }
  }
  private addTree(x: number, y: number, left: number) {
    const key = x + ',' + y;
    if (this.treeMeshes.has(key)) return;
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.1, 0.35), new THREE.MeshLambertMaterial({ color: 0x8a6a3f }));
    trunk.position.y = 0.55;
    trunk.castShadow = this.quality === 'high';
    g.add(trunk);
    const canopyMat = new THREE.MeshLambertMaterial({ color: left > 1 ? 0x3e7d3e : 0x4f7d3f });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.1, 1.3), canopyMat);
    canopy.position.y = 1.65;
    canopy.castShadow = this.quality === 'high';
    g.add(canopy);
    const canopy2 = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.8, 0.9), canopyMat);
    canopy2.position.y = 2.2;
    g.add(canopy2);
    g.position.set(x + 0.5, 0, y + 0.5);
    this.sceneRoot.add(g);
    this.treeMeshes.set(key, { group: g, canopy, left });
  }
  private updateTreeLeft(key: string, left: number) {
    const t = this.treeMeshes.get(key);
    if (!t) return;
    t.left = left;
    if (left <= 0) {
      this.sceneRoot.remove(t.group);
      this.treeMeshes.delete(key);
    } else {
      (t.canopy.material as THREE.MeshLambertMaterial).color.set(left > 1 ? 0x3e7d3e : 0x4f7d3f);
    }
  }

  // ── NPCs ──
  private buildNpcs() {
    for (const def of this.defs?.npcs || []) {
      const fakeChar: never = null as never;
      void fakeChar;
      const rig = this.buildNpcRig(def);
      this.npcRigs.set(def.id, { rig, target: new THREE.Vector3(def.home[0] + 0.5, 0, def.home[1] + 0.5), anim: 'idle' });
      this.entityRoot.add(rig.group);
    }
  }
  private buildNpcRig(def: { id: string; name: string; color: string; role: string }): CharRig {
    const char: Parameters<typeof buildCharacter>[0] = {
      name: def.name, farmName: '', gender: 'nonbinary', hair: Math.abs(hashColor(def.id)) % 3 === 0 ? 'short' : Math.abs(hashColor(def.id)) % 3 === 1 ? 'long' : 'bob',
      hairColor: Math.abs(hashColor(def.id + 'h')) % 2 ? '#5a4632' : '#3b2a1e',
      skin: ['#f2c9a0', '#e0ac69', '#f6d7b0', '#c68642'][Math.abs(hashColor(def.id)) % 4],
      eye: '#3b82f6', eyeStyle: 'round',
      outfit: ['overall', 'apron', 'jacket', 'robe', 'shirt', 'dress'][Math.abs(hashColor(def.id + 'o')) % 6],
      outfitColor: def.color, shoes: 'boots', accessory: Math.abs(hashColor(def.id + 'a')) % 4 === 0 ? 'hat' : 'none',
    };
    return buildCharacter(char, { name: def.name, nameColor: def.color });
  }

  // ── my player & remote ──
  private spawnMyPlayer(world: WorldState) {
    void world;
    // my rig created after character creation; called from createMyPlayer
  }
  createMyPlayer(char: NonNullable<PlayerState['char']>, name: string) {
    if (this.myRig) { this.entityRoot.remove(this.myRig.group); }
    this.myRig = buildCharacter(char, { name, nameColor: '#9ee6a8' });
    this.entityRoot.add(this.myRig.group);
  }
  setMyPos(x: number, y: number, dir?: number) {
    this.myPos.set(x + 0.5, WORLD_Y, y + 0.5);
    if (typeof dir === 'number') this.myDir = dir;
  }
  getMyTile(): [number, number] { return [Math.round(this.myPos.x - 0.5), Math.round(this.myPos.z - 0.5)]; }

  syncRemotePlayers(players: PlayerState[]) {
    const seen = new Set<string>();
    for (const p of players) {
      if (p.id === this.opts.userId) continue;
      seen.add(p.id);
      if (!this.remote.has(p.id) && p.char) {
        const rig = buildCharacter(p.char, { name: p.username, nameColor: '#a9c8ff' });
        rig.group.position.set(p.x + 0.5, 0, p.y + 0.5);
        this.entityRoot.add(rig.group);
        const now = performance.now();
        this.remote.set(p.id, {
          rig,
          target: new THREE.Vector3(p.x + 0.5, 0, p.y + 0.5),
          anim: p.anim || 'idle',
          sprint: !!p.sprint,
          visible: true,
          buffer: [{ t: now, x: p.x + 0.5, z: p.y + 0.5, dir: p.dir || 2 }],
          dir: p.dir || 2,
          lastSeen: now,
        });
      }
    }
    for (const [id, r] of this.remote) {
      if (!seen.has(id)) {
        this.entityRoot.remove(r.rig.group);
        disposeObject(r.rig.group);
        this.remote.delete(id);
      }
    }
    // refresh own view of animals
    this.syncPlayerAnimals(players);
  }
  syncSnapshotPositions(list: [string, number, number, number, string, number, number][]) {
    const now = performance.now();
    for (const [id, x, y, dir, anim, sprint] of list) {
      if (id === this.opts.userId) continue;
      const r = this.remote.get(String(id));
      if (!r) continue;
      const wx = x + 0.5, wz = y + 0.5;
      r.target.set(wx, 0, wz);
      r.anim = anim;
      r.sprint = sprint === 1;
      r.dir = dir;
      r.lastSeen = now;
      const last = r.buffer[r.buffer.length - 1];
      // Ignore duplicate samples so the interpolator does not stall.
      if (!last || last.x !== wx || last.z !== wz || last.dir !== dir) {
        r.buffer.push({ t: now, x: wx, z: wz, dir });
      } else {
        last.t = now;
      }
      // Keep ~1s of history; bounded so the buffer can never leak.
      while (r.buffer.length > 20) r.buffer.shift();
    }
  }
  /**
   * Live, interpolated world positions of remote players — the same coordinates
   * the 3D scene renders, so the map can never desync from the world.
   * Returns fractional tiles for smooth marker motion.
   */
  getRemotePositions(): { id: string; x: number; y: number; dir: number }[] {
    const out: { id: string; x: number; y: number; dir: number }[] = [];
    for (const [id, r] of this.remote) {
      const p = r.rig.group.position;
      out.push({ id, x: p.x - 0.5, y: p.z - 0.5, dir: r.dir });
    }
    return out;
  }
  /** Fractional own position (map marker uses this for smooth movement). */
  getMyPosition(): { x: number; y: number; dir: number } {
    return { x: this.myPos.x - 0.5, y: this.myPos.z - 0.5, dir: this.myDir };
  }
  syncNpcPositions(list: [string, number, number, string, string][]) {
    for (const [id, x, y, anim] of list) {
      const r = this.npcRigs.get(String(id));
      if (!r) continue;
      r.target.set(x + 0.5, 0, y + 0.5);
      r.anim = anim;
    }
  }
  private dirToRotation(dir: number): number {
    // dir: 0 up (-z), 1 right (+x), 2 down (+z), 3 left (-x)
    return dir === 0 ? Math.PI : dir === 1 ? -Math.PI / 2 : dir === 2 ? 0 : Math.PI / 2;
  }

  private syncPlayerAnimals(players: PlayerState[]) {
    // Render owned animals near their owner for every connected player.
    const seen = new Set<string>();
    for (const p of players) {
      const owner = this.remote.get(p.id)?.rig.group.position || (p.id === this.opts.userId ? this.myPos : null);
      if (!owner) continue;
      p.animals.forEach((an, i) => {
        const key = `${p.id}:${an.id}`;
        seen.add(key);
        let r = this.animalRigs.get(key);
        const def = this.defs?.animals?.[an.type];
        if (!r) {
          r = buildAnimal(an.type, def?.color || '#e8e8e8');
          this.entityRoot.add(r.group);
          this.animalRigs.set(key, r);
        }
        const ox = owner.x + Math.cos(i * 2.4) * 1.6;
        const oz = owner.z + Math.sin(i * 2.4) * 1.6;
        r.group.position.lerp(this._tmpVec.set(ox, 0, oz), 0.3);
        r.setAnim(an.hunger > 80 ? 'eat' : an.type === 'chicken' ? 'walk' : 'idle', performance.now() / 1000);
      });
    }
    for (const [key, r] of this.animalRigs) {
      if (!seen.has(key)) {
        this.entityRoot.remove(r.group);
        this.animalRigs.delete(key);
      }
    }
  }

  // ── events from server ──
  handleEvent(e: Record<string, unknown> & { type: string }) {
    const type = e.type;
    switch (type) {
      case 'tilled': {
        const x = Number(e.x), y = Number(e.y);
        const key = x + ',' + y;
        if (!this.tilledMeshes.has(key)) {
          const m = new THREE.Mesh(new THREE.PlaneGeometry(0.95, 0.95), new THREE.MeshLambertMaterial({ color: 0x7a4a26 }));
          m.rotation.x = -Math.PI / 2;
          m.position.set(x + 0.5, 0.03, y + 0.5);
          m.receiveShadow = true;
          this.sceneRoot.add(m);
          this.tilledMeshes.set(key, m);
        }
        break;
      }
      case 'crop': {
        const x = Number(e.x), y = Number(e.y);
        const c = e.crop as { crop: string; stage: number; water: number };
        this.addCrop(x, y, c.crop, c.stage, c.water);
        break;
      }
      case 'crop_removed': {
        const key = `${e.x},${e.y}`;
        this.removeCropMesh(key);
        break;
      }
      case 'forage_taken': {
        const key = `${e.x},${e.y}`;
        const m = this.forageMeshes.get(key);
        if (m) { this.sceneRoot.remove(m); this.forageMeshes.delete(key); }
        break;
      }
      case 'forage_spawn': {
        const key = String(e.key || '');
        const [x, y] = key.split(',').map(Number);
        if (Number.isFinite(x) && Number.isFinite(y)) this.addForage(x, y, String(e.item));
        break;
      }
      case 'tree': {
        this.updateTreeLeft(`${e.x},${e.y}`, Number(e.left));
        break;
      }
      case 'weather': {
        const w = String(e.weather);
        this.setWeather(w);
        break;
      }
      case 'fish_start': {
        this.opts.onSfx('fish_cast');
        this.myRig?.setEmote(null);
        this.myRig?.playOnce('fish');
        if (this.myRig?.rod) this.myRig.rod.visible = true;
        setTimeout(() => { if (this.myRig?.rod) this.myRig.rod.visible = false; }, 1400);
        break;
      }
      case 'fish_bite': this.opts.onSfx('fish_bite'); break;
      case 'fish_result': {
        this.opts.onSfx((e.caught as boolean) ? 'fish_catch' : 'fish_fail');
        break;
      }
      case 'emote': {
        const r = this.remote.get(String(e.playerId));
        if (r && String(e.playerId) !== this.opts.userId) r.rig.setEmote(String(e.emote));
        break;
      }
      case 'mine_enter': {
        this.enterMine(Number(e.depth), Number(e.S), e.grid as number[], e.ores as Record<string, string>);
        break;
      }
      case 'mine_exit': {
        this.exitMine();
        break;
      }
      case 'mine_break': {
        this.breakMineVisual(Number(e.x), Number(e.y));
        break;
      }
      case 'community_done': {
        if (this.world?.community) {
          const id = String(e.id);
          if (this.world.community[id]) this.world.community[id].done = true;
        }
        this.buildBridge(this.world?.bridge.x || 120, this.world?.bridge.y || 71);
        break;
      }
      case 'festival_item_taken': {
        const key = `${e.x},${e.y}`;
        const m = this.festivalMeshes.get(key);
        if (m) { this.sceneRoot.remove(m); this.festivalMeshes.delete(key); }
        break;
      }
      default: break;
    }
  }

  // ── mine ──
  private mineOreMeshes = new Map<string, THREE.Mesh>();
  private enterMine(depth: number, S: number, grid: number[], ores: Record<string, string>) {
    this.inMine = true;
    this.mine = { S, grid, ores, depth };
    this.disposeMineRoot();
    const matWall = new THREE.MeshLambertMaterial({ color: 0x3a3230 });
    const matFloor = new THREE.MeshLambertMaterial({ color: 0x4a4038 });
    const matFloor2 = new THREE.MeshLambertMaterial({ color: 0x52463c });
    const floorGeo = new THREE.BoxGeometry(S, 0.2, S);
    const floor = new THREE.Mesh(floorGeo, matFloor);
    floor.position.y = -0.1;
    this.mineRoot.add(floor);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        if (grid[y * S + x] === 1) {
          const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 3, 1), matWall);
          wall.position.set(x + 0.5, 1.5, y + 0.5);
          wall.castShadow = this.quality === 'high';
          this.mineRoot.add(wall);
        } else if ((x + y) % 2 === 0) {
          const sq = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.22, 0.9), matFloor2);
          sq.position.set(x + 0.5, 0.02, y + 0.5);
          this.mineRoot.add(sq);
        }
      }
    }
    // ores
    const oreColors: Record<string, string> = {
      ore_copper: '#d98e5b', ore_iron: '#9aa0a6', ore_gold: '#f2c94c',
      gem_emerald: '#4caf7d', gem_ruby: '#e05b4b', gem_sapphire: '#4aa3df', gem_diamond: '#d7e8f7',
    };
    for (const [key, ore] of Object.entries(ores)) {
      const [x, y] = key.split(',').map(Number);
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshLambertMaterial({ color: oreColors[ore] || '#aaa' }));
      m.position.set(x + 0.5, 0.26, y + 0.5);
      m.castShadow = this.quality === 'high';
      this.mineRoot.add(m);
      this.mineOreMeshes.set(key, m);
    }
    // exit glow at (0, entry)
    const exit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.6, 0.2), new THREE.MeshBasicMaterial({ color: 0x6fe3c0 }));
    exit.position.set(0.5, 0.8, 0.6);
    this.mineRoot.add(exit);
    this.mineRoot.position.copy(this.mineOffset);
    this.mineRoot.visible = true;
    if (this.myRig) this.myRig.group.visible = true;
    this.setMyPos(1, 0);
    this.camTarget.set(this.mineOffset.x + 1.5, 0, this.mineOffset.z + 0.5);
    this.camera.position.set(this.mineOffset.x + 19, 34, this.mineOffset.z + 19);
    this.ambient.color.set(0x8899aa);
    this.ambient.intensity = 0.5;
    this.sun.intensity = 0.2;
  }
  private exitMine() {
    this.inMine = false;
    this.mine = null;
    this.mineRoot.visible = false;
    this.disposeMineRoot();
    const door = this.world?.mineDoor;
    if (door) this.setMyPos(door.x + 1, door.y + 2);
    if (this.world) {
      const w = this.world;
      this.setWeather(w.weather);
    }
  }
  private disposeMineRoot() {
    const old = [...this.mineRoot.children];
    for (const c of old) this.mineRoot.remove(c);
    this.mineOreMeshes.clear();
  }
  private breakMineVisual(x: number, y: number) {
    const key = `${x},${y}`;
    const m = this.mineOreMeshes.get(key);
    if (m) {
      this.mineRoot.remove(m);
      this.mineOreMeshes.delete(key);
    }
  }

  // ── input ──
  /** Legacy entry point kept for compatibility: feeds the shared InputManager. */
  setMoveVector(x: number, y: number) {
    inputManager.setJoystick(x, y);
  }
  /** Pause simulation + rendering without tearing anything down (portrait / hidden tab). */
  setPaused(v: boolean) {
    if (this.paused === v) return;
    this.paused = v;
    if (!v) {
      // Drop the delta accumulated while paused so we do not teleport on resume.
      this.clock.getDelta();
    }
  }
  isPaused() { return this.paused; }
  /** Screen-space input (ix right, iy up) → world x/z vector for the 45° camera. */
  private _worldVec = new THREE.Vector2(0, 0);
  private screenToWorld(ix: number, iy: number): THREE.Vector2 {
    return this._worldVec.set((ix - iy) * 0.7071, (-ix - iy) * 0.7071);
  }
  /** Scratch vector — reused every frame to avoid per-frame allocations. */
  private _inputVec = new THREE.Vector2(0, 0);
  private inputVec(): THREE.Vector2 {
    const f = inputManager.frame;
    return this._inputVec.set(f.x, f.y);
  }
  setSprintTouch(v: boolean) { inputManager.setTouchSprint(v); }
  isSprinting(): boolean { return inputManager.frame.sprint; }

  // ── interactions ──
  private computeHint() {
    const defs = this.defs;
    const world = this.world;
    if (!defs || !world) return;
    const [px, py] = this.getMyTile();
    const near = (dx: number, dy: number) => [px + dx, py + dy] as const;
    const tryX = (x: number, y: number): InteractionHint | null => {
      if (x < 0 || y < 0 || x >= this.W || y >= this.H) return null;
      const t = this.tiles[y * this.W + x];
      const key = `${x},${y}`;
      // festival items
      const fes = world.festival;
      if (fes.active && this.festivalMeshes.has(key)) {
        return { kind: 'festival', label: `Kumpulkan ${defs.items[fes.def?.id === 'fes_treasure' ? 'artifact_coin' : 'flower_spring']?.name || 'item'}`, x, y };
      }
      const crop = world.crops[key];
      if (crop) {
        const cdef = defs.crops[crop.crop];
        if (cdef && crop.stage >= cdef.days) {
          return { kind: 'harvest', label: `PANEN ${cdef.id.replace('crop_', '').toUpperCase()}`, x, y };
        }
        return { kind: 'water', label: 'SIRAM TANAMAN', x, y };
      }
      const till = world.tilled[key];
      if (till) {
        const seed = this.selectedSeed();
        if (seed) return { kind: 'plant', label: `TANAM ${defs.items[seed]?.name || 'BENIH'}`, x, y, extra: { seed } };
        return { kind: 'plant', label: 'AMBIL BENIH', x, y, extra: {} };
      }
      const tree = world.trees[key];
      if (tree && tree.left > 0) return { kind: 'chop', label: 'TEBANG POHON', x, y };
      const forage = world.forage[key];
      if (forage && forage.respawnAt <= Date.now()) {
        return { kind: 'forage', label: `PETIK ${defs.items[forage.item]?.name || ''}`, x, y };
      }
      if (t === TILE.water) return { kind: 'fish', label: 'MANCING', x, y };
      if (t === TILE.soil || t === TILE.grass || t === TILE.flower) {
        return { kind: 'till', label: 'OLAHTANAH', x, y };
      }
      return null;
    };
    const candidates: InteractionHint[] = [];
    for (const [dx, dy] of [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const [x, y] = near(dx, dy);
      const h = tryX(x, y);
      if (h) { h.x = x; h.y = y; candidates.push(h); }
    }
    // NPCs
    for (const [id, r] of this.npcRigs) {
      const nx = Math.round(r.target.x - 0.5), ny = Math.round(r.target.z - 0.5);
      if (Math.abs(nx - px) <= 2 && Math.abs(ny - py) <= 2) {
        const def = defs.npcs.find(n => n.id === id);
        candidates.push({ kind: 'talk', label: `BICARA — ${def?.name || ''}`, x: nx, y: ny, extra: { npc: id } });
      }
    }
    // mine door
    const door = world.mineDoor;
    if (Math.abs(door.x - px) <= 2 && Math.abs(door.y - py) <= 2) {
      candidates.push({ kind: 'door', label: 'MASUK TAMBANG', x: door.x, y: door.y });
    }
    // hidden grove
    if (px >= 92 && px <= 100 && py >= 20 && py <= 28) {
      candidates.push({ kind: 'grove', label: 'RAHASIA TERSEMBUNYI...', x: px, y: py });
    }
    // pick nearest by distance
    let best: InteractionHint | null = null;
    let bestD = Infinity;
    for (const c of candidates) {
      const d = Math.hypot(c.x - px, c.y - py);
      if (d < bestD) { best = c; bestD = d; }
    }
    if (best && best.kind !== this.hintCurrent.kind) {
      this.hintCurrent = best;
      this.opts.onHint(best);
    }
  }

  setSelectedItem(itemId: string | null) { this.selectedItem = itemId; }
  private selectedSeed(): string | null {
    return this.selectedItem && this.selectedItem.startsWith('seed_') ? this.selectedItem : null;
  }

  doInteract() {
    const h = this.hintCurrent;
    if (!h.kind) return;
    const payload: Record<string, unknown> = { ...(h.extra || {}), x: h.x, y: h.y };
    switch (h.kind) {
      case 'till': this.opts.onAction('till', payload); this.myRig?.playOnce('tool'); this.opts.onSfx('till'); break;
      case 'plant': {
        if (!h.extra?.seed) { this.opts.onAction('need_seed', {}); break; }
        this.opts.onAction('plant', payload); this.myRig?.playOnce('tool'); this.opts.onSfx('plant');
        break;
      }
      case 'water': this.opts.onAction('water', payload); this.myRig?.playOnce('tool'); this.opts.onSfx('water'); break;
      case 'harvest': this.opts.onAction('harvest', payload); this.myRig?.playOnce('tool'); this.opts.onSfx('harvest'); break;
      case 'chop': this.opts.onAction('chop', payload); this.myRig?.playOnce('tool'); this.opts.onSfx('chop'); break;
      case 'forage': this.opts.onAction('forage', payload); this.myRig?.playOnce('tool'); this.opts.onSfx('harvest'); break;
      case 'fish': {
        this.opts.onAction('fish_start', payload);
        break;
      }
      case 'talk': this.opts.onAction('talk', payload); this.opts.onSfx('talk'); break;
      case 'festival': this.opts.onAction('festival_collect', payload); this.opts.onSfx('harvest'); break;
      case 'door': this.opts.onAction('mine_enter', { x: this.world?.mineDoor.x, y: this.world?.mineDoor.y }); break;
      case 'grove': this.opts.onAction('explore', payload); this.opts.onSfx('emote'); break;
      default: break;
    }
  }

  // mine-mode hint (called by HUD when in mine UI)
  computeMineHint(): InteractionHint {
    if (!this.mine) return { kind: 'mine', label: 'TAMBANG', x: 0, y: 0 };
    const [px, py] = this.getMineTile();
    const dirs = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dy] of dirs) {
      const [x, y] = [px + dx, py + dy];
      const key = `${x},${y}`;
      if (this.mine.ores[key]) {
        const def = this.defs?.items?.[this.mine.ores[key]];
        return { kind: 'mine', label: `TAMBANG ${def?.name || 'ORE'}`, x, y };
      }
    }
    if (px <= 1) return { kind: 'exit', label: 'KELUAR TAMBANG', x: 1, y: py };
    return { kind: 'mine', label: 'TAMBANG', x: px, y: py };
  }
  doMineInteract() {
    const h = this.computeMineHint();
    if (h.kind === 'exit') {
      this.opts.onAction('mine_exit', {});
    } else if (h.kind === 'mine') {
      const [mx, my] = this.getMineTile();
      if (h.x !== mx || h.y !== my) {
        this.opts.onAction('mine_break', { x: h.x, y: h.y });
        this.myRig?.playOnce('tool');
        this.opts.onSfx('mine');
      }
    }
  }
  getMineTile(): [number, number] {
    return [Math.round(this.myPos.x - 0.5), Math.round(this.myPos.z - 0.5)];
  }

  // ── main loop ──
  private loop = () => {
    if (this.disposed) return;
    this.rafId = requestAnimationFrame(this.loop);
    if (this.paused) {
      // Keep the clock from accumulating a huge delta while paused.
      this.clock.getDelta();
      return;
    }
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const t = this.clock.elapsedTime;

    // movement
    this.updateMovement(dt, t);
    // camera
    this.updateCamera(dt);
    // entities
    this.updateRemote(dt, t);
    this.updateNpcs(dt, t);
    // env anim
    this.updateEnvironment(dt, t);
    // mine visuals
    if (this.inMine) this.updateMineBubbles(t);
    // hint (throttled)
    this.hintTimer -= dt;
    if (this.hintTimer <= 0) {
      this.hintTimer = 0.15;
      if (this.inMine) {
        const h = this.computeMineHint();
        if (h.kind !== this.hintCurrent.kind || h.label !== this.hintCurrent.label) {
          this.hintCurrent = h;
          this.opts.onHint(h);
        }
      } else {
        this.computeHint();
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  private updateMovement(dt: number, t: number) {
    if (!this.myRig) { this.updateCamera(dt); return; }
    const frame = inputManager.frame;
    const raw = this.inputVec();
    const magnitude = Math.min(1, frame.magnitude || raw.length());
    const v = this.screenToWorld(raw.x, raw.y);
    const sprinting = this.isSprinting();
    const inMine = this.inMine && this.mine;
    // Analog magnitude scales speed so a half-tilted stick walks slowly.
    const baseSpeed = (sprinting ? SPRINT_SPEED : WALK_SPEED) * (inMine ? 0.8 : 1);
    const speed = baseSpeed * (magnitude > 0 ? Math.max(0.35, magnitude) : 0);
    if (v.lengthSq() > 0.0001 && speed > 0) {
      const dir = v.normalize();
      const dx = dir.x * speed * dt;
      const dz = dir.y * speed * dt;
      const beforeX = this.myPos.x, beforeZ = this.myPos.z;
      // Local prediction: apply immediately, remember it for reconciliation.
      this.tryMoveTo(beforeX + dx, beforeZ + dz);
      if (!this.inMine) {
        this.inputSeq += 1;
        this.pendingInputs.push({ seq: this.inputSeq, dx: this.myPos.x - beforeX, dz: this.myPos.z - beforeZ });
        if (this.pendingInputs.length > 180) this.pendingInputs.shift();
      }
      if (Math.abs(dir.x) > Math.abs(dir.y)) this.myDir = dir.x > 0 ? 1 : 3;
      else this.myDir = dir.y > 0 ? 2 : 0;
      this.myAnim = sprinting && magnitude > 0.75 ? 'run' : 'walk';
    } else {
      this.myAnim = 'idle';
    }
    if (this.myRig) {
      const renderPos = this.inMine && this.mine
        ? new THREE.Vector3(this.mineOffset.x + this.myPos.x, 0, this.mineOffset.z + this.myPos.z)
        : this.myPos;
      this.myRig.group.position.copy(renderPos);
      this.myRig.group.rotation.y = this.dirToRotation(this.myDir);
      this.myRig.setAnim(this.myAnim, t, sprinting);
    }
    // Throttled network send (20 Hz) — inputs only, never React state.
    // Sub-tile precision keeps remote interpolation smooth; the server still
    // validates every step, so this stays authoritative.
    const now = performance.now();
    const tx = Math.round((this.myPos.x - 0.5) * 100) / 100;
    const tz = Math.round((this.myPos.z - 0.5) * 100) / 100;
    const moved = Math.abs(tx - this.lastSentPos.x) > 0.005 || Math.abs(tz - this.lastSentPos.y) > 0.005;
    const idleFlush = this.myAnim === 'idle' && (this.lastSentAnim !== 'idle');
    if (now - this.lastSentMove > 50 && (moved || idleFlush)) {
      this.lastSentMove = now;
      this.lastSentPos = { x: tx, y: tz };
      this.lastSentAnim = this.myAnim;
      this.opts.onMove(tx, tz, this.myDir, this.myAnim, sprinting, this.inputSeq);
      if (this.myAnim !== 'idle' && (now % 260) < 60) this.opts.onSfx('step');
    }
  }

  /**
   * Server reconciliation. The server sends back the authoritative position plus
   * the last input sequence it processed. We drop acknowledged predictions and,
   * if the server disagrees beyond a tolerance, we snap/ease toward truth.
   */
  reconcile(x: number, y: number, ackSeq: number) {
    if (this.inMine) return;
    if (ackSeq > 0) {
      this.lastServerSeq = ackSeq;
      this.pendingInputs = this.pendingInputs.filter((p) => p.seq > ackSeq);
    }
    // Re-apply the unacknowledged inputs on top of the authoritative position.
    let px = x + 0.5;
    let pz = y + 0.5;
    for (const p of this.pendingInputs) { px += p.dx; pz += p.dz; }
    const err = Math.hypot(px - this.myPos.x, pz - this.myPos.z);
    if (err > 6) {
      // Way off (teleport / respawn / rejected movement) → hard snap.
      this.myPos.set(px, WORLD_Y, pz);
      this.pendingInputs.length = 0;
    } else if (err > 0.08) {
      // Small drift → ease so the correction is invisible.
      this.myPos.x += (px - this.myPos.x) * 0.18;
      this.myPos.z += (pz - this.myPos.z) * 0.18;
    }
  }
  getLastServerSeq() { return this.lastServerSeq; }

  private walkable(x: number, y: number): boolean {
    if (this.inMine && this.mine) {
      const S = this.mine.S;
      const tx = Math.floor(x), ty = Math.floor(y);
      if (tx < 0 || ty < 0 || tx >= S || ty >= S) return false;
      return this.mine.grid[ty * S + tx] === 0;
    }
    const tx = Math.floor(x), ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.W || ty >= this.H) return false;
    const t = this.tiles[ty * this.W + tx];
    if (t === TILE.water || t === TILE.rock || t === TILE.mountain) return false;
    const key = `${tx},${ty}`;
    if (this.treeMeshes.has(key)) return false;
    return true;
  }
  private tryMoveTo(nx: number, nz: number) {
    // axis-separated collision (slide along walls)
    if (this.walkable(nx, this.myPos.z)) this.myPos.x = nx;
    if (this.walkable(this.myPos.x, nz)) this.myPos.z = nz;
    if (this.inMine) {
      return;
    }
  }

  private _camDesired = new THREE.Vector3();
  private updateCamera(dt: number) {
    const inMine = this.inMine && this.mine;
    const target = inMine
      ? this._tmpVec.set(this.mineOffset.x + this.myPos.x, 0, this.mineOffset.z + this.myPos.z)
      : this._tmpVec.set(this.myPos.x, 0, this.myPos.z);
    this.camTarget.lerp(target, Math.min(1, dt * 6));
    const desired = this._camDesired.set(this.camTarget.x + 16, 30, this.camTarget.z + 16);
    const cur = this.camera.position;
    cur.lerp(desired, Math.min(1, dt * 5));
    this.camZoom += (this.camZoomTarget - this.camZoom) * Math.min(1, dt * 4);
    const aspect = Math.max(1, this.container.clientWidth / Math.max(1, this.container.clientHeight));
    this.camera.left = -16 * aspect * this.camZoom;
    this.camera.right = 16 * aspect * this.camZoom;
    this.camera.top = 9 * this.camZoom;
    this.camera.bottom = -9 * this.camZoom;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(this.camTarget.x, 0, this.camTarget.z);
    // sun follows player for shadows
    this.sun.position.set(this.camTarget.x - 30, 60, this.camTarget.z + 20);
    this.sun.target.position.set(this.camTarget.x, 0, this.camTarget.z);
    this.sun.target.updateMatrixWorld();
  }

  setZoomDelta(delta: number) {
    this.camZoomTarget = Math.max(0.55, Math.min(1.8, this.camZoomTarget * (delta > 0 ? 0.92 : 1.08)));
  }

  private updateRemote(dt: number, t: number) {
    // Entity interpolation: render at (now - INTERP_DELAY) between the two
    // surrounding samples. Falls back to bounded extrapolation when a packet is
    // late, which prevents both stutter and rubber-band teleporting.
    const renderTime = performance.now() - this.INTERP_DELAY_MS;
    for (const r of this.remote.values()) {
      const buf = r.buffer;
      if (buf.length === 0) {
        r.rig.group.position.lerp(r.target, Math.min(1, dt * 12));
      } else if (buf.length === 1 || renderTime <= buf[0].t) {
        const s0 = buf[0];
        r.rig.group.position.lerp(this._tmpVec.set(s0.x, 0, s0.z), Math.min(1, dt * 12));
      } else {
        let i = buf.length - 1;
        while (i > 0 && buf[i].t > renderTime) i--;
        const a = buf[i];
        const b = buf[i + 1];
        if (b) {
          const span = b.t - a.t;
          const alpha = span > 0 ? Math.min(1, Math.max(0, (renderTime - a.t) / span)) : 1;
          r.rig.group.position.set(a.x + (b.x - a.x) * alpha, 0, a.z + (b.z - a.z) * alpha);
        } else {
          // No newer sample: extrapolate at most 250ms along the last velocity.
          const prev = buf[buf.length - 2] || a;
          const span = a.t - prev.t;
          const ahead = Math.min(250, renderTime - a.t);
          if (span > 0 && ahead > 0) {
            const vx = (a.x - prev.x) / span;
            const vz = (a.z - prev.z) / span;
            r.rig.group.position.lerp(this._tmpVec.set(a.x + vx * ahead, 0, a.z + vz * ahead), Math.min(1, dt * 10));
          } else {
            r.rig.group.position.lerp(this._tmpVec.set(a.x, 0, a.z), Math.min(1, dt * 12));
          }
        }
        // Drop samples we have already passed, keeping one behind renderTime.
        while (buf.length > 2 && buf[1].t < renderTime) buf.shift();
      }
      r.rig.group.rotation.y = this.dirToRotation(r.dir);
      r.rig.setAnim(r.anim, t, r.sprint);
    }
    // animals follow owner positions (approx): keep them tied to owners
    for (const a of this.animalRigs.values()) {
      a.parts.head.rotation.z = Math.sin(t * 1.5) * 0.05;
    }
  }
  private updateNpcs(dt: number, t: number) {
    for (const r of this.npcRigs.values()) {
      r.rig.group.position.lerp(r.target, Math.min(1, dt * 4));
      r.rig.setAnim(r.anim === 'sleep' ? 'sleep' : r.anim === 'walk' ? 'walk' : 'idle', t, false);
    }
  }

  // ── weather & day/night ──
  setWeather(w: string) {
    this.weather = w;
    this.rainOn = w === 'rain' || w === 'storm';
    this.snowOn = w === 'snow';
    this.rain.visible = this.rainOn;
    this.snow.visible = this.snowOn;
    const fogColor = w === 'fog' ? 0xc9d4dc : w === 'storm' ? 0x6a7480 : 0xbcd6e8;
    if (this.scene.fog) (this.scene.fog as THREE.Fog).color.set(fogColor);
  }
  private initRain() {
    const n = 700;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * 60 - 30;
      pos[i * 3 + 1] = Math.random() * 20;
      pos[i * 3 + 2] = Math.random() * 60 - 30;
      vel[i] = 14 + Math.random() * 10;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0x9cc4e0, size: 0.1, transparent: true, opacity: 0.8 });
    this.rain = new THREE.Points(geo, mat);
    this.rain.visible = false;
    this.scene.add(this.rain);
    (this.rain as unknown as { _vel: Float32Array })._vel = vel;
  }
  private initSnow() {
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = Math.random() * 60 - 30;
      pos[i * 3 + 1] = Math.random() * 16;
      pos[i * 3 + 2] = Math.random() * 60 - 30;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.14, transparent: true, opacity: 0.85 });
    this.snow = new THREE.Points(geo, mat);
    this.snow.visible = false;
    this.scene.add(this.snow);
  }
  private updateEnvironment(dt: number, t: number) {
    // time-of-day lighting
    const h = this.timeOfDay / 60;
    const dayFactor = Math.max(0, Math.min(1, (Math.sin((h - 6) / 14 * Math.PI) + 0.18)));
    const nightIn = this.inMine;
    if (!nightIn) {
      const day = dayFactor;
      this.ambient.intensity = 0.25 + day * 0.75;
      this.sun.intensity = 0.25 + day * 1.1;
      const sky = new THREE.Color(0x0d1526);
      const daySky = new THREE.Color(0x8fc2e8);
      const duskSky = new THREE.Color(0xe8a05b);
      const nightSky = new THREE.Color(0x0d1526);
      let target: THREE.Color;
      if (h >= 17 && h < 20) target = duskSky;
      else if (h >= 20 || h < 5) target = nightSky;
      else target = daySky;
      sky.copy(target);
      if (this.weather === 'storm') sky.lerp(new THREE.Color(0x3a4550), 0.5);
      if (this.weather === 'fog') sky.lerp(new THREE.Color(0xc9d4dc), 0.7);
      if (this.weather === 'snow') sky.lerp(new THREE.Color(0xd8e2ea), 0.5);
      this.scene.background = sky;
      if (this.scene.fog) (this.scene.fog as THREE.Fog).color.copy(sky);
      // window glow handled via emissive materials is skipped for perf
    }
    // rain
    if (this.rain.visible) {
      const attr = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const vel = (this.rain as unknown as { _vel: Float32Array })._vel;
      for (let i = 0; i < attr.count; i++) {
        let y = attr.getY(i) - vel[i] * dt;
        if (y < 0) {
          y = 14 + Math.random() * 6;
          attr.setX(i, this.camTarget.x + (Math.random() * 40 - 20));
          attr.setZ(i, this.camTarget.z + (Math.random() * 40 - 20));
        }
        attr.setY(i, y);
      }
      attr.needsUpdate = true;
    }
    if (this.snow.visible) {
      const attr = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < attr.count; i++) {
        let y = attr.getY(i) - 1.2 * dt;
        let x = attr.getX(i) + Math.sin(t + i) * 0.3 * dt;
        if (y < 0) {
          y = 14 + Math.random() * 4;
          x = this.camTarget.x + (Math.random() * 40 - 20);
          attr.setZ(i, this.camTarget.z + (Math.random() * 40 - 20));
        }
        attr.setY(i, y);
        attr.setX(i, x);
      }
      attr.needsUpdate = true;
    }
    // storm flash
    if (this.weather === 'storm') {
      this.flashT -= dt;
      if (this.flashT <= 0 && Math.random() < 0.012) {
        this.flashT = 0.25;
        this.ambient.intensity = 2.5;
        this.opts.onSfx('storm');
      } else if (this.flashT > 0.22) {
        this.ambient.intensity = 1.4;
      }
    }
  }
  setClock(timeMin: number) {
    this.timeOfDay = timeMin;
  }

  // bubbles/party effects (festival sparkles): lightweight
  private updateMineBubbles(t: number) {
    void t;
  }

  burst(x: number, y: number, z: number, color: number, count = 10) {
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color }));
      m.position.set(x, 0.4 + Math.random() * 0.5, z);
      this.sceneRoot.add(m);
      this.burstPool.push(m);
      this.burstAt.push(performance.now() + 500);
    }
    this.emoteTimer = 0;
    // particles cleanup handled in loop via setTimeout to avoid allocation churn
    setTimeout(() => {
      for (let i = 0; i < this.burstPool.length; i++) {
        const m = this.burstPool[i];
        this.sceneRoot.remove(m);
      }
      this.burstPool.length = 0;
      this.burstAt.length = 0;
    }, 600);
  }

  // festival items from server (on festival start event the client asks snapshot)
  setFestivalItems(items: { x: number; y: number; item: string }[]) {
    for (const it of items) {
      const key = `${it.x},${it.y}`;
      if (this.festivalMeshes.has(key)) continue;
      const def = this.defs?.items?.[it.item];
      const g = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.2, 0.24), new THREE.MeshBasicMaterial({ color: def ? new THREE.Color(def.color) : 0xf2c94c }));
      g.position.set(it.x + 0.5, 0.14, it.y + 0.5);
      const glow = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.3 }));
      g.add(glow);
      this.sceneRoot.add(g);
      this.festivalMeshes.set(key, g);
    }
  }
  clearFestivalItems() {
    for (const m of this.festivalMeshes.values()) this.sceneRoot.remove(m);
    this.festivalMeshes.clear();
  }

  onResize = () => {
    const rect = this.container.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 450;
    this.renderer.setSize(w, h, false);
  };

  // ── zoom: mouse wheel + touch pinch ──
  private pointers = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private onWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    this.setZoomDelta(ev.deltaY);
  };
  private onPointerDown = (ev: PointerEvent) => {
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  };
  private onPointerMove = (ev: PointerEvent) => {
    const prev = this.pointers.get(ev.pointerId);
    if (!prev) return;
    this.pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.setZoomDelta(d > this.pinchDist ? -1 : 1);
      this.pinchDist = d;
    }
  };
  private onPointerEnd = (ev: PointerEvent) => {
    this.pointers.delete(ev.pointerId);
    this.pinchDist = 0;
  };

  // expose for UI
  getWorldState() { return this.world; }
  setDefs(d: Defs) { this.defs = d; }
  getZone(): string { return this.zone; }
  setMyPlayer(me: PlayerState) { this.syncPlayerAnimals([me]); }
  isInMine() { return this.inMine; }
}
