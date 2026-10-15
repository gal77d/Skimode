// terrain.js — ההר: צורת השטח, צבעים, טקסטורת שלג, ופירוק לחתיכות (chunks) עם LOD.
import * as THREE from 'three';
import { makeNoise, fbm, ridged } from './noise.js';

export const SLOPE_LENGTH = 3000; // אורך המסלול (מטרים)
export const ROAM_HALF = 320; // כמה רחוק הצידה מהמסלול אפשר לגלוש
export const Z_MIN = -900;
export const Z_MAX = SLOPE_LENGTH + 1500;
const CHUNK = 300; // אורך כל חתיכת שטח

const nA = makeNoise(1337);
const nB = makeNoise(4242);
const nC = makeNoise(9001);

export function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// מרכז המסלול מתפתל לאורך ההר
export function pisteCenter(z) {
  return 45 * Math.sin(z * 0.0021) + 22 * Math.sin(z * 0.0053 + 1.3);
}

export function pisteHalfWidth(z) {
  return 42 + 14 * Math.sin(z * 0.0031 + 0.7);
}

// כמה מטרים מחוץ לשולי המסלול (0 = על המסלול)
export function outside(x, z) {
  return Math.max(0, Math.abs(x - pisteCenter(z)) - pisteHalfWidth(z));
}

export function pisteFactor(x, z) {
  const d = Math.abs(x - pisteCenter(z));
  const w = pisteHalfWidth(z);
  return 1 - smoothstep(w - 5, w + 3, d);
}

export function mountainFactor(x, z) {
  return smoothstep(350, 1300, outside(x, z));
}

// גובה השלג בכל נקודה. "למטה" במדרון = כיוון +z
export function getHeight(x, z) {
  // קו הנפילה הראשי, עם קטעים תלולים ומתונים לסירוגין
  let h = -z * 0.3 + 14 * fbm(nA, z * 0.0024, 0.37, 3);
  // פסגה מאחורי נקודת ההתחלה, ואזור מתון בסוף המסלול
  if (z < 0) h += Math.pow(-z, 1.25) * 0.35;
  if (z > SLOPE_LENGTH) h += (z - SLOPE_LENGTH) * 0.24;

  // גלים עדינים במסלול המטופח
  h += 0.9 * nB(x * 0.03, z * 0.03) + 0.35 * nB(x * 0.06 + 7.1, z * 0.05);

  // דפנות העמק עולות בהדרגה מחוץ למסלול
  const out = outside(x, z);
  const near = Math.min(out, 350);
  h += out * 0.06 + near * near * 0.0006 + Math.max(0, out - 350) * 0.15;

  // שטח לא מטופח: גבשושיות שגדלות ככל שמתרחקים
  const rough = smoothstep(0, 25, out);
  if (rough > 0) h += rough * 2.4 * fbm(nC, x * 0.025, z * 0.025, 3);

  // גבעות בינוניות בצדי העמק
  const hills = smoothstep(15, 160, out);
  if (hills > 0) h += hills * 45 * fbm(nB, x * 0.004 + 11.3, z * 0.004, 4);

  // הרים גבוהים עם רכסים, רחוק מהמסלול
  const m = smoothstep(350, 1300, out);
  if (m > 0) h += m * 700 * ridged(nA, x * 0.0014 + 3.3, z * 0.0014, 4) + m * m * 120;
  return h;
}

// שיפוע: out.x = שינוי גובה לכיוון x, out.y = לכיוון z
export function getSlope(x, z, out) {
  const e = 0.5;
  out.x = (getHeight(x + e, z) - getHeight(x - e, z)) / (2 * e);
  out.y = (getHeight(x, z + e) - getHeight(x, z - e)) / (2 * e);
  return out;
}

// ---------- טקסטורת "גרגירי שלג" (normal map) שנוצרת בקוד ----------
function makeSnowNormalMap() {
  const S = 256;
  const P = 32; // מחזוריות, כדי שהטקסטורה תתחבר חלק בכל הכיוונים
  const rnd = new Float32Array(P * P);
  let seed = 7;
  for (let i = 0; i < P * P; i++) {
    seed = (seed * 16807) % 2147483647;
    rnd[i] = seed / 2147483647;
  }
  const val = (x, y, per) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const g = (a, b) =>
      rnd[(((a % per) + per) % per * 73 + (((b % per) + per) % per) * 151 + per * 17) % (P * P)];
    const a = g(xi, yi);
    const b = g(xi + 1, yi);
    const c = g(xi, yi + 1);
    const d = g(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const hgt = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let h = 0;
      let amp = 1;
      let per = 4;
      for (let o = 0; o < 4; o++) {
        h += amp * val((x / S) * per, (y / S) * per, per);
        amp *= 0.55;
        per *= 2;
      }
      hgt[y * S + x] = h;
    }
  }
  const canvas = document.createElement('canvas');
  canvas.width = S;
  canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const strength = 2.2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const l = hgt[y * S + ((x - 1 + S) % S)];
      const r = hgt[y * S + ((x + 1) % S)];
      const u = hgt[((y - 1 + S) % S) * S + x];
      const d = hgt[((y + 1) % S) * S + x];
      let nx = (l - r) * strength;
      let ny = (u - d) * strength;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nz /= len;
      const i = (y * S + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

// ---------- חומר השלג: ניצוצות, פסי "קורדרוי" של מכונת הכבישה ----------
function makeSnowMaterial() {
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.86,
    metalness: 0,
    normalMap: makeSnowNormalMap(),
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader =
      'attribute float piste;\nvarying float vPiste;\nvarying float vFlat;\nvarying vec3 vWPos;\n' +
      shader.vertexShader.replace(
        '#include <fog_vertex>',
        '#include <fog_vertex>\n vPiste = piste;\n vFlat = smoothstep(0.55, 0.9, objectNormal.y);\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader =
      'varying float vPiste;\nvarying float vFlat;\nvarying vec3 vWPos;\n' +
      shader.fragmentShader
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
          normal = normalize(mix(normalize(vNormal), normal, vFlat));
          float camDist = length(cameraPosition - vWPos);
          float cord = vPiste * (1.0 - smoothstep(8.0, 45.0, camDist));
          vec3 wx = normalize((viewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
          normal = normalize(normal + wx * sin(vWPos.x * 22.0 + sin(vWPos.z * 0.05) * 2.0) * 0.1 * cord);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          vec3 cell = floor(vWPos * 18.0);
          float hsh = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
          vec3 vdir = normalize(cameraPosition - vWPos);
          float tw = fract(hsh * 91.7 + dot(vdir, vec3(9.1, 4.7, 6.3)));
          float spark = step(0.992, hsh) * smoothstep(0.85, 1.0, tw)
            * (1.0 - smoothstep(4.0, 25.0, length(cameraPosition - vWPos)));
          totalEmissiveRadiance += vec3(spark * 2.0);`,
        );
  };
  return mat;
}

// מיפוי עמודות: צפוף ליד המסלול, דליל בהרים הרחוקים
function mapU(u) {
  const a = Math.abs(u);
  return Math.sign(u) * (240 * a + 1800 * a * a * a * a);
}

const _g = new THREE.Vector2();
const _c = new THREE.Color();
const SNOW = new THREE.Color(0.95, 0.965, 1.0);
const SNOW_OFF = new THREE.Color(0.88, 0.915, 0.97);
const ROCK = new THREE.Color(0.33, 0.31, 0.3);

function buildChunk(z0, z1, nx, dz, mat) {
  const nz = Math.max(1, Math.round((z1 - z0) / dz));
  const cols = nx + 1;
  const rows = nz + 1;
  const count = cols * rows;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const pst = new Float32Array(count);

  let k = 0;
  for (let r = 0; r < rows; r++) {
    const z = z0 + ((z1 - z0) * r) / nz;
    const c = pisteCenter(z);
    for (let q = 0; q < cols; q++) {
      const u = -1 + (2 * q) / nx;
      const x = c + mapU(u);
      const y = getHeight(x, z);
      getSlope(x, z, _g);
      let nxv = -_g.x;
      let nyv = 1;
      let nzv = -_g.y;
      const len = Math.hypot(nxv, nyv, nzv);
      nxv /= len;
      nyv /= len;
      nzv /= len;

      // צבע: שלג מטופח / שלג טבעי / סלע בשיפועים תלולים
      const out = outside(x, z);
      const steep = Math.hypot(_g.x, _g.y);
      const pf = pisteFactor(x, z);
      _c.copy(SNOW_OFF).lerp(SNOW, pf);
      const patch = nB(x * 0.02 + 40, z * 0.02) * 0.03;
      _c.r += patch;
      _c.g += patch;
      const rock = smoothstep(0.75, 1.25, steep) * smoothstep(60, 250, out);
      if (rock > 0) {
        const rn = 0.85 + 0.3 * nC(x * 0.05, z * 0.05);
        _c.lerp(ROCK, rock * Math.min(1, rn));
      }

      pos[k * 3] = x;
      pos[k * 3 + 1] = y;
      pos[k * 3 + 2] = z;
      nor[k * 3] = nxv;
      nor[k * 3 + 1] = nyv;
      nor[k * 3 + 2] = nzv;
      col[k * 3] = _c.r;
      col[k * 3 + 1] = _c.g;
      col[k * 3 + 2] = _c.b;
      uv[k * 2] = x / 4;
      uv[k * 2 + 1] = (z - z0) / 4;
      pst[k] = pf;
      k++;
    }
  }

  const idxCount = nx * nz * 6;
  const index = count > 65535 ? new Uint32Array(idxCount) : new Uint16Array(idxCount);
  let i = 0;
  for (let r = 0; r < nz; r++) {
    for (let q = 0; q < nx; q++) {
      const a = r * cols + q;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      index[i++] = a;
      index[i++] = c;
      index[i++] = b;
      index[i++] = b;
      index[i++] = c;
      index[i++] = d;
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('piste', new THREE.BufferAttribute(pst, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- עמודי סימון מסלול (כחול עם קצה כתום) ----------
function createMarkers(scene) {
  const spacing = 40;
  const rows = Math.floor(SLOPE_LENGTH / spacing);
  const geo = new THREE.CylinderGeometry(0.035, 0.04, 2.0, 6, 6);
  geo.translate(0, 1.0, 0);
  const p = geo.attributes.position;
  const colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const top = p.getY(i) > 1.65;
    colors[i * 3] = top ? 1.0 : 0.08;
    colors[i * 3 + 1] = top ? 0.45 : 0.25;
    colors[i * 3 + 2] = top ? 0.05 : 0.75;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const mesh = new THREE.InstancedMesh(geo, mat, rows * 2);
  const m = new THREE.Matrix4();
  let k = 0;
  for (let r = 1; r < rows; r++) {
    const z = r * spacing;
    for (let side = -1; side <= 1; side += 2) {
      const x = pisteCenter(z) + side * (pisteHalfWidth(z) + 1);
      m.makeTranslation(x, getHeight(x, z) - 0.2, z);
      mesh.setMatrixAt(k++, m);
    }
  }
  mesh.count = k;
  mesh.castShadow = true;
  scene.add(mesh);
}

// ---------- בניית כל ההר ----------
export function createTerrain(scene) {
  const mat = makeSnowMaterial();
  const chunks = [];
  for (let z0 = Z_MIN; z0 < Z_MAX; z0 += CHUNK) {
    const z1 = Math.min(Z_MAX, z0 + CHUNK);
    const hi = buildChunk(z0, z1, 128, 6, mat); // פירוט גבוה (קרוב)
    const lo = buildChunk(z0, z1, 64, 20, mat); // פירוט נמוך (רחוק)
    lo.receiveShadow = false;
    hi.visible = false;
    lo.visible = false;
    scene.add(hi);
    scene.add(lo);
    chunks.push({ zc: (z0 + z1) / 2, hi, lo });
  }
  createMarkers(scene);

  return {
    // LOD: חתיכות קרובות בפירוט גבוה, רחוקות בפירוט נמוך
    update(camPos) {
      for (let i = 0; i < chunks.length; i++) {
        const c = chunks[i];
        const d = Math.abs(camPos.z - c.zc);
        c.hi.visible = d < 360;
        c.lo.visible = d >= 360 && d < 3200;
      }
    },
  };
}
