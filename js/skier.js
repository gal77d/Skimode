// skier.js — דמות הגולש: גוף מעוגל (מעיל, מכנסיים, מגפי סקי, כפפות, קסדה, משקפיים,
// כיסוי פנים), עם מפרקים אמיתיים. הרגליים מחושבות ב-IK כך שהמגפיים נשארים על המגלשיים.
import * as THREE from 'three';

const THIGH = 0.46;
const SHIN = 0.46;
const UPPER_ARM = 0.3;
const FOREARM = 0.27;
const ANKLE_Y = 0.17; // גובה הקרסול מעל תחתית המגלש
const SKI_LEN = 1.72;

// גוף עגול מפרופיל (סיבוב קו סביב ציר Y)
function lathe(points, mat, segs = 14) {
  const pts = points.map((p) => new THREE.Vector2(p[0], p[1]));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, segs), mat);
}

function makeSkiGeometry() {
  const t = 0.02;
  const tail = -0.74;
  const tip = tail + SKI_LEN;
  const s = new THREE.Shape();
  s.moveTo(tail, 0.01);
  s.quadraticCurveTo(tail - 0.03, 0.02, tail - 0.025, 0.05);
  s.lineTo(tail - 0.012, 0.05);
  s.quadraticCurveTo(tail - 0.01, t + 0.005, tail + 0.05, t);
  s.lineTo(tip - 0.24, t);
  s.quadraticCurveTo(tip - 0.06, t + 0.01, tip, 0.1);
  s.lineTo(tip - 0.012, 0.106);
  s.quadraticCurveTo(tip - 0.09, 0.015, tip - 0.26, 0);
  s.lineTo(tail + 0.05, 0);
  s.quadraticCurveTo(tail + 0.005, 0, tail, 0.01);
  const width = 0.078;
  const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 8 });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

// מגף סקי: פרופיל צד שעובר "שחול" לרוחב (0 = הקרסול)
function makeBootGeometry() {
  const s = new THREE.Shape();
  const sole = -(ANKLE_Y - 0.045);
  s.moveTo(-0.13, sole);
  s.lineTo(0.15, sole);
  s.quadraticCurveTo(0.175, sole, 0.172, sole + 0.04);
  s.quadraticCurveTo(0.16, sole + 0.075, 0.1, sole + 0.095);
  s.quadraticCurveTo(0.07, sole + 0.12, 0.065, 0.06);
  s.lineTo(0.075, 0.2);
  s.lineTo(0.06, 0.225);
  s.lineTo(-0.085, 0.225);
  s.lineTo(-0.1, 0.12);
  s.quadraticCurveTo(-0.115, 0.0, -0.13, sole + 0.04);
  s.lineTo(-0.13, sole);
  const width = 0.105;
  const geo = new THREE.ExtrudeGeometry(s, {
    depth: width, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 6,
  });
  geo.rotateY(-Math.PI / 2);
  geo.translate(width / 2, 0, 0);
  return geo;
}

export function createSkier() {
  const M = (color, rough = 0.8, metal = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const jacket = M(0xb01f2b, 0.62);
  const jacketDark = M(0x16191f, 0.75);
  const pants = M(0x23272f, 0.82);
  const boots = M(0xe8ebef, 0.3);
  const bootDark = M(0x1a1d22, 0.45);
  const buckle = M(0xbfc6cf, 0.25, 0.85);
  const glove = M(0x121418, 0.7);
  const helmetMat = M(0x202329, 0.42);
  const gaiter = M(0x3a3f48, 0.95);
  const lensMat = new THREE.MeshPhongMaterial({
    color: 0x2a1b55, specular: 0xffb36b, shininess: 140, emissive: 0x1a0f00,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4, side: THREE.DoubleSide });
  const strap = M(0xd0302b, 0.8);
  const skiTop = M(0x101826, 0.3, 0.25);
  const skiSide = M(0xe9eef4, 0.4);
  const bindingMat = M(0x8b939d, 0.35, 0.7);
  const poleMat = M(0xc0c7cf, 0.25, 0.85);
  const gripMat = M(0x101010, 0.8);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  // ---------- מגלשיים + קשירות ----------
  const skiGeo = makeSkiGeometry();
  const bindGeo = new THREE.BoxGeometry(0.075, 0.035, 0.3);
  const heelGeo = new THREE.BoxGeometry(0.08, 0.06, 0.1);
  const skis = [];
  for (let side = -1; side <= 1; side += 2) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(skiGeo, [skiSide, skiTop]));
    const b = new THREE.Mesh(bindGeo, bindingMat);
    b.position.set(0, 0.035, 0.02);
    g.add(b);
    const heel = new THREE.Mesh(heelGeo, bindingMat);
    heel.position.set(0, 0.05, -0.16);
    g.add(heel);
    root.add(g);
    skis.push(g);
  }

  // ---------- רגליים ----------
  const bootGeo = makeBootGeometry();
  const buckleGeo = new THREE.BoxGeometry(0.13, 0.012, 0.05);
  const legs = [];
  for (let side = -1; side <= 1; side += 2) {
    const hip = new THREE.Group();
    root.add(hip);
    const thigh = new THREE.Group();
    hip.add(thigh);
    thigh.add(lathe([[0, 0.03], [0.085, 0.02], [0.098, -0.06], [0.09, -0.24], [0.074, -0.42], [0.064, -0.47], [0, -0.48]], pants));
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    thigh.add(knee);
    knee.add(lathe([[0, 0.02], [0.066, 0.0], [0.061, -0.14], [0.068, -0.24], [0.083, -0.27], [0, -0.275]], pants));
    const ankle = new THREE.Group();
    ankle.position.y = -SHIN;
    ankle.rotation.order = 'XZY';
    knee.add(ankle);
    ankle.add(new THREE.Mesh(bootGeo, boots));
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.07, 0.1, 12), bootDark);
    cuff.position.set(0, 0.17, -0.005);
    cuff.scale.set(1, 1, 1.2);
    ankle.add(cuff);
    for (let i = 0; i < 3; i++) {
      const bk = new THREE.Mesh(buckleGeo, buckle);
      bk.position.set(0, -0.02 + i * 0.075, 0.075 - i * 0.004);
      bk.rotation.x = -0.25;
      ankle.add(bk);
    }
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.022, 0.31), bootDark);
    sole.position.set(0, -(ANKLE_Y - 0.056), 0.012);
    ankle.add(sole);
    legs.push({ side, hip, thigh, knee, ankle });
  }

  // ---------- אגן וגוף ----------
  const pelvis = new THREE.Group();
  root.add(pelvis);
  const hips = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), pants);
  hips.scale.set(1.15, 0.75, 0.85);
  pelvis.add(hips);

  const spine = new THREE.Group();
  spine.position.y = 0.02;
  pelvis.add(spine);

  const torso = lathe(
    [[0, -0.06], [0.15, -0.05], [0.165, 0.02], [0.15, 0.13], [0.152, 0.22], [0.168, 0.32], [0.178, 0.4], [0.165, 0.47], [0.12, 0.53], [0.065, 0.565], [0, 0.57]],
    jacket, 18,
  );
  torso.scale.set(1.22, 1, 0.8);
  spine.add(torso);
  const hem = lathe([[0.168, -0.07], [0.171, -0.01], [0.166, 0.03], [0.15, 0.03]], jacketDark, 18);
  hem.scale.set(1.22, 1, 0.8);
  spine.add(hem);
  const yoke = lathe([[0.178, 0.39], [0.168, 0.47], [0.122, 0.535], [0.07, 0.565]], jacketDark, 18);
  yoke.scale.set(1.23, 1.01, 0.81);
  spine.add(yoke);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.5, 0.01), jacketDark);
  zip.position.set(0, 0.26, 0.128);
  spine.add(zip);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.095, 0.09, 14), jacket);
  collar.position.y = 0.58;
  spine.add(collar);

  // ---------- ראש: קסדה, משקפיים, כיסוי פנים ----------
  const neck = new THREE.Group();
  neck.position.y = 0.6;
  spine.add(neck);
  const head = new THREE.Group();
  head.position.y = 0.12;
  neck.add(head);
  const gaiterMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.088, 0.078, 0.13, 14), gaiter);
  gaiterMesh.position.set(0, -0.05, 0.005);
  head.add(gaiterMesh);
  const skull = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), gaiter);
  skull.scale.set(1, 1.05, 1.05);
  head.add(skull);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.128, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62),
    helmetMat,
  );
  helmet.scale.set(1, 1.0, 1.14);
  helmet.position.set(0, 0.02, -0.01);
  head.add(helmet);
  const frame = new THREE.Mesh(
    new THREE.CylinderGeometry(0.122, 0.122, 0.072, 20, 1, true, -Math.PI * 0.45, Math.PI * 0.9),
    frameMat,
  );
  frame.scale.set(1, 1, 1.12);
  frame.position.set(0, 0.012, 0.004);
  head.add(frame);
  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.127, 0.127, 0.058, 20, 1, true, -Math.PI * 0.4, Math.PI * 0.8),
    lensMat,
  );
  lens.scale.set(1, 1, 1.12);
  lens.position.set(0, 0.012, 0.006);
  head.add(lens);
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.014, 6, 24), strap);
  band.rotation.x = Math.PI / 2;
  band.scale.set(1, 1.12, 1);
  band.position.set(0, 0.012, -0.01);
  head.add(band);

  // ---------- ידיים ומקלות ----------
  const arms = [];
  for (let side = -1; side <= 1; side += 2) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.19, 0.48, 0);
    spine.add(shoulder);
    shoulder.add(lathe([[0, 0.04], [0.068, 0.02], [0.072, -0.07], [0.064, -0.22], [0.056, -0.3], [0, -0.31]], jacket, 10));
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    shoulder.add(elbow);
    elbow.add(lathe([[0, 0.02], [0.056, 0.0], [0.053, -0.15], [0.06, -0.22], [0.062, -0.25], [0, -0.255]], jacket, 10));
    const hand = new THREE.Group();
    hand.position.y = -FOREARM;
    elbow.add(hand);
    const gl = new THREE.Mesh(new THREE.SphereGeometry(0.052, 12, 10), glove);
    gl.scale.set(0.85, 1.25, 1.0);
    gl.position.y = -0.04;
    hand.add(gl);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.04, 3, 6), glove);
    thumb.position.set(-side * 0.035, -0.03, 0.03);
    thumb.rotation.z = side * 0.6;
    hand.add(thumb);
    const gcuff = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.055, 0.06, 12), glove);
    gcuff.position.y = 0.01;
    hand.add(gcuff);

    const pole = new THREE.Group();
    pole.position.y = -0.04;
    hand.add(pole);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.016, 0.15, 10), gripMat);
    grip.position.y = 0.02;
    pole.add(grip);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.006, 1.1, 8), poleMat);
    shaft.position.y = -0.5;
    pole.add(shaft);
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.01, 14), gripMat);
    basket.position.y = -0.96;
    pole.add(basket);
    const tipM = new THREE.Mesh(new THREE.ConeGeometry(0.006, 0.05, 6), poleMat);
    tipM.position.y = -1.07;
    tipM.rotation.x = Math.PI;
    pole.add(tipM);

    arms.push({ side, shoulder, elbow, hand, pole });
  }

  root.traverse((o) => {
    if (o.isMesh) o.castShadow = true;
  });

  return { root, skis, legs, pelvis, spine, neck, arms };
}

// ---------- תנוחה ----------
// pose: { tuck, brake, air, turn (-1..1 לפי כוח הפנייה), push, compress, time }
export function poseSkier(rig, pose) {
  const { tuck, brake, air, turn, push, compress, time } = pose;
  const aturn = Math.abs(turn);

  // אגן: יורד בכפיפה, בנחיתה ובבליעת גבשושיות; זז פנימה בפנייה
  const breathe = Math.sin(time * 1.7) * 0.006;
  const hipY = 0.98 - tuck * 0.33 - air * 0.12 - compress * 0.2 - brake * 0.05 - aturn * 0.06 + breathe;
  const hipZ = -0.06 - tuck * 0.13 - compress * 0.04;
  const hipX = -turn * 0.1;
  rig.pelvis.position.set(hipX, hipY, hipZ);

  // פלג גוף עליון: נוטה קדימה, ונשאר זקוף יותר מהרגליים בפנייה (אנגולציה)
  const spineLean = 0.25 + tuck * 0.85 + compress * 0.25 + brake * 0.05;
  rig.spine.rotation.set(spineLean, turn * 0.12, -turn * 0.38);
  rig.neck.rotation.set(-spineLean * 0.85, -turn * 0.08, turn * 0.3);

  // רגליים ומגלשיים
  const spread = 0.115 + brake * 0.15 + air * 0.01;
  const plough = brake * 0.3;
  for (let i = 0; i < 2; i++) {
    const L = rig.legs[i];
    const side = L.side;
    const inner = side * turn < 0 ? 1 : 0; // הרגל הפנימית בפנייה מקדימה קצת
    const footX = side * spread;
    const footZ = inner * aturn * 0.09 - (1 - inner) * aturn * 0.03;
    const footY = air * 0.04 * (inner ? 1 : 0.5);
    const yaw = -side * plough;

    const ski = rig.skis[i];
    ski.position.set(footX, footY, footZ);
    ski.rotation.y = yaw;

    const hx = hipX + side * 0.095;
    const dx = footX - hx;
    const dy = ANKLE_Y + footY - hipY;
    const dz = footZ - hipZ;
    L.hip.position.set(hx, hipY, hipZ);
    const roll = Math.atan2(dx, -dy);
    L.hip.rotation.z = roll;

    const V = Math.hypot(dx, dy);
    const dRaw = Math.hypot(V, dz);
    const d = Math.min(THIGH + SHIN - 0.001, Math.max(0.05, dRaw));
    const thetaT = Math.atan2(-dz, V);
    const cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
    const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const t1 = thetaT - a;
    const ky = -Math.cos(t1) * THIGH;
    const kz = -Math.sin(t1) * THIGH;
    const ty = (-V * d) / dRaw;
    const tz = (dz * d) / dRaw;
    const t2 = Math.atan2(-(tz - kz), -(ty - ky));

    L.thigh.rotation.x = t1;
    L.knee.rotation.x = t2 - t1;
    L.ankle.rotation.set(-t2, yaw, -roll);
  }

  // ידיים: לפנים ולצדדים ("מוכן"), צמודות בכפיפה, דחיפה עם המקלות
  const swing = push > 0 ? Math.sin(time * 5.5) * push : 0;
  for (let i = 0; i < 2; i++) {
    const A = rig.arms[i];
    const side = A.side;
    const inner = side * turn < 0 ? 1 : 0;
    const upper = -0.55 - tuck * 0.7 + swing * 0.75 + inner * aturn * 0.25;
    const elbowBend = -0.85 - tuck * 0.6 + Math.max(0, -swing) * 0.45;
    A.shoulder.rotation.set(upper, 0, side * (0.32 - tuck * 0.18 + air * 0.15));
    A.elbow.rotation.set(elbowBend, 0, side * 0.08);
    const poleWorld = 0.42 + tuck * 1.0 + swing * 0.55;
    A.pole.rotation.set(poleWorld - (spineLean + upper + elbowBend), 0, -side * 0.12);
  }
}
