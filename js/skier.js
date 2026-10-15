// skier.js — דמות גולש מציאותית עם מפרקים (ירך, ברך, קרסול, כתף, מרפק).
// הרגליים מחושבות ב-IK (קינמטיקה הפוכה): נותנים איפה הירך ואיפה הרגל,
// והקוד מחשב לבד כמה לכופף את הברך. כך המגפיים תמיד נשארים על המגלשיים.
import * as THREE from 'three';

// אורכי עצמות (מטרים)
const THIGH = 0.45;
const SHIN = 0.45;
const UPPER_ARM = 0.29;
const FOREARM = 0.27;
const ANKLE_Y = 0.16; // גובה הקרסול מעל תחתית המגלש
const SKI_LEN = 1.75;

function capsule(radius, length, mat, segs = 8) {
  // קפסולה שמתחילה ב-0 ויורדת למטה לאורך length
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, segs);
  geo.translate(0, -length / 2, 0);
  return new THREE.Mesh(geo, mat);
}

// מגלש עם קצה מעוקל למעלה (פרופיל צד שעובר "שחול" לרוחב)
function makeSkiGeometry() {
  const t = 0.022; // עובי
  const tail = -0.75;
  const tip = tail + SKI_LEN;
  const s = new THREE.Shape();
  s.moveTo(tail, 0.012);
  s.quadraticCurveTo(tail - 0.03, 0.02, tail - 0.025, 0.045); // זנב מעט מורם
  s.lineTo(tail - 0.012, 0.045);
  s.quadraticCurveTo(tail - 0.01, t + 0.005, tail + 0.04, t);
  s.lineTo(tip - 0.22, t);
  s.quadraticCurveTo(tip - 0.06, t + 0.01, tip, 0.11); // קצה קדמי מעוקל
  s.lineTo(tip - 0.012, 0.115);
  s.quadraticCurveTo(tip - 0.08, 0.02, tip - 0.24, 0);
  s.lineTo(tail + 0.04, 0);
  s.quadraticCurveTo(tail + 0.005, 0, tail, 0.012);

  const width = 0.085;
  const geo = new THREE.ExtrudeGeometry(s, { depth: width, bevelEnabled: false, curveSegments: 6 });
  geo.rotateY(-Math.PI / 2); // ציר האורך של הצורה הופך לכיוון "קדימה" (+z)
  geo.translate(width / 2, 0, 0);
  return geo;
}

export function createSkier() {
  // ---------- חומרים ----------
  const M = (color, rough = 0.8, metal = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
  const jacket = M(0xc81d25, 0.75);
  const jacketDark = M(0x1b1f2a, 0.8);
  const pants = M(0x2b2f3a, 0.85);
  const boots = M(0x1c2740, 0.35);
  const bootTrim = M(0xc9d1da, 0.3, 0.7);
  const glove = M(0x15171c, 0.7);
  const skin = M(0xe0ac8a, 0.7);
  const helmetMat = M(0xf4f6f8, 0.3);
  const goggleMat = new THREE.MeshPhongMaterial({
    color: 0xff8a1f, specular: 0xffffff, shininess: 120, emissive: 0x401800,
  });
  const strap = M(0x111111, 0.9);
  const skiTop = M(0x0f1a2e, 0.35, 0.2);
  const skiSide = M(0xffc21a, 0.5);
  const binding = M(0x8a929c, 0.4, 0.6);
  const poleMat = M(0xb8c0c8, 0.3, 0.8);
  const gripMat = M(0x101010, 0.8);

  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  // ---------- מגלשיים ----------
  const skiGeo = makeSkiGeometry();
  const bindGeo = new THREE.BoxGeometry(0.07, 0.03, 0.42);
  const skis = [];
  for (let side = -1; side <= 1; side += 2) {
    const g = new THREE.Group();
    const ski = new THREE.Mesh(skiGeo, [skiSide, skiTop]);
    g.add(ski);
    const b = new THREE.Mesh(bindGeo, binding);
    b.position.set(0, 0.035, 0);
    g.add(b);
    g.userData.side = side;
    root.add(g);
    skis.push(g);
  }

  // ---------- רגליים ----------
  const legs = [];
  const bootGeo = new THREE.BoxGeometry(0.115, 0.2, 0.3);
  bootGeo.translate(0, -0.045, 0.02);
  const cuffGeo = new THREE.CylinderGeometry(0.068, 0.075, 0.14, 10);
  const buckleGeo = new THREE.BoxGeometry(0.12, 0.02, 0.1);
  for (let side = -1; side <= 1; side += 2) {
    const hip = new THREE.Group(); // נטייה הצידה של כל הרגל
    root.add(hip);
    const thigh = new THREE.Group();
    hip.add(thigh);
    thigh.add(capsule(0.085, THIGH + 0.04, pants));
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    thigh.add(knee);
    knee.add(capsule(0.07, SHIN, pants));
    const ankle = new THREE.Group();
    ankle.position.y = -SHIN;
    ankle.rotation.order = 'XZY';
    knee.add(ankle);
    const boot = new THREE.Mesh(bootGeo, boots);
    ankle.add(boot);
    const cuff = new THREE.Mesh(cuffGeo, boots);
    cuff.position.y = 0.1;
    ankle.add(cuff);
    for (let i = 0; i < 2; i++) {
      const bk = new THREE.Mesh(buckleGeo, bootTrim);
      bk.position.set(0, 0.04 + i * 0.08, 0.035);
      ankle.add(bk);
    }
    legs.push({ side, hip, thigh, knee, ankle });
  }

  // ---------- אגן וגו ----------
  const pelvis = new THREE.Group();
  root.add(pelvis);
  const hipsGeo = new THREE.CapsuleGeometry(0.12, 0.12, 4, 10);
  hipsGeo.rotateZ(Math.PI / 2);
  const hipsMesh = new THREE.Mesh(hipsGeo, pants);
  hipsMesh.scale.set(1, 1, 0.85);
  pelvis.add(hipsMesh);

  const spine = new THREE.Group();
  spine.position.y = 0.04;
  pelvis.add(spine);

  const chestGeo = new THREE.CapsuleGeometry(0.16, 0.26, 6, 12);
  chestGeo.translate(0, 0.27, 0);
  const chest = new THREE.Mesh(chestGeo, jacket);
  chest.scale.set(1.28, 1, 0.82);
  spine.add(chest);

  // פס כהה על המעיל ורוכסן
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.2, 0.07, 14), jacketDark);
  band.scale.set(1, 1, 0.82);
  band.position.y = 0.36;
  spine.add(band);
  const zip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.36, 0.01), jacketDark);
  zip.position.set(0, 0.3, 0.135);
  spine.add(zip);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.085, 0.07, 12), jacketDark);
  collar.position.y = 0.55;
  spine.add(collar);

  // ---------- ראש וקסדה ----------
  const neck = new THREE.Group();
  neck.position.y = 0.57;
  spine.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 12), skin);
  head.scale.set(0.95, 1.1, 1);
  head.position.y = 0.13;
  neck.add(head);
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.122, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.58),
    helmetMat,
  );
  helmet.scale.set(1, 1.05, 1.12);
  helmet.position.set(0, 0.15, -0.01);
  neck.add(helmet);
  const goggles = new THREE.Mesh(
    new THREE.CylinderGeometry(0.112, 0.112, 0.06, 16, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
    goggleMat,
  );
  goggles.scale.set(1, 1, 1.05);
  goggles.position.set(0, 0.15, 0.012);
  neck.add(goggles);
  const gStrap = new THREE.Mesh(new THREE.TorusGeometry(0.116, 0.012, 6, 20), strap);
  gStrap.rotation.x = Math.PI / 2;
  gStrap.scale.set(1, 1.08, 1);
  gStrap.position.set(0, 0.15, 0);
  neck.add(gStrap);

  // ---------- ידיים ומקלות ----------
  const arms = [];
  const basketGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.008, 12);
  for (let side = -1; side <= 1; side += 2) {
    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.2, 0.47, 0);
    spine.add(shoulder);
    shoulder.add(capsule(0.058, UPPER_ARM + 0.03, jacket));
    const elbow = new THREE.Group();
    elbow.position.y = -UPPER_ARM;
    shoulder.add(elbow);
    elbow.add(capsule(0.05, FOREARM, jacket));
    const hand = new THREE.Group();
    hand.position.y = -FOREARM;
    elbow.add(hand);
    const fist = new THREE.Mesh(new THREE.SphereGeometry(0.048, 10, 8), glove);
    fist.scale.set(0.9, 1.15, 1);
    hand.add(fist);

    const pole = new THREE.Group();
    hand.add(pole);
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.017, 0.14, 8), gripMat);
    grip.position.y = 0.02;
    pole.add(grip);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.006, 1.12, 6), poleMat);
    shaft.position.y = -0.5;
    pole.add(shaft);
    const basket = new THREE.Mesh(basketGeo, gripMat);
    basket.position.y = -0.98;
    pole.add(basket);

    arms.push({ side, shoulder, elbow, hand, pole });
  }

  return { root, skis, legs, pelvis, spine, neck, arms };
}

// ---------- תנוחה ----------
// pose: { tuck 0..1, brake 0..1, air 0..1, turn -1..1, push 0..1, time }
export function poseSkier(rig, pose) {
  const { tuck, brake, air, turn, push, time } = pose;

  // מיקום האגן: יורד ונסוג אחורה כשמתכופפים
  const hipY = 0.97 - tuck * 0.3 - air * 0.14 - brake * 0.05;
  const hipZ = -0.06 - tuck * 0.12;
  const hipX = -turn * 0.06; // הזזת אגן לתוך הפנייה
  rig.pelvis.position.set(hipX, hipY, hipZ);

  // פלג גוף עליון: נוטה קדימה, ונשאר זקוף יותר בפנייה (אנגולציה)
  const spineLean = 0.22 + tuck * 0.85 + brake * 0.05;
  rig.spine.rotation.set(spineLean, 0, -turn * 0.25);
  rig.neck.rotation.x = -spineLean * 0.85; // המבט נשאר קדימה

  // רגליים + מגלשיים
  const spread = 0.12 + brake * 0.14;
  const plough = brake * 0.32;
  for (let i = 0; i < 2; i++) {
    const L = rig.legs[i];
    const side = L.side;
    const footX = side * spread;
    const footZ = 0;
    const yaw = -side * plough;

    const ski = rig.skis[i];
    ski.position.set(footX, 0, footZ);
    ski.rotation.y = yaw;

    // IK: מהירך אל הקרסול
    const hx = hipX + side * 0.1;
    const dx = footX - hx;
    const dy = ANKLE_Y - hipY;
    const dz = footZ - hipZ;
    L.hip.position.set(hx, hipY, hipZ);
    const roll = Math.atan2(dx, -dy);
    L.hip.rotation.z = roll;

    const V = Math.hypot(dx, dy);
    let d = Math.hypot(V, dz);
    d = Math.min(THIGH + SHIN - 0.001, Math.max(0.05, d));
    const thetaT = Math.atan2(-dz, V);
    const cosA = (THIGH * THIGH + d * d - SHIN * SHIN) / (2 * THIGH * d);
    const a = Math.acos(Math.max(-1, Math.min(1, cosA)));
    const t1 = thetaT - a; // הברך הולכת קדימה
    const ky = -Math.cos(t1) * THIGH;
    const kz = -Math.sin(t1) * THIGH;
    const ty = -V * (d / Math.hypot(V, dz));
    const tz = dz * (d / Math.hypot(V, dz));
    const t2 = Math.atan2(-(tz - kz), -(ty - ky));

    L.thigh.rotation.x = t1;
    L.knee.rotation.x = t2 - t1;
    L.ankle.rotation.set(-t2, yaw, -roll); // המגף נשאר ישר על המגלש
  }

  // ידיים: תנוחת "מוכן" / כפיפה / דחיפה עם מקלות
  const swing = push > 0 ? Math.sin(time * 5.5) * push : 0;
  for (let i = 0; i < 2; i++) {
    const A = rig.arms[i];
    const side = A.side;
    const upper = -0.45 - tuck * 0.75 + swing * 0.7;
    const elbowBend = -0.95 - tuck * 0.55 + Math.max(0, -swing) * 0.4;
    A.shoulder.rotation.set(upper, 0, side * (0.28 - tuck * 0.12));
    A.elbow.rotation.set(elbowBend, 0, 0);
    // המקל: כמעט אנכי ונוטה אחורה; בכפיפה — אופקי מתחת לבית השחי
    const poleWorld = 0.35 + tuck * 1.05 + swing * 0.5;
    A.pole.rotation.set(poleWorld - (spineLean + upper + elbowBend), 0, -side * 0.1);
  }
}
