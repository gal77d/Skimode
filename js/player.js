// player.js — הגולש: הדמות שלו והתנועה שלו על המדרון
import * as THREE from 'three';
import { getHeight, getSlope, SLOPE_LENGTH, PLAY_HALF } from './terrain.js';

const G = 9.81; // כוח המשיכה (מ'/שנייה²)
const START_Z = 15;

const MU_SNOW = 0.045; // חיכוך רגיל של מגלשיים על שלג
const MU_BRAKE = 0.42; // חיכוך בזמן בלימה ("פיצה")
const DRAG = 0.0028; // התנגדות אוויר בעמידה רגילה
const DRAG_TUCK = 0.0016; // התנגדות אוויר בכפיפה (מהר יותר)
const DRAG_BRAKE = 0.006; // התנגדות אוויר בבלימה
const EDGE_GRIP = 5.5; // כמה חזק הקצוות "תופסים" ומונעים החלקה הצידה
const CARVE_KEEP = 0.65; // כמה מהמהירות נשמרת כשמסובבים
const TURN_RATE = 1.9; // מהירות סיבוב (רדיאנים לשנייה)
const JUMP_SPEED = 5.2; // מהירות הקפיצה למעלה
const PUSH_ACCEL = 2.5; // דחיפה עם המקלות כשהולכים לאט

// משתנים זמניים שנוצרים פעם אחת בלבד (לא בכל פריים)
const _slope = new THREE.Vector2();
const _up = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();

function buildModel() {
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';

  const matSuit = new THREE.MeshLambertMaterial({ color: 0xd62828 });
  const matPants = new THREE.MeshLambertMaterial({ color: 0x1d3557 });
  const matHelmet = new THREE.MeshLambertMaterial({ color: 0x222831 });
  const matGoggles = new THREE.MeshLambertMaterial({ color: 0x00b4d8 });
  const matSki = new THREE.MeshLambertMaterial({ color: 0xffb703 });
  const matPole = new THREE.MeshLambertMaterial({ color: 0x9aa5b1 });

  // מגלשיים
  const skiGeo = new THREE.BoxGeometry(0.11, 0.03, 1.7);
  const skis = [];
  for (let side = -1; side <= 1; side += 2) {
    const ski = new THREE.Mesh(skiGeo, matSki);
    ski.position.set(side * 0.14, 0.015, 0.1);
    ski.userData.side = side;
    root.add(ski);
    skis.push(ski);
  }

  // רגליים (נקודת הציר למטה כדי שיתכווצו לכיוון הקרקע)
  const legGeo = new THREE.BoxGeometry(0.13, 0.8, 0.15);
  legGeo.translate(0, 0.4, 0);
  const legs = [];
  for (let side = -1; side <= 1; side += 2) {
    const leg = new THREE.Mesh(legGeo, matPants);
    leg.position.set(side * 0.14, 0.03, 0);
    root.add(leg);
    legs.push(leg);
  }

  // פלג גוף עליון (נוטה קדימה ויורד בכפיפה)
  const torso = new THREE.Group();
  torso.position.y = 0.83;
  root.add(torso);

  const chest = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.35, 4, 8), matSuit);
  chest.position.y = 0.32;
  torso.add(chest);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), matHelmet);
  head.position.y = 0.8;
  torso.add(head);

  const goggles = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.06), matGoggles);
  goggles.position.set(0, 0.8, 0.13);
  torso.add(goggles);

  const armGeo = new THREE.BoxGeometry(0.08, 0.45, 0.08);
  armGeo.translate(0, -0.22, 0);
  const poleGeo = new THREE.CylinderGeometry(0.012, 0.012, 1.15, 5);
  poleGeo.translate(0, -0.55, 0);
  for (let side = -1; side <= 1; side += 2) {
    const arm = new THREE.Mesh(armGeo, matSuit);
    arm.position.set(side * 0.27, 0.55, 0);
    arm.rotation.x = -0.6;
    torso.add(arm);
    const pole = new THREE.Mesh(poleGeo, matPole);
    pole.position.set(0, -0.42, 0);
    pole.rotation.x = 1.0;
    arm.add(pole);
  }

  return { root, torso, legs, skis };
}

export class Player {
  constructor(scene) {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0; // 0 = פונה ישר במורד (+z)
    this.grounded = true;
    this.speed = 0;
    this.pitch = 0;
    this.lean = 0;
    this.tuck = 0;
    this.brake = 0;

    const model = buildModel();
    this.mesh = model.root;
    this.torso = model.torso;
    this.legs = model.legs;
    this.skis = model.skis;
    scene.add(this.mesh);

    // צל עגול פשוט מתחת לגולש (זול מאוד לעומת צל אמיתי)
    const shadowGeo = new THREE.CircleGeometry(0.9, 20);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    scene.add(this.shadow);

    this.reset();
  }

  reset() {
    this.pos.set(0, getHeight(0, START_Z), START_Z);
    this.vel.set(0, 0, 0);
    this.heading = 0;
    this.grounded = true;
    this.speed = 0;
    this.pitch = 0;
    this.lean = 0;
    this.tuck = 0;
    this.brake = 0;
    this._updateVisual(1, 0);
  }

  update(dt, input) {
    // החלקה של הקלט כדי שהתנועה תהיה רכה
    const blend = Math.min(1, dt * 6);
    this.tuck += (input.tuck - this.tuck) * blend;
    this.brake += (input.brake - this.brake) * blend;

    if (input.consumeJump() && this.grounded) {
      this.grounded = false;
      this.vel.y += JUMP_SPEED;
    }

    // סיבוב: steer חיובי = ימינה (ימינה מנקודת המבט של המצלמה זה כיוון -x)
    const turnFactor = (this.grounded ? 1 : 0.5) * (1 - 0.3 * this.tuck);
    this.heading -= input.steer * TURN_RATE * turnFactor * dt;

    const fx = Math.sin(this.heading); // כיוון קדימה
    const fz = Math.cos(this.heading);
    const rx = fz; // כיוון הצד
    const rz = -fx;

    if (this.grounded) this._groundStep(dt, fx, fz, rx, rz);
    else this._airStep(dt);

    // לא יוצאים מגבולות המסלול
    if (this.pos.x > PLAY_HALF || this.pos.x < -PLAY_HALF) {
      this.pos.x = Math.sign(this.pos.x) * PLAY_HALF;
      this.vel.x = 0;
      if (this.grounded) this.pos.y = getHeight(this.pos.x, this.pos.z);
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    // הגענו לסוף המדרון? מתחילים מחדש (בשלב 2 העולם יהיה אינסופי)
    if (this.pos.z > SLOPE_LENGTH - 10) {
      this.reset();
      return;
    }

    this._updateVisual(dt, input.steer);
  }

  _groundStep(dt, fx, fz, rx, rz) {
    getSlope(this.pos.x, this.pos.z, _slope);
    const gx = _slope.x;
    const gz = _slope.y;
    const k = 1 + gx * gx + gz * gz;
    const cosT = 1 / Math.sqrt(k);

    // 1) כוח המשיכה מושך במורד השיפוע
    let vx = this.vel.x - (G * gx / k) * dt;
    let vz = this.vel.z - (G * gz / k) * dt;

    // 2) מפרקים את המהירות ל"לאורך המגלשיים" ו"הצידה"
    let vf = vx * fx + vz * fz;
    let vl = vx * rx + vz * rz;
    const sBefore = Math.hypot(vf, vl);

    // 3) הקצוות תופסים: ההחלקה הצידה נעלמת בהדרגה
    vl *= Math.exp(-EDGE_GRIP * dt);

    // 4) בפנייה רגילה (לא בבלימה) רוב המהירות מופנית לכיוון החדש
    const sAfter = Math.hypot(vf, vl);
    if (sAfter > 0.01 && this.brake < 0.5) {
      const keep = sAfter + (sBefore - sAfter) * CARVE_KEEP;
      const sc = keep / sAfter;
      vf *= sc;
      vl *= sc;
    }

    vx = vf * fx + vl * rx;
    vz = vf * fz + vl * rz;

    // 5) דחיפה עם המקלות כשכמעט עומדים ולוחצים קדימה
    let s = Math.hypot(vx, vz);
    if (this.tuck > 0.3 && s < 6) {
      vx += fx * PUSH_ACCEL * this.tuck * dt;
      vz += fz * PUSH_ACCEL * this.tuck * dt;
      s = Math.hypot(vx, vz);
    }

    // 6) חיכוך שלג + התנגדות אוויר
    if (s > 0.0001) {
      const mu = MU_SNOW + (MU_BRAKE - MU_SNOW) * this.brake;
      let drag = DRAG + (DRAG_TUCK - DRAG) * this.tuck;
      drag += (DRAG_BRAKE - drag) * this.brake;
      const decel = mu * G * cosT + drag * s * s;
      const ns = Math.max(0, s - decel * dt);
      vx *= ns / s;
      vz *= ns / s;
    }

    // 7) מזיזים את הגולש ומדביקים אותו לשלג
    const oldY = this.pos.y;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    this.pos.y = getHeight(this.pos.x, this.pos.z);

    this.vel.x = vx;
    this.vel.z = vz;
    this.vel.y = (this.pos.y - oldY) / dt; // מהירות אנכית (חשוב לקפיצה)
  }

  _airStep(dt) {
    this.vel.y -= G * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const gy = getHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      // נחיתה (בשלב 3 נוסיף נחיתה טובה/גרועה)
      this.pos.y = gy;
      this.vel.y = 0;
      this.grounded = true;
    }
  }

  _updateVisual(dt, steer) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = fz;
    const rz = -fx;
    const blend = Math.min(1, dt * 10);

    getSlope(this.pos.x, this.pos.z, _slope);
    const gx = _slope.x;
    const gz = _slope.y;

    // הטיה קדימה/אחורה לפי השיפוע, והטיה לצד לפי הפנייה והשיפוע הצידי
    const targetPitch = this.grounded ? Math.atan(-(gx * fx + gz * fz)) : this.pitch;
    const sideSlope = Math.atan(gx * rx + gz * rz);
    const turnLean = steer * 0.45 * Math.min(1, this.speed / 12);
    const targetLean = this.grounded ? sideSlope + turnLean : turnLean * 0.5;
    this.pitch += (targetPitch - this.pitch) * blend;
    this.lean += (targetLean - this.lean) * blend;

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch, this.heading, this.lean);

    // כפיפה: הרגליים מתקצרות והגוף נוטה קדימה
    const legScale = 1 - 0.3 * this.tuck;
    this.legs[0].scale.y = legScale;
    this.legs[1].scale.y = legScale;
    this.torso.position.y = 0.03 + 0.8 * legScale;
    this.torso.rotation.x = 0.15 + this.tuck * 0.7;

    // בלימה: קצות המגלשיים מתקרבים ("פיצה")
    for (let i = 0; i < 2; i++) {
      const ski = this.skis[i];
      ski.rotation.y = -ski.userData.side * 0.3 * this.brake;
    }

    // הצל על השלג
    const groundY = getHeight(this.pos.x, this.pos.z);
    this.shadow.position.set(this.pos.x, groundY + 0.04, this.pos.z);
    _normal.set(-gx, 1, -gz).normalize();
    this.shadow.quaternion.setFromUnitVectors(_up, _normal);
    const air = this.pos.y - groundY;
    const sc = Math.max(0.4, 1 - air * 0.1);
    this.shadow.scale.setScalar(sc);
    this.shadowMat.opacity = 0.22 * sc;
  }
}
