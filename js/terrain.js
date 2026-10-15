// terrain.js — המדרון: הצורה שלו (פונקציית גובה) והציור שלו
import * as THREE from 'three';

// גדלים במטרים
export const SLOPE_LENGTH = 3000; // אורך המדרון
export const SLOPE_WIDTH = 240; // רוחב כולל (כולל הגדות)
export const PISTE_HALF = 70; // חצי רוחב המסלול השטוח, אחריו מתחילות גדות
export const PLAY_HALF = 100; // השחקן לא יכול לצאת יותר מזה הצידה

const SLOPE = 0.32; // שיפוע: יורדים 0.32 מטר על כל מטר קדימה (בערך 18 מעלות)

// מחזירה את גובה השלג בכל נקודה (x,z).
// כיוון "למטה" במדרון הוא +z.
export function getHeight(x, z) {
  let h = -z * SLOPE;
  // גלים עדינים כדי שהמדרון לא יהיה שטוח לגמרי
  h += Math.sin(z * 0.018) * 2.5;
  h += Math.sin(z * 0.05 + x * 0.035) * 0.7;
  h += Math.sin(x * 0.09 - z * 0.013) * 0.35;
  // גדות בצדדים שמחזירות את השחקן למסלול
  const ax = Math.abs(x);
  if (ax > PISTE_HALF) {
    const d = ax - PISTE_HALF;
    h += d * d * 0.03;
  }
  return h;
}

// מחשבת את השיפוע בנקודה: out.x = כמה הגובה משתנה לכיוון x, out.y = לכיוון z.
// משתמשים ב-out קיים כדי לא ליצור אובייקט חדש בכל פריים.
export function getSlope(x, z, out) {
  const e = 0.5;
  out.x = (getHeight(x + e, z) - getHeight(x - e, z)) / (2 * e);
  out.y = (getHeight(x, z + e) - getHeight(x, z - e)) / (2 * e);
  return out;
}

// בונה את רשת השלג ואת עמודי הסימון ומוסיפה לסצנה
export function createTerrain(scene) {
  // --- השלג ---
  const segX = 60;
  const segZ = 400;
  const geo = new THREE.PlaneGeometry(SLOPE_WIDTH, SLOPE_LENGTH + 400, segX, segZ);
  geo.rotateX(-Math.PI / 2); // משכיבים את המישור
  geo.translate(0, 0, SLOPE_LENGTH / 2); // המדרון מתחיל ליד z=0

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    pos.setY(i, getHeight(x, z));

    // צבע: לבן, קצת כחלחל בגדות, ומעט "רעש" כדי שייראה כמו שלג
    const bank = Math.min(1, Math.max(0, (Math.abs(x) - PISTE_HALF) / 40));
    const n = Math.sin(x * 1.7 + z * 0.9) * Math.sin(z * 1.3 - x * 0.4) * 0.025;
    colors[i * 3] = 0.93 - bank * 0.1 + n;
    colors[i * 3 + 1] = 0.96 - bank * 0.05 + n;
    colors[i * 3 + 2] = 1.0;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const snowMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const snow = new THREE.Mesh(geo, snowMat);
  scene.add(snow);

  // --- עמודי סימון בצדי המסלול (אדום משמאל, כחול מימין) ---
  // InstancedMesh = מאות עמודים בציור אחד, חוסך הרבה עבודה לטלפון
  const spacing = 25;
  const rows = Math.floor(SLOPE_LENGTH / spacing);
  const poleGeo = new THREE.CylinderGeometry(0.07, 0.07, 2.2, 6);
  poleGeo.translate(0, 1.1, 0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const poles = new THREE.InstancedMesh(poleGeo, poleMat, rows * 2);
  poles.frustumCulled = false;

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  let k = 0;
  for (let r = 0; r < rows; r++) {
    const z = r * spacing;
    for (let side = -1; side <= 1; side += 2) {
      const x = side * (PISTE_HALF - 4);
      m.makeTranslation(x, getHeight(x, z), z);
      poles.setMatrixAt(k, m);
      c.set(side < 0 ? 0xe63946 : 0x1d4ed8);
      poles.setColorAt(k, c);
      k++;
    }
  }
  scene.add(poles);

  return { snow, poles };
}
