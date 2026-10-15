// trees.js — יער אורנים מושלג וסלעים.
// כל העצים בחתיכה (chunk) מצוירים בבת אחת (InstancedMesh), ויש שתי רמות פירוט:
// עצים קרובים מפורטים עם צל, עצים רחוקים פשוטים (LOD).
import * as THREE from 'three';
import {
  getHeight, getSlope, pisteCenter, pisteHalfWidth, outside, smoothstep, Z_MIN, Z_MAX,
} from './terrain.js';
import { makeNoise, fbm, mulberry32 } from './noise.js';

const CHUNK = 150;
const nT = makeNoise(777);

const GREEN = new THREE.Color(0x1d3a2a);
const GREEN_DARK = new THREE.Color(0x10241a);
const SNOW = new THREE.Color(0xeef3fb);
const BARK = new THREE.Color(0x3d2b20);

function paint(geo, fn) {
  const p = geo.attributes.position;
  const n = geo.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    fn(c, p.getY(i), n.getY(i));
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function merge(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

// עץ בגובה 1 (מגדילים אותו לכל עץ בנפרד)
function makeTreeGeometry(detailed) {
  const parts = [];
  if (detailed) {
    const trunk = new THREE.CylinderGeometry(0.03, 0.045, 0.2, 6, 1, true).translate(0, 0.1, 0).toNonIndexed();
    parts.push(paint(trunk, (c) => c.copy(BARK)));
    const layers = 5;
    for (let k = 0; k < layers; k++) {
      const r = 0.36 * (1 - k * 0.17);
      const h = 0.32 - k * 0.02;
      const yb = 0.1 + k * 0.155;
      const cone = new THREE.ConeGeometry(r, h, 7, 1).translate(0, yb + h / 2, 0).toNonIndexed();
      paint(cone, (c, y, ny) => {
        const t = (y - yb) / h;
        c.copy(GREEN_DARK).lerp(GREEN, Math.min(1, t * 1.5));
        // שלג על החלק העליון של כל "קומה"
        const snow = smoothstep(0.25, 0.75, t) * 0.85 + (ny > 0.9 ? 0.1 : 0);
        c.lerp(SNOW, Math.min(1, snow));
        if (ny < -0.5) c.copy(GREEN_DARK); // תחתית כהה
      });
      parts.push(cone);
    }
  } else {
    const cone = new THREE.ConeGeometry(0.32, 0.95, 6, 1, true).translate(0, 0.05 + 0.475, 0).toNonIndexed();
    paint(cone, (c, y) => {
      const t = (y - 0.05) / 0.95;
      c.copy(GREEN).lerp(SNOW, 0.35 + t * 0.45);
    });
    parts.push(cone);
  }
  return merge(parts);
}

function makeRockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 0);
  const n = makeNoise(31);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const f = 1 + 0.35 * n(x * 1.3 + z * 0.7, y * 1.3 - z * 0.4);
    p.setXYZ(i, x * f * 1.2, y * f * 0.65, z * f);
  }
  geo.computeVertexNormals();
  const nr = geo.attributes.normal;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const s = smoothstep(0.45, 0.8, nr.getY(i)); // שלג על החלק העליון
    const g = 0.36 + 0.05 * Math.sin(i * 1.7);
    colors[i * 3] = g + (0.93 - g) * s;
    colors[i * 3 + 1] = g * 0.97 + (0.95 - g * 0.97) * s;
    colors[i * 3 + 2] = g * 0.94 + (1.0 - g * 0.94) * s;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _e = new THREE.Euler();
const _col = new THREE.Color();
const _g2 = new THREE.Vector2();

export function createForest(scene) {
  const hiGeo = makeTreeGeometry(true);
  const loGeo = makeTreeGeometry(false);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });

  const chunks = [];
  const rand = mulberry32(2024);
  const ATTEMPTS = 420;

  for (let z0 = Z_MIN + 300; z0 < Z_MAX - 300; z0 += CHUNK) {
    const hi = new THREE.InstancedMesh(hiGeo, mat, ATTEMPTS);
    const lo = new THREE.InstancedMesh(loGeo, mat, ATTEMPTS);
    let k = 0;
    for (let a = 0; a < ATTEMPTS; a++) {
      const z = z0 + rand() * CHUNK;
      const side = rand() < 0.5 ? -1 : 1;
      const off = pisteHalfWidth(z) + 3 + Math.pow(rand(), 1.6) * 650;
      const x = pisteCenter(z) + side * off;
      const out = outside(x, z);
      // קו העצים: אין עצים גבוה בהרים
      if (rand() < smoothstep(380, 800, out)) continue;
      getSlope(x, z, _g2);
      if (Math.hypot(_g2.x, _g2.y) > 0.85) continue;
      // קרחות יער
      const cluster = fbm(nT, x * 0.009, z * 0.009, 2);
      if (cluster < -0.12 && rand() < 0.9) continue;

      const h = 8 + rand() * 11;
      const w = 0.8 + rand() * 0.45;
      _p.set(x, getHeight(x, z) - 0.4, z);
      _q.setFromEuler(_e.set((rand() - 0.5) * 0.06, rand() * Math.PI * 2, (rand() - 0.5) * 0.06));
      _s.set(h * w, h, h * w);
      _m.compose(_p, _q, _s);
      hi.setMatrixAt(k, _m);
      lo.setMatrixAt(k, _m);
      const t = 0.85 + rand() * 0.25;
      _col.setRGB(t, t, t);
      hi.setColorAt(k, _col);
      lo.setColorAt(k, _col);
      k++;
    }
    hi.count = k;
    lo.count = k;
    hi.computeBoundingSphere();
    lo.computeBoundingSphere();
    hi.visible = false;
    lo.visible = false;
    scene.add(hi);
    scene.add(lo);
    chunks.push({ zc: z0 + CHUNK / 2, hi, lo });
  }

  // ---------- סלעים ----------
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
  const ROCKS = 700;
  const rocks = new THREE.InstancedMesh(makeRockGeometry(), rockMat, ROCKS);
  let rk = 0;
  for (let a = 0; a < ROCKS * 3 && rk < ROCKS; a++) {
    const z = Z_MIN + 300 + rand() * (Z_MAX - Z_MIN - 600);
    const side = rand() < 0.5 ? -1 : 1;
    const off = pisteHalfWidth(z) + 6 + Math.pow(rand(), 1.3) * 380;
    const x = pisteCenter(z) + side * off;
    getSlope(x, z, _g2);
    const steep = Math.hypot(_g2.x, _g2.y);
    if (rand() > 0.25 + steep * 0.6) continue;
    const s = 0.5 + Math.pow(rand(), 2.5) * 5;
    _p.set(x, getHeight(x, z) - s * 0.25, z);
    _q.setFromEuler(_e.set(rand() * 0.4, rand() * Math.PI * 2, rand() * 0.4));
    _s.set(s, s * (0.7 + rand() * 0.6), s);
    _m.compose(_p, _q, _s);
    rocks.setMatrixAt(rk++, _m);
  }
  rocks.count = rk;
  rocks.receiveShadow = true;
  rocks.computeBoundingSphere();
  scene.add(rocks);

  return {
    update(camPos) {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const d = Math.abs(camPos.z - c.zc);
        c.hi.visible = d < 230;
        c.lo.visible = d >= 230 && d < 2600;
      }
    },
  };
}
