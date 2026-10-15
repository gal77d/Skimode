// effects.js — עקבות מגלשיים בשלג ורסס שלג בפניות ובבלימות.
// שניהם עובדים עם "מאגר" קבוע (object pooling): לא נוצרים אובייקטים חדשים תוך כדי משחק.
import * as THREE from 'three';
import { getHeight } from './terrain.js';

function makeSoftTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

// ---------- עקבות ----------
export class SkiTracks {
  constructor(scene, maxSegments = 900) {
    this.max = maxSegments;
    this.positions = new Float32Array(maxSegments * 6 * 3);
    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.positions, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x8fa3bf,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.next = 0;
    this.last = [new THREE.Vector3(), new THREE.Vector3()];
    this.has = false;
    this.dirty = false;
  }

  reset() {
    this.positions.fill(0);
    this.attr.needsUpdate = true;
    this.has = false;
  }

  break() {
    this.has = false;
  }

  // a, b = מרכזי שני המגלשיים כרגע
  add(a, b) {
    if (!this.has) {
      this.last[0].copy(a);
      this.last[1].copy(b);
      this.has = true;
      return;
    }
    const dx = a.x - this.last[0].x;
    const dz = a.z - this.last[0].z;
    if (dx * dx + dz * dz < 0.5) return;
    this._segment(this.last[0], a);
    this._segment(this.last[1], b);
    this.last[0].copy(a);
    this.last[1].copy(b);
    this.dirty = true;
  }

  _segment(p0, p1) {
    const dx = p1.x - p0.x;
    const dz = p1.z - p0.z;
    const len = Math.hypot(dx, dz) || 1;
    const px = (-dz / len) * 0.05;
    const pz = (dx / len) * 0.05;
    const y0 = getHeight(p0.x, p0.z) + 0.025;
    const y1 = getHeight(p1.x, p1.z) + 0.025;
    const o = this.next * 18;
    const P = this.positions;
    // משולש 1
    P[o] = p0.x - px; P[o + 1] = y0; P[o + 2] = p0.z - pz;
    P[o + 3] = p0.x + px; P[o + 4] = y0; P[o + 5] = p0.z + pz;
    P[o + 6] = p1.x - px; P[o + 7] = y1; P[o + 8] = p1.z - pz;
    // משולש 2
    P[o + 9] = p0.x + px; P[o + 10] = y0; P[o + 11] = p0.z + pz;
    P[o + 12] = p1.x + px; P[o + 13] = y1; P[o + 14] = p1.z + pz;
    P[o + 15] = p1.x - px; P[o + 16] = y1; P[o + 17] = p1.z - pz;
    this.next = (this.next + 1) % this.max;
  }

  update() {
    if (this.dirty) {
      this.attr.needsUpdate = true;
      this.dirty = false;
    }
  }
}

// ---------- רסס שלג ----------
export class SnowSpray {
  constructor(scene, max = 500) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    for (let i = 0; i < max; i++) {
      this.col[i * 4] = 1;
      this.col[i * 4 + 1] = 1;
      this.col[i * 4 + 2] = 1;
      this.col[i * 4 + 3] = 0;
      this.pos[i * 3 + 1] = -99999;
    }
    const geo = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.colAttr = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.posAttr);
    geo.setAttribute('color', this.colAttr);
    const mat = new THREE.PointsMaterial({
      size: 0.38,
      map: makeSoftTexture(),
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.next = 0;
    this.active = 0;
  }

  emit(x, y, z, vx, vy, vz, count, spread) {
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.4;
      this.pos[i * 3 + 1] = y + Math.random() * 0.15;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.4;
      this.vel[i * 3] = vx + (Math.random() - 0.5) * spread;
      this.vel[i * 3 + 1] = vy + Math.random() * spread * 0.8;
      this.vel[i * 3 + 2] = vz + (Math.random() - 0.5) * spread;
      const l = 0.5 + Math.random() * 0.7;
      this.life[i] = l;
      this.maxLife[i] = l;
    }
    this.active = 2;
  }

  update(dt) {
    if (this.active <= 0) return;
    let alive = false;
    const drag = Math.max(0, 1 - 2.2 * dt);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      alive = true;
      this.life[i] -= dt;
      const i3 = i * 3;
      this.vel[i3] *= drag;
      this.vel[i3 + 1] = this.vel[i3 + 1] * drag - 5 * dt;
      this.vel[i3 + 2] *= drag;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      const t = Math.max(0, this.life[i] / this.maxLife[i]);
      this.col[i * 4 + 3] = t * 0.8;
      if (this.life[i] <= 0) this.col[i * 4 + 3] = 0;
    }
    this.posAttr.needsUpdate = true;
    this.colAttr.needsUpdate = true;
    if (!alive) this.active--;
  }
}
