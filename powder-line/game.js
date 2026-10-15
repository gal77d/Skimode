// Powder Line — game code (Three.js module)
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (id) => document.getElementById(id);
$('loadMsg').textContent = 'Generating terrain, forest and skier';

/* =========================================================
   Math helpers + noise
   ========================================================= */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));

function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const simplex2 = (() => {
  const gx = [1, -1, 1, -1, 1, -1, 0, 0], gy = [1, 1, -1, -1, 0, 0, 1, -1];
  const rng = makeRng(20261013);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const F2 = 0.5 * (Math.sqrt(3) - 1), G2 = (3 - Math.sqrt(3)) / 6;
  return (xin, yin) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s), j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t), y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
    const ii = i & 255, jj = j & 255;
    let n = 0, tt, g;
    tt = 0.5 - x0 * x0 - y0 * y0;
    if (tt > 0) { g = perm[ii + perm[jj]] & 7; tt *= tt; n += tt * tt * (gx[g] * x0 + gy[g] * y0); }
    tt = 0.5 - x1 * x1 - y1 * y1;
    if (tt > 0) { g = perm[ii + i1 + perm[jj + j1]] & 7; tt *= tt; n += tt * tt * (gx[g] * x1 + gy[g] * y1); }
    tt = 0.5 - x2 * x2 - y2 * y2;
    if (tt > 0) { g = perm[ii + 1 + perm[jj + 1]] & 7; tt *= tt; n += tt * tt * (gx[g] * x2 + gy[g] * y2); }
    return 70 * n;
  };
})();

function fbm(x, y, oct) {
  let a = 0.5, f = 1, s = 0;
  for (let i = 0; i < oct; i++) { s += a * simplex2(x * f + i * 17.3, y * f - i * 9.1); f *= 2.03; a *= 0.5; }
  return s;
}
function ridged(x, y, oct) {
  let a = 0.55, f = 1, s = 0, w = 1;
  for (let i = 0; i < oct; i++) {
    let n = 1 - Math.abs(simplex2(x * f + i * 31.7, y * f + i * 7.7));
    n *= n; n *= w; w = clamp(n * 1.6, 0, 1);
    s += n * a; f *= 2.1; a *= 0.48;
  }
  return s;
}

/* =========================================================
   Course definition (downhill = -Z). s = distance along run.
   ========================================================= */
// Every spot on the trail map is one of these. The world is rebuilt from the chosen one.
const TRAILS = [
  { id: 'valley', name: 'Valley Park', diff: 'blue', tag: 'Park run', run: 2500, startAlt: 2840, slope: 0.31,
    wind: [44, 0.0021, 16, 0.0063], roll: [18, 5], half: 30, park: [600, 2000], trees: 700, spread: 40,
    kickers: [[700, -7, 'S'], [880, 3, 'M'], [1040, 0, 'L'], [1150, -8, 'S'], [1165, 9, 'M'], [1265, 0, 'L']],
    rails: [[690, 9, 'rail'], [790, -9, 'box'], [950, 11, 'box'], [955, -11, 'rail'], [1390, -8, 'rail'], [1395, 8, 'box']],
    pipe: [1600, 330], banner: 'TERRAIN PARK  ·  JUMPS S M L  ·  RAILS  ·  HALF-PIPE',
    blurb: 'A 2.5 km descent through a snowed-in pine valley. From 600 m down it turns into a terrain park: tabletop jumps in three sizes, rails, boxes and a 330 m half-pipe.' },
  { id: 'bigair', name: 'Big Air', diff: 'park', tag: 'One huge jump', run: 820, startAlt: 3120, slope: 0.36,
    wind: [5, 0.004, 2, 0.011], roll: [3, 1], half: 42, park: [120, 800], trees: 0, spread: 40, inrun: [300, 0.24, 35],
    kickers: [[350, 0, 'XL']], rails: [], pipe: null, banner: 'BIG AIR  ·  65 m LAKE GAP', alpine: true, lake: true, rocks: 140, peaks: [430, 1400, 1.4],
    blurb: 'High above the treeline: a steep 330 m in-run into a 16-metre kicker that throws you 65 m across a lake in a rocky gorge to an 80 m landing. Come up short and you go swimming. Tuck the in-run, pop at the lip, and spend your air time on a trick.' },
  { id: 'pipe', name: 'Pipe Dream', diff: 'park', tag: 'Superpipe', run: 1150, startAlt: 2610, slope: 0.28,
    wind: [14, 0.003, 5, 0.008], roll: [4, 1.5], half: 32, park: [100, 1120], trees: 600, spread: 40,
    kickers: [[1000, 0, 'M']], rails: [[1010, 12, 'box'], [1010, -12, 'rail']], pipe: [160, 780],
    banner: 'PIPE DREAM  ·  780 m SUPERPIPE', blurb: 'A 780 m half-pipe with 6 m walls. Ride wall to wall for air off both sides, then a medium jump, a box and a rail before the gondola.' },
  { id: 'glades', name: 'Pine Glades', diff: 'black', tag: 'Tree run', run: 2200, startAlt: 2760, slope: 0.38,
    wind: [70, 0.0032, 24, 0.0095], roll: [22, 7], half: 15, park: null, trees: 1150, spread: 22,
    kickers: [], rails: [], pipe: null, banner: '',
    blurb: 'A narrow, steep 2.2 km trail that twists through thick pine forest, with big rollers and no park. The trees sit right at the edge, so pick your line early.' },
  // ---- premium trails: unlocked with coins on the trail map ----
  { id: 'slope', name: 'Slopestyle Pro', diff: 'park', tag: 'Pro slopestyle', price: 800, run: 2000, startAlt: 2980, slope: 0.33,
    wind: [30, 0.0024, 10, 0.007], roll: [10, 3], half: 34, park: [250, 1880], trees: 600, spread: 40,
    kickers: [[580, 0, 'M'], [700, -6, 'L'], [830, 6, 'L'], [960, 0, 'L'], [1180, 0, 'L'], [1320, 0, 'L'], [1460, -8, 'M'], [1470, 8, 'M']],
    rails: [[290, -10, 'rail'], [290, 10, 'box'], [380, 0, 'rail'], [470, -12, 'box'], [475, 12, 'rail'], [1080, -11, 'rail'], [1085, 11, 'box'], [1600, 0, 'box'], [1700, -10, 'rail'], [1700, 10, 'rail']],
    pipe: null, banner: 'SLOPESTYLE PRO  ·  5 BIG JUMPS  ·  RAIL GARDEN',
    blurb: 'A full competition course. It opens with a rail garden, then throws five big tabletops at you back to back, a mid-course rail line, a pair of side-by-side kickers and a finale of rails. Every big jump pays 45 coins before tricks.' },
  { id: 'widow', name: 'Widowmaker', diff: 'double', tag: 'Steep couloir', price: 1200, run: 2600, startAlt: 3050, slope: 0.47,
    wind: [66, 0.0036, 22, 0.011], roll: [26, 9], half: 12, park: null, trees: 1300, spread: 18, rocks: 130,
    kickers: [], rails: [], pipe: null, banner: '',
    blurb: 'The steepest line on the mountain: a 2.6 km double-black chute that snakes hard through dense pines on a trail barely 24 m wide. Speeds get scary fast — brake into the bends or meet a tree.' },
  { id: 'glacier', name: 'Glacier Gap', diff: 'park', tag: 'Six mega gaps', price: 2000, run: 2100, startAlt: 3380, slope: 0.36,
    wind: [6, 0.004, 2, 0.011], roll: [3, 1], half: 42, park: [120, 2050], trees: 0, spread: 40, inrun: [300, 0.24, 35],
    kickers: [[350, 0, 'XL'], [640, 0, 'XL'], [930, 0, 'XL'], [1220, 0, 'XL'], [1510, 0, 'XL'], [1800, 0, 'XL']], rails: [], pipe: null,
    banner: 'GLACIER GAP  ·  SIX 65 m MEGA GAPS', alpine: true, lake: true, rocks: 170, peaks: [430, 1300, 1.7],
    blurb: 'The highest gondola on the hill drops you onto a glacier with six 16-metre kickers in a row, each throwing you 65 m to an 80 m landing. The first one sends you over a frozen lake. Every gap pays 150 coins before tricks, so a clean run is worth 900+.' },
  { id: 'monster', name: 'The Monster', diff: 'park', tag: 'One giant jump', price: 10000, run: 1000, startAlt: 3820, slope: 0.40,
    wind: [5, 0.004, 2, 0.011], roll: [3, 1], half: 50, park: [120, 950], trees: 0, spread: 40, inrun: [500, 0.38, 40],
    kickers: [[500, 0, 'XXL']], rails: [], pipe: null, banner: 'THE MONSTER  ·  120 m  ·  50 m HIGH',
    alpine: true, lake: true, rocks: 190, peaks: [460, 1250, 1.9],
    blurb: 'The biggest jump on the mountain. A 500 m in-run so steep it feels like falling, into a 32-metre kicker that launches you about 120 m through the air, up to 50 m above the snow, over a lake in a deep canyon. Nearly five seconds of air: enough for double flips and huge spins. The jump alone pays 500 coins.' },
];
let T = TRAILS[0], RUN = T.run, START_ALT = T.startAlt;
const centerX = (s) => T.wind[0] * Math.sin(s * T.wind[1]) + T.wind[2] * Math.sin(s * T.wind[3] + 1.3);
// optional steeper in-run: extra slope until inrun[0], blended smoothly over inrun[2] metres
const inrunDist = (s, a, w) => (s < a - w ? s : s > a + w ? a : s - (s - (a - w)) ** 2 / (4 * w));
const baseY = (s) => -T.slope * s - T.roll[0] * Math.sin(s * 0.0045) - T.roll[1] * Math.sin(s * 0.017 + 0.5)
  - (T.inrun ? T.inrun[1] * inrunDist(s, T.inrun[0], T.inrun[2]) : 0);
const pisteHalf = (s) => T.half * (1 + 0.233 * Math.sin(s * 0.011 + 0.7));
function wallH(ad) { const d = Math.max(0, ad - 16) / 430; return 460 * (1 - Math.exp(-d * d)); }

// Terrain park zone: groomed smooth so features sit on clean snow
let PARK_START = 1e9, PARK_END = -1e9;
const parkMask = (s) => smooth(PARK_START - 70, PARK_START + 10, s) * (1 - smooth(PARK_END - 30, PARK_END + 50, s));

function heightAt(x, z) {
  const s = -z;
  const ad = Math.abs(x - centerX(s));
  const ph = pisteHalf(s);
  const off = smooth(ph - 6, ph + 60, ad);
  const pk = parkMask(s) * (1 - off);
  let h = baseY(s) + wallH(ad);
  h += fbm(x * 0.0035, z * 0.0035, 3) * (5 * (1 - 0.8 * pk) + 34 * off);
  h += simplex2(x * 0.021 + 5.2, z * 0.021) * (0.7 * (1 - pk) + 2.6 * off);
  h += simplex2(x * 0.075 - 3.1, z * 0.075 + 1.7) * (0.1 * (1 - pk) + 0.45 * off);
  if (LAKE) h = lakeCarve(x, s, h);
  return h;
}
// A lake sunk into a gorge between a gap kicker's lip and its landing. Water level is flat (W);
// the basin is carved below it and a low berm holds the water on the downhill side.
let LAKE = null;
function lakeR(x, s) {
  const L = LAKE, ds = s - L.cs;
  if (Math.abs(ds) > L.as * 1.4) return 9;
  return Math.hypot(ds / L.as, (x - centerX(s) - L.u) / L.au);
}
function lakeCarve(x, s, h) {
  const r = lakeR(x, s);
  if (r > 1.35) return h;
  const W = LAKE.W;
  if (r < 1) {
    const floor = W - 0.8 - 2.4 * (1 - r * r);
    const bank = Math.max(h, W + 0.5);
    return r < 0.72 ? Math.min(h, floor) : lerp(Math.min(h, floor), bank, smooth(0.72, 1, r));
  }
  return Math.max(h, W + 0.5 * smooth(1.35, 1.0, r));
}
const inLake = (x, z) => LAKE && lakeR(x, -z) < 0.97;
function normalAt(x, z, out) {
  const e = 0.6;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}

/* =========================================================
   Terrain park: analytic feature surfaces (shared by physics + meshes)
   Feature-local coords: u = lateral offset from course centre (minus feature u), v = metres downhill from feature start
   ========================================================= */
const UP = new THREE.Vector3(0, 1, 0), XAX = new THREE.Vector3(1, 0, 0);
const _rs = new THREE.Vector3();

// Tabletop kickers: takeoff transition -> deck -> knuckle -> landing
const KICK = {
  S: { H: 1.6, Lr: 7, Lt: 5, Ll: 17, w: 7 },
  M: { H: 2.6, Lr: 10, Lt: 9, Ll: 24, w: 9 },
  L: { H: 5.6, Lr: 18, Lt: 16, Ll: 44, w: 13 },
  XL: { H: 16.0, Lr: 46, Lt: 65, Ll: 80, w: 24, wall: 3.5, cut: true, gap: true },
  XXL: { H: 32.0, Lr: 80, Lt: 82, Ll: 100, w: 34, wall: 4, cut: true, gap: true },   // The Monster: ~120 m flight, ~50 m high   // 65 m gap over a lake   // shaped like a pro park kicker: shovel-cut walls
};
// Half-pipe cross-section (metres): flat floor, circular transitions to near-vertical, deck, outer fall-off
const PF = 7, PR = 6.2, PANG = 1.48, PWMAX = PR * Math.sin(PANG), PTOP = 6.0, PDECK = 3.2, PFALL = 9;
const PIPE_HALF = PF + PWMAX + 0.03 + PDECK + PFALL;
function pipeProfile(au) {
  if (au <= PF) return 0;
  const w = au - PF;
  if (w <= PWMAX) return PR * (1 - Math.sqrt(Math.max(0, 1 - (w / PR) * (w / PR))));
  const ytop = PR * (1 - Math.cos(PANG));
  if (w <= PWMAX + 0.03) return ytop + (PTOP - ytop) * (w - PWMAX) / 0.03;
  const w2 = w - PWMAX - 0.03;
  if (w2 <= PDECK) return PTOP;
  const t = (w2 - PDECK) / PFALL;
  return t >= 1 ? 0 : PTOP * (1 - t * t * (3 - 2 * t));
}

const FEATURES = [], RAILS = [];
function addKicker(s0, u, size) {
  const k = KICK[size];
  FEATURES.push({ kind: 'kicker', size, s0, u, ...k, len: k.Lr + k.Lt + k.Ll, reach: k.w / 2 + (k.wall || k.H * 0.9 + 0.8) });
}
function addRail(s0, u, kind) {
  const H = kind === 'box' ? 0.55 : 0.7, Lr = 4.5, len = kind === 'box' ? 9 : 11;
  const ramp = { kind: 'ramp', s0, u, H, Lr, w: 1.7, len: Lr, reach: 1.7 / 2 + 0.6 };
  FEATURES.push(ramp);
  const sA = s0 + Lr, sB = sA + len;
  const A = new THREE.Vector3(centerX(sA) + u, 0, -sA); A.y = heightAt(A.x, A.z) + H;
  const B = new THREE.Vector3(centerX(sB) + u, 0, -sB); B.y = heightAt(B.x, B.z) + H;
  const r = { kind, s0: sA, s1: sB, u, A, B, H, tol: kind === 'box' ? 0.42 : 0.3, dir: B.clone().sub(A).normalize() };
  ramp.rail = r;
  RAILS.push(r);
}
const NO_PIPE = { kind: 'pipe', s0: 1e9, u: 0, len: 0, reach: 0 };
let PIPE = NO_PIPE;
function setTrail(id) {
  T = TRAILS.find((t) => t.id === id) || TRAILS[0];
  RUN = T.run; START_ALT = T.startAlt;
  PARK_START = T.park ? T.park[0] : 1e9; PARK_END = T.park ? T.park[1] : -1e9;
  FEATURES.length = 0; RAILS.length = 0;
  for (const [s0, u, size] of T.kickers) addKicker(s0, u, size);
  for (const [s0, u, kind] of T.rails) addRail(s0, u, kind);
  PIPE = T.pipe ? { kind: 'pipe', s0: T.pipe[0], u: 0, len: T.pipe[1], reach: PIPE_HALF } : NO_PIPE;
  if (T.pipe) FEATURES.push(PIPE);
  LAKE = null;
  const gk = FEATURES.find((f) => f.gap);
  if (T.lake && gk) {
    const sl = gk.s0 + gk.Lr, sk = sl + gk.Lt;
    LAKE = { f: gk, u: gk.u, cs: (sl + sk) / 2, as: gk.Lt / 2 - 1.2, au: 38, W: 0 };
    const keep = LAKE; LAKE = null;
    keep.W = heightAt(centerX(sk) + gk.u, -sk) - 0.6;
    LAKE = keep;
  }
}
let savedTrail = 'valley';
try {
  const raw = JSON.parse(localStorage.getItem('powderline.gear.v1') || '{}') || {};
  savedTrail = raw.trail || 'valley';
  const st = TRAILS.find((t) => t.id === savedTrail);
  if (!st || (st.price && !(Array.isArray(raw.owned) && raw.owned.includes('map-' + st.id)))) savedTrail = 'valley';
} catch (e) { /* default trail */ }
setTrail(savedTrail);

const BS = { b: 0, region: '', lip: 99 };
function bumpOf(f, u, v) {
  BS.b = 0; BS.region = ''; BS.lip = 99;
  if (v < 0 || v > f.len) return 0;
  const au = Math.abs(u);
  if (au > f.reach) return 0;
  if (f.kind === 'kicker') {
    let b;
    if (v < f.Lr) { b = f.H * (v / f.Lr) * (v / f.Lr); BS.region = 'ramp'; BS.lip = f.Lr - v; }
    else if (v < f.Lr + f.Lt) {
      if (f.gap) { const a = v - f.Lr; b = f.H * (1 - smooth(0, 2.5, a)) + f.H * smooth(f.Lt - 2.5, f.Lt, a); BS.region = 'gap'; }
      else { b = f.H; BS.region = 'table'; }
    }
    else { const t = (v - f.Lr - f.Lt) / f.Ll; b = f.H * 0.5 * (1 + Math.cos(Math.PI * t)); BS.region = 'landing'; }
    if (au > f.w / 2) b *= 1 - smooth(0, 1, (au - f.w / 2) / (f.reach - f.w / 2));
    BS.b = b;
  } else if (f.kind === 'ramp') {
    const t = v / f.Lr;
    let b = f.H * (1 - (1 - t) * (1 - t));
    if (au > f.w / 2) b *= 1 - smooth(0, 1, (au - f.w / 2) / (f.reach - f.w / 2));
    BS.b = b; BS.region = 'ramp';
  } else if (f.kind === 'pipe') {
    const a = smooth(0, 24, v) * (1 - smooth(f.len - 18, f.len, v));
    BS.b = pipeProfile(au) * a;
    const w = au - PF;
    BS.region = (w > PWMAX - 1.2 && w < PWMAX + 0.6) ? 'lip' : (w > 0 ? 'wall' : 'flat');
  }
  return BS.b;
}

// Snow surface height including kickers, ramps and the pipe (rails handled separately)
function surfH(x, z, gi) {
  const s = -z, cx = centerX(s);
  let best = 0, bf = null, reg = '', lip = 99;
  for (let i = 0; i < FEATURES.length; i++) {
    const f = FEATURES[i];
    const v = s - f.s0;
    if (v < 0 || v > f.len) continue;
    const b = bumpOf(f, x - cx - f.u, v);
    if (b > best) { best = b; bf = f; reg = BS.region; lip = BS.lip; }
  }
  if (gi) { gi.feat = bf; gi.kind = bf ? bf.kind : ''; gi.region = reg; gi.lip = lip; }
  return heightAt(x, z) + best;
}
function surfNormal(x, z, out) {
  // finer sampling on the half-pipe's steep transitions so the wall tangent stays exact up to the coping
  const s = -z;
  const inPipeWall = s > PIPE.s0 && s < PIPE.s0 + PIPE.len && Math.abs(x - centerX(s)) > PF;
  const e = inPipeWall ? 0.03 : 0.25;
  const hx = surfH(x + e, z) - surfH(x - e, z);
  const hz = surfH(x, z + e) - surfH(x, z - e);
  return out.set(-hx, 2 * e, -hz).normalize();
}
const RT = { t: 0 };
function railTop(r, x, z) {
  const dx = r.B.x - r.A.x, dz = r.B.z - r.A.z;
  const t = ((x - r.A.x) * dx + (z - r.A.z) * dz) / (dx * dx + dz * dz);
  if (t < 0 || t > 1) return -Infinity;
  const lat = Math.hypot(x - (r.A.x + dx * t), z - (r.A.z + dz * t));
  if (lat > r.tol) return -Infinity;
  RT.t = t;
  return r.A.y + (r.B.y - r.A.y) * t;
}
function railNormal(r, out) { _rs.crossVectors(r.dir, UP); return out.crossVectors(_rs, r.dir).normalize(); }
const mkGI = () => ({ h: 0, n: new THREE.Vector3(0, 1, 0), feat: null, kind: '', region: '', lip: 99, rail: null, railT: 0, blocked: null });
// Full ground query. refY: rails only count as ground if the rider is at/above their top (else they are an obstacle)
function groundInfo(x, z, refY, gi) {
  gi.h = surfH(x, z, gi); gi.rail = null; gi.blocked = null;
  const s = -z;
  for (let i = 0; i < RAILS.length; i++) {
    const r = RAILS[i];
    if (s < r.s0 - 0.5 || s > r.s1 + 0.5) continue;
    const top = railTop(r, x, z);
    if (top === -Infinity) continue;
    if (refY >= top - 0.45) {
      if (top >= gi.h) { gi.h = top; gi.rail = r; gi.railT = RT.t; gi.kind = r.kind; gi.region = 'rail'; }
    } else gi.blocked = r;
  }
  if (gi.rail) railNormal(gi.rail, gi.n); else surfNormal(x, z, gi.n);
  return gi;
}
function courseDir(s, out) { return out.set(centerX(s + 2) - centerX(s), 0, -2).normalize(); }

/* =========================================================
   Renderer, scene, camera, post
   ========================================================= */
const isCoarse = matchMedia('(pointer:coarse)').matches;
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
let pixelRatio = Math.min(window.devicePixelRatio, isCoarse ? 1.5 : 1.75);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.55;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
let world = new THREE.Group();   // everything that belongs to the current trail
scene.add(world);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.15, 13000);

// --- Sky + sun
const SUN_ELEV = 13, SUN_AZ = 228;
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEV), THREE.MathUtils.degToRad(SUN_AZ));
function makeSky() {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  const u = sky.material.uniforms;
  u.turbidity.value = 4.2;
  u.rayleigh.value = 1.15;
  u.mieCoefficient.value = 0.0042;
  u.mieDirectionalG.value = 0.86;
  u.sunPosition.value.copy(sunDir);
  return sky;
}
const sky = makeSky();
scene.add(sky);

// Image-based light from the same sky (gives goggles + clearcoats real reflections)
const pmrem = new THREE.PMREMGenerator(renderer);
const envScene = new THREE.Scene();
const envSky = makeSky();
envScene.add(envSky);
const envRT = pmrem.fromScene(envScene, 0, 0.1, 20000);
scene.environment = envRT.texture;

// Sample the sky's horizon radiance so fog matches it exactly (HDR, linear)
function sampleHorizon() {
  const fallback = new THREE.Color(0.62, 0.74, 0.92);
  try {
    const rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
    const cam = new THREE.PerspectiveCamera(12, 1, 0.1, 20000);
    const buf = new Float32Array(8 * 8 * 4);
    const acc = new THREE.Color(0, 0, 0);
    const yaws = [0, 0.9, -0.9, Math.PI];
    for (const yaw of yaws) {
      cam.position.set(0, 0, 0);
      cam.lookAt(-Math.sin(yaw), Math.tan(THREE.MathUtils.degToRad(1.5)), -Math.cos(yaw));
      renderer.setRenderTarget(rt);
      renderer.render(envScene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, 8, 8, buf);
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < 64; i++) { r += buf[i * 4]; g += buf[i * 4 + 1]; b += buf[i * 4 + 2]; }
      acc.r += r / 64; acc.g += g / 64; acc.b += b / 64;
    }
    renderer.setRenderTarget(null);
    rt.dispose();
    acc.multiplyScalar(1 / yaws.length);
    if (!isFinite(acc.r) || acc.r <= 0) return fallback;
    return acc;
  } catch (e) { renderer.setRenderTarget(null); return fallback; }
}
const horizon = sampleHorizon();
scene.fog = new THREE.FogExp2(horizon.clone().multiplyScalar(0.96), 0.00040);

// Lights
const sun = new THREE.DirectionalLight(0xffd8b0, 3.1);
sun.castShadow = true;
const SHADOW_SIZE = isCoarse ? 2048 : 4096;
sun.shadow.mapSize.set(SHADOW_SIZE, SHADOW_SIZE);
const SH = 34;
Object.assign(sun.shadow.camera, { left: -SH, right: SH, top: SH, bottom: -SH, near: 1, far: 520 });
sun.shadow.bias = -0.00025;
sun.shadow.normalBias = 0.045;
scene.add(sun, sun.target);

const hemi = new THREE.HemisphereLight(0xa9c6ff, 0xf3f6ff, 0.32);
scene.add(hemi);

// Post: MSAA HDR target -> bloom -> tone map
const composerRT = new THREE.WebGLRenderTarget(innerWidth * pixelRatio, innerHeight * pixelRatio, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, composerRT);
composer.setPixelRatio(pixelRatio);
composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.32, 0.55, 1.7);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* =========================================================
   Procedural textures
   ========================================================= */
function hash2(ix, iy) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function tileNoise(x, y, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const x0 = ((xi % px) + px) % px, x1 = (x0 + 1) % px;
  const y0 = ((yi % py) + py) % py, y1 = (y0 + 1) % py;
  const a = hash2(x0, y0), b = hash2(x1, y0), c = hash2(x0, y1), d = hash2(x1, y1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function makeSnowTextures() {
  const N = 512;
  const hgt = new Float32Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    let h = 0;
    h += tileNoise(u * 8, v * 8, 8, 8) * 0.50;
    h += tileNoise(u * 16, v * 16, 16, 16) * 0.26;
    h += tileNoise(u * 32, v * 32, 32, 32) * 0.13;
    h += tileNoise(u * 64, v * 64, 64, 64) * 0.07;
    h += tileNoise(u * 128, v * 128, 128, 128) * 0.035;
    // wind-blown sastrugi ripples: stretched noise
    h += tileNoise(u * 6, v * 44, 6, 44) * 0.22;
    h += tileNoise(u * 12, v * 90, 12, 90) * 0.08;
    hgt[y * N + x] = h;
  }
  const nCan = document.createElement('canvas'); nCan.width = nCan.height = N;
  const rCan = document.createElement('canvas'); rCan.width = rCan.height = N;
  const nCtx = nCan.getContext('2d'), rCtx = rCan.getContext('2d');
  const nImg = nCtx.createImageData(N, N), rImg = rCtx.createImageData(N, N);
  const str = 9.0;
  const rng = makeRng(77);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const l = hgt[y * N + ((x - 1 + N) % N)], r = hgt[y * N + ((x + 1) % N)];
    const t = hgt[((y - 1 + N) % N) * N + x], b = hgt[((y + 1) % N) * N + x];
    let nx = (l - r) * str, ny = (t - b) * str, nz = 1;
    const il = 1 / Math.hypot(nx, ny, nz); nx *= il; ny *= il; nz *= il;
    const i = (y * N + x) * 4;
    nImg.data[i] = (nx * 0.5 + 0.5) * 255;
    nImg.data[i + 1] = (ny * 0.5 + 0.5) * 255;
    nImg.data[i + 2] = (nz * 0.5 + 0.5) * 255;
    nImg.data[i + 3] = 255;
    // roughness: soft powder with sparse ice-crystal glints
    const glint = rng() < 0.018 ? 0.28 : 0.82 + (rng() - 0.5) * 0.08;
    const rv = clamp(glint, 0, 1) * 255;
    rImg.data[i] = rv; rImg.data[i + 1] = rv; rImg.data[i + 2] = rv; rImg.data[i + 3] = 255;
  }
  nCtx.putImageData(nImg, 0, 0); rCtx.putImageData(rImg, 0, 0);
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const mk = (c) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = aniso; t.colorSpace = THREE.NoColorSpace; return t; };
  return { normal: mk(nCan), rough: mk(rCan) };
}
const snowTex = makeSnowTextures();

const snowMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 1.0, metalness: 0,
  normalMap: snowTex.normal, normalScale: new THREE.Vector2(0.55, 0.55),
  roughnessMap: snowTex.rough,
});

/* =========================================================
   Terrain chunks (analytic heights, grid-derived normals)
   ========================================================= */
const Z_START = 80, CHUNK = 200, DZ = 1.6;
let NCH = 0;   // set per trail: terrain reaches just past the valley station
const xs = (() => {
  const inner = [];
  for (let i = 0; i <= 160; i++) inner.push(-130 + i * 1.625);
  const outer = [];
  for (let k = 1; k <= 28; k++) outer.push(130 + 450 * Math.pow(k / 28, 1.6));
  return [...outer.slice().reverse().map((v) => -v), ...inner, ...outer];
})();

const chunks = [];
function buildTerrainChunk(ci) {
  const zTop = Z_START - ci * CHUNK;
  const nx = xs.length, nz = Math.round(CHUNK / DZ) + 1;
  const H = new Float32Array(nx * (nz + 2));
  for (let j = -1; j <= nz; j++) {
    const z = zTop - j * DZ;
    for (let i = 0; i < nx; i++) H[(j + 1) * nx + i] = heightAt(xs[i], z);
  }
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3), uv = new Float32Array(nx * nz * 2);
  for (let j = 0; j < nz; j++) {
    const z = zTop - j * DZ;
    const s = -z, cx = centerX(s);
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const k = j * nx + i, hk = (j + 1) * nx + i;
      const il = Math.max(0, i - 1), ir = Math.min(nx - 1, i + 1);
      const hx = (H[(j + 1) * nx + ir] - H[(j + 1) * nx + il]) / (xs[ir] - xs[il]);
      const hz = (H[(j + 2) * nx + i] - H[j * nx + i]) / (-2 * DZ);
      let nX = -hx, nY = 1, nZ = -hz; const inv = 1 / Math.hypot(nX, nY, nZ);
      nX *= inv; nY *= inv; nZ *= inv;
      pos[k * 3] = x; pos[k * 3 + 1] = H[hk]; pos[k * 3 + 2] = z;
      nor[k * 3] = nX; nor[k * 3 + 1] = nY; nor[k * 3 + 2] = nZ;
      uv[k * 2] = x / 6; uv[k * 2 + 1] = z / 6;
      // colour: snow with cool/warm drift variation, exposed rock on steep faces
      const t1 = simplex2(x * 0.012 + 40, z * 0.012) * 0.5 + 0.5;
      const rn = simplex2(x * 0.05, z * 0.05) * 0.07 + simplex2(x * 0.2, z * 0.2) * 0.025;
      const rock = smooth(0.80, 0.60, nY + rn);
      const ad = Math.abs(x - cx);
      const groom = 1 - smooth(pisteHalf(s) - 4, pisteHalf(s) + 6, ad);
      let r = 0.84 + 0.035 * t1 + 0.02 * groom, g = 0.875 + 0.03 * t1 + 0.015 * groom, b = 0.95;
      const rv = 0.10 + 0.06 * (simplex2(x * 0.11, z * 0.11) * 0.5 + 0.5);
      r = lerp(r, rv * 1.05, rock); g = lerp(g, rv, rock); b = lerp(b, rv * 0.95, rock);
      col[k * 3] = r; col[k * 3 + 1] = g; col[k * 3 + 2] = b;
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let p = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[p++] = a; idx[p++] = b; idx[p++] = c;
    idx[p++] = b; idx[p++] = d; idx[p++] = c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  const m = new THREE.Mesh(g, snowMat);
  m.receiveShadow = true; m.castShadow = true;
  world.add(m);
  return { zTop, zBot: zTop - CHUNK, terrain: m, treesHi: [], treesLo: [], rocks: [] };
}

/* =========================================================
   Distant mountains (backdrop ring around the valley)
   ========================================================= */
function buildBackdrop() {
  const SIZE = 15000, SEG = 220;
  const g = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  g.rotateX(-Math.PI / 2);
  g.translate(0, 0, -RUN / 2);
  const p = g.attributes.position;
  const elev = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const s = -z, sc = clamp(s, 0, RUN);
    const d = x - centerX(sc);
    const along = s < 0 ? -s : (s > RUN ? (s - RUN) * 0.2 : 0);   // the valley stays open past the finish
    const dc = Math.hypot(Math.max(0, Math.abs(d) - 40), along * 0.8);
    let h = baseY(s) + wallH(Math.abs(d));
    const inside = (1 - smooth(540, 600, Math.abs(x))) * (1 - smooth(60, 120, z)) * (1 - smooth(RUN + 60, RUN + 160, s));
    h -= 30 * inside;
    const pk = T.peaks || [480, 1700, 1];
    const mask = smooth(pk[0], pk[1], dc);
    h += mask * (ridged(x * 0.00042, z * 0.00042, 5) * 1500 * pk[2] + 120);
    h += smooth(300, 900, dc) * fbm(x * 0.0016, z * 0.0016, 4) * 140;
    p.setY(i, h);
    elev[i] = h - baseY(sc);
  }
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), ny = n.getY(i);
    const rn = simplex2(x * 0.004, z * 0.004) * 0.06;
    const rock = smooth(0.72, 0.5, ny + rn);
    const forest = (T.alpine ? 0 : 1) * (1 - smooth(260, 620, elev[i])) * smooth(0.62, 0.86, ny) * smooth(-0.1, 0.35, simplex2(x * 0.003 + 9, z * 0.003));
    let r = 0.86, gg = 0.89, b = 0.95;
    r = lerp(r, 0.035, forest * 0.85); gg = lerp(gg, 0.05, forest * 0.85); b = lerp(b, 0.05, forest * 0.85);
    r = lerp(r, 0.11, rock); gg = lerp(gg, 0.105, rock); b = lerp(b, 0.10, rock);
    col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  mat.userData.perWorld = true;
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = false; m.castShadow = false;
  world.add(m);
}

/* =========================================================
   Pine trees: layered, drooping branch tiers with snow loads
   ========================================================= */
function colorize(geo, fn) {
  const p = geo.attributes.position, n = geo.attributes.normal;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const rgb = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2];
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

function makePine(seed, hi) {
  const rng = makeRng(seed);
  const H = 12, R = 2.7;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.1, 0.34, H * 0.93, hi ? 8 : 5, 1);
  trunk.translate(0, H * 0.465 - 0.35, 0);
  colorize(trunk, (x, y, z) => { const v = 0.75 + 0.25 * hash2(Math.round(y * 9), Math.round(Math.atan2(x, z) * 4)); return [0.055 * v, 0.033 * v, 0.02 * v]; });
  parts.push(trunk);

  const layers = hi ? 8 + Math.floor(rng() * 3) : 5;
  const radial = hi ? 12 : 7, hseg = hi ? 3 : 1;
  const bottom = 1.3 + rng() * 0.7;
  const span = H - bottom - 0.6;
  const greenBase = [0.018 + rng() * 0.01, 0.042 + rng() * 0.014, 0.026 + rng() * 0.01];
  for (let li = 0; li < layers; li++) {
    const t = li / (layers - 1);
    const r = R * Math.pow(1 - t * 0.9, 1.05) * (0.88 + rng() * 0.24) + 0.25;
    const h = (span / layers) * 2.2 * (1 - t * 0.3);
    const y0 = bottom + t * (span - h * 0.55);
    const g = new THREE.ConeGeometry(r, h, radial, hseg, false);
    const p = g.attributes.position;
    const lseed = Math.floor(rng() * 1e6);
    const snowBias = 0.25 + rng() * 0.35;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const rr = Math.hypot(x, z);
      const tf = (y + h / 2) / h; // 0 bottom -> 1 tip
      if (rr < 1e-4) {
        if (tf < 0.01) y += h * 0.28; // hollow underside toward trunk
        p.setY(i, y); continue;
      }
      const ang = Math.atan2(x, z);
      const k = ((Math.round(ang / (Math.PI * 2) * radial) % radial) + radial) % radial;
      const jag = (k % 2 ? 1.0 : 0.72) + 0.22 * hash2(k, lseed);
      const edge = 1 - tf; // stronger at the rim
      const f = 1 + (jag - 0.86) * edge * 0.6;
      x *= f; z *= f;
      // branch droop at the rim
      y -= Math.pow(edge, 3) * r * 0.22 * jag;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    colorize(g, (x, y, z, nx, ny) => {
      const tf = (y + h / 2) / h;
      const ang = Math.atan2(x, z);
      const k = ((Math.round(ang / (Math.PI * 2) * radial) % radial) + radial) % radial;
      const noise = hash2(k * 7 + Math.round(tf * 5), lseed);
      const up = smooth(0.05, 0.45, ny);
      let snow = up * smooth(snowBias - 0.25, snowBias + 0.15, tf + noise * 0.35);
      if (ny < -0.2) snow = 0;
      const shade = 0.75 + 0.5 * noise;
      const gr = [greenBase[0] * shade, greenBase[1] * shade, greenBase[2] * shade];
      const sn = [0.80, 0.84, 0.90];
      return [lerp(gr[0], sn[0], snow), lerp(gr[1], sn[1], snow), lerp(gr[2], sn[2], snow)];
    });
    g.rotateY(rng() * Math.PI * 2);
    g.translate(0, y0 + h / 2, 0);
    parts.push(g);
  }
  // leader shoot
  const tip = new THREE.ConeGeometry(0.16, 1.1, hi ? 6 : 4, 1);
  tip.translate(0, H - 0.1, 0);
  colorize(tip, (x, y, z, nx, ny) => ny > 0.3 ? [0.7, 0.74, 0.8] : greenBase);
  parts.push(tip);
  const merged = mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g : g; }), false);
  merged.computeBoundingSphere();
  return merged;
}

const treeMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0 });
const TREE_VARIANTS = 3;
const treeHi = [], treeLo = [];
for (let v = 0; v < TREE_VARIANTS; v++) { treeHi.push(makePine(101 + v * 13, true)); treeLo.push(makePine(101 + v * 13, false)); }

/* =========================================================
   Rocks: displaced icosahedra with snow on top faces
   ========================================================= */
function makeRock(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const o = seed * 13.7;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = simplex2(x * 1.3 + o, y * 1.3 + z * 0.7) * 0.28 + simplex2(z * 2.7 - o, x * 2.7 + y) * 0.1;
    const f = 1 + n;
    p.setXYZ(i, x * f * 1.35, y * f * 0.78, z * f * 1.05);
  }
  g.computeVertexNormals();
  colorize(g, (x, y, z, nx, ny) => {
    const v = 0.8 + 0.4 * (simplex2(x * 3 + o, z * 3) * 0.5 + 0.5);
    const snow = smooth(0.35, 0.65, ny + simplex2(x * 4, z * 4 + o) * 0.12);
    return [lerp(0.09 * v, 0.82, snow), lerp(0.085 * v, 0.85, snow), lerp(0.08 * v, 0.91, snow)];
  });
  return g;
}
const rockGeos = [makeRock(1), makeRock(2), makeRock(3)];
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });

/* =========================================================
   Populate chunks with trees and rocks
   ========================================================= */
const _n = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();
const _m4 = new THREE.Matrix4();
function populateChunk(ch, ci) {
  const rng = makeRng(9000 + ci * 31);
  const buckets = Array.from({ length: TREE_VARIANTS }, () => []);
  for (let k = 0; k < T.trees; k++) {
    const z = ch.zTop - rng() * CHUNK, s = -z;
    const side = rng() < 0.5 ? -1 : 1;
    const off = 3 + (-Math.log(1 - rng() * 0.999)) * T.spread;
    if (off > 430) continue;
    const x = centerX(s) + side * (pisteHalf(s) + off);
    if (Math.abs(x) > 570) continue;
    if (s > PIPE.s0 - 10 && s < PIPE.s0 + PIPE.len + 10 && pisteHalf(s) + off < PIPE_HALF + 4) continue;
    if (liftNear(x, s, 10)) continue;
    normalAt(x, z, _n);
    if (_n.y < 0.74 && rng() < 0.85) continue;
    const sc = 0.55 + rng() * 0.75;
    _p.set(x, heightAt(x, z) - 0.35 * sc, z);
    _q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rng() * Math.PI * 2);
    _s.set(sc * (0.85 + rng() * 0.3), sc * (0.9 + rng() * 0.2), sc * (0.85 + rng() * 0.3));
    buckets[Math.floor(rng() * TREE_VARIANTS)].push(_m4.compose(_p, _q, _s).clone());
  }
  const tint = new THREE.Color();
  buckets.forEach((list, v) => {
    if (!list.length) return;
    const hiMesh = new THREE.InstancedMesh(treeHi[v], treeMat, list.length);
    const loMesh = new THREE.InstancedMesh(treeLo[v], treeMat, list.length);
    list.forEach((m, i) => {
      hiMesh.setMatrixAt(i, m); loMesh.setMatrixAt(i, m);
      const t = 0.9 + rng() * 0.18; tint.setRGB(t, t, t);
      hiMesh.setColorAt(i, tint); loMesh.setColorAt(i, tint);
    });
    hiMesh.castShadow = true; hiMesh.receiveShadow = true;
    loMesh.castShadow = false; loMesh.receiveShadow = false;
    hiMesh.computeBoundingSphere(); loMesh.computeBoundingSphere();
    loMesh.visible = false;
    world.add(hiMesh, loMesh);
    ch.treesHi.push(hiMesh); ch.treesLo.push(loMesh);
  });
  // rocks
  const rb = Array.from({ length: 3 }, () => []);
  for (let k = 0; k < (T.rocks || 60); k++) {
    const z = ch.zTop - rng() * CHUNK, s = -z;
    const side = rng() < 0.5 ? -1 : 1;
    const off = 2 + rng() * rng() * 380;
    const x = centerX(s) + side * (pisteHalf(s) + off);
    if (Math.abs(x) > 570) continue;
    if (parkMask(s) > 0.01 && pisteHalf(s) + off < PIPE_HALF + 6) continue;
    if (liftNear(x, s, 9)) continue;
    normalAt(x, z, _n);
    const steep = _n.y < 0.8;
    const sc = (0.4 + rng() * 1.4) * (steep ? 2.2 : 1);
    _p.set(x, heightAt(x, z) - 0.38 * sc, z);
    _e.set((rng() - 0.5) * 0.5, rng() * Math.PI * 2, (rng() - 0.5) * 0.5);
    _q.setFromEuler(_e);
    _s.set(sc, sc * (0.8 + rng() * 0.5), sc);
    rb[Math.floor(rng() * 3)].push(_m4.compose(_p, _q, _s).clone());
  }
  rb.forEach((list, v) => {
    if (!list.length) return;
    const m = new THREE.InstancedMesh(rockGeos[v], rockMat, list.length);
    list.forEach((mm, i) => m.setMatrixAt(i, mm));
    m.castShadow = true; m.receiveShadow = true;
    m.computeBoundingSphere();
    world.add(m);
    ch.rocks.push(m);
  });
}

/* =========================================================
   The skier: jointed rig built from primitives
   ========================================================= */
function makeSkiTopTexture(c = { base: '#0e1a2c', mid: '#1a3456', accent: '#ff5a2c', line: '#e9eef5', trim: '#f2c14e', pattern: 'chev' }) {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 1024;
  const x = cv.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 1024);
  gr.addColorStop(0, c.base); gr.addColorStop(0.5, c.mid); gr.addColorStop(1, c.base);
  x.fillStyle = gr; x.fillRect(0, 0, 64, 1024);
  x.fillStyle = c.accent;
  x.fillRect(0, 0, 64, 90); x.fillRect(0, 960, 64, 64);
  if (c.pattern === 'chev') {
    for (let i = 0; i < 6; i++) {
      const y = 150 + i * 26;
      x.beginPath(); x.moveTo(0, y + 18); x.lineTo(32, y); x.lineTo(64, y + 18); x.lineTo(64, y + 28); x.lineTo(32, y + 10); x.lineTo(0, y + 28); x.closePath();
      x.globalAlpha = 1 - i * 0.14; x.fill();
    }
    x.globalAlpha = 1;
  } else if (c.pattern === 'stripe') {
    x.fillRect(0, 140, 22, 760); x.fillRect(42, 140, 22, 760);
  } else if (c.pattern === 'camo') {
    const r = makeRng(42);
    for (let i = 0; i < 70; i++) {
      x.fillStyle = [c.accent, c.mid, c.base, c.trim][i % 4];
      x.globalAlpha = 0.85;
      x.beginPath(); x.ellipse(r() * 64, 100 + r() * 830, 6 + r() * 14, 10 + r() * 30, r() * 3, 0, Math.PI * 2); x.fill();
    }
    x.globalAlpha = 1;
  } else if (c.pattern === 'fade') {
    const g2 = x.createLinearGradient(0, 100, 0, 600);
    g2.addColorStop(0, c.accent); g2.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g2; x.fillRect(0, 90, 64, 510);
  }
  x.fillStyle = c.line; x.fillRect(30, 320, 4, 560);
  x.fillStyle = c.trim; x.fillRect(0, 470, 64, 6); x.fillRect(0, 560, 64, 6);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

function skiGeometry() {
  const L = 1.72;
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 1, 72);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = z * 2; // -1 tip .. +1 tail
    let w = 0.071 + (u < 0 ? 0.044 : 0.034) * u * u;
    const endT = u < 0 ? clamp((-u - 0.9) / 0.1, 0, 1) : clamp((u - 0.94) / 0.06, 0, 1);
    w *= Math.sqrt(Math.max(0.02, 1 - endT * endT * 0.95));
    const th = 0.007 + 0.012 * (1 - u * u);
    let yy = (y + 0.5) * th;
    if (u < -0.7) { const t = (-u - 0.7) / 0.3; yy += 0.095 * t * t; }
    if (u > 0.86) { const t = (u - 0.86) / 0.14; yy += 0.03 * t * t; }
    p.setXYZ(i, x * w, yy, z * L);
  }
  g.computeVertexNormals();
  return g;
}

// Twin-tip snowboard: built along z like the skis (so the ski top textures map onto it), then turned across
function boardGeometry() {
  const L = 1.56;
  const g = new THREE.BoxGeometry(1, 1, 1, 2, 1, 80);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const u = z * 2, au = Math.abs(u);
    let w = 0.255 + 0.03 * u * u;
    const endT = clamp((au - 0.9) / 0.1, 0, 1);
    w *= Math.sqrt(Math.max(0.05, 1 - endT * endT * 0.9));
    let yy = (y + 0.5) * (0.012 + 0.008 * (1 - u * u));
    if (au > 0.74) { const t = (au - 0.74) / 0.26; yy += 0.06 * t * t; }
    p.setXYZ(i, x * w, yy, z * L);
  }
  g.computeVertexNormals();
  g.rotateY(Math.PI / 2);
  return g;
}

function buildSkier() {
  const M = {
    jacket: new THREE.MeshPhysicalMaterial({ color: 0xd2412a, roughness: 0.6, sheen: 0.7, sheenRoughness: 0.45, sheenColor: new THREE.Color(0xffa58a) }),
    jacketDark: new THREE.MeshPhysicalMaterial({ color: 0x1b2633, roughness: 0.55, sheen: 0.4, sheenColor: new THREE.Color(0x7d90a8) }),
    trim: new THREE.MeshStandardMaterial({ color: 0xf2c14e, roughness: 0.4 }),
    pants: new THREE.MeshPhysicalMaterial({ color: 0x2a3442, roughness: 0.72, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0x8fa1b8) }),
    glove: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.5 }),
    gloveCuff: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.8 }),
    helmet: new THREE.MeshPhysicalMaterial({ color: 0xf1f1ee, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.06 }),
    helmetDark: new THREE.MeshStandardMaterial({ color: 0x1d2228, roughness: 0.55 }),
    lens: new THREE.MeshPhysicalMaterial({ color: 0xffa646, metalness: 1, roughness: 0.04, iridescence: 1, iridescenceIOR: 1.7, iridescenceThicknessRange: [180, 620], envMapIntensity: 1.6 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x0f1113, roughness: 0.38, side: THREE.DoubleSide }),
    strap: new THREE.MeshStandardMaterial({ color: 0xd2412a, roughness: 0.7, side: THREE.DoubleSide }),
    gaiter: new THREE.MeshStandardMaterial({ color: 0x34475d, roughness: 0.95 }),
    boot: new THREE.MeshPhysicalMaterial({ color: 0xeeeeea, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 }),
    bootAccent: new THREE.MeshPhysicalMaterial({ color: 0xd2412a, roughness: 0.35, clearcoat: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xc4cad2, metalness: 1, roughness: 0.28 }),
    pole: new THREE.MeshStandardMaterial({ color: 0xa3acb7, metalness: 0.95, roughness: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.85 }),
    pack: new THREE.MeshPhysicalMaterial({ color: 0x232c38, roughness: 0.7, sheen: 0.3, sheenColor: new THREE.Color(0x8899aa) }),
    skiTop: new THREE.MeshPhysicalMaterial({ map: makeSkiTopTexture(), roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    skiBase: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.32 }),
    skiEdge: new THREE.MeshStandardMaterial({ color: 0x9aa2ab, metalness: 1, roughness: 0.3 }),
  };
  const add = (parent, geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = true; m.receiveShadow = true;
    parent.add(m); return m;
  };
  const grp = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  // Loose fabric tube: open-ended, with folds, vertical drape and bunching ("stacking") toward the hem
  const fabricTube = (rTop, rBot, len, seed = 0, wr = 0.01, stack = 0) => {
    const g = new THREE.CylinderGeometry(rTop, rBot, len, 26, 18, true);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const r = Math.hypot(x, z) || 1e-6, a = Math.atan2(x, z), t = (y + len / 2) / len;
      let d = wr * (simplex2(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4 + y * 9) * 0.65 + Math.sin(a * 5 + y * 14 + seed) * 0.35);
      d += stack * (1 - t) * (1 - t) * (0.55 + 0.45 * Math.sin(y * 70 + seed * 3));
      const k = (r + d) / r;
      p.setX(i, x * k); p.setZ(i, z * k);
      if (t < 0.001) p.setY(i, y + wr * 1.6 * Math.sin(a * 3 + seed));
    }
    g.computeVertexNormals();
    return g;
  };
  for (const m of [M.jacket, M.jacketDark, M.pants]) m.side = THREE.DoubleSide;

  const root = new THREE.Group();
  const rig = grp(root);

  // ---- skis, bindings, boots
  const skiGeo = skiGeometry();
  const skiMats = [M.skiEdge, M.skiEdge, M.skiTop, M.skiBase, M.skiEdge, M.skiEdge];
  function makeSkiAssembly(side) {
    const sg = grp(rig, side * 0.12, 0, 0);
    add(sg, skiGeo, skiMats, 0, 0, 0.02);
    add(sg, new RoundedBoxGeometry(0.068, 0.018, 0.44, 2, 0.006), M.dark, 0, 0.026, 0.0);
    add(sg, new RoundedBoxGeometry(0.075, 0.05, 0.075, 2, 0.015), M.metal, 0, 0.05, -0.19);
    add(sg, new RoundedBoxGeometry(0.06, 0.03, 0.05, 2, 0.01), M.bootAccent, 0, 0.078, -0.2);
    add(sg, new RoundedBoxGeometry(0.078, 0.07, 0.1, 2, 0.018), M.metal, 0, 0.058, 0.2);
    add(sg, new RoundedBoxGeometry(0.06, 0.04, 0.06, 2, 0.012), M.bootAccent, 0, 0.1, 0.22);
    add(sg, new THREE.BoxGeometry(0.008, 0.006, 0.09), M.dark, 0.045, 0.03, 0.26, 0.35);
    add(sg, new THREE.BoxGeometry(0.008, 0.006, 0.09), M.dark, -0.045, 0.03, 0.26, 0.35);
    const boot = grp(sg, 0, 0.045, 0.0);
    add(boot, new RoundedBoxGeometry(0.106, 0.034, 0.315, 2, 0.012), M.dark, 0, 0.017, 0);
    add(boot, new RoundedBoxGeometry(0.112, 0.12, 0.28, 3, 0.04), M.boot, 0, 0.09, -0.005);
    add(boot, new RoundedBoxGeometry(0.114, 0.05, 0.11, 2, 0.02), M.bootAccent, 0, 0.11, -0.1);
    const cuff = grp(boot, 0, 0.21, 0.035); cuff.rotation.x = -0.24;
    add(cuff, new THREE.CylinderGeometry(0.066, 0.072, 0.22, 20), M.boot, 0, 0, 0);
    add(cuff, new RoundedBoxGeometry(0.062, 0.2, 0.04, 2, 0.015), M.bootAccent, 0, 0.0, -0.062);
    add(cuff, new THREE.CylinderGeometry(0.071, 0.071, 0.035, 20, 1, true), M.dark, 0, 0.09, 0);
    for (let b = 0; b < 3; b++) {
      add(cuff, new RoundedBoxGeometry(0.014, 0.02, 0.05, 1, 0.004), M.metal, side * 0.07, -0.06 + b * 0.055, 0.0);
    }
    add(boot, new RoundedBoxGeometry(0.014, 0.02, 0.05, 1, 0.004), M.metal, side * 0.058, 0.1, -0.06);
    add(boot, new RoundedBoxGeometry(0.014, 0.02, 0.05, 1, 0.004), M.metal, side * 0.058, 0.13, 0.03);
    sg.userData.boot = boot;
    return sg;
  }
  const skiL = makeSkiAssembly(-1), skiR = makeSkiAssembly(1);
  const ANKLE = new THREE.Vector3(0, 0.235, 0.03);

  // ---- pelvis, legs
  const pelvis = grp(rig, 0, 0.84, 0.06);
  add(pelvis, new THREE.SphereGeometry(1, 22, 16), M.pants, 0, -0.04, 0.005).scale.set(0.195, 0.135, 0.155);
  const THIGH = 0.44, SHIN = 0.44;
  function makeLeg(side) {
    const hip = new THREE.Vector3(side * 0.095, -0.045, 0);
    const thigh = grp(pelvis, hip.x, hip.y, hip.z); thigh.rotation.order = 'ZXY';
    add(thigh, fabricTube(0.122, 0.108, 0.52, side * 3.1, 0.011), M.pants, 0, -0.215, 0.005);
    add(thigh, new RoundedBoxGeometry(0.075, 0.12, 0.04, 2, 0.014), M.pants, side * 0.105, -0.25, 0.0, 0, 0, side * 0.08);
    add(thigh, new RoundedBoxGeometry(0.075, 0.018, 0.042, 1, 0.006), M.jacketDark, side * 0.107, -0.19, 0.0, 0, 0, side * 0.08);
    const knee = grp(thigh, 0, -THIGH, 0);
    add(knee, new THREE.SphereGeometry(0.104, 16, 12), M.pants, 0, 0, -0.008);
    // lower leg: flares and bunches over the boot cuff; hem sits ~10 cm below the ankle so only the toe shows
    add(knee, fabricTube(0.104, 0.128, 0.57, side * 5.7, 0.012, 0.012), M.pants, 0, -0.265, 0.012);
    add(knee, new THREE.CylinderGeometry(0.131, 0.133, 0.03, 26, 1, true), M.jacketDark, 0, -0.535, 0.012);
    return { hip, thigh, knee };
  }
  const legL = makeLeg(-1), legR = makeLeg(1);

  // ---- spine, chest, head
  const spine = grp(pelvis, 0, 0.03, 0);
  const hem = add(spine, fabricTube(0.19, 0.212, 0.3, 2.2, 0.012, 0.006), M.jacket, 0, -0.05, 0.005);
  hem.scale.set(1, 1, 0.86);
  add(spine, new THREE.CylinderGeometry(0.216, 0.216, 0.025, 26, 1, true), M.jacketDark, 0, -0.195, 0.005).scale.set(1, 1, 0.86);
  add(spine, new THREE.CapsuleGeometry(0.16, 0.1, 6, 20), M.jacket, 0, 0.11, 0).scale.set(1.15, 1, 0.88);
  const chest = grp(spine, 0, 0.2, 0);
  add(chest, new THREE.CapsuleGeometry(0.178, 0.15, 8, 22), M.jacket, 0, 0.11, 0).scale.set(1.22, 1, 0.9);
  add(chest, new THREE.CapsuleGeometry(0.08, 0.32, 6, 12), M.jacketDark, 0, 0.24, 0.005, 0, 0, Math.PI / 2);
  add(chest, new THREE.BoxGeometry(0.012, 0.38, 0.012), M.trim, 0, 0.1, -0.158);
  add(chest, new RoundedBoxGeometry(0.08, 0.012, 0.012, 1, 0.004), M.jacketDark, 0.085, 0.16, -0.154);
  add(chest, new RoundedBoxGeometry(0.08, 0.012, 0.012, 1, 0.004), M.jacketDark, -0.085, 0.03, -0.152);
  add(chest, new THREE.CylinderGeometry(0.096, 0.112, 0.11, 20), M.jacketDark, 0, 0.32, 0);
  add(chest, new THREE.SphereGeometry(0.115, 18, 12), M.jacket, 0, 0.335, 0.085).scale.set(1.15, 0.7, 0.85);
  // avalanche pack
  const pack = grp(chest, 0, 0.11, 0.17);
  add(pack, new RoundedBoxGeometry(0.25, 0.34, 0.11, 3, 0.04), M.pack, 0, 0, 0);
  add(pack, new RoundedBoxGeometry(0.2, 0.12, 0.03, 2, 0.012), M.jacketDark, 0, -0.06, 0.06);
  add(pack, new THREE.BoxGeometry(0.03, 0.3, 0.012), M.bootAccent, 0.07, 0.02, 0.058);
  add(pack, new THREE.TorusGeometry(0.03, 0.007, 6, 14), M.metal, 0.07, 0.11, 0.066);
  for (const sx of [-1, 1]) add(chest, new THREE.BoxGeometry(0.035, 0.32, 0.012), M.dark, sx * 0.11, 0.12, -0.156);

  const neck = grp(chest, 0, 0.33, 0);
  add(neck, new THREE.CylinderGeometry(0.058, 0.068, 0.09, 16), M.gaiter, 0, 0.03, 0);
  const head = grp(neck, 0, 0.11, -0.005);
  add(head, new THREE.SphereGeometry(0.1, 24, 18), M.gaiter, 0, -0.01, 0).scale.set(0.95, 1.08, 1.02);
  const helmetShell = add(head, new THREE.SphereGeometry(0.128, 36, 20, 0, Math.PI * 2, 0, Math.PI * 0.56), M.helmet, 0, 0.018, 0.008);
  helmetShell.scale.set(1, 1.02, 1.12);
  add(head, new THREE.SphereGeometry(0.1295, 36, 6, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.045), M.helmetDark, 0, 0.018, 0.008).scale.set(1, 1.02, 1.12);
  for (let v = -1; v <= 1; v++) add(head, new RoundedBoxGeometry(0.016, 0.01, 0.07, 1, 0.004), M.helmetDark, v * 0.04, 0.142, 0.01);
  for (const sx of [-1, 1]) add(head, new THREE.CylinderGeometry(0.042, 0.045, 0.02, 18), M.helmetDark, sx * 0.124, -0.02, 0.01, 0, 0, Math.PI / 2);
  const gog = grp(head, 0, 0.0, 0.006);
  gog.scale.set(1, 1, 1.13);
  add(gog, new THREE.CylinderGeometry(0.124, 0.124, 0.066, 32, 1, true, Math.PI - 1.2, 2.4), M.frame, 0, 0, 0);
  add(gog, new THREE.CylinderGeometry(0.129, 0.129, 0.054, 32, 1, true, Math.PI - 1.08, 2.16), M.lens, 0, 0, 0);
  add(gog, new THREE.CylinderGeometry(0.131, 0.131, 0.038, 36, 1, true, Math.PI + 1.15, Math.PI * 2 - 2.3), M.strap, 0, 0.003, 0);

  // ---- arms, gloves, poles
  function makeArm(side) {
    const shoulder = grp(chest, side * 0.215, 0.235, 0.0); shoulder.rotation.order = 'ZXY';
    add(shoulder, new THREE.SphereGeometry(0.09, 16, 12), M.jacket, 0, 0, 0);
    add(shoulder, fabricTube(0.086, 0.078, 0.32, side * 7.3, 0.009), M.jacket, 0, -0.145, 0);
    const elbow = grp(shoulder, 0, -0.29, 0);
    add(elbow, new THREE.SphereGeometry(0.076, 14, 10), M.jacket, 0, 0, 0);
    add(elbow, fabricTube(0.074, 0.084, 0.27, side * 9.1, 0.009, 0.005), M.jacket, 0, -0.125, 0);
    add(elbow, new THREE.CylinderGeometry(0.087, 0.087, 0.02, 18, 1, true), M.jacketDark, 0, -0.255, 0);
    const hand = grp(elbow, 0, -0.265, 0);
    add(hand, new THREE.CylinderGeometry(0.062, 0.054, 0.085, 14), M.gloveCuff, 0, 0.035, 0);
    add(hand, new RoundedBoxGeometry(0.09, 0.105, 0.072, 3, 0.03), M.glove, 0, -0.045, 0.0);
    add(hand, new THREE.CapsuleGeometry(0.019, 0.04, 4, 8), M.glove, -side * 0.04, -0.035, -0.035, 0.5, 0, side * 0.6);
    add(hand, new RoundedBoxGeometry(0.094, 0.025, 0.074, 2, 0.01), M.gloveCuff, 0, -0.01, 0);
    const pole = grp(hand, 0, -0.045, 0);
    pole.rotation.order = 'ZXY';
    add(pole, new THREE.CylinderGeometry(0.0095, 0.0065, 1.18, 8), M.pole, 0, -0.55, 0);
    add(pole, new THREE.CylinderGeometry(0.018, 0.015, 0.16, 12), M.rubber, 0, 0.02, 0);
    add(pole, new THREE.SphereGeometry(0.02, 10, 8), M.rubber, 0, 0.1, 0);
    add(pole, new THREE.TorusGeometry(0.035, 0.005, 6, 16), M.bootAccent, 0, 0.06, 0, 0, Math.PI / 2, 0);
    add(pole, new THREE.CylinderGeometry(0.048, 0.048, 0.006, 16), M.rubber, 0, -1.02, 0);
    add(pole, new THREE.TorusGeometry(0.046, 0.004, 5, 18), M.bootAccent, 0, -1.02, 0, Math.PI / 2, 0, 0);
    add(pole, new THREE.ConeGeometry(0.006, 0.05, 6), M.metal, 0, -1.165, 0, Math.PI, 0, 0);
    return { shoulder, elbow, hand, pole, side };
  }
  const armL = makeArm(-1), armR = makeArm(1);

  return { M, root, rig, skiL, skiR, pelvis, spine, chest, neck, head, legL, legR, armL, armR, ANKLE, THIGH, SHIN };
}

const skier = buildSkier();
scene.add(skier.root);
// Snowboard: board + bindings in the rig, feet spread along it (rig is turned sideways in board mode)
const STANCE = 0.27;
skier.board = (() => {
  const M = skier.M, g = new THREE.Group();
  const deck = new THREE.Mesh(boardGeometry(), [M.skiEdge, M.skiEdge, M.skiTop, M.skiBase, M.skiEdge, M.skiEdge]);
  deck.castShadow = true; deck.receiveShadow = true; g.add(deck);
  const part = (geo, mat, x, y, z, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; m.castShadow = true; m.receiveShadow = true; g.add(m); };
  for (const sx of [-1, 1]) {
    part(new RoundedBoxGeometry(0.17, 0.022, 0.27, 2, 0.008), M.dark, sx * STANCE, 0.03, 0);
    part(new RoundedBoxGeometry(0.15, 0.22, 0.025, 2, 0.01), M.dark, sx * STANCE, 0.16, 0.14, -0.28);
    part(new RoundedBoxGeometry(0.17, 0.035, 0.05, 2, 0.012), M.bootAccent, sx * STANCE, 0.15, -0.02);
    part(new RoundedBoxGeometry(0.17, 0.03, 0.045, 2, 0.01), M.bootAccent, sx * STANCE, 0.1, -0.12);
  }
  g.visible = false;
  skier.rig.add(g);
  return g;
})();
let BOARD = false;

const _ik = new THREE.Vector3(), _ikM = new THREE.Matrix4();
function solveLeg(leg, skiGroup) {
  skiGroup.updateMatrix();
  _ik.copy(skier.ANKLE).applyMatrix4(skiGroup.matrix);
  skier.pelvis.updateMatrix();
  _ikM.copy(skier.pelvis.matrix).invert();
  _ik.applyMatrix4(_ikM).sub(leg.hip);
  const A = skier.THIGH, B = skier.SHIN;
  const d = clamp(_ik.length(), 0.08, A + B - 0.002);
  const dyz = Math.hypot(_ik.y, _ik.z);
  const phi = Math.atan2(_ik.z, -_ik.y);
  const alpha = Math.acos(clamp((A * A + d * d - B * B) / (2 * A * d), -1, 1));
  const gamma = Math.acos(clamp((A * A + B * B - d * d) / (2 * A * B), -1, 1));
  leg.thigh.rotation.set(-phi + alpha, 0, Math.atan2(_ik.x, dyz));
  leg.knee.rotation.x = -(Math.PI - gamma);
}

/* =========================================================
   Snow spray particles
   ========================================================= */
const MAXP = 1600;
const spray = (() => {
  const pos = new Float32Array(MAXP * 3), alpha = new Float32Array(MAXP), size = new Float32Array(MAXP);
  const vel = new Float32Array(MAXP * 3), life = new Float32Array(MAXP), maxLife = new Float32Array(MAXP), size0 = new Float32Array(MAXP);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 600 }, uColor: { value: new THREE.Color(1.15, 1.17, 1.22) } },
    vertexShader: `attribute float aAlpha; attribute float aSize; varying float vA; uniform float uScale;
      void main(){ vec4 mv = modelViewMatrix*vec4(position,1.0); gl_Position = projectionMatrix*mv;
      gl_PointSize = aSize*uScale/max(0.1,-mv.z); vA = aAlpha; }`,
    fragmentShader: `varying float vA; uniform vec3 uColor;
      void main(){ vec2 c = gl_PointCoord-0.5; float r = dot(c,c)*4.0; float a = 1.0-smoothstep(0.0,1.0,r); a*=a; if(a*vA<0.003) discard; gl_FragColor = vec4(uColor, a*vA); }`,
    transparent: true, depthWrite: false,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  scene.add(pts);
  let head = 0;
  function emit(p, v, sz, lf) {
    const i = head; head = (head + 1) % MAXP;
    pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
    vel[i * 3] = v.x; vel[i * 3 + 1] = v.y; vel[i * 3 + 2] = v.z;
    life[i] = lf; maxLife[i] = lf; size0[i] = sz;
  }
  function update(dt) {
    for (let i = 0; i < MAXP; i++) {
      if (life[i] <= 0) { alpha[i] = 0; size[i] = 0; continue; }
      life[i] -= dt;
      const t = 1 - life[i] / maxLife[i];
      const dr = Math.exp(-2.2 * dt);
      vel[i * 3] *= dr; vel[i * 3 + 2] *= dr; vel[i * 3 + 1] = vel[i * 3 + 1] * dr - 5.5 * dt;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      alpha[i] = Math.max(0, (1 - t)) * Math.min(1, t * 8) * 0.55;
      size[i] = size0[i] * (0.6 + t * 1.8);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }
  return { emit, update, mat };
})();

/* =========================================================
   Player state + physics (ground / air / rail / crash)
   ========================================================= */
const G = 9.81, MASS = 80, RHO = 1.1;
const P = {
  pos: new THREE.Vector3(), vel: new THREE.Vector3(),
  fwd: new THREE.Vector3(0, 0, -1), right: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), lastN: new THREE.Vector3(0, 1, 0),
  steer: 0, tuck: 0, brake: 0, lean: 0, comp: 0, landComp: 0, charge: 0, grab: 0,
  mode: 'ground', yawVis: 0, sw: false, sinceGround: 0, lastLip: 99, popped: false, prevSpace: false,
  airT: 0, q: new THREE.Quaternion(), q0: new THREE.Quaternion(), v0: new THREE.Vector3(0, 0, -1), trajW: 1,
  spin: 0, flip: 0, grabT: 0, autoFlip: 0, autoFlipRate: 0, wantFlip: false,
  onRail: null, railT: 0, railSide: 1,
  crashT: 0, crashQ: new THREE.Quaternion(), crashW: new THREE.Vector3(),
  time: 0, top: 0, startY: 0, running: false, finished: false, score: 0, lastAir: 0,
};
const GI = mkGI(), GI2 = mkGI();
const _tv = new THREE.Vector3(), _tv2 = new THREE.Vector3(), _bu = new THREE.Vector3(), _bf = new THREE.Vector3(), _vt = new THREE.Vector3();
const _gq = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qc = new THREE.Quaternion(), _qI = new THREE.Quaternion();
const _basis = new THREE.Matrix4(), _x = new THREE.Vector3(), _z = new THREE.Vector3();

const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dampAngle = (a, t, k, dt) => a + wrapA(t - a) * (1 - Math.exp(-k * dt));

function resetPlayer() {
  const s0 = 12;
  P.pos.set(centerX(s0), 0, -s0); P.pos.y = surfH(P.pos.x, P.pos.z);
  P.startY = heightAt(centerX(0), 0);
  P.vel.set(0, 0, 0);
  courseDir(s0, P.fwd);
  surfNormal(P.pos.x, P.pos.z, P.up); P.lastN.copy(P.up);
  Object.assign(P, { steer: 0, tuck: 0, brake: 0, lean: 0, comp: 0, landComp: 0, charge: 0, grab: 0, mode: 'ground', yawVis: 0, sw: false,
    sinceGround: 0, lastLip: 99, popped: false, airT: 0, spin: 0, flip: 0, grabT: 0, autoFlip: 0, wantFlip: false, onRail: null, railT: 0, crashT: 0,
    time: 0, top: 0, finished: false, score: 0, lastAir: 0, runCoins: 0, launch: '', perfect: false, inLake: false });
  camState.init = false;
}

// Body orientation while on snow: up vector + ski direction rotated by the visual yaw (switch / boardslide)
function groundQuat(up, out) {
  _gq.setFromAxisAngle(up, P.yawVis);
  _z.copy(P.fwd).applyQuaternion(_gq).negate();
  _x.crossVectors(up, _z);
  if (_x.lengthSq() < 1e-6) _x.set(1, 0, 0);
  _x.normalize();
  _z.crossVectors(_x, up).normalize();
  _basis.makeBasis(_x, up, _z);
  return out.setFromRotationMatrix(_basis);
}

/* ---------- input ---------- */
const keys = new Set();
const touch = { L: false, R: false, T: false, B: false, J: false };
const CODE_MAP = {
  KeyA: 'a', KeyD: 'd', KeyW: 'w', KeyS: 's', KeyR: 'r', KeyF: 'f',
  ArrowLeft: 'arrowleft', ArrowRight: 'arrowright', ArrowUp: 'arrowup', ArrowDown: 'arrowdown', Space: ' ',
};
const keyName = (e) => CODE_MAP[e.code] || (e.key || '').toLowerCase();
addEventListener('keydown', (e) => {
  const k = keyName(e);
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k)) e.preventDefault();
  keys.add(k);
  if (ride.active && (k === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); skipRide(); return; }
  if (k === 'r' && started && !storeOpen && !e.repeat) goHome();
  if (k === 'f' && started && P.running && !e.repeat) P.wantFlip = true;
});
addEventListener('keyup', (e) => keys.delete(keyName(e)));
addEventListener('blur', () => keys.clear());
function readInput() {
  return {
    left: keys.has('a') || keys.has('arrowleft') || touch.L,
    right: keys.has('d') || keys.has('arrowright') || touch.R,
    tuck: keys.has('w') || keys.has('arrowup') || touch.T,
    brake: keys.has('s') || keys.has('arrowdown') || touch.B,
    space: keys.has(' ') || touch.J,
  };
}

/* ---------- F: one-press backflip ---------- */
// On snow: a big pop straight off the surface. In the air: start rotating now.
// The flip speed is matched to the air time left, so a well-timed flip comes round in time.
function triggerBackflip() {
  if (P.mode === 'crash' || P.autoFlip > 0) return;
  if (P.mode === 'ground') {
    const gi = groundInfo(P.pos.x, P.pos.z, P.pos.y + 0.05, GI);
    P.vel.addScaledVector(P.lastN, 4.6 * GEAR.pop);
    P.charge = 0; P.popped = true;
    P.pos.addScaledVector(P.lastN, 0.03);
    startAir(gi);
  }
  const hAbove = Math.max(0, P.pos.y - surfH(P.pos.x, P.pos.z));
  const vy = P.vel.y;
  const tLeft = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * G * hAbove))) / G;
  P.autoFlip = Math.PI * 2;
  P.autoFlipRate = clamp((Math.PI * 2) / Math.max(0.05, 0.8 * tLeft), 5.5, 14);
}

/* ---------- step dispatcher ---------- */
function physics(dt, inp) {
  const steerT = (inp.left ? 1 : 0) - (inp.right ? 1 : 0);
  P.steer = damp(P.steer, steerT, 7, dt);
  const grounded = P.mode === 'ground';
  P.tuck = damp(P.tuck, grounded && inp.tuck && !inp.brake && !inp.space ? 1 : 0, 5, dt);
  P.brake = damp(P.brake, grounded && inp.brake && !P.onRail ? 1 : 0, 6, dt);
  P.landComp *= Math.exp(-3.4 * dt);
  const released = P.prevSpace && !inp.space;
  P.prevSpace = inp.space;
  if (P.wantFlip) { P.wantFlip = false; triggerBackflip(); }
  if (P.mode === 'crash') return crashStep(dt);
  if (P.mode === 'air') return airStep(dt, inp, steerT, released);
  return groundStep(dt, inp, released);
}

function updateCharge(inp, released, dt) {
  if (inp.space) P.charge = Math.min(1, P.charge + dt / 0.45);
  else if (!released) P.charge = Math.max(0, P.charge - dt * 4);
}

/* ---------- on snow ---------- */
function groundStep(dt, inp, released) {
  const gi = groundInfo(P.pos.x, P.pos.z, P.pos.y + 0.05, GI);
  const n = gi.n;
  P.lastN.copy(n);
  P.sinceGround = 0;
  if (gi.kind === 'kicker') P.lastLip = gi.region === 'ramp' ? gi.lip : 99; else P.lastLip = 99;

  // keep the ski direction on the tangent plane (works on half-pipe walls too)
  const f = P.fwd;
  f.addScaledVector(n, -f.dot(n));
  if (f.lengthSq() < 1e-4) {
    f.copy(P.vel).addScaledVector(n, -P.vel.dot(n));
    if (f.lengthSq() < 1e-4) f.set(0, 0, -1).addScaledVector(n, n.z);
  }
  f.normalize();
  const r = P.right.crossVectors(f, n).normalize();
  updateCharge(inp, released, dt);

  if (gi.rail) return railStep(dt, gi, released);
  if (P.onRail) leaveRail();

  // gravity along the slope
  _tv.set(0, -G, 0);
  _tv.addScaledVector(n, -_tv.dot(n));
  P.vel.addScaledVector(_tv, dt);
  let speed = P.vel.length();

  // steering: rotate skis about the surface normal, limited by carve radius
  const omegaMax = Math.min(2.3, 0.75 + speed / 13) * (1 - 0.35 * P.tuck);
  _gq.setFromAxisAngle(n, P.steer * omegaMax * dt);
  f.applyQuaternion(_gq).normalize();
  r.crossVectors(f, n).normalize();

  // edge grip: bleed lateral velocity, redirect most energy along the skis
  let vf = P.vel.dot(f);
  const vl = P.vel.dot(r);
  const grip = lerp(lerp(9, 7, P.tuck) * GEAR.grip, 2.2, P.brake);
  const newVl = vl * Math.exp(-grip * dt);
  const gained = (vl * vl - newVl * newVl) * lerp(0.9, 0.0, P.brake);
  vf = (vf >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, vf * vf + gained));
  P.vel.copy(f).multiplyScalar(vf).addScaledVector(r, newVl);
  speed = P.vel.length();

  if (inp.tuck && speed < 5) P.vel.addScaledVector(f, 1.6 * dt);

  // snow friction + skid + drag
  const mu = 0.045 + P.brake * 0.42 + 0.22 * Math.min(1, Math.abs(newVl) / (speed + 1));
  const cda = (lerp(0.55, 0.22, P.tuck) + P.brake * 0.3) * GEAR.drag;
  const decel = mu * G * Math.max(0.2, n.y) + (0.5 * RHO * cda * speed * speed) / MASS;
  if (speed > 1e-4) { const ns = Math.max(0, speed - decel * dt); P.vel.multiplyScalar(ns / speed); }

  // ramps up to rails/boxes gently guide the rider onto the line
  if (gi.kind === 'ramp' && gi.feat && gi.feat.rail) {
    const tx = centerX(-P.pos.z) + gi.feat.rail.u;
    P.pos.x += (tx - P.pos.x) * Math.min(1, 4 * dt);
  }

  // pop
  if (released && P.charge > 0.05) {
    const perfect = gi.kind === 'kicker' && gi.region === 'ramp' && gi.lip < 2.4;
    doPop(n, perfect, gi);
    return P.vel.length();
  }

  // reaching a kicker lip: launch at the ramp's true lip angle (the averaged snow normal would flatten it)
  if (gi.kind === 'kicker' && gi.region === 'ramp' && gi.lip < 0.25 + P.vel.length() * dt) {
    const f = gi.feat, sl = f.s0 + f.Lr;
    const grade = heightAt(centerX(sl + 0.5), -(sl + 0.5)) - heightAt(centerX(sl - 0.5), -(sl - 0.5));
    P.pos.addScaledVector(courseDir(sl, _tv2), Math.max(0, gi.lip));   // take off from the lip itself
    P.pos.y = surfH(P.pos.x, P.pos.z) + 0.01;
    P.vel.y = Math.hypot(P.vel.x, P.vel.z) * (grade + 2 * f.H / f.Lr);
    startAir(gi);
    return P.vel.length();
  }

  P.pos.addScaledVector(P.vel, dt);
  P.pos.x = clamp(P.pos.x, -560, 560);
  const g2 = groundInfo(P.pos.x, P.pos.z, P.pos.y + 0.3, GI2);
  if (g2.blocked && P.vel.length() > 2.5) { crash(g2.blocked.kind === 'box' ? 'Slammed the box' : 'Clipped the rail', g2.n); return P.vel.length(); }

  // a kicker lip always throws you: crossing from the takeoff ramp onto the deck launches you along the ramp's angle
  if (gi.kind === 'kicker' && gi.region === 'ramp' && g2.feat === gi.feat && g2.region !== 'ramp' && P.vel.y > 0) { startAir(gi); return P.vel.length(); }
  // leave the snow when it drops away faster than gravity can follow (lips, knuckles, pipe coping)
  const gap = P.pos.y - g2.h;
  if (gap > 0.5 * G * Math.max(0.25, n.y) * dt * dt + 0.003) { startAir(gi); return P.vel.length(); }
  P.pos.y = g2.h;
  const sp = P.vel.length();
  P.vel.addScaledVector(g2.n, -P.vel.dot(g2.n));
  if (P.vel.lengthSq() > 1e-8) P.vel.setLength(sp);
  if (g2.rail) return sp;

  // terrain curvature -> knee compression
  if (sp > 0.5) {
    _tv2.copy(P.vel); _tv2.y = 0;
    if (_tv2.lengthSq() > 1e-4) {
      _tv2.normalize();
      const a = surfH(P.pos.x + _tv2.x * 1.5, P.pos.z + _tv2.z * 1.5);
      const b = surfH(P.pos.x - _tv2.x * 1.5, P.pos.z - _tv2.z * 1.5);
      const kappa = (a + b - 2 * P.pos.y) / 2.25;
      P.comp = damp(P.comp, clamp((kappa * sp * sp) / G, -0.8, 1.4), 10, dt);
    }
  } else P.comp = damp(P.comp, 0, 6, dt);

  const omega = P.steer * omegaMax;
  P.lean = damp(P.lean, clamp(Math.atan2(sp * omega, G), -0.95, 0.95) * (1 - 0.5 * P.brake), 6, dt);
  P.up.lerp(g2.n, 1 - Math.exp(-12 * dt)).normalize();
  // switch: after landing backwards the rider keeps skiing backwards until the next 180
  const yawTarget = P.sw ? (P.yawVis >= 0 ? Math.PI : -Math.PI) : 0;
  P.yawVis = dampAngle(P.yawVis, yawTarget, 7, dt);
  return sp;
}

/* ---------- rails & boxes: slide along the line, skis across ---------- */
function railStep(dt, gi, released) {
  const r = gi.rail;
  if (P.onRail !== r) { P.onRail = r; P.railT = 0; P.railSide = P.yawVis >= 0 ? 1 : -1; }
  P.railT += dt;
  const t = r.dir;
  let vt = P.vel.dot(t);
  vt += -G * t.y * dt;
  vt -= Math.sign(vt) * Math.min(Math.abs(vt), 0.08 * G * dt + (0.5 * RHO * 0.45 * vt * vt / MASS) * dt);
  P.vel.copy(t).multiplyScalar(vt);
  P.fwd.copy(t).multiplyScalar(vt >= 0 ? 1 : -1);
  P.right.crossVectors(P.fwd, gi.n).normalize();
  P.lean = damp(P.lean, 0, 6, dt);
  P.comp = damp(P.comp, 0, 6, dt);
  if (released && P.charge > 0.05) { doPop(gi.n, false); return Math.abs(vt); }
  P.pos.addScaledVector(P.vel, dt);
  const g2 = groundInfo(P.pos.x, P.pos.z, P.pos.y + 0.3, GI2);
  if (g2.rail === r) {
    P.pos.x = r.A.x + (r.B.x - r.A.x) * g2.railT;
    P.pos.z = r.A.z + (r.B.z - r.A.z) * g2.railT;
    P.pos.y = g2.h;
  } else {
    startAir(gi);
  }
  P.up.lerp(gi.n, 1 - Math.exp(-12 * dt)).normalize();
  P.yawVis = dampAngle(P.yawVis, P.railSide * Math.PI / 2, 10, dt);
  return Math.abs(vt);
}
function leaveRail() {
  if (P.onRail && P.railT > 0.3) {
    const pts = Math.round(P.railT * 320);
    P.score += pts;
    const coins = Math.max(1, Math.round(P.railT * 3));
    addCoins(coins);
    toast(P.onRail.kind === 'box' ? 'Boardslide' : 'Rail slide', 'good', `${P.railT.toFixed(1)} s · +${pts} · +${coins} coins`);
  }
  P.onRail = null;
}

/* ---------- airborne ---------- */
function startAir(gi) {
  const fromRail = !!P.onRail;
  if (fromRail) { leaveRail(); P.yawVis = 0; P.sw = false; }
  // half-pipe coping assist: send the rider straight up so they come back into the pipe
  if (gi && gi.kind === 'pipe' && gi.region !== 'flat' && P.vel.y > 1) {
    const side = Math.sign(P.pos.x - centerX(-P.pos.z)) || 1;
    if (P.vel.x * side > -0.4) P.vel.x = -side * 0.4;
  }
  P.mode = 'air'; P.airT = 0; P.spin = 0; P.flip = 0; P.grabT = 0;
  P.launch = gi && gi.feat ? (gi.feat.kind === 'kicker' ? (gi.region === 'ramp' ? 'kicker-' + gi.feat.size : '') : gi.feat.kind) : '';
  P.aimFeat = gi && gi.feat && gi.feat.kind === 'kicker' && gi.region === 'ramp' ? gi.feat : null;
  if (P.aimFeat) aimJump(P.aimFeat);
  groundQuat(P.lastN, P.q0);   // q0 = body orientation without the rider's spin/flip
  P.q.copy(P.q0);
}

function doPop(n, perfect, gi) {
  const pw = (1.3 + 1.7 * P.charge) * (perfect ? 1.4 : 1) * GEAR.pop;
  if (perfect) P.perfect = true;
  P.vel.addScaledVector(n, pw);
  P.charge = 0; P.popped = true;
  if (perfect) toast('Perfect pop', 'good', 'timed at the lip');
  if (P.mode !== 'air') {
    P.pos.addScaledVector(n, 0.03);
    startAir(gi || null);
  } else if (P.aimFeat && P.airT < 0.25) aimJump(P.aimFeat);   // late pop off the lip
}

/* ---------- landing assist ----------
   Off a kicker the game solves for the takeoff speed that lands the rider on the sweet spot of the
   landing slope (about 40% of the way down it), the way a rider checks speed before a jump.
   Too fast: speed is scrubbed to the solution. A little slow: topped up to it. Very slow: helped partway.
   If the pop is so big the landing would be too hard, some height is taken off as well. */
const _aimP = new THREE.Vector3(), _aimD = new THREE.Vector3(), _aimC = new THREE.Vector3(), _aimN = new THREE.Vector3();
const AIM_SPOT = 0.4, AIM_MAX_IMPACT = 9;
function simLanding(p0, dir, hs, vy, out) {
  let x = p0.x, y = p0.y, z = p0.z, vx = dir.x * hs, vz = dir.z * hs, v = vy;
  const dt = 1 / 60, k = (0.5 * RHO * 0.45) / MASS;
  for (let i = 0; i < 480; i++) {
    v -= G * dt;
    const d = Math.max(0, 1 - k * Math.hypot(vx, v, vz) * dt);
    vx *= d; v *= d; vz *= d;
    x += vx * dt; y += v * dt; z += vz * dt;
    if (i > 1 && y <= surfH(x, z)) break;
  }
  out.set(x, y, z);
  _aimC.set(vx, v, vz);
  return out;
}
// Gap kickers (the lake gaps): the flight is scaled as a whole — launch angle kept, speed set — so a fast
// in-run doesn't turn into a sky-high arc, and the landing spot is picked where the hill is steepest.
function aimGap(f, hs) {
  const sl = f.s0 + f.Lr;
  const lipK = heightAt(centerX(sl + 0.5), -(sl + 0.5)) - heightAt(centerX(sl - 0.5), -(sl - 0.5)) + 2 * f.H / f.Lr;
  let k = Math.max(P.vel.y / hs, lipK);
  const kMin = Math.max(0.05, lipK * 0.55);
  let best = null;
  for (let tries = 0; tries < 8; tries++) {
    for (const spot of [0.4, 0.5, 0.6]) {
      const target = sl + f.Lt + f.Ll * spot;
      let lo = 0.5, hi = 70;
      for (let it = 0; it < 18; it++) {
        const mid = (lo + hi) / 2;
        simLanding(P.pos, _aimD, mid, k * mid, _aimP);
        if (-_aimP.z < target) lo = mid; else hi = mid;
      }
      const h = (lo + hi) / 2;
      simLanding(P.pos, _aimD, h, k * h, _aimP);
      surfNormal(_aimP.x, _aimP.z, _aimN);
      const impact = -_aimC.dot(_aimN);
      if (!best || impact < best.impact) best = { hs: h, vy: k * h, impact };
    }
    if (best.impact <= AIM_MAX_IMPACT || k <= kMin + 1e-3) break;
    k = Math.max(kMin, k * 0.85);
  }
  const helpAll = hs >= 0.55 * best.hs;
  const hsNew = helpAll ? best.hs : hs + (best.hs - hs) * 0.5;
  const vyNew = helpAll ? best.vy : Math.max(P.vel.y, best.vy * hsNew / best.hs);
  P.vel.set(_aimD.x * hsNew, vyNew, _aimD.z * hsNew);
}
function aimJump(f) {
  let hs = Math.hypot(P.vel.x, P.vel.z);
  if (hs < 0.5) return;
  courseDir(f.s0 + f.Lr, _aimD);
  _aimD.lerp(_aimN.set(P.vel.x / hs, 0, P.vel.z / hs), 0.4).normalize();   // mostly straight down the landing
  if (f.gap) return aimGap(f, hs);
  const target = f.s0 + f.Lr + f.Lt + f.Ll * AIM_SPOT;
  let vy = P.vel.y, hsT = hs;
  // never fly flatter than the lip itself, or the rider clips it
  const sl = f.s0 + f.Lr;
  const lipVy = hs * (heightAt(centerX(sl + 0.5), -(sl + 0.5)) - heightAt(centerX(sl - 0.5), -(sl - 0.5)) + 2 * f.H / f.Lr);
  const vyFloor = Math.min(vy, Math.max(0.5, lipVy));
  for (let tries = 0; tries < 6; tries++) {
    let lo = 0.5, hi = 70;
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      simLanding(P.pos, _aimD, mid, vy, _aimP);
      if (-_aimP.z < target) lo = mid; else hi = mid;
    }
    hsT = (lo + hi) / 2;
    simLanding(P.pos, _aimD, hsT, vy, _aimP);
    surfNormal(_aimP.x, _aimP.z, _aimN);
    const impact = -_aimC.dot(_aimN);
    if (impact <= AIM_MAX_IMPACT || vy <= vyFloor + 1e-3) break;
    vy = Math.max(vyFloor, vy * 0.85);
  }
  const hsNew = hs >= 0.55 * hsT ? hsT : hs + (hsT - hs) * 0.5;
  P.vel.set(_aimD.x * hsNew, vy, _aimD.z * hsNew);
}

function airStep(dt, inp, steerT, released) {
  P.airT += dt; P.sinceGround += dt;
  // late pop (coyote time) still counts if released just after leaving the lip
  if (released && !P.popped && P.sinceGround < 0.16 && P.charge > 0.05) doPop(P.lastN, P.lastLip < 2.4);
  if (!inp.space) P.charge = 0;
  P.grab = damp(P.grab, inp.space && P.airT > 0.12 ? 1 : 0, 8, dt);
  if (P.grab > 0.7) P.grabT += dt;

  P.vel.y -= G * dt;
  const sp = P.vel.length();
  P.vel.multiplyScalar(Math.max(0, 1 - (0.5 * RHO * 0.45 * sp) / MASS * dt));
  P.spin += steerT * 5.2 * dt;                                       // A/D: spin about body axis
  P.flip += ((inp.brake ? 1 : 0) - (inp.tuck ? 1 : 0)) * 3.8 * dt;   // W: forward, S: backward
  if (P.autoFlip > 0) { const d = Math.min(P.autoFlip, P.autoFlipRate * dt); P.flip += d; P.autoFlip -= d; }
  P.lean = damp(P.lean, 0, 5, dt);
  P.comp = damp(P.comp, 0, 5, dt);
  P.pos.addScaledVector(P.vel, dt);

  // rider spots the landing: body turns toward the slope ahead at a limited rate (short airs can't fully level out),
  // then the rider's own spin and flip are layered on top
  surfNormal(P.pos.x + P.vel.x * 0.3, P.pos.z + P.vel.z * 0.3, _tv2);
  _bu.set(0, 1, 0).applyQuaternion(P.q0);
  const ang = _bu.angleTo(_tv2);
  if (ang > 1e-4) {
    _qa.setFromUnitVectors(_bu, _tv2);
    const maxStep = 1.7 * dt;
    if (ang > maxStep) { _qc.copy(_qa); _qa.slerpQuaternions(_qI, _qc, maxStep / ang); }   // separate source: three.js slerpQuaternions overwrites its target first
    P.q0.premultiply(_qa);
  }
  // skis track the flight direction (about the body axis) unless the rider is spinning
  if (Math.abs(P.spin) < 0.3) {
    _bu.set(0, 1, 0).applyQuaternion(P.q0);
    _bf.set(0, 0, -1).applyQuaternion(P.q0);
    _vt.set(P.vel.x, 0, P.vel.z); _vt.addScaledVector(_bu, -_vt.dot(_bu));   // horizontal travel only
    if (_vt.lengthSq() > 1) {
      _vt.normalize();
      if (_bf.dot(_vt) < 0) _vt.negate();   // flying backwards: stay backwards
      const yawErr = Math.atan2(_tv.crossVectors(_bf, _vt).dot(_bu), _bf.dot(_vt));
      const step = clamp(yawErr, -3.2 * dt, 3.2 * dt);
      _qa.setFromAxisAngle(_bu, step);
      P.q0.premultiply(_qa);
    }
  }
  _qb.setFromAxisAngle(UP, P.spin);
  _qc.setFromAxisAngle(XAX, P.flip);
  P.q.copy(P.q0).multiply(_qb).multiply(_qc);

  const gi = groundInfo(P.pos.x, P.pos.z, P.pos.y, GI);
  if (LAKE && P.pos.y <= LAKE.W + 0.15 && inLake(P.pos.x, P.pos.z)) { splash(); return sp; }
  if (P.pos.y <= gi.h) land(gi);
  return sp;
}

/* ---------- landing: must match the slope ---------- */
function land(gi) {
  const n = gi.n;
  _bu.set(0, 1, 0).applyQuaternion(P.q);
  _bf.set(0, 0, -1).applyQuaternion(P.q);
  const fdn = _bf.dot(n);
  const vDotN = P.vel.dot(n), vn = -vDotN;
  _vt.copy(P.vel).addScaledVector(n, -vDotN);
  const vtLen = _vt.length();
  const upErr = _bu.angleTo(n);
  _bf.addScaledVector(n, -fdn);
  let yawDot = 1;
  if (_bf.lengthSq() > 1e-4 && vtLen > 0.5) { _bf.normalize(); yawDot = _bf.dot(_tv.copy(_vt).divideScalar(vtLen)); }
  const air = P.airT;
  P.pos.y = gi.h;

  let reason = null;
  if (upErr > (air < 0.25 ? 1.1 : 0.8 + GEAR.tol)) reason = upErr > 2.0 ? 'Landed on your head' : (fdn > 0 ? 'Backseat — tails first' : 'Nose dive');
  else if (!gi.rail && vtLen > 4 && Math.abs(yawDot) < 0.55) reason = 'Landed sideways';
  else if (vn > 11.5 + GEAR.impact + (gi.region === 'landing' ? 2.5 : 0)) reason = gi.region === 'landing' ? 'Landed too hard' : 'Cased the flat';
  if (reason) { crash(reason, n); return; }

  P.mode = 'ground';
  // a clean landing turns most of the air speed into speed down the slope
  const keep = 1 - 0.1 * (1 - Math.abs(yawDot)) - 0.04 * smooth(5, 14, vn);
  const landSpeed = Math.max(vtLen, P.vel.length() * 0.92) * keep;
  if (vtLen > 0.2) P.vel.copy(_vt).setLength(landSpeed);
  else P.vel.copy(_vt).multiplyScalar(keep);
  if (vtLen > 0.2) P.fwd.copy(_vt).normalize();
  else if (_bf.lengthSq() > 1e-4) P.fwd.copy(_bf);
  P.yawVis = Math.atan2(_tv2.crossVectors(P.fwd, _bf).dot(n), P.fwd.dot(_bf));
  const wasSw = P.sw;
  P.sw = Math.abs(P.yawVis) > Math.PI / 2;
  if (P.sw !== wasSw && air > 0.25) toast(P.sw ? 'Riding switch' : 'Back to regular', 'good', P.sw ? 'skiing backwards' : 'facing forward');
  P.up.copy(_bu);
  P.lastN.copy(n);
  P.popped = false; P.charge = 0; P.autoFlip = 0;
  if (air > 0.25) {
    P.landComp = clamp(vn / 7, 0.25, 1.4);
    burst(P.pos, Math.round(10 + vn * 4), 0.6 + vn * 0.08);
  }
  if ((air > 0.5 || P.launch.startsWith('kicker')) && air > 0.25 && !gi.rail) scoreTrick(air, yawDot < 0, vn);
  P.perfect = false;
  P.lastAir = Math.max(P.lastAir, air);
}

function scoreTrick(air, sw, vn) {
  const parts = [];
  const spinDeg = Math.round(Math.abs(P.spin) / Math.PI) * 180;
  const flips = Math.round(Math.abs(P.flip) / (Math.PI * 2));
  if (sw) parts.push('Switch');
  if (spinDeg >= 180) parts.push(String(spinDeg));
  if (flips) parts.push((flips === 2 ? 'Double ' : flips >= 3 ? 'Triple ' : '') + (P.flip < 0 ? 'front flip' : 'backflip'));
  const grabbed = P.grabT > 0.25;
  if (grabbed) parts.push(parts.length ? 'grab' : 'Grab');
  const clean = vn < (P.launch === 'kicker-XL' || P.launch === 'kicker-XXL' ? 10.5 : 8);
  let pts = air * 120 + spinDeg * 1.2 + flips * 500 + (grabbed ? 150 : 0);
  if (sw) pts *= 1.2;
  if (clean) pts *= 1.15;
  pts = Math.round(pts);
  P.score += pts;
  const coins = jumpCoins(P.launch, spinDeg, flips, grabbed, clean, P.perfect);
  addCoins(coins);
  const name = parts.length ? parts.join(' ') : 'Straight air';
  toast(name.charAt(0).toUpperCase() + name.slice(1), 'good', `${air.toFixed(1)} s air · +${pts}${clean ? ' · stomped' : ''} · +${coins} coins`);
}

/* ---------- crash: tumbling slide, then back up ---------- */
function crash(reason, n) {
  if (P.mode === 'air') P.crashQ.copy(P.q); else groundQuat(P.up, P.crashQ);
  if (P.onRail) P.onRail = null;
  P.mode = 'crash'; P.crashT = 0;
  const sp = P.vel.length();
  _tv.copy(P.vel); _tv.y = 0;
  if (_tv.lengthSq() < 1e-4) _tv.copy(P.fwd).setY(0);
  if (_tv.lengthSq() < 1e-6) _tv.set(0, 0, -1);
  _tv.normalize();
  P.crashW.crossVectors(_tv, UP).normalize().multiplyScalar(-clamp(sp * 0.45, 3, 11));
  P.crashW.y += (Math.random() - 0.5) * 5;
  const vdn = P.vel.dot(n);
  if (vdn < 0) P.vel.addScaledVector(n, -vdn * 0.75);
  P.vel.multiplyScalar(0.85);
  // pos now tracks the body's centre of mass
  _bu.set(0, 1, 0).applyQuaternion(P.crashQ);
  P.pos.addScaledVector(_bu, 0.8);
  burst(P.pos, 80, 1.4);
  P.charge = 0; P.popped = false; P.grab = 0; P.autoFlip = 0; P.perfect = false;
  toast(reason, 'bad', 'Wipeout');
}
function splash() {
  crash('Splash! Into the lake', UP);
  P.inLake = true;
  P.vel.multiplyScalar(0.3); P.vel.y = Math.min(0, P.vel.y) * 0.2;
  P.crashW.multiplyScalar(0.3);
  burst(P.pos, 140, 2.4);
}
function crashStep(dt) {
  if (!P.inLake && LAKE && P.pos.y <= LAKE.W + 0.3 && inLake(P.pos.x, P.pos.z)) {   // tumbled into the water
    P.inLake = true; P.crashT = 0; burst(P.pos, 90, 1.8); toast('Splash! Into the lake', 'bad', 'Wipeout');
  }
  if (P.inLake) {   // bob in the water, then get pulled out onto the landing
    P.crashT += dt;
    P.vel.multiplyScalar(Math.exp(-2.5 * dt));
    P.vel.y += (LAKE.W - 0.9 - P.pos.y) * 4 * dt;
    P.pos.addScaledVector(P.vel, dt);
    P.crashW.multiplyScalar(Math.exp(-2 * dt));
    const w = P.crashW.length();
    if (w > 1e-3) { _qa.setFromAxisAngle(_tv.copy(P.crashW).divideScalar(w), w * dt); P.crashQ.premultiply(_qa); }
    if (P.crashT > 2.2) {
      P.inLake = false;
      const f = LAKE.f, s2 = f.s0 + f.Lr + f.Lt + f.Ll * 0.55;
      P.pos.set(centerX(s2) + f.u, 0, -s2);
      recover();
      toast('Pulled out of the lake', 'good', 'Back on the landing');
    }
    return P.vel.length();
  }
  P.crashT += dt;
  P.vel.y -= G * dt;
  P.pos.addScaledVector(P.vel, dt);
  const gi = groundInfo(P.pos.x, P.pos.z, P.pos.y + 1, GI);
  const R = 0.32;
  if (P.pos.y < gi.h + R) {
    P.pos.y = gi.h + R;
    const vdn = P.vel.dot(gi.n);
    if (vdn < 0) {
      P.vel.addScaledVector(gi.n, -vdn * 1.3);
      if (vdn < -3) burst(P.pos, 18, 0.8);
    }
    P.vel.multiplyScalar(Math.exp(-1.7 * dt));
    P.crashW.multiplyScalar(Math.exp(-1.4 * dt));
    if (Math.random() < P.vel.length() * dt * 1.5) burst(P.pos, 3, 0.5);
  }
  const w = P.crashW.length();
  if (w > 1e-3) { _qa.setFromAxisAngle(_tv.copy(P.crashW).divideScalar(w), w * dt); P.crashQ.premultiply(_qa); }
  if ((P.crashT > 2.2 && P.vel.length() < 2.5) || P.crashT > 6) recover();
  return P.vel.length();
}
function recover() {
  P.mode = 'ground';
  P.pos.y = surfH(P.pos.x, P.pos.z);
  P.vel.set(0, 0, 0);
  courseDir(-P.pos.z, P.fwd);
  surfNormal(P.pos.x, P.pos.z, P.up);
  P.lastN.copy(P.up);
  P.yawVis = 0; P.sw = false; P.lean = 0; P.landComp = 0.9; P.comp = 0;
}

/* =========================================================
   Pose / animation
   ========================================================= */
const POSE = {
  stance: { hipH: 0.84, hipZ: 0.06, torso: 0.38, armX: 0.85, armZ: 0.3, fore: 0.95, pole: -0.45 },
  tuck:   { hipH: 0.57, hipZ: 0.17, torso: 1.12, armX: 2.05, armZ: 0.12, fore: 1.85, pole: -1.38 },
  brake:  { hipH: 0.77, hipZ: 0.1, torso: 0.45, armX: 0.7, armZ: 0.42, fore: 0.85, pole: -0.3 },
  crouch: { hipH: 0.58, hipZ: 0.13, torso: 0.9, armX: 1.2, armZ: 0.22, fore: 1.05, pole: -0.95 },
  air:    { hipH: 0.7, hipZ: 0.07, torso: 0.5, armX: 0.7, armZ: 0.95, fore: 0.5, pole: -0.55 },
  grab:   { hipH: 0.5, hipZ: 0.08, torso: 1.05, armX: 1.5, armZ: 0.28, fore: 0.3, pole: -1.25 },
  rail:   { hipH: 0.74, hipZ: 0.04, torso: 0.35, armX: 0.55, armZ: 0.95, fore: 0.55, pole: -0.5 },
  crash:  { hipH: 0.62, hipZ: 0.1, torso: 0.7, armX: 1.2, armZ: 1.2, fore: 1.2, pole: -0.4 },
};
const pose = { ...POSE.stance };
const Wt = { air: 0, rail: 0, crash: 0 };
const _tq = new THREE.Quaternion(), _off = new THREE.Vector3();
let animT = 0;
function animateSkier(dt, speed) {
  animT += dt;
  Wt.air = damp(Wt.air, P.mode === 'air' ? 1 : 0, 9, dt);
  Wt.rail = damp(Wt.rail, P.onRail ? 1 : 0, 10, dt);
  Wt.crash = damp(Wt.crash, P.mode === 'crash' ? 1 : 0, 8, dt);
  if (P.mode !== 'air') P.grab = damp(P.grab, 0, 8, dt);
  const ground = 1 - Wt.air;
  // the body is turned by yawVis; riding backwards the lean has to be mirrored to stay into the turn
  const lean = P.onRail ? P.lean : P.lean * Math.cos(P.yawVis);
  for (const k in pose) {
    let v = lerp(lerp(POSE.stance[k], POSE.tuck[k], P.tuck), POSE.brake[k], P.brake);
    v = lerp(v, POSE.crouch[k], P.charge * ground * (1 - Wt.rail));
    v = lerp(v, POSE.rail[k], Wt.rail);
    v = lerp(v, POSE.air[k], Wt.air);
    v = lerp(v, POSE.grab[k], P.grab * Wt.air);
    v = lerp(v, POSE.crash[k], Wt.crash);
    pose[k] = damp(pose[k], v, 12, dt);
  }
  const breathe = Math.sin(animT * 1.7) * 0.006 * (1 - Math.min(1, speed / 6)) * ground;
  // knees absorb terrain and landings
  const comp = clamp(P.comp, -0.8, 1.4) * 0.075 * ground + P.landComp * 0.27;

  // root placement
  if (P.mode === 'gondola') {
    _tq.copy(ride.skierQ);
    skier.root.position.copy(ride.skierPos);
  } else if (P.mode === 'crash') {
    _tq.copy(P.crashQ);
    _off.set(0, -0.8, 0).applyQuaternion(P.crashQ);
    skier.root.position.copy(P.pos).add(_off);
  } else {
    if (P.mode === 'air') _tq.copy(P.q); else groundQuat(P.up, _tq);
    skier.root.position.copy(P.pos);
  }
  if (P.mode === 'gondola') skier.root.quaternion.copy(_tq);
  else skier.root.quaternion.slerp(_tq, 1 - Math.exp(-(P.mode === 'crash' ? 30 : 22) * dt));
  skier.rig.rotation.z = lean * (1 - Wt.crash) * (BOARD ? 1.15 : 1);

  // skis: wedge when braking, pulled up under the body in the air, flailing in a crash
  const plow = BOARD ? 0 : P.brake * ground * (1 - Wt.rail) * (1 - Wt.crash);
  const lift = 0.16 * Wt.air + 0.1 * P.grab * Wt.air;
  const fl = BOARD ? 0 : Wt.crash;
  const halfStance = BOARD ? STANCE : 0.12;
  skier.board.position.y = BOARD ? lift : 0;
  skier.skiL.position.set(-halfStance - 0.2 * plow, lift, 0.02 * plow);
  skier.skiR.position.set(halfStance + 0.2 * plow, lift, 0.02 * plow);
  skier.skiL.rotation.set(Math.sin(animT * 8.1) * 0.45 * fl, -0.3 * plow + Math.sin(animT * 6.3) * 0.3 * fl, -0.22 * plow);
  skier.skiR.rotation.set(Math.sin(animT * 7.4 + 1) * 0.45 * fl, 0.3 * plow + Math.sin(animT * 5.7 + 2) * 0.3 * fl, 0.22 * plow);

  // pelvis + spine
  const torso = pose.torso + comp * 0.55 + Math.sin(animT * 5.1) * 0.5 * fl;
  skier.pelvis.position.set(0, Math.max(0.44, pose.hipH - comp + breathe), pose.hipZ + comp * 0.12);
  skier.pelvis.rotation.set(-torso * 0.45, 0, -lean * 0.15);
  skier.spine.rotation.set(-torso * 0.3, 0, -lean * 0.22 + Math.sin(animT * 4.3) * 0.25 * fl);
  const by = BOARD ? 1 : 0;   // snowboarder: shoulders open and head turned to look down the fall line
  skier.chest.rotation.set(-torso * 0.25 + breathe * 2, -0.4 * by, -lean * 0.15);
  skier.neck.rotation.set(torso * 0.8, -0.95 * by, lean * 0.3);

  solveLeg(skier.legL, skier.skiL);
  solveLeg(skier.legR, skier.skiR);

  // arms: inside hand drops in turns, windmill for balance in the air, flail in a crash
  const balance = Wt.air * (1 - P.grab);
  for (const arm of [skier.armL, skier.armR]) {
    const inside = arm.side * -Math.sign(lean || 1) > 0 ? 1 : -1;
    const turnK = Math.min(1, Math.abs(lean) * 1.6) * ground;
    const ph = arm.side * 1.7;
    const ax = pose.armX + inside * -0.15 * turnK
      + Math.sin(animT * 4.8 + ph) * 0.3 * balance
      + Math.sin(animT * 9 + ph) * 1.1 * fl;
    const az = pose.armZ + 0.35 * by + Math.sin(animT * 6.5 + ph) * 0.35 * balance + Math.sin(animT * 7.3 + ph) * 0.7 * fl;
    arm.shoulder.rotation.set(ax, 0, arm.side * az);
    arm.elbow.rotation.x = pose.fore + Math.sin(animT * 6 + ph) * 0.6 * fl;
    arm.hand.rotation.set(-0.2, 0, 0);
    const handPitch = -torso + ax + arm.elbow.rotation.x - 0.2;
    arm.pole.rotation.set(pose.pole - handPitch, 0, arm.side * (0.1 + 0.25 * balance));
  }
}

/* =========================================================
   Chase camera (follows down the pipe when inside it)
   ========================================================= */
const camState = { pos: new THREE.Vector3(), look: new THREE.Vector3(), dir: new THREE.Vector3(0, 0, -1), fov: 60, init: false };
const _cd = new THREE.Vector3(), _ct = new THREE.Vector3(), _cc = new THREE.Vector3();
function pipeWeight(s) { return smooth(PIPE.s0 - 10, PIPE.s0 + 15, s) * (1 - smooth(PIPE.s0 + PIPE.len - 15, PIPE.s0 + PIPE.len + 10, s)); }
function updateCamera(dt, speed, attract) {
  if (attract) {
    const a = animT * (storeOpen ? 0.22 : 0.16) + 2.4, rad = storeOpen ? 3.4 : 5.2;
    _ct.set(P.pos.x + Math.sin(a) * rad, 0, P.pos.z + Math.cos(a) * rad);
    _ct.y = Math.max(surfH(_ct.x, _ct.z) + 1.0, P.pos.y + 1.7);
    camera.position.copy(_ct);
    camState.look.set(P.pos.x, P.pos.y + 0.95, P.pos.z);
    camera.lookAt(camState.look);
    camState.init = false;
    return;
  }
  const s = -P.pos.z;
  _cd.set(P.vel.x, 0, P.vel.z);
  const hs = _cd.length();
  if (P.mode === 'crash' || hs < 1.2) _cd.copy(camState.dir);
  else {
    _cd.divideScalar(hs);
    if (P.mode === 'ground') { _cc.copy(P.fwd).setY(0); if (_cc.lengthSq() > 1e-4) _cd.lerp(_cc.normalize(), 0.3); }
  }
  const pw = pipeWeight(s);
  if (pw > 0) { courseDir(s, _cc); _cd.lerp(_cc, pw * 0.88); }
  _cd.y = 0; _cd.normalize();
  camState.dir.lerp(_cd, 1 - Math.exp(-3.2 * dt)).normalize();

  const dist = 5.0 + Math.min(speed, 40) * 0.055 + pw * 3;
  const height = 1.75 + Math.min(speed, 40) * 0.012;
  _ct.copy(P.pos).addScaledVector(camState.dir, -dist);
  let ty = P.pos.y + height;
  if (pw > 0) {
    // stay over the pipe floor, rising only partway with the rider
    const cs = -_ct.z, floor = heightAt(centerX(cs), -cs);
    _ct.x = lerp(_ct.x, centerX(cs) + (P.pos.x - centerX(s)) * 0.35, pw);
    ty = lerp(ty, floor + 3.8 + Math.max(0, P.pos.y - floor) * 0.45, pw);
  }
  _ct.y = Math.max(ty, surfH(_ct.x, _ct.z) + 1.1);
  if (!camState.init) { camState.pos.copy(_ct); camState.look.copy(P.pos); camState.init = true; }
  camState.pos.lerp(_ct, 1 - Math.exp(-(P.mode === 'air' ? 3.5 : 5) * dt));
  const gy = surfH(camState.pos.x, camState.pos.z) + 0.9;
  if (camState.pos.y < gy) camState.pos.y = gy;
  _ct.copy(P.pos).addScaledVector(camState.dir, 3.2 * (1 - pw * 0.6));
  _ct.y = P.pos.y + (P.mode === 'crash' ? 0.1 : 0.9);
  camState.look.lerp(_ct, 1 - Math.exp(-9 * dt));
  camera.position.copy(camState.pos);
  const sh = Math.max(0, speed - 18) * 0.0009 * (P.mode === 'ground' ? 1 : 0);
  camera.position.x += (Math.random() - 0.5) * sh; camera.position.y += (Math.random() - 0.5) * sh;
  camera.lookAt(camState.look);
  camState.fov = damp(camState.fov, 58 + Math.min(speed, 40) * 0.3, 2.5, dt);
  if (Math.abs(camera.fov - camState.fov) > 0.01) { camera.fov = camState.fov; camera.updateProjectionMatrix(); }
}

/* =========================================================
   Shadows follow the player (texel-snapped to stop shimmer)
   ========================================================= */
const _lightRot = new THREE.Matrix4().lookAt(sunDir, new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
const _lightInv = _lightRot.clone().invert();
const texel = (2 * SH) / SHADOW_SIZE;
const _sp = new THREE.Vector3();
function updateShadow() {
  _sp.copy(P.pos).applyMatrix4(_lightInv);
  _sp.x = Math.round(_sp.x / texel) * texel;
  _sp.y = Math.round(_sp.y / texel) * texel;
  _sp.applyMatrix4(_lightRot);
  sun.target.position.copy(_sp);
  sun.position.copy(_sp).addScaledVector(sunDir, 260);
  sun.target.updateMatrixWorld();
}

/* =========================================================
   Spray emission
   ========================================================= */
const _ep = new THREE.Vector3(), _ev = new THREE.Vector3();
function emitSpray(dt, speed) {
  if (speed < 2) return;
  const turn = Math.abs(P.steer);
  const rate = speed * (0.6 + turn * 7 + P.brake * 14);
  let count = rate * dt;
  const out = Math.sign(P.steer || 0.0001);
  while (count > 0) {
    if (count < 1 && Math.random() > count) break;
    count -= 1;
    const side = Math.random() < 0.5 ? -1 : 1;
    _ep.copy(P.pos)
      .addScaledVector(P.right, side * 0.12 + out * 0.05)
      .addScaledVector(P.fwd, -0.2 - Math.random() * 0.6);
    _ep.addScaledVector(P.up, 0.03);
    _ev.copy(P.vel).multiplyScalar(0.35 + Math.random() * 0.2)
      .addScaledVector(P.right, out * (turn * 0.18 + P.brake * 0.25) * speed * (0.5 + Math.random()))
      .addScaledVector(P.up, 0.6 + Math.random() * (1.2 + turn * 1.5 + P.brake * 1.2));
    _ev.x += (Math.random() - 0.5) * 1.2; _ev.z += (Math.random() - 0.5) * 1.2;
    spray.emit(_ep, _ev, 0.12 + Math.random() * 0.22 + P.brake * 0.15, 0.45 + Math.random() * 0.7);
  }
}
// Radial puff of snow (landings, crashes)
function burst(p, count, power) {
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random();
    _ep.set(p.x + Math.cos(a) * r * 0.5, p.y + 0.05, p.z + Math.sin(a) * r * 0.5);
    _ev.set(Math.cos(a) * (1 + Math.random() * 3) * power, (1 + Math.random() * 2.5) * power, Math.sin(a) * (1 + Math.random() * 3) * power);
    _ev.addScaledVector(P.vel, 0.3);
    spray.emit(_ep, _ev, 0.2 + Math.random() * 0.35, 0.6 + Math.random() * 0.7);
  }
}

/* =========================================================
   World build + LOD
   ========================================================= */
/* =========================================================
   Park meshes: groomed snow features, dye lines, rails, boxes, flags, banner
   ========================================================= */
const parkMat = snowMat.clone();
parkMat.polygonOffset = true; parkMat.polygonOffsetFactor = -2; parkMat.polygonOffsetUnits = -2;
const SNOW_C = [0.87, 0.9, 0.96], DYE_C = [0.03, 0.17, 0.62];
function rangeList(a, b, step, extra = []) {
  const out = [];
  for (let x = a; x < b; x += step) out.push(+x.toFixed(4));
  out.push(+b.toFixed(4));
  for (const e of extra) out.push(+e.toFixed(4));
  return [...new Set(out)].sort((p, q) => p - q);
}
function featureMesh(f, us, vs, colorFn) {
  const nu = us.length, nv = vs.length;
  const pos = new Float32Array(nu * nv * 3), col = new Float32Array(nu * nv * 3), uv = new Float32Array(nu * nv * 2);
  for (let j = 0; j < nv; j++) {
    const v = vs[j], s = f.s0 + v, cx = centerX(s), z = -s;
    for (let i = 0; i < nu; i++) {
      const u = us[i], x = cx + f.u + u;
      const b = bumpOf(f, u, v), region = BS.region;
      const k = j * nu + i;
      pos[k * 3] = x; pos[k * 3 + 1] = heightAt(x, z) + b + 0.04; pos[k * 3 + 2] = z;
      const c = colorFn(u, v, b, region);
      col[k * 3] = c[0]; col[k * 3 + 1] = c[1]; col[k * 3 + 2] = c[2];
      uv[k * 2] = x / 6; uv[k * 2 + 1] = z / 6;
    }
  }
  const idx = [];
  for (let j = 0; j < nv - 1; j++) for (let i = 0; i < nu - 1; i++) {
    const a = j * nu + i, b = a + 1, c = a + nu, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, parkMat);
  m.castShadow = true; m.receiveShadow = true;
  world.add(m);
  return m;
}
const railMat = new THREE.MeshStandardMaterial({ color: 0xd3d9e0, metalness: 1, roughness: 0.22 });
const paintMat = new THREE.MeshStandardMaterial({ color: 0xff6a3d, roughness: 0.45 });
const boxTopMat = new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.3 });
const boxSideMat = new THREE.MeshStandardMaterial({ color: 0x1f4fa8, roughness: 0.5 });
const flagMat = new THREE.MeshStandardMaterial({ color: 0xff5a2c, roughness: 0.7, side: THREE.DoubleSide });
const woodMat = new THREE.MeshStandardMaterial({ color: 0x5a3b22, roughness: 0.85 });
function shadowed(m) { m.castShadow = true; m.receiveShadow = true; return m; }
function addFlag(x, z) {
  const y = heightAt(x, z);
  const pole = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 2.4, 8), paintMat));
  pole.position.set(x, y + 1.1, z);
  const flag = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.36), flagMat));
  flag.position.set(x + 0.28, y + 2.1, z);
  flag.rotation.y = 0.5;
  world.add(pole, flag);
}
function buildRailMesh(r) {
  const L = r.A.distanceTo(r.B);
  const mid = r.A.clone().add(r.B).multiplyScalar(0.5);
  const n = railNormal(r, new THREE.Vector3());
  if (r.kind === 'rail') {
    const tube = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, L, 16), railMat));
    tube.position.copy(mid).addScaledVector(n, -0.038);
    tube.quaternion.setFromUnitVectors(UP, r.dir);
    world.add(tube);
    for (const end of [r.A, r.B]) {
      const cap = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), railMat));
      cap.position.copy(end).addScaledVector(n, -0.038);
      world.add(cap);
    }
  } else {
    const box = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.6, L), [boxSideMat, boxSideMat, boxTopMat, boxSideMat, boxSideMat, boxSideMat]));
    box.position.copy(mid).addScaledVector(n, -0.3);
    box.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, -1), r.dir);
    world.add(box);
    // painted edge trim on the top
    for (const sx of [-1, 1]) {
      const trim = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, L), paintMat));
      trim.position.copy(box.position).addScaledVector(n, 0.3);
      trim.quaternion.copy(box.quaternion);
      trim.translateX(sx * 0.24);
      world.add(trim);
    }
  }
  if (r.kind === 'rail') {
    for (const t of [0.12, 0.5, 0.88]) {
      const p = r.A.clone().lerp(r.B, t);
      const gy = heightAt(p.x, p.z);
      const h = p.y - 0.07 - (gy - 0.3);
      const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, h, 10), paintMat));
      post.position.set(p.x, gy - 0.3 + h / 2, p.z);
      world.add(post);
    }
  }
}
function buildBanner() {
  const s = PARK_START - 12, cx = centerX(s), z = -s;
  const span = 26;
  for (const sx of [-1, 1]) {
    const x = cx + sx * span / 2, y = heightAt(x, z);
    const post = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6, 10), woodMat));
    post.position.set(x, y + 2.7, z);
    world.add(post);
  }
  const c = document.createElement('canvas'); c.width = 1024; c.height = 96;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ff5a2c'; ctx.fillRect(0, 0, 1024, 96);
  ctx.fillStyle = '#10213a'; ctx.fillRect(0, 0, 1024, 8); ctx.fillRect(0, 88, 1024, 8);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 58px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(T.banner, 512, 50);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const banMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8, side: THREE.DoubleSide });
  banMat.userData.perWorld = true;
  const ban = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(span, span * 96 / 1024), banMat));
  ban.position.set(cx, Math.max(heightAt(cx - span / 2, z), heightAt(cx + span / 2, z)) + 5.0, z);
  world.add(ban);
}
function buildLake() {
  const f = LAKE.f, s = LAKE.cs, cx = centerX(s) + LAKE.u, cz = -s;
  const yaw = Math.atan2(centerX(s - 2) - centerX(s + 2), -4);
  const wn = snowTex.normal.clone(); wn.needsUpdate = true; wn.repeat.set(5, 5);
  const mat = new THREE.MeshPhysicalMaterial({ color: 0x1b5a74, roughness: 0.05, metalness: 0, normalMap: wn, normalScale: new THREE.Vector2(0.3, 0.3),
    transparent: true, opacity: 0.93, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.3 });
  mat.userData.perWorld = true;
  const water = new THREE.Mesh(new THREE.CircleGeometry(1, 72), mat);
  water.rotation.x = -Math.PI / 2;
  const grp = new THREE.Group(); grp.position.set(cx, LAKE.W, cz); grp.rotation.y = yaw; grp.scale.set(LAKE.au, 1, LAKE.as);
  water.receiveShadow = true; grp.add(water);
  const iceMat = new THREE.MeshStandardMaterial({ color: 0xeaf4fb, roughness: 0.35, transparent: true, opacity: 0.92 });
  iceMat.userData.perWorld = true;
  const ice = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.02, 72, 1), iceMat);
  ice.rotation.x = -Math.PI / 2; ice.position.y = 0.03; ice.receiveShadow = true; grp.add(ice);
  world.add(grp);
  LAKE.mat = mat;
}
function buildPark() {
  for (const f of FEATURES) {
    if (f.kind === 'kicker') {
      const edge = f.w / 2;
      const us = f.cut ? rangeList(-f.reach, f.reach, 0.15, [-edge, edge, -edge - 0.12, edge + 0.12]) : rangeList(-f.reach, f.reach, 0.3);
      const vs = rangeList(-0.6, f.len + 0.6, f.cut ? 0.2 : 0.25, [f.Lr - 0.002, f.Lr, f.Lr + f.Lt]);
      featureMesh(f, us, vs, (u, v, b, region) => {
        if (f.cut) {
          const au = Math.abs(u);
          if (au > edge + 0.02 && b > 0.05) {   // shovel-cut sidewall: cooler, with vertical tool marks
            const m = 0.035 * Math.sin(v * 5.3 + au * 2) + 0.02 * Math.sin(v * 17.1);
            return [0.80 + m, 0.85 + m, 0.94 + m];
          }
          const cord = b > 0.05 || v < 0 ? 0.022 * Math.sin(u * Math.PI * 2 / 0.6) : 0;   // groomer corduroy
          const lip = region === 'ramp' && v > f.Lr - 0.25 ? 0.03 : 0;
          return [SNOW_C[0] + cord + lip, SNOW_C[1] + cord + lip, SNOW_C[2] + cord * 0.5 + lip];
        }
        const dye = b > 0.08 && ((v > f.Lr - 0.45 && v <= f.Lr) || (v > f.Lr + f.Lt - 0.15 && v < f.Lr + f.Lt + 0.35));
        return dye ? DYE_C : SNOW_C;
      });
      const s = f.s0 + f.Lr;
      for (const sx of [-1, 1]) addFlag(centerX(s) + f.u + sx * (f.w / 2 + 1.6), -s);
    } else if (f.kind === 'ramp') {
      const us = rangeList(-f.reach, f.reach, 0.15);
      const vs = rangeList(-0.4, f.Lr, 0.15, [f.Lr - 0.001]);
      featureMesh(f, us, vs, () => SNOW_C);
    } else if (f.kind === 'pipe') {
      const half = [...rangeList(0, PF, 0.6), ...rangeList(PF, PF + PWMAX, 0.1), PF + PWMAX + 0.03, ...rangeList(PF + PWMAX + 0.06, PF + PWMAX + 0.03 + PDECK, 0.4), ...rangeList(PF + PWMAX + 0.03 + PDECK + 0.5, PIPE_HALF, 0.6)];
      const hs = [...new Set(half.map((v) => +v.toFixed(4)))].sort((a, b) => a - b);
      const us = [...hs.slice(1).reverse().map((v) => -v), ...hs];
      const vs = rangeList(0, f.len, 0.8);
      featureMesh(f, us, vs, (u, v, b) => {
        const w = Math.abs(u) - PF;
        return (b > 1 && w > PWMAX - 0.5 && w < PWMAX + 0.08) ? DYE_C : SNOW_C;
      });
    }
  }
  for (const r of RAILS) buildRailMesh(r);
  if (T.park && T.banner) buildBanner();
  if (LAKE) buildLake();
}

/* =========================================================
   Gondola: line, towers, stations, cabins and the ride back up
   ========================================================= */
// Line runs beside the piste from a valley station below the finish to a top station beside the start.
// Tower heights are raised until every cabin clears the snow by at least CLEAR metres.
let LIFT = null;
function makeLift() {
  const OFF = 58, sBot = RUN + 40, sTop = -30, SPAN = 175, CAB = 4.9, CLEAR = 4.5, STATION_H = 5.9, GAP = 3, SUB = 18;
  // a tower close to each station lifts the cable off the steep ground at the platforms, then even spans
  const NEAR = 45, inner = Math.ceil((sBot - sTop - 2 * NEAR) / SPAN);
  const ss = [sBot];
  for (let k = 0; k <= inner; k++) ss.push(sBot - NEAR - (sBot - sTop - 2 * NEAR) * k / inner);
  ss.push(sTop);
  const n = ss.length - 1;
  const pts = ss.map((s, k) => {
    const x = centerX(s) + OFF, z = -s;
    const station = k === 0 || k === n;
    return { s, x, z, g: heightAt(x, z), h: station ? STATION_H : 14, station };
  });
  for (let it = 0; it < 10; it++) {
    let changed = false;
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z), sag = len * 0.012;
      let worst = 0;
      for (let t = 0.02; t < 0.999; t += 0.02) {
        const d = t * len;
        if ((a.station && d < 24) || (b.station && len - d < 24)) continue;
        const x = lerp(a.x, b.x, t), z = lerp(a.z, b.z, t);
        const y = lerp(a.g + a.h, b.g + b.h, t) - sag * 4 * t * (1 - t);
        for (const off of [-GAP, GAP]) worst = Math.max(worst, heightAt(x + off, z) + CLEAR + CAB - y);
      }
      if (worst > 0.05) {
        changed = true;
        if (!a.station) a.h = Math.min(60, a.h + worst * (b.station ? 2.2 : 1.1));
        if (!b.station) b.h = Math.min(60, b.h + worst * (a.station ? 2.2 : 1.1));
      }
    }
    if (!changed) break;
  }
  for (let k = 0; k <= n; k++) {
    const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n, k + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
    pts[k].dir = new THREE.Vector3(dx / l, 0, dz / l);      // bottom -> top
    pts[k].lat = new THREE.Vector3(dz / l, 0, -dx / l);     // away from the piste
  }
  function line(sgn) {
    const P = [], cum = [0];
    for (let k = 0; k < n; k++) {
      const a = pts[k], b = pts[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z), sag = len * 0.012;
      for (let j = 0; j < SUB; j++) {
        const t = j / SUB;
        const lat = a.lat.clone().lerp(b.lat, t).normalize();
        P.push(new THREE.Vector3(lerp(a.x, b.x, t), lerp(a.g + a.h, b.g + b.h, t) - sag * 4 * t * (1 - t), lerp(a.z, b.z, t)).addScaledVector(lat, GAP * sgn));
      }
    }
    const e = pts[n];
    P.push(new THREE.Vector3(e.x, e.g + e.h, e.z).addScaledVector(e.lat, GAP * sgn));
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + P[i].distanceTo(P[i - 1]));
    return { P, cum, L: cum[cum.length - 1] };
  }
  const up = line(-1), down = line(1);   // uphill cabins ride on the piste side
  const altOf = (y) => START_ALT + (y - heightAt(centerX(0), 0));
  return { OFF, sBot, sTop, n, pts, up, down, CAB, GAP, LOOP: up.L + down.L, altOf };
}

function linePos(line, u, out, tan) {
  const { P, cum, L } = line;
  u = clamp(u, 0, L);
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= u) lo = m; else hi = m; }
  const t = (u - cum[lo]) / Math.max(1e-6, cum[hi] - cum[lo]);
  out.copy(P[lo]).lerp(P[hi], t);
  if (tan) tan.copy(P[hi]).sub(P[lo]).normalize();
  return out;
}
// Keeps trees and rocks out of the lift corridor and the station footprints
function liftNear(x, s, r) {
  if (s < LIFT.sTop - 18 || s > LIFT.sBot + 18) return false;
  const pts = LIFT.pts;
  let k = 0;
  while (k < LIFT.n - 1 && pts[k + 1].s > s) k++;
  const t = clamp((pts[k].s - s) / (pts[k].s - pts[k + 1].s), 0, 1);
  const lx = lerp(pts[k].x, pts[k + 1].x, t);
  if (Math.abs(s - LIFT.sBot) < 16 || Math.abs(s - LIFT.sTop) < 16) r = Math.max(r, 14);
  return Math.abs(x - lx) < r;
}

const GMAT = {
  body: new THREE.MeshPhysicalMaterial({ color: 0xa5161f, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08 }),
  glass: new THREE.MeshPhysicalMaterial({ color: 0x1d2a36, roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.3, envMapIntensity: 1.4, depthWrite: false }),
  steel: new THREE.MeshStandardMaterial({ color: 0x8c949d, metalness: 0.9, roughness: 0.38 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x23272c, roughness: 0.6, metalness: 0.3 }),
  white: new THREE.MeshStandardMaterial({ color: 0xf1f1ec, roughness: 0.45 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.95 }),
};
const CABIN_MATS = [GMAT.body, GMAT.glass, GMAT.steel, GMAT.dark, GMAT.white];
const nonIdx = (g) => (g.index ? g.toNonIndexed() : g);

// Cabin in grip-local space: origin on the cable, cabin hanging below (floor at y = -4.9)
function cabinGeometry() {
  const by = [[], [], [], [], []];
  const put = (mi, g, x, y, z, rx = 0, ry = 0, rz = 0) => {
    if (rx) g.rotateX(rx); if (ry) g.rotateY(ry); if (rz) g.rotateZ(rz);
    g.translate(x, y, z); by[mi].push(nonIdx(g));
  };
  put(0, new RoundedBoxGeometry(2.2, 0.95, 2.0, 3, 0.12), 0, -4.425, 0);
  put(0, new RoundedBoxGeometry(2.24, 0.28, 2.04, 3, 0.1), 0, -2.45, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) put(0, new THREE.BoxGeometry(0.1, 1.32, 0.1), sx * 1.05, -3.25, sz * 0.95);
  for (const sz of [-1, 1]) put(0, new THREE.BoxGeometry(0.08, 1.32, 0.06), 0, -3.25, sz * 0.97);
  put(1, new THREE.BoxGeometry(2.12, 1.32, 1.92), 0, -3.25, 0);
  put(2, new THREE.CylinderGeometry(0.05, 0.05, 2.25, 8), 0, -1.2, 0);
  put(2, new THREE.BoxGeometry(1.5, 0.08, 0.1), 0, -2.28, 0);
  put(2, new THREE.BoxGeometry(0.08, 0.08, 1.4), 0, -2.28, 0);
  put(3, new THREE.BoxGeometry(0.3, 0.3, 0.62), 0, 0, 0);
  for (const sz of [-1, 1]) put(3, new THREE.CylinderGeometry(0.11, 0.11, 0.07, 14), 0, 0.14, sz * 0.2, 0, 0, Math.PI / 2);
  put(3, new RoundedBoxGeometry(2.22, 0.12, 2.02, 2, 0.05), 0, -4.86, 0);
  put(4, new THREE.BoxGeometry(2.23, 0.1, 2.03), 0, -4.2, 0);
  const g = mergeGeometries(by.map((list) => mergeGeometries(list, false)), true);
  g.computeBoundingSphere();
  return g;
}

function buildTowers() {
  const byMat = { steel: [], dark: [], concrete: [] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  for (let k = 1; k < LIFT.n; k++) {
    const t = LIFT.pts[k], h = t.h, parts = [];
    const loc = (key, g, x, y, z) => { g.translate(x, y, z); parts.push([key, g]); };
    loc('concrete', new THREE.BoxGeometry(2.6, 1.8, 2.6), 0, -0.3, 0);
    loc('steel', new THREE.CylinderGeometry(0.36, 0.6, h + 0.5, 10), 0, h / 2 - 0.25, 0);
    loc('steel', new THREE.BoxGeometry(1.0, 1.0, 1.0), 0, h - 0.55, 0);
    loc('steel', new THREE.BoxGeometry(2 * LIFT.GAP + 1.4, 0.44, 0.52), 0, h - 0.62, 0);
    for (let r = 2; r < h - 2; r += 0.45) loc('dark', new THREE.BoxGeometry(0.34, 0.035, 0.035), 0, r, 0.68);
    for (const sx of [-1, 1]) {
      loc('dark', new THREE.BoxGeometry(0.06, h - 3.6, 0.06), sx * 0.17, h / 2, 0.68);
      loc('dark', new THREE.BoxGeometry(0.34, 0.3, 3.4), sx * LIFT.GAP, h - 0.24, 0);
      for (const sz of [-1.25, -0.42, 0.42, 1.25]) {
        const w = new THREE.CylinderGeometry(0.17, 0.17, 0.12, 12); w.rotateZ(Math.PI / 2);
        loc('dark', w, sx * LIFT.GAP, h - 0.15, sz);
      }
      loc('steel', new THREE.BoxGeometry(0.9, 0.05, 3.8), sx * (LIFT.GAP + 0.9), h - 0.85, 0);
    }
    q.setFromAxisAngle(UP, Math.atan2(t.dir.x, t.dir.z));
    m4.compose(p.set(t.x, t.g, t.z), q, one);
    for (const [key, g] of parts) { g.applyMatrix4(m4); byMat[key].push(nonIdx(g)); }
  }
  for (const key of Object.keys(byMat)) {
    const mesh = new THREE.Mesh(mergeGeometries(byMat[key], false), GMAT[key]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    world.add(mesh);
  }
}

function stationSign(text) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 96;
  const x = c.getContext('2d');
  x.fillStyle = '#a5161f'; x.fillRect(0, 0, 1024, 96);
  x.fillStyle = '#f1f1ec'; x.fillRect(0, 0, 1024, 6); x.fillRect(0, 90, 1024, 6);
  x.font = '700 54px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillText(text, 512, 50);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  const m = new THREE.MeshStandardMaterial({ map: t, roughness: 0.7 });
  m.userData.perWorld = true;
  return m;
}
function buildStation(t, label) {
  const grp = new THREE.Group();
  grp.position.set(t.x, t.g, t.z);
  grp.rotation.y = Math.atan2(t.dir.x, t.dir.z);
  world.add(grp);
  const c = t.h, top = 1.0;
  let minH = 0;
  const v = new THREE.Vector3();
  for (const sx of [-7, 0, 7]) for (const sz of [-10, 0, 10]) {
    v.set(sx, 0, sz).applyAxisAngle(UP, grp.rotation.y);
    minH = Math.min(minH, heightAt(t.x + v.x, t.z + v.z) - t.g);
  }
  const bottom = minH - 2.5;
  const mk = (geo, mat, x, y, z) => { const m = shadowed(new THREE.Mesh(geo, mat)); m.position.set(x, y, z); grp.add(m); return m; };
  mk(new THREE.BoxGeometry(14, top - bottom, 20), GMAT.concrete, 0, (top + bottom) / 2, 0);
  mk(new THREE.BoxGeometry(14.2, 0.12, 20.2), GMAT.dark, 0, top + 0.02, 0);
  const pillarH = c + 3.4 - top;
  for (const sx of [-6.2, 6.2]) for (const sz of [-9.2, 9.2]) mk(new THREE.CylinderGeometry(0.22, 0.26, pillarH, 10), GMAT.steel, sx, top + pillarH / 2, sz);
  mk(new THREE.BoxGeometry(15, 0.5, 21), GMAT.dark, 0, c + 3.6, 0);
  mk(new THREE.BoxGeometry(15.2, 0.3, 21.2), GMAT.white, 0, c + 3.95, 0);
  const signMat = stationSign(label);
  for (const sz of [-1, 1]) {
    mk(new THREE.BoxGeometry(15, 1.3, 0.25), GMAT.body, 0, c + 3.0, sz * 10.4);
    const s = mk(new THREE.PlaneGeometry(14.6, 1.2), signMat, 0, c + 3.0, sz * 10.54);
    s.rotation.y = sz > 0 ? 0 : Math.PI;
    s.castShadow = false;
  }
  mk(new THREE.BoxGeometry(2.4, 2.6, 2.4), GMAT.white, 0, c + 1.95, 0);
  for (const sx of [-1, 1]) mk(new THREE.BoxGeometry(0.14, 0.14, 17), GMAT.steel, sx * LIFT.GAP, c + 0.3, 0);
  const wheel = new THREE.Group(); wheel.position.set(0, c, 0); grp.add(wheel);
  const rim = shadowed(new THREE.Mesh(new THREE.TorusGeometry(LIFT.GAP, 0.16, 8, 48), GMAT.steel)); rim.rotation.x = Math.PI / 2; wheel.add(rim);
  for (let i = 0; i < 4; i++) { const sp = shadowed(new THREE.Mesh(new THREE.BoxGeometry(2 * LIFT.GAP, 0.12, 0.14), GMAT.dark)); sp.rotation.y = i * Math.PI / 4; wheel.add(sp); }
  wheel.add(shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.6, 16), GMAT.dark)));
  return wheel;
}

const GOND = { v: 42, N: 22, w: 0, t: 0, deco: null, player: null, wheels: [] };
function buildLift() {
  GOND.wheels = [];
  buildTowers();
  for (const line of [LIFT.up, LIFT.down]) {
    const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(line.P, false, 'centripetal'), line.P.length * 2, 0.045, 5, false);
    world.add(new THREE.Mesh(g, GMAT.dark));
  }
  const bot = LIFT.pts[0], tp = LIFT.pts[LIFT.n];
  const fmtAlt = (p) => nf.format(Math.round(LIFT.altOf(p.g)));
  GOND.wheels.push(buildStation(bot, `GONDOLA  ·  VALLEY STATION  ·  ${fmtAlt(bot)} m`));
  GOND.wheels.push(buildStation(tp, `GONDOLA  ·  TOP STATION  ·  ${fmtAlt(tp)} m`));
  const geo = cabinGeometry();
  GOND.deco = new THREE.InstancedMesh(geo, CABIN_MATS, GOND.N);
  GOND.deco.castShadow = true; GOND.deco.receiveShadow = true;
  GOND.deco.frustumCulled = false;   // cabins travel the whole valley
  world.add(GOND.deco);
  // the rider's own cabin, with their skis in the outside rack
  const pc = new THREE.Group();
  const shell = new THREE.Mesh(geo, CABIN_MATS); shell.castShadow = true; shell.receiveShadow = true; pc.add(shell);
  const M = skier.M, skiMats = [M.skiEdge, M.skiEdge, M.skiTop, M.skiBase, M.skiEdge, M.skiEdge];
  for (const sz of [-0.13, 0.13]) {
    const ski = new THREE.Mesh(skiGeometry(), skiMats);
    ski.rotation.set(0, 0, 0);
    ski.geometry.rotateX(Math.PI / 2); ski.geometry.rotateY(Math.PI / 2);
    ski.position.set(1.17, -3.75, sz);
    ski.castShadow = true;
    pc.add(ski);
  }
  for (const y of [-4.3, -3.0]) { const bar = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.8), GMAT.steel)); bar.position.set(1.15, y, 0); pc.add(bar); }
  pc.visible = false;
  world.add(pc);
  GOND.player = pc;
}

const _cpTan = new THREE.Vector3(), _cpX = new THREE.Vector3(), _cpZ = new THREE.Vector3(), _cpB = new THREE.Matrix4(), _cpSw = new THREE.Quaternion(), _cpE = new THREE.Euler();
const _one = new THREE.Vector3(1, 1, 1), _cm = new THREE.Matrix4(), _cpos = new THREE.Vector3(), _cq = new THREE.Quaternion();
// Loop position w: [0, up.L) climbs the uphill line, the rest descends the downhill line
function cabinPose(w, pos, quat, phase) {
  const U = LIFT.up.L, LOOP = LIFT.LOOP;
  w = ((w % LOOP) + LOOP) % LOOP;
  if (w < U) linePos(LIFT.up, w, pos, _cpTan);
  else { linePos(LIFT.down, LIFT.down.L - (w - U), pos, _cpTan); _cpTan.negate(); }
  _cpTan.y = 0;
  if (_cpTan.lengthSq() < 1e-6) _cpTan.set(0, 0, 1);
  _cpTan.normalize();
  _cpZ.copy(_cpTan).negate();
  _cpX.crossVectors(UP, _cpZ).normalize();
  _cpB.makeBasis(_cpX, UP, _cpZ);
  quat.setFromRotationMatrix(_cpB);
  _cpE.set(Math.sin(GOND.t * 0.9 + phase) * 0.025, 0, Math.sin(GOND.t * 1.3 + phase * 1.7) * 0.02);
  return quat.multiply(_cpSw.setFromEuler(_cpE));
}
function updateLift(dt) {
  if (!GOND.deco) return;
  GOND.t += dt;
  GOND.w += GOND.v * dt;
  const D = LIFT.LOOP / GOND.N;
  for (let i = 0; i < GOND.N; i++) {
    cabinPose(GOND.w + i * D, _cpos, _cq, i * 1.37);
    GOND.deco.setMatrixAt(i, _cm.compose(_cpos, _cq, _one));
  }
  GOND.deco.instanceMatrix.needsUpdate = true;
  for (const w of GOND.wheels) w.rotation.y += (GOND.v / LIFT.GAP) * dt;
}

/* ---------- the ride ---------- */
const ride = { active: false, u: 0, uiT: 0, camA: 0, cabPos: new THREE.Vector3(), cabQ: new THREE.Quaternion(), skierPos: new THREE.Vector3(), skierQ: new THREE.Quaternion() };
const _yaw180 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
let gearOn = true;
function setSkierGear(on) {
  gearOn = on;
  for (const sg of [skier.skiL, skier.skiR]) for (const c of sg.children) if (c !== sg.userData.boot) c.visible = on && !BOARD;
  skier.armL.pole.visible = on && !BOARD; skier.armR.pole.visible = on && !BOARD;
  skier.board.visible = on && BOARD;
}
function setBoardMode(on) {
  BOARD = on;
  skier.rig.rotation.order = 'ZYX';           // roll about the travel axis after the sideways stance
  skier.rig.rotation.y = on ? Math.PI / 2 : 0;
  setSkierGear(gearOn);
  SHOP.skis.label = on ? 'Boards' : 'Skis';
  const b = $('modeBtn');
  if (b) { b.textContent = on ? 'Switch to skis' : 'Switch to snowboard'; b.setAttribute('aria-pressed', String(on)); }
}
function startGondola() {
  if (ride.active) return;
  $('finish').hidden = true; $('hud').hidden = true; $('touch').hidden = true;
  ride.active = true; ride.u = 0; ride.uiT = 0; ride.camA = 2.3;
  GOND.w = (LIFT.LOOP / GOND.N) / 2;   // other cabins sit halfway between ours
  P.running = false; P.mode = 'gondola';
  P.vel.set(0, 0, 0);
  Object.assign(P, { tuck: 0, brake: 0, charge: 0, lean: 0, comp: 0, landComp: 0, grab: 0, steer: 0 });
  setSkierGear(false);
  GOND.player.visible = true;
  updateRide(0);
  skier.root.quaternion.copy(ride.skierQ);
  $('ride').hidden = false;
  $('skipRide').focus();
}
function updateRide(dt) {
  const L = LIFT.up.L;
  const ease = clamp(Math.min(ride.u + 6, L - ride.u + 6) / 70, 0.12, 1);
  ride.u = Math.min(L, ride.u + GOND.v * ease * dt);
  cabinPose(ride.u, ride.cabPos, ride.cabQ, 0.7);
  GOND.player.position.copy(ride.cabPos);
  GOND.player.quaternion.copy(ride.cabQ);
  // the rider stands near the uphill window, looking back down the valley
  ride.skierPos.set(0, -4.83, -0.28).applyQuaternion(ride.cabQ).add(ride.cabPos);
  ride.skierQ.copy(ride.cabQ).multiply(_yaw180);
  P.pos.copy(ride.skierPos);
  ride.uiT -= dt;
  if (ride.uiT <= 0) {
    ride.uiT = 0.1;
    const left = (L - ride.u) / GOND.v;
    $('rideLeft').textContent = left > 1 ? `${fmtClock(left)} to the top` : 'Arriving';
    $('rideProg').style.width = `${(ride.u / L) * 100}%`;
    $('rideAlt').textContent = `${nf.format(Math.round(LIFT.altOf(ride.cabPos.y - LIFT.CAB)))} m`;
  }
  if (ride.u >= L - 0.01) arriveTop();
}
const fmtClock = (t) => { const s = Math.ceil(t), m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
function endRide() {
  ride.active = false;
  $('ride').hidden = true;
  if (GOND.player) GOND.player.visible = false;
  setSkierGear(true);
  if (P.mode === 'gondola') P.mode = 'ground';
}
function arriveTop() {
  endRide();
  $('finish').hidden = true;
  resetPlayer();
  P.running = true;
  $('hud').hidden = false;
  if (isCoarse) $('touch').hidden = false;
  toast('Top station', 'good', 'Drop in when you are ready');
}
function skipRide() { if (ride.active) arriveTop(); }
const _rc = new THREE.Vector3(), _rt = new THREE.Vector3();
function updateRideCamera(dt) {
  const turn = ((keys.has('d') || keys.has('arrowright')) ? 1 : 0) - ((keys.has('a') || keys.has('arrowleft')) ? 1 : 0);
  ride.camA += dt * (0.09 + turn * 1.1);
  _rt.copy(ride.cabPos); _rt.y -= 3.4;
  const dist = 12.5;
  _rc.set(_rt.x + Math.sin(ride.camA) * dist, _rt.y + 2.2 + Math.sin(ride.camA * 0.6) * 1.2, _rt.z + Math.cos(ride.camA) * dist);
  _rc.y = Math.max(_rc.y, surfH(_rc.x, _rc.z) + 2);
  camera.position.copy(_rc);
  camera.lookAt(_rt);
  if (Math.abs(camera.fov - 55) > 0.01) { camera.fov = damp(camera.fov, 55, 3, dt); camera.updateProjectionMatrix(); }
  camState.fov = camera.fov;
}

function buildWorld() {
  NCH = Math.ceil((Z_START + RUN + 140) / CHUNK);
  LIFT = makeLift();
  buildPark();
  buildLift();
  buildBackdrop();
  for (let i = 0; i < NCH; i++) {
    const ch = buildTerrainChunk(i);
    populateChunk(ch, i);
    chunks.push(ch);
  }
}
// Tear down the current trail's meshes (shared tree and rock shapes are kept)
function disposeWorld() {
  const keep = new Set([...treeHi, ...treeLo, ...rockGeos]);
  world.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    if (o.material) for (const m of [].concat(o.material)) if (m.userData.perWorld) { if (m.map) m.map.dispose(); m.dispose(); }
  });
  scene.remove(world);
  world = new THREE.Group();
  scene.add(world);
  chunks.length = 0;
}
function updateLOD() {
  const cz = camera.position.z;
  for (const ch of chunks) {
    const dz = cz > ch.zTop ? cz - ch.zTop : (cz < ch.zBot ? ch.zBot - cz : 0);
    const hi = dz < 360;
    for (const m of ch.treesHi) m.visible = hi;
    for (const m of ch.treesLo) m.visible = !hi;
    for (const m of ch.rocks) m.visible = dz < 900;
  }
}

/* =========================================================
   HUD
   ========================================================= */
const fmtTime = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(1).padStart(4, '0')}`; };
const nf = new Intl.NumberFormat('en-US');
let hudT = 0, fpsFrames = 0, fpsT = 0, fpsVal = 60, lowFpsStreak = 0;
let toastTimer = 0;
function toast(title, kind, sub) {
  const el = $('toast');
  el.className = 'toast';
  void el.offsetWidth;
  $('toastTitle').textContent = title;
  $('toastSub').textContent = sub || '';
  el.className = `toast show ${kind || ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = `toast ${kind || ''}`; }, 2200);
}
function updateHUD(dt, speed) {
  hudT += dt;
  if (hudT < 0.1) return;
  hudT = 0;
  $('spd').textContent = Math.round(speed * 3.6);
  const s = clamp(-P.pos.z, 0, RUN);
  $('dist').textContent = `${nf.format(Math.round(s))} m`;
  $('alt').textContent = `${nf.format(Math.round(START_ALT + (P.pos.y - P.startY)))} m`;
  $('time').textContent = fmtTime(P.time);
  $('top').textContent = `${Math.round(P.top * 3.6)} km/h`;
  $('score').textContent = nf.format(P.score);
  $('air').textContent = P.mode === 'air' ? `${P.airT.toFixed(1)} s` : (P.lastAir ? `${P.lastAir.toFixed(1)} s` : '—');
  $('prog').style.width = `${(s / RUN) * 100}%`;
  const deg = Math.acos(clamp(P.up.y, -1, 1)) * 180 / Math.PI;
  $('grade').textContent = `${Math.round(deg)}°`;
  const zone = s >= PIPE.s0 && s <= PIPE.s0 + PIPE.len ? 'Half-pipe' : (parkMask(s) > 0.5 && FEATURES.length ? 'Terrain park' : T.name);
  $('zone').textContent = zone;
}
function trackFPS(dt) {
  fpsFrames++; fpsT += dt;
  if (fpsT >= 1) {
    fpsVal = fpsFrames / fpsT; fpsFrames = 0; fpsT = 0;
    $('fps').textContent = `${Math.round(fpsVal)} fps`;
    if (fpsVal < 52) lowFpsStreak++; else lowFpsStreak = 0;
    if (lowFpsStreak >= 2 && pixelRatio > 1.0) {
      pixelRatio = Math.max(1.0, pixelRatio - 0.25);
      renderer.setPixelRatio(pixelRatio); composer.setPixelRatio(pixelRatio);
      composer.setSize(innerWidth, innerHeight);
      lowFpsStreak = 0;
    }
  }
}

/* =========================================================
   Coins + gear shop (saved in this browser)
   ========================================================= */
const SHOP = {
  skis: { label: 'Skis', items: [
    { id: 'ski-carver', name: 'Piste Carver', price: 0, perk: 'Balanced all-rounder',
      tex: { base: '#0e1a2c', mid: '#1a3456', accent: '#ff5a2c', line: '#e9eef5', trim: '#f2c14e', pattern: 'chev' }, stats: {} },
    { id: 'ski-twin', name: 'Park Twin', price: 150, perk: '+15% pop',
      tex: { base: '#1d2b1a', mid: '#3c5a2c', accent: '#c6f03a', line: '#111111', trim: '#ffffff', pattern: 'camo' }, stats: { pop: 1.15 } },
    { id: 'ski-powder', name: 'Powder Fat', price: 250, perk: '+20% edge grip in turns',
      tex: { base: '#dfe7ef', mid: '#ffffff', accent: '#0fb5ae', line: '#14303a', trim: '#0fb5ae', pattern: 'stripe' }, stats: { grip: 1.2 } },
    { id: 'ski-race', name: 'Race GS', price: 450, perk: '−10% air drag (faster)',
      tex: { base: '#120d0e', mid: '#2a1416', accent: '#e21d2b', line: '#ffffff', trim: '#e21d2b', pattern: 'fade' }, stats: { drag: 0.9 } },
    { id: 'ski-gold', name: 'Gold Edition', price: 1500, perk: '−12% drag and +20% pop',
      tex: { base: '#5a420c', mid: '#e7c35c', accent: '#fff3c4', line: '#3a2a06', trim: '#fff3c4', pattern: 'chev' }, stats: { drag: 0.88, pop: 1.2 } },
  ] },
  boots: { label: 'Boots', items: [
    { id: 'boot-classic', name: 'Classic White', price: 0, perk: 'Standard landing window', shell: '#eeeeea', accent: '#d2412a', stats: {} },
    { id: 'boot-stealth', name: 'Stealth Black', price: 120, perk: 'Looks only', shell: '#1c1e22', accent: '#4a515c', stats: {} },
    { id: 'boot-volt', name: 'Volt', price: 300, perk: '+5° landing tolerance', shell: '#e3ec2e', accent: '#1c1e22', stats: { tol: 0.09 } },
    { id: 'boot-carbon', name: 'Pro Carbon', price: 650, perk: '+8° tolerance, survives harder impacts', shell: '#2b2f36', accent: '#36c5f0', carbon: true, stats: { tol: 0.14, impact: 1.5 } },
  ] },
  outfit: { label: 'Clothing', items: [
    { id: 'fit-ember', name: 'Ember', price: 0, perk: 'Signal red over charcoal', jacket: '#d2412a', dark: '#1b2633', pants: '#2a3442', trim: '#f2c14e' },
    { id: 'fit-glacier', name: 'Glacier', price: 100, perk: 'Ice blue, white pants', jacket: '#8fc1ea', dark: '#2b4a6a', pants: '#e3e9f0', trim: '#ffffff' },
    { id: 'fit-forest', name: 'Forest', price: 180, perk: 'Olive and khaki', jacket: '#56603a', dark: '#2a2f22', pants: '#a89a74', trim: '#e0a33a' },
    { id: 'fit-sunset', name: 'Sunset', price: 260, perk: 'Amber jacket, plum pants', jacket: '#ffab2e', dark: '#7a2a1a', pants: '#3b2a4a', trim: '#ff5a7a' },
    { id: 'fit-neon', name: 'Neon Rave', price: 350, perk: 'Hot pink and lime', jacket: '#ff4fb4', dark: '#2a1640', pants: '#a6e22e', trim: '#3af2e6' },
    { id: 'fit-midnight', name: 'Midnight', price: 500, perk: 'Black with violet trim', jacket: '#1d1f2a', dark: '#6c3cff', pants: '#121318', trim: '#a98bff' },
  ] },
  helmet: { label: 'Helmets', items: [
    { id: 'helm-arctic', name: 'Arctic White', price: 0, perk: 'Amber mirror lens', shell: '#f1f1ee', lens: '#ffa646' },
    { id: 'helm-matte', name: 'Matte Black', price: 90, perk: 'Blue mirror lens', shell: '#1b1d21', lens: '#3aa0ff', matte: true },
    { id: 'helm-signal', name: 'Signal Orange', price: 160, perk: 'Silver lens', shell: '#ff6a1a', lens: '#c9d3de' },
    { id: 'helm-chrome', name: 'Chrome', price: 700, perk: 'Polished shell, gold lens', shell: '#d9dde2', lens: '#ffd04a', metal: true },
  ] },
};
const DEFAULT_GEAR = { skis: 'ski-carver', boots: 'boot-classic', outfit: 'fit-ember', helmet: 'helm-arctic' };
const SAVE_KEY = 'powderline.gear.v1';
const SAVE = { coins: 50, owned: Object.values(DEFAULT_GEAR), equipped: { ...DEFAULT_GEAR } };
try {
  const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  if (raw && typeof raw.coins === 'number' && isFinite(raw.coins)) {
    SAVE.coins = Math.max(0, Math.floor(raw.coins));
    if (Array.isArray(raw.owned)) SAVE.owned = [...new Set([...SAVE.owned, ...raw.owned])];
    if (typeof raw.trail === 'string') SAVE.trail = raw.trail;
    if (raw.board === true) SAVE.board = true;
    if (raw.equipped) for (const k in DEFAULT_GEAR) if (raw.equipped[k] && SAVE.owned.includes(raw.equipped[k])) SAVE.equipped[k] = raw.equipped[k];
  }
} catch (e) { /* storage unavailable: start fresh */ }
function saveGame() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (e) { /* not persisted */ } }
const itemOf = (cat, id) => SHOP[cat].items.find((i) => i.id === id) || SHOP[cat].items[0];

// Gameplay effect of equipped gear (read by the physics)
const GEAR = { drag: 1, pop: 1, grip: 1, tol: 0, impact: 0 };

// Coins for a landed jump: size of the feature + tricks, ×1.5 for a stomped landing
const JUMP_COINS = { 'kicker-S': 10, 'kicker-M': 20, 'kicker-L': 45, 'kicker-XL': 150, 'kicker-XXL': 500, pipe: 15 };
function jumpCoins(launch, spinDeg, flips, grabbed, clean, perfect) {
  let c = (JUMP_COINS[launch] ?? 5) + (spinDeg / 180) * 5 + flips * 25 + (grabbed ? 10 : 0) + (perfect ? 5 : 0);
  if (clean) c *= 1.5;
  return Math.round(c);
}
function addCoins(n) {
  SAVE.coins += n;
  P.runCoins = (P.runCoins || 0) + n;
  saveGame();
  updateWallet();
}
function updateWallet() {
  const t = nf.format(SAVE.coins);
  for (const id of ['coins', 'homeCoins', 'storeCoins', 'mapCoins']) { const el = $(id); if (el) el.textContent = t; }
}

const skiTexCache = {};
let preview = {};   // items being tried on in the shop (not bought)
function applyGear() {
  const M = skier.M;
  const eq = { ...SAVE.equipped, ...preview };
  const sk = itemOf('skis', eq.skis);
  M.skiTop.map = skiTexCache[sk.id] || (skiTexCache[sk.id] = makeSkiTopTexture(sk.tex));
  M.skiTop.needsUpdate = true;
  GEAR.drag = sk.stats.drag || 1; GEAR.pop = sk.stats.pop || 1; GEAR.grip = sk.stats.grip || 1;

  const b = itemOf('boots', eq.boots);
  M.boot.color.set(b.shell); M.bootAccent.color.set(b.accent);
  M.boot.roughness = b.carbon ? 0.42 : 0.3;
  GEAR.tol = b.stats.tol || 0; GEAR.impact = b.stats.impact || 0;

  const o = itemOf('outfit', eq.outfit);
  M.jacket.color.set(o.jacket); M.jacket.sheenColor.set(o.jacket).lerp(new THREE.Color(1, 1, 1), 0.45);
  M.jacketDark.color.set(o.dark);
  M.pants.color.set(o.pants); M.pants.sheenColor.set(o.pants).lerp(new THREE.Color(1, 1, 1), 0.4);
  M.trim.color.set(o.trim); M.strap.color.set(o.jacket);

  const h = itemOf('helmet', eq.helmet);
  M.helmet.color.set(h.shell);
  M.helmet.metalness = h.metal ? 1 : 0;
  M.helmet.roughness = h.metal ? 0.12 : (h.matte ? 0.62 : 0.28);
  M.helmet.clearcoat = h.matte ? 0 : 1;
  M.lens.color.set(h.lens);
}

/* ---------- shop UI ---------- */
let storeOpen = false, storeTab = 'skis', storeReturn = null;
function swatch(cat, it) {
  const cols = cat === 'skis' ? [it.tex.accent, it.tex.mid, it.tex.base]
    : cat === 'boots' ? [it.shell, it.shell, it.accent]
    : cat === 'outfit' ? [it.jacket, it.dark, it.pants]
    : [it.shell, it.shell, it.lens];
  return `linear-gradient(135deg, ${cols[0]} 0 38%, ${cols[1]} 38% 62%, ${cols[2]} 62% 100%)`;
}
function renderStore() {
  updateWallet();
  const tabs = $('storeTabs');
  tabs.innerHTML = '';
  for (const k of Object.keys(SHOP)) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'tab'; b.textContent = SHOP[k].label;
    b.setAttribute('aria-pressed', String(k === storeTab));
    b.addEventListener('click', () => { storeTab = k; renderStore(); });
    tabs.appendChild(b);
  }
  const list = $('storeItems');
  list.innerHTML = '';
  for (const it of SHOP[storeTab].items) {
    const owned = SAVE.owned.includes(it.id), equipped = SAVE.equipped[storeTab] === it.id;
    const trying = preview[storeTab] === it.id;
    const card = document.createElement('div');
    card.className = 'item' + (equipped ? ' equipped' : '') + (trying ? ' trying' : '');
    const short = Math.max(0, it.price - SAVE.coins);
    const label = equipped ? 'Equipped' : owned ? 'Equip' : short > 0 ? `Need ${nf.format(short)} more` : `Buy · ${nf.format(it.price)}`;
    const tryBtn = document.createElement('button');
    tryBtn.type = 'button'; tryBtn.className = 'try';
    tryBtn.setAttribute('aria-label', `Try on ${it.name}`);
    tryBtn.setAttribute('aria-pressed', String(trying || (equipped && !preview[storeTab])));
    tryBtn.innerHTML = `<span class="sw" style="background:${swatch(storeTab, it)}"></span>
      <span class="meta-i"><b>${it.name}</b><span>${it.perk}</span>
      <em>${trying ? 'Trying on' : owned ? 'Owned' : `<i class="coin"></i>${nf.format(it.price)}`}</em></span>`;
    tryBtn.addEventListener('click', () => {
      if (equipped) delete preview[storeTab]; else preview[storeTab] = it.id;
      $('storeMsg').textContent = equipped ? `Wearing your ${it.name}.` : `Trying on ${it.name}${owned ? '' : ' — not bought yet'}.`;
      applyGear(); renderStore();
    });
    card.appendChild(tryBtn);
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'buy' + (owned ? ' owned' : '');
    btn.textContent = label;
    btn.disabled = equipped || (!owned && short > 0);
    btn.addEventListener('click', () => {
      if (!owned) {
        if (SAVE.coins < it.price) return;
        SAVE.coins -= it.price; SAVE.owned.push(it.id);
        $('storeMsg').textContent = `Bought ${it.name}.`;
      } else $('storeMsg').textContent = `Equipped ${it.name}.`;
      SAVE.equipped[storeTab] = it.id;
      delete preview[storeTab];
      saveGame(); applyGear(); renderStore();
    });
    card.appendChild(btn);
    list.appendChild(card);
  }
}
function setShopView() {
  const off = storeOpen && innerWidth > 760 ? Math.min(240, innerWidth * 0.2) : 0;
  if (off) camera.setViewOffset(innerWidth, innerHeight, off, 0, innerWidth, innerHeight);
  else camera.clearViewOffset();
}
function openStore(from) {
  storeReturn = from;
  if (from) $(from).hidden = true;
  $('storeMsg').textContent = '';
  $('store').hidden = false;
  storeOpen = true;
  setShopView();
  renderStore();
  $('closeStore').focus();
}
function closeStore() {
  preview = {};
  applyGear();
  $('store').hidden = true;
  storeOpen = false;
  setShopView();
  if (storeReturn) { $(storeReturn).hidden = false; const b = $(storeReturn === 'intro' ? 'go' : 'again'); if (b) b.focus(); }
}
$('openStore').addEventListener('click', () => openStore('intro'));
setBoardMode(!!SAVE.board);
$('modeBtn').addEventListener('click', () => {
  setBoardMode(!BOARD); SAVE.board = BOARD; saveGame();
  if (storeOpen) renderStore();
});
$('finishStore').addEventListener('click', () => openStore('finish'));
$('closeStore').addEventListener('click', closeStore);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && storeOpen) closeStore(); });
addEventListener('resize', setShopView);

/* =========================================================
   Trail map: pick a spot, the world rebuilds for that trail
   ========================================================= */
const MAP_ART = {
  valley: { d: 'M318 98 C 284 150, 372 190, 320 240 S 362 320, 336 384', label: [348, 150], lift: [[370, 390], [362, 96]], w: 15 },
  bigair: { d: 'M486 212 C 492 238, 482 266, 490 304', label: [500, 226], lift: [[518, 308], [514, 206]], jump: [487, 256], w: 17 },
  pipe: { d: 'M212 150 C 206 210, 218 272, 204 340', label: [96, 188], lift: [[238, 344], [240, 146]], pipe: true, w: 15 },
  glades: { d: 'M98 114 C 150 158, 66 198, 120 246 S 78 322, 126 382', label: [18, 296], lift: [[156, 388], [150, 110]], w: 8 },
  slope: { d: 'M424 112 C 410 160, 440 210, 420 260 S 436 300, 444 340', label: [448, 178], lift: [[466, 346], [462, 108]], w: 15 },
  widow: { d: 'M262 20 C 248 50, 278 78, 256 108 S 276 148, 264 176', label: [56, 60], lift: [[286, 180], [284, 18]], w: 7 },
  monster: { d: 'M540 22 C 548 48, 530 78, 544 108', label: [470, 128], lift: [[566, 112], [562, 18]], jump: [540, 58], w: 19 },
  glacier: { d: 'M384 16 C 394 34, 378 56, 390 82', label: [414, 40], lift: [[408, 88], [404, 12]], jump: [386, 42], w: 17 },
};
const mapOwned = (t) => !t.price || SAVE.owned.includes('map-' + t.id);
const MAP_RIVER = 'M606 -6 C 588 56, 632 104, 600 156 S 552 222, 580 270 S 566 318, 552 344';
const DIFF = {
  blue: { label: 'Intermediate', color: '#1f6fd6' },
  black: { label: 'Expert', color: '#14171c' },
  double: { label: 'Double black', color: '#14171c' },
  park: { label: 'Terrain park', color: '#ff7a1a' },
};
function diffSymbol(diff, x, y, r = 7) {
  const c = DIFF[diff].color;
  if (diff === 'blue') return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
  if (diff === 'double') return [-0.85, 0.85].map((k) => `<rect x="${x + k * r - r * 0.7}" y="${y - r * 0.7}" width="${1.4 * r}" height="${1.4 * r}" fill="${c}" stroke="#fff" stroke-width="1.3" transform="rotate(45 ${x + k * r} ${y})"/>`).join('');
  if (diff === 'black') return `<rect x="${x - r * 0.8}" y="${y - r * 0.8}" width="${1.6 * r}" height="${1.6 * r}" fill="${c}" stroke="#fff" stroke-width="1.5" transform="rotate(45 ${x} ${y})"/>`;
  return `<rect x="${x - r * 1.3}" y="${y - r * 0.8}" width="${2.6 * r}" height="${1.6 * r}" rx="3" fill="${c}" stroke="#fff" stroke-width="1.5"/>`;
}

/* ---------- painted winter landscape (drawn once, top-down) ---------- */
let mapBg = null;
function paintMapBackground() {
  if (typeof Path2D === 'undefined') return null;
  const MW = 640, MH = 440, S = 2;
  const c = document.createElement('canvas'); c.width = MW * S; c.height = MH * S;
  const x = c.getContext('2d');
  const rng = makeRng(2026);

  // 1. elevation → hill-shaded snow, icy rock along the high ridge
  const GW = MW + 1, GH = MH + 1, E = new Float32Array(GW * GH);
  for (let v = 0; v < GH; v++) for (let u = 0; u < GW; u++) {
    const hi = 1 - smooth(20, 175, v + fbm(u * 0.01, 3, 2) * 40);
    const ridge = ridged(u * 0.014 + 3, v * 0.02, 6);                 // sharp crests and gullies
    E[v * GW + u] = (1 - v / MH) * 1.2 + 0.3 * fbm(u * 0.011, v * 0.011, 4) + 1.6 * hi * ridge * ridge + 0.05 * fbm(u * 0.06, v * 0.06, 2);
  }
  const base = x.createImageData(MW, MH), bd = base.data;
  const L = [-0.62, -0.55, 0.56];
  for (let v = 0; v < MH; v++) for (let u = 0; u < MW; u++) {
    const i = v * GW + u, k = 34;
    const dx = (E[i + 1] - E[i]) * k, dy = (E[i + GW] - E[i]) * k;
    const nl = Math.hypot(dx, dy, 1);
    const sh = clamp((-dx * L[0] - dy * L[1] + L[2]) / nl / 0.95, 0, 1.2);
    const steep = Math.hypot(dx, dy);
    const hi = 1 - smooth(30, 170, v + fbm(u * 0.03, v * 0.03, 2) * 30);
    const shade = clamp(sh, 0, 1.15);
    // steep faces turned away from the sun show dark rock; sunny faces stay snow-white
    const rock = hi * smooth(0.9, 1.9, steep) * smooth(0.75, 0.35, shade) * (0.75 + 0.5 * fbm(u * 0.07 + 9, v * 0.07, 2));
    const grain = (fbm(u * 0.25, v * 0.25, 2)) * 6;
    let r = lerp(132, 253, shade) + grain, g = lerp(160, 254, shade) + grain, b = lerp(206, 255, shade) + grain;
    const rv = lerp(58, 125, clamp(shade, 0, 1));
    r = lerp(r, rv * 0.95, rock); g = lerp(g, rv * 1.0, rock); b = lerp(b, rv * 1.15, rock);
    const o = (v * MW + u) * 4;
    bd[o] = r; bd[o + 1] = g; bd[o + 2] = b; bd[o + 3] = 255;
  }
  const bc = document.createElement('canvas'); bc.width = MW; bc.height = MH;
  bc.getContext('2d').putImageData(base, 0, 0);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(bc, 0, 0, MW * S, MH * S);
  x.scale(S, S);

  // wind-blown snow strokes for a painted feel
  x.lineCap = 'round';
  for (let i = 0; i < 900; i++) {
    const u = rng() * MW, v = 30 + rng() * MH, len = 6 + rng() * 18;
    x.strokeStyle = rng() < 0.6 ? 'rgba(255,255,255,.35)' : 'rgba(150,175,215,.18)';
    x.lineWidth = 0.6 + rng() * 1.4;
    x.beginPath(); x.moveTo(u, v); x.quadraticCurveTo(u + len * 0.5, v - 2, u + len, v + 1); x.stroke();
  }

  // 2. frozen river and lake
  const river = new Path2D(MAP_RIVER);
  const lake = new Path2D();
  { const cx = 590, cy = 402, n = 40;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2, rr = 1 + 0.18 * Math.sin(a * 3 + 1) + 0.1 * Math.sin(a * 7);
      const px = cx + Math.cos(a) * 95 * rr, py = cy + Math.sin(a) * 66 * rr;
      i ? lake.lineTo(px, py) : lake.moveTo(px, py);
    }
    lake.closePath(); }
  x.lineJoin = 'round';
  x.strokeStyle = 'rgba(110,135,175,.5)'; x.lineWidth = 19; x.stroke(river);
  x.fillStyle = 'rgba(110,135,175,.5)'; x.save(); x.translate(-3, -3); x.fill(lake); x.restore();
  x.strokeStyle = '#9fd2ea'; x.lineWidth = 13; x.stroke(river);
  const lg = x.createLinearGradient(500, 330, 640, 440);
  lg.addColorStop(0, '#bfe6f6'); lg.addColorStop(1, '#7cc1e2');
  x.fillStyle = lg; x.fill(lake);
  x.strokeStyle = 'rgba(230,248,255,.85)'; x.lineWidth = 4; x.stroke(river);
  x.save(); x.clip(lake);
  x.fillStyle = '#3f93bd';
  for (const [u, v, a, b] of [[566, 388, 22, 12], [612, 420, 30, 14], [540, 420, 14, 8]]) { x.beginPath(); x.ellipse(u, v, a, b, 0.3, 0, Math.PI * 2); x.fill(); }
  for (let i = 0; i < 26; i++) {           // ice floes
    const u = 505 + rng() * 140, v = 345 + rng() * 100, rr = 3 + rng() * 9;
    x.fillStyle = 'rgba(240,250,255,.95)'; x.strokeStyle = 'rgba(120,180,215,.8)'; x.lineWidth = 0.8;
    x.beginPath();
    for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2 + rng() * 0.5, q = rr * (0.7 + rng() * 0.5); k ? x.lineTo(u + Math.cos(a) * q, v + Math.sin(a) * q * 0.7) : x.moveTo(u + Math.cos(a) * q, v + Math.sin(a) * q * 0.7); }
    x.closePath(); x.fill(); x.stroke();
  }
  x.strokeStyle = 'rgba(255,255,255,.7)'; x.lineWidth = 0.6;
  for (let i = 0; i < 40; i++) { const u = 500 + rng() * 140, v = 340 + rng() * 100; x.beginPath(); x.moveTo(u, v); x.lineTo(u + (rng() - 0.5) * 30, v + (rng() - 0.5) * 18); x.stroke(); }
  x.restore();

  // frozen pond in the lower forest
  { const pond = new Path2D(); pond.ellipse(262, 300, 13, 9, 0.3, 0, Math.PI * 2);
    x.fillStyle = 'rgba(110,135,175,.5)'; x.save(); x.translate(2, 2); x.fill(pond); x.restore();
    x.fillStyle = '#a9daf0'; x.fill(pond); x.strokeStyle = 'rgba(255,255,255,.8)'; x.lineWidth = 0.7;
    x.beginPath(); x.moveTo(254, 296); x.lineTo(266, 303); x.lineTo(271, 298); x.stroke(); }
  // 3. groomed trails, the half-pipe and the big kicker
  const trailPaths = {};
  for (const t of TRAILS) {
    const a = MAP_ART[t.id], p = new Path2D(a.d);
    trailPaths[t.id] = p;
    x.strokeStyle = 'rgba(105,130,175,.42)'; x.lineWidth = a.w + 5; x.stroke(p);
    x.strokeStyle = 'rgba(252,253,255,.97)'; x.lineWidth = a.w; x.stroke(p);
    x.setLineDash([1, 2.2]); x.strokeStyle = 'rgba(190,206,230,.55)'; x.lineWidth = a.w * 0.7; x.stroke(p); x.setLineDash([]);
    if (a.pipe) {
      x.strokeStyle = 'rgba(120,150,195,.55)'; x.lineWidth = a.w * 0.62; x.stroke(p);
      x.strokeStyle = 'rgba(240,247,255,1)'; x.lineWidth = a.w * 0.3; x.stroke(p);
    }
    if (a.jump) {
      const [u, v] = a.jump;
      x.fillStyle = 'rgba(80,100,140,.5)'; x.beginPath(); x.ellipse(u + 1, v + 13, 15, 8, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#3f93bd'; x.beginPath(); x.ellipse(u, v + 12, 14, 7, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = 'rgba(235,248,255,.95)'; x.lineWidth = 1.4; x.stroke();
      x.fillStyle = '#ffffff'; x.strokeStyle = 'rgba(110,135,180,.8)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(u - 7, v - 7); x.lineTo(u + 7, v - 7); x.lineTo(u + 9, v + 3); x.lineTo(u - 9, v + 3); x.closePath(); x.fill(); x.stroke();
      x.strokeStyle = '#1f4fbf'; x.lineWidth = 1.6; x.beginPath(); x.moveTo(u - 9, v + 3); x.lineTo(u + 9, v + 3); x.stroke();
    }
  }

  // 4. snowy boulders
  const rocks = [];
  for (let i = 0; i < 70; i++) {
    const u = rng() * MW, v = 40 + rng() * 360;
    if (x.isPointInPath(lake, u, v)) continue;
    let near = false;
    for (const t of TRAILS) { x.lineWidth = MAP_ART[t.id].w + 8; if (x.isPointInStroke(trailPaths[t.id], u, v)) near = true; }
    if (!near) rocks.push([u, v, 2 + rng() * 5]);
  }
  for (const [u, v, rr] of rocks) {
    x.fillStyle = 'rgba(70,90,130,.3)'; x.beginPath(); x.ellipse(u + rr * 0.6, v + rr * 0.5, rr * 1.2, rr * 0.8, 0.4, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#6f7684'; x.beginPath(); x.ellipse(u, v, rr, rr * 0.8, rng(), 0, Math.PI * 2); x.fill();
    x.fillStyle = '#f4f8fc'; x.beginPath(); x.ellipse(u - rr * 0.3, v - rr * 0.3, rr * 0.7, rr * 0.5, rng(), 0, Math.PI * 2); x.fill();
  }

  // 5. pine forest seen from above: dense on the left and lower slopes, cleared for trails, lifts and ice
  const liftSegs = TRAILS.map((t) => MAP_ART[t.id].lift);
  const nearLift = (u, v) => liftSegs.some(([[ax, ay], [bx, by]]) => {
    const dx = bx - ax, dy = by - ay, tt = clamp(((u - ax) * dx + (v - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(u - ax - dx * tt, v - ay - dy * tt) < 7;
  });
  const trees = [];
  for (let i = 0; i < 9000 && trees.length < 1500; i++) {
    const u = rng() * MW, v = 100 + rng() * 345;
    const treeline = 128 + fbm(u * 0.02, 5, 2) * 40;
    if (v < treeline) continue;
    const dens = fbm(u * 0.012 + 4, v * 0.012, 3) + (u < 190 ? 0.35 : 0) + (v > 300 ? 0.1 : 0) - (u > 420 && v > 320 ? 0.6 : 0);
    if (dens < 0.12 + rng() * 0.22) continue;
    if (x.isPointInPath(lake, u, v)) continue;
    x.lineWidth = 22; if (x.isPointInStroke(river, u, v)) continue;
    let blocked = false;
    for (const t of TRAILS) { x.lineWidth = MAP_ART[t.id].w + (t.id === 'glades' || t.id === 'widow' ? 5 : 9); if (x.isPointInStroke(trailPaths[t.id], u, v)) { blocked = true; break; } }
    if (blocked || nearLift(u, v)) continue;
    if (v > 384 && u > 220 && u < 440) continue;             // the village
    if (Math.hypot(u - 262, v - 300) < 18) continue;          // the pond
    trees.push([u, v, 4.4 + rng() * 4.2, rng()]);
  }
  trees.sort((a, b) => a[1] - b[1]);
  for (const [u, v, rr] of trees) { x.fillStyle = 'rgba(40,62,100,.32)'; x.beginPath(); x.ellipse(u + rr * 0.7, v + rr * 0.6, rr * 1.05, rr * 0.8, 0.5, 0, Math.PI * 2); x.fill(); }
  const star = (u, v, r1, r2, n, rot) => { x.beginPath(); for (let k = 0; k < n * 2; k++) { const a = rot + (k / (n * 2)) * Math.PI * 2, q = k % 2 ? r2 : r1; k ? x.lineTo(u + Math.cos(a) * q, v + Math.sin(a) * q) : x.moveTo(u + Math.cos(a) * q, v + Math.sin(a) * q); } x.closePath(); };
  for (const [u, v, rr, h] of trees) {
    const dark = h < 0.5 ? '#173b2c' : '#1d4633', mid = h < 0.5 ? '#2c5f45' : '#356b4c';
    x.fillStyle = dark; star(u, v, rr, rr * 0.66, 10, h * 3); x.fill();
    x.fillStyle = mid; star(u - rr * 0.1, v - rr * 0.1, rr * 0.74, rr * 0.48, 8, h * 5); x.fill();
    x.fillStyle = h < 0.5 ? '#3f7a58' : '#4a8461'; star(u - rr * 0.2, v - rr * 0.2, rr * 0.42, rr * 0.26, 6, h * 7); x.fill();
    x.fillStyle = 'rgba(245,250,255,.92)';
    x.beginPath(); x.ellipse(u - rr * 0.35, v - rr * 0.38, rr * 0.38, rr * 0.22, -0.6, 0, Math.PI * 2); x.fill();
    if (h > 0.4) { x.beginPath(); x.ellipse(u + rr * 0.15, v - rr * 0.55, rr * 0.2, rr * 0.13, 0, 0, Math.PI * 2); x.fill(); }
    x.fillStyle = '#e9f1f8'; x.beginPath(); x.arc(u - rr * 0.05, v - rr * 0.05, rr * 0.12, 0, Math.PI * 2); x.fill();
  }

  // 6. base village: chalets with snowy roofs, packed paths, and a gondola station for every trail
  x.strokeStyle = 'rgba(190,170,140,.55)'; x.lineWidth = 3;
  x.beginPath(); x.moveTo(150, 398); x.bezierCurveTo(240, 420, 330, 404, 520, 318); x.stroke();
  const chalet = (u, v, w, h, rot, roof) => {
    x.save(); x.translate(u, v); x.rotate(rot);
    x.fillStyle = 'rgba(40,60,100,.35)'; x.fillRect(-w / 2 + 2, -h / 2 + 2, w, h);
    x.fillStyle = roof; x.fillRect(-w / 2, -h / 2, w, h / 2);
    x.fillStyle = '#f7fbff'; x.fillRect(-w / 2, 0, w, h / 2);
    x.fillStyle = 'rgba(255,255,255,.7)'; x.fillRect(-w / 2, -h / 2, w * 0.55, h / 2);
    x.strokeStyle = 'rgba(60,40,30,.8)'; x.lineWidth = 0.7; x.strokeRect(-w / 2, -h / 2, w, h);
    x.beginPath(); x.moveTo(-w / 2, 0); x.lineTo(w / 2, 0); x.stroke();
    x.fillStyle = '#6b4a36'; x.fillRect(w * 0.22, -h * 0.42, 2.2, 2.2);
    x.restore();
  };
  [[262, 414, 18, 12, 0.1, '#7a4a2e'], [290, 402, 14, 10, -0.2, '#8c3a2c'], [338, 410, 22, 14, 0, '#5e4636'], [372, 426, 15, 10, 0.15, '#8c3a2c'], [62, 360, 13, 9, 0.3, '#5e4636'], [306, 422, 16, 11, 0.05, '#5e4636'], [404, 416, 13, 9, -0.1, '#8c3a2c'],
   [424, 400, 10, 8, 0.3, '#7a4a2e'], [236, 428, 12, 9, -0.15, '#5e4636'], [446, 422, 14, 10, 0.2, '#6d3a2a']].forEach((c2) => chalet(...c2));
  for (const t of TRAILS) for (const [u, v] of MAP_ART[t.id].lift) chalet(u, v, 13, 9, 0, '#a5161f');

  // 7. vignette and paper edge
  x.setTransform(1, 0, 0, 1, 0, 0);
  const vg = x.createRadialGradient(MW, MH * 0.9, MH * 0.5, MW, MH, MW * 1.15);
  vg.addColorStop(0, 'rgba(20,40,70,0)'); vg.addColorStop(1, 'rgba(20,40,70,.28)');
  x.fillStyle = vg; x.fillRect(0, 0, MW * S, MH * S);
  return c;
}

function trailStats(t) {
  const old = T; T = t;
  const drop = baseY(0) - baseY(t.run);
  T = old;
  const lift = Math.hypot(t.run + 70, drop);
  const parts = [];
  const sizes = t.kickers.map((k) => k[2]);
  if (sizes.length) parts.push(`${sizes.length} jump${sizes.length > 1 ? 's' : ''} (${[...new Set(sizes)].join(' · ')})`);
  const nr = t.rails.filter((r) => r[2] === 'rail').length, nb = t.rails.length - nr;
  if (nr) parts.push(`${nr} rail${nr > 1 ? 's' : ''}`);
  if (nb) parts.push(`${nb} box${nb > 1 ? 'es' : ''}`);
  if (t.pipe) parts.push(`${t.pipe[1]} m half-pipe`);
  if (t.lake) { const g = t.kickers.find((k) => KICK[k[2]].gap); if (g) parts.push(`${KICK[g[2]].Lt} m gap over a lake`); }
  if (!parts.length) parts.push('Rollers and tight trees, no park');
  return { drop, lift, features: parts };
}
let mapSel = T.id, mapReturn = 'intro';
function renderMapArt() {
  const W = 640, H = 440;
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="group" aria-label="Trail map of the mountain">
  <defs><filter id="mGlow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>`;
  for (const t of TRAILS) {
    const a = MAP_ART[t.id], c = DIFF[t.diff].color, sel = t.id === mapSel, cur = t.id === T.id;
    const [[bx, by], [tx, ty]] = a.lift;
    let cabins = '', towers = '';
    for (let i = 1; i < 5; i++) { const k = i / 5; cabins += `<rect x="${bx + (tx - bx) * k - 2.6}" y="${by + (ty - by) * k + 1.5}" width="5.2" height="5.2" rx="1.4" fill="#a5161f" stroke="#fff" stroke-width=".7"/>`; }
    for (let i = 1; i < 6; i++) { const k = (i - 0.5) / 5.5; towers += `<circle cx="${bx + (tx - bx) * k}" cy="${by + (ty - by) * k}" r="1.6" fill="#3c4048"/>`; }
    const lx = a.label[0], ly = a.label[1], tw = t.name.length * 8.4 + 34;
    const locked = !mapOwned(t), sub = cur ? 'You are here' : locked ? `Locked · ${nf.format(t.price)} coins` : '', lh = sub ? 34 : 22;
    svg += `<g class="m-trail${sel ? ' sel' : ''}" data-id="${t.id}" role="button" tabindex="0" aria-pressed="${sel}" aria-label="${t.name}, ${DIFF[t.diff].label}, ${t.tag}${cur ? ', current trail' : ''}${locked ? `, locked, costs ${t.price} coins` : ''}">
      <line x1="${bx}" y1="${by}" x2="${tx}" y2="${ty}" stroke="#2b2f36" stroke-width="1.1"/>${towers}${cabins}
      <path class="m-hit" d="${a.d}" fill="none" stroke="transparent" stroke-width="28"/>
      ${sel ? `<path d="${a.d}" fill="none" stroke="#ffd34d" stroke-width="${a.w + 8}" stroke-linecap="round" opacity=".55" filter="url(#mGlow)"/>` : ''}
      <path class="m-line" d="${a.d}" fill="none" stroke="${c}" stroke-width="${sel ? 4 : 2.4}" stroke-linecap="round" stroke-dasharray="${sel ? 'none' : '7 5'}"/>
      <g class="m-label" transform="translate(${lx} ${ly - 13})">
        <rect x="2" y="3" width="${tw}" height="${lh}" rx="3" fill="rgba(30,25,20,.35)"/>
        <rect width="${tw}" height="${lh}" rx="3" fill="${locked ? '#4a3a2c' : '#6b4425'}" stroke="${sel ? '#ffd34d' : '#3d2614'}" stroke-width="${sel ? 2 : 1.2}"/>
        <rect x="3" y="3" width="${tw - 6}" height="2" fill="#f4f8fc" opacity=".9"/>
        ${diffSymbol(t.diff, 14, 12, 5)}
        <text x="26" y="16" class="m-name">${t.name}</text>
        ${sub ? `<text x="26" y="29" class="m-cur">${sub}</text>` : ''}
      </g>
    </g>`;
  }
  svg += `<g class="m-legend" transform="translate(${W - 202} ${H - 76})">
      <rect x="2" y="3" width="188" height="62" rx="4" fill="rgba(30,25,20,.35)"/>
      <rect width="188" height="62" rx="4" fill="#6b4425" stroke="#3d2614"/>
      <rect x="3" y="3" width="182" height="2" fill="#f4f8fc" opacity=".9"/>
      ${diffSymbol('blue', 16, 20, 5)}<text x="28" y="24">Intermediate</text>${diffSymbol('black', 110, 20, 5)}<text x="122" y="24">Expert</text>
      ${diffSymbol('park', 18, 44, 5)}<text x="32" y="48">Park</text><line x1="92" y1="44" x2="114" y2="44" stroke="#f4f8fc" stroke-width="1.2"/><rect x="100" y="41" width="6" height="6" rx="1.4" fill="#a5161f" stroke="#fff" stroke-width=".7"/><text x="122" y="48">Gondola</text>
    </g>
    <g transform="translate(34 404)" class="m-compass"><circle r="16" fill="rgba(255,255,255,.75)" stroke="#6b4425" stroke-width="1.5"/>
      <path d="M0 -13 L4 0 L0 13 L-4 0 Z" fill="#6b4425"/><path d="M0 -13 L4 0 L-4 0 Z" fill="#a5161f"/><text y="-19" text-anchor="middle">N</text></g>
  </svg>`;
  const art = $('mapArt');
  art.innerHTML = svg;
  art.querySelectorAll('.m-label').forEach((lab) => {
    const txt = lab.querySelector('.m-name');
    if (!txt || !txt.getComputedTextLength) return;
    const w = Math.max(txt.getComputedTextLength(), (lab.querySelector('.m-cur') || txt).getComputedTextLength()) + 36;
    const rs = lab.querySelectorAll('rect');
    rs[0].setAttribute('width', w); rs[1].setAttribute('width', w); rs[2].setAttribute('width', w - 6);
  });
  if (!mapBg) mapBg = paintMapBackground();
  if (mapBg && art.prepend) art.prepend(mapBg);
  art.querySelectorAll('.m-trail').forEach((el) => {
    const pick = () => { mapSel = el.dataset.id; $('mapMsg').textContent = ''; renderMapArt(); renderMapInfo(); const again = $('mapArt').querySelector(`[data-id="${mapSel}"]`); if (again) again.focus(); };
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
  });
}

function renderMapInfo() {
  const t = TRAILS.find((x) => x.id === mapSel) || TRAILS[0];
  const st = trailStats(t);
  $('mapInfo').innerHTML = `
    <div class="mi-tag"><span class="mi-sym" style="background:${DIFF[t.diff].color}"></span>${DIFF[t.diff].label} · ${t.tag}</div>
    <h3>${t.name}</h3>
    <p>${t.blurb}</p>
    <dl class="stats">
      <div><dt>Length</dt><dd>${nf.format(t.run)} m</dd></div>
      <div><dt>Vertical</dt><dd>${nf.format(Math.round(st.drop))} m</dd></div>
      <div><dt>Top</dt><dd>${nf.format(t.startAlt)} m</dd></div>
      <div><dt>Gondola</dt><dd>${(st.lift / 1000).toFixed(1)} km</dd></div>
    </dl>${mapOwned(t) ? '' : `<div class="mi-tag" style="color:var(--gold)"><i class="coin"></i>Premium trail · ${nf.format(t.price)} coins to unlock</div>`}
    <ul class="mi-feat">${st.features.map((f) => `<li>${f}</li>`).join('')}<li>Gondola back up at the bottom</li></ul>`;
  const btn = $('rideTrail');
  if (!mapOwned(t)) {
    const short = Math.max(0, t.price - SAVE.coins);
    btn.textContent = short ? `Need ${nf.format(short)} more coins` : `Unlock · ${nf.format(t.price)} coins`;
    btn.disabled = short > 0;
  } else {
    btn.disabled = false;
    btn.textContent = t.id === T.id ? `Ride ${t.name}` : `Go to ${t.name}`;
  }
  updateWallet();
}
function openMap(from) {
  mapReturn = from;
  $(from).hidden = true;
  mapSel = T.id;
  $('mapMsg').textContent = '';
  $('mapView').hidden = false;
  renderMapArt(); renderMapInfo();
  $('rideTrail').focus();
}
function closeMap() {
  $('mapView').hidden = true;
  $(mapReturn).hidden = false;
}
function updateIntro() {
  const st = trailStats(T);
  $('introTrail').textContent = `${T.name} · ${DIFF[T.diff].label}`;
  $('introBlurb').textContent = T.blurb;
  const facts = [[`${nf.format(T.run)} m`, 'length'], [`${nf.format(Math.round(st.drop))} m`, 'vertical']];
  if (T.kickers.length) facts.push([String(T.kickers.length), `jump${T.kickers.length > 1 ? 's' : ''} ${[...new Set(T.kickers.map((k) => k[2]))].join('·')}`]);
  if (T.rails.length) facts.push([String(T.rails.length), 'rails & boxes']);
  if (T.pipe) facts.push([`${T.pipe[1]} m`, 'half-pipe']);
  if (!T.kickers.length && !T.pipe) facts.push([`${T.half * 2} m`, 'trail width']);
  $('introFacts').innerHTML = facts.map(([a, b]) => `<span><strong>${a}</strong>${b}</span>`).join('');
}
function chooseTrail(id, andRide) {
  $('mapView').hidden = true;
  $('finish').hidden = true;
  if (id === T.id) { $('intro').hidden = false; if (andRide) start(); return; }
  SAVE.trail = id; saveGame();
  if (ride.active) endRide();
  started = false; P.running = false;
  $('hud').hidden = true; $('touch').hidden = true;
  const go = $('go');
  go.disabled = true; go.textContent = 'Building the mountain…';
  $('intro').hidden = false;
  setTimeout(() => {
    disposeWorld();
    setTrail(id);
    buildWorld();
    resetPlayer();
    updateCourseBar();
    updateIntro();
    go.disabled = false; go.textContent = 'Drop in';
    if (andRide) start(); else go.focus();
  }, 40);
}
$('openMap').addEventListener('click', () => openMap('intro'));
$('finishMap').addEventListener('click', () => openMap('finish'));
$('closeMap').addEventListener('click', closeMap);
$('rideTrail').addEventListener('click', () => {
  const t = TRAILS.find((x) => x.id === mapSel);
  if (t && !mapOwned(t)) {
    if (SAVE.coins < t.price) return;
    SAVE.coins -= t.price; SAVE.owned.push('map-' + t.id); saveGame();
    $('mapMsg').textContent = `Unlocked ${t.name}! It's yours for good.`;
    renderMapArt(); renderMapInfo(); $('rideTrail').focus();
    return;
  }
  chooseTrail(mapSel, true);
});
addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('mapView').hidden) closeMap(); });

/* =========================================================
   Loop
   ========================================================= */
let started = false;
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 1 / 30);
  let speed = 0;
  if (started && P.running) {
    const inp = readInput();
    const steps = 4;
    for (let i = 0; i < steps; i++) speed = physics(dt / steps, inp);
    P.time += dt;
    if (P.mode !== 'crash') P.top = Math.max(P.top, speed);
    if (P.mode === 'ground' && !P.onRail) emitSpray(dt, speed);
    if (-P.pos.z >= RUN && P.mode !== 'crash') finishRun();
  } else {
    speed = P.vel.length();
  }
  updateLift(dt);
  if (ride.active) updateRide(dt);
  animateSkier(dt, speed);
  if (ride.active) updateRideCamera(dt);
  else updateCamera(dt, speed, !started || storeOpen);
  sky.position.copy(camera.position);
  updateShadow();
  updateLOD();
  spray.update(dt);
  if (LAKE && LAKE.mat) { LAKE.mat.normalMap.offset.x += dt * 0.012; LAKE.mat.normalMap.offset.y += dt * 0.007; }
  spray.mat.uniforms.uScale.value = (renderer.domElement.height * 0.5) / Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
  if (started) updateHUD(dt, speed);
  trackFPS(dt);
  composer.render();
}

function finishRun() {
  P.running = false; P.finished = true;
  $('fTime').textContent = fmtTime(P.time);
  $('fTop').textContent = Math.round(P.top * 3.6);
  $('fScore').textContent = nf.format(P.score);
  $('fCoins').textContent = nf.format(P.runCoins || 0);
  $('liftInfo').textContent = `The gondola climbs ${(LIFT.up.L / 1000).toFixed(1)} km back to the top station, about ${fmtClock(LIFT.up.L / GOND.v)}. You can skip the ride at any time.`;
  $('finish').hidden = false;
  $('again').focus();
}

function onResize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
}
addEventListener('resize', onResize);

// touch controls (hold-style buttons)
function bindTouch(id, key) {
  const el = $(id);
  const on = (e) => { e.preventDefault(); touch[key] = true; el.classList.add('on'); };
  const off = (e) => { e.preventDefault(); touch[key] = false; el.classList.remove('on'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
bindTouch('tL', 'L'); bindTouch('tR', 'R'); bindTouch('tT', 'T'); bindTouch('tB', 'B'); bindTouch('tJ', 'J');
$('tF').addEventListener('pointerdown', (e) => { e.preventDefault(); if (started && P.running) P.wantFlip = true; });

// course bar: mark the park and the pipe for the current trail
function updateCourseBar() {
  const course = $('course');
  course.querySelectorAll('.zone').forEach((el) => el.remove());
  const mark = (a, b, cls) => {
    const el = document.createElement('span');
    el.className = `zone ${cls}`;
    el.style.left = `${(a / RUN) * 100}%`; el.style.width = `${(Math.max(1, b - a) / RUN) * 100}%`;
    course.prepend(el);
  };
  const parkEnd = Math.max(0, ...FEATURES.filter((f) => f.kind !== 'pipe').map((f) => f.s0 + f.len), ...RAILS.map((r) => r.s1));
  const hasPark = parkEnd > 0;
  if (hasPark) mark(Math.min(...FEATURES.map((f) => f.s0)), parkEnd, 'park');
  if (T.pipe) mark(PIPE.s0, PIPE.s0 + PIPE.len, 'pipe');
  $('lblPark').hidden = !hasPark; $('lblPipe').hidden = !T.pipe;
  if (hasPark) $('lblPark').style.left = `${(Math.min(...FEATURES.map((f) => f.s0)) / RUN) * 100}%`;
  if (T.pipe) $('lblPipe').style.left = `${(PIPE.s0 / RUN) * 100}%`;
}
updateCourseBar();

function start() {
  $('intro').hidden = true;
  $('hud').hidden = false;
  if (isCoarse) $('touch').hidden = false;
  resetPlayer();
  started = true; P.running = true;
  clock.getDelta();
}
$('go').addEventListener('click', start);
// R: leave the run and go back to the home screen (coins are already saved)
function goHome() {
  started = false;
  P.running = false;
  keys.clear();
  for (const k in touch) touch[k] = false;
  if (ride.active) endRide();
  resetPlayer();
  $('finish').hidden = true;
  $('hud').hidden = true;
  $('touch').hidden = true;
  $('intro').hidden = false;
  updateWallet();
  $('go').focus();
}
$('again').addEventListener('click', startGondola);
$('skipTop').addEventListener('click', () => { $('finish').hidden = true; arriveTop(); });
$('skipRide').addEventListener('click', skipRide);

// Build after the loading text paints
requestAnimationFrame(() => setTimeout(() => {
  buildWorld();
  applyGear();
  updateWallet();
  updateIntro();
  resetPlayer();
  renderer.setAnimationLoop(frame);
  const go = $('go');
  go.disabled = false; go.textContent = 'Drop in';
  $('loadMsg').hidden = true;
  go.focus();
}, 30));
