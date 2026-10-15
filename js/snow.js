// snow.js — שלג יורד. מספר קבוע של פתיתים שזזים סביב המצלמה ו"עוטפים" חזרה
// (כשפתית יוצא מהקופסה הוא חוזר מהצד השני), כך שאף פעם לא יוצרים פתיתים חדשים.
import * as THREE from 'three';

function makeFlakeTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

export class Snowfall {
  constructor(scene, count = 1000, area = 50, height = 26) {
    this.count = count;
    this.area = area;
    this.height = height;
    this.time = 0;

    this.positions = new Float32Array(count * 3);
    this.speeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.positions[i * 3] = (Math.random() - 0.5) * area;
      this.positions[i * 3 + 1] = Math.random() * height;
      this.positions[i * 3 + 2] = (Math.random() - 0.5) * area;
      this.speeds[i] = 1.2 + Math.random() * 1.6;
    }

    const geo = new THREE.BufferGeometry();
    this.attr = new THREE.BufferAttribute(this.positions, 3);
    this.attr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.attr);

    const mat = new THREE.PointsMaterial({
      size: 0.16,
      map: makeFlakeTexture(),
      transparent: true,
      depthWrite: false,
      color: 0xffffff,
    });

    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(dt, center) {
    this.time += dt;
    const p = this.positions;
    const half = this.area / 2;
    const area = this.area;
    const h = this.height;
    const bottom = center.y - h * 0.5;
    const windX = Math.sin(this.time * 0.3) * 0.8;

    for (let i = 0; i < this.count; i++) {
      const i3 = i * 3;
      let x = p[i3] + (windX + Math.sin(this.time * 1.3 + i) * 0.4) * dt;
      let y = p[i3 + 1] - this.speeds[i] * dt;
      let z = p[i3 + 2];

      // עטיפה סביב המצלמה
      const dx = x - center.x;
      if (dx > half) x -= area;
      else if (dx < -half) x += area;
      const dz = z - center.z;
      if (dz > half) z -= area;
      else if (dz < -half) z += area;
      const dy = y - bottom;
      if (dy < 0) y += h;
      else if (dy > h) y -= h;

      p[i3] = x;
      p[i3 + 1] = y;
      p[i3 + 2] = z;
    }
    this.attr.needsUpdate = true;
  }
}
