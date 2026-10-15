// player.js — הגולש: פיזיקה מציאותית של סקי.
// - כוח משיכה לאורך השיפוע האמיתי של השטח
// - "חריצה" (carving): המגלש מסובב את המהירות בלי לאבד אותה, עד גבול האחיזה של הקצוות
// - מעבר לגבול האחיזה: החלקה הצידה (skid) שמאבדת מהירות ומעיפה שלג
// - חיכוך שלג + התנגדות אוויר אמיתית (שטח חזית קטן בכפיפה = מהר יותר)
// - המראה טבעית מגבשושיות כשהקרקע "בורחת" מהר יותר מכוח המשיכה, ונחיתה עם בליעה בברכיים
import * as THREE from 'three';
import { getHeight, getSlope, SLOPE_LENGTH, ROAM_HALF, pisteCenter } from './terrain.js';
import { createSkier, poseSkier } from './skier.js';

const G = 9.81;
const RHO = 1.2; // צפיפות אוויר
const MASS = 78; // ק"ג
const CDA_STAND = 0.55; // מקדם גרר × שטח חזית בעמידה (מ"ר)
const CDA_TUCK = 0.22; // בכפיפה
const CDA_BRAKE = 0.8; // בבלימה
const MU_SNOW = 0.04; // חיכוך מגלשיים על שלג מטופח
const MU_PLOUGH = 0.3; // חיכוך בבלימת "פיצה"
const R_MIN = 9; // רדיוס הסיבוב הכי חד בחריצה (מטרים)
const A_CARVE = 2.1 * G; // אחיזה מקסימלית של הקצוות בחריצה
const A_SKID = 0.85 * G; // אחיזה בזמן החלקה הצידה / עצירת הוקי
const PIVOT_RATE = 1.7; // סיבוב במקום כשנוסעים לאט
const POLE_ACCEL = 1.8; // דחיפה במקלות
const JUMP_SPEED = 3.6; // קפיצה (ollie) ביחס לשלג
const START_Z = 15;

const _slope = new THREE.Vector2();
const _up = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export class Player {
  constructor(scene) {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0; // 0 = ישר במורד (+z)
    this.grounded = true;
    this.speed = 0;
    this.pitch = 0;
    this.lean = 0;
    this.tuck = 0;
    this.brake = 0;
    this.air = 0;
    this.push = 0;
    this.pushing = false;
    this.compress = 0;
    this.compressVel = 0;
    this.latAccel = 0;
    this.skid = 0;
    this.skidSign = 0;
    this.yawRate = 0;
    this.time = 0;
    this.landImpact = 0; // לרעידת מצלמה ורסס בנחיתה
    this.resetEvent = false;
    // אירועים (main.js מאפס אותם אחרי כל פריים)
    this.justLanded = false;
    this.justTookOff = false;
    this.wasReset = true;
    this.rx = 1;
    this.rz = 0;
    this.pose = { tuck: 0, brake: 0, air: 0, turn: 0, push: 0, compress: 0, time: 0 };

    this.rig = createSkier();
    this.mesh = this.rig.root;
    scene.add(this.mesh);

    // צל רך מתחת לגולש (בנוסף לצל האמיתי) — נותן תחושת מגע עם השלג
    const shadowGeo = new THREE.CircleGeometry(0.8, 24);
    shadowGeo.rotateX(-Math.PI / 2);
    this.shadowMat = new THREE.MeshBasicMaterial({
      color: 0x203048,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(shadowGeo, this.shadowMat);
    scene.add(this.shadow);

    this.reset();
  }

  reset() {
    const x = pisteCenter(START_Z);
    this.pos.set(x, getHeight(x, START_Z), START_Z);
    this.vel.set(0, 0, 0);
    this.heading = 0;
    this.grounded = true;
    this.speed = 0;
    this.pitch = 0;
    this.lean = 0;
    this.tuck = 0;
    this.brake = 0;
    this.air = 0;
    this.push = 0;
    this.compress = 0;
    this.compressVel = 0;
    this.latAccel = 0;
    this.skid = 0;
    this.wasReset = true;
    this.resetEvent = true; // main.js מנקה את העקבות
    this._updateVisual(1);
  }

  update(dt, input) {
    const blend = Math.min(1, dt * 6);
    this.tuck += (input.tuck - this.tuck) * blend;
    this.brake += (input.brake - this.brake) * blend;

    if (input.consumeJump() && this.grounded) {
      this.grounded = false;
      this.justTookOff = true;
      this.vel.y += JUMP_SPEED;
      this.compress = -0.3;
    }

    if (this.grounded) this._groundStep(dt, input.steer);
    else this._airStep(dt, input.steer);

    // אפשר לגלוש חופשי הצידה, אבל לא אל תוך ההרים הגבוהים
    const c = pisteCenter(this.pos.z);
    if (Math.abs(this.pos.x - c) > ROAM_HALF) {
      this.pos.x = c + Math.sign(this.pos.x - c) * ROAM_HALF;
      this.vel.x *= -0.2;
      if (this.grounded) this.pos.y = getHeight(this.pos.x, this.pos.z);
    }

    this.speed = Math.hypot(this.vel.x, this.vel.z);

    if (this.pos.z > SLOPE_LENGTH) {
      this.reset();
      return;
    }

    this._updateVisual(dt);
  }

  _groundStep(dt, steer) {
    getSlope(this.pos.x, this.pos.z, _slope);
    const gx = _slope.x;
    const gz = _slope.y;
    const k = 1 + gx * gx + gz * gz;
    const cosT = 1 / Math.sqrt(k);
    let vx = this.vel.x;
    let vz = this.vel.z;
    let s = Math.hypot(vx, vz);

    // 1) סיבוב: לאט = סיבוב במקום; מהר = רדיוס חריצה, מוגבל באחיזה (בכפיפה אחיזה פחותה)
    const grip = A_CARVE * (1 - 0.35 * this.tuck);
    const hockey = this.brake > 0.5 && Math.abs(steer) > 0.25 && s > 3;
    const pivotW = PIVOT_RATE * (1 - Math.min(1, Math.max(0, (s - 2) / 7)));
    const carveW = s > 0.5 ? Math.min(s / R_MIN, grip / s) : 0;
    let w = steer * Math.max(pivotW, carveW);
    if (hockey) w = steer * 3.2;
    this.heading -= w * dt;
    this.yawRate = w;

    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = fz;
    const rz = -fx;
    this.rx = rx;
    this.rz = rz;

    // 2) כוח המשיכה לאורך השיפוע
    vx -= (G * gx / k) * dt;
    vz -= (G * gz / k) * dt;

    // 3) הקצוות דוחפים הצידה עד גבול האחיזה. מה שנשאר = החלקה (skid)
    const vf = vx * fx + vz * fz;
    let vl = vx * rx + vz * rz;
    let latGrip = grip;
    if (hockey) latGrip = A_SKID;
    else if (this.brake > 0.3) latGrip = grip + (A_SKID - grip) * this.brake;
    const need = Math.abs(vl) / dt;
    const applied = Math.min(need, latGrip);
    vl -= Math.sign(vl) * applied * dt;
    s = Math.hypot(vf, vl);
    const skidRaw = s > 1 ? Math.abs(vl) / s : 0;
    const skidTarget = Math.min(1, skidRaw * 5 + (hockey ? 0.7 : 0) + this.brake * 0.3);
    this.skid += (skidTarget - this.skid) * Math.min(1, dt * 10);
    this.skidSign = Math.sign(vl) || this.skidSign;
    // תאוצה צידית אמיתית (קובעת כמה הגוף נוטה פנימה)
    this.latAccel = clamp(s * w, -latGrip, latGrip);

    vx = vf * fx + vl * rx;
    vz = vf * fz + vl * rz;

    // 4) דחיפה במקלות כשנוסעים לאט ולוחצים קדימה
    s = Math.hypot(vx, vz);
    this.pushing = this.tuck > 0.3 && s < 5;
    if (this.pushing) {
      vx += fx * POLE_ACCEL * this.tuck * dt;
      vz += fz * POLE_ACCEL * this.tuck * dt;
      s = Math.hypot(vx, vz);
    }

    // 5) חיכוך שלג (תלוי בכוח הנורמלי) + גרר אוויר (½ρCdA·v²/m)
    if (s > 0.0001) {
      let cda = CDA_STAND + (CDA_TUCK - CDA_STAND) * this.tuck;
      cda += (CDA_BRAKE - cda) * this.brake;
      const drag = (0.5 * RHO * cda) / MASS;
      const mu = MU_SNOW + (MU_PLOUGH - MU_SNOW) * this.brake * (hockey ? 0.4 : 1);
      const decel = mu * G * cosT + drag * s * s;
      const ns = Math.max(0, s - decel * dt);
      vx *= ns / s;
      vz *= ns / s;
    }

    // 6) תנועה + בדיקה אם הקרקע "בורחת" מתחת (גבשושית/שפה) => המראה טבעית
    const oldY = this.pos.y;
    const vySurf = gx * vx + gz * vz;
    this.pos.x += vx * dt;
    this.pos.z += vz * dt;
    const gy = getHeight(this.pos.x, this.pos.z);
    const yBall = oldY + vySurf * dt - 0.5 * G * dt * dt;

    this.vel.x = vx;
    this.vel.z = vz;

    if (gy < yBall - 0.04 && s > 7) {
      this.grounded = false;
      this.justTookOff = true;
      this.pos.y = yBall;
      this.vel.y = vySurf - G * dt;
    } else {
      const newVy = (gy - oldY) / dt;
      // בליעה בברכיים: לחץ מהקרקע (גבשושית קעורה) מכווץ את הרגליים
      const surfAccel = (newVy - this.vel.y) / dt;
      if (!this.wasReset) this.compressVel += clamp(surfAccel / 40, -0.6, 1.2) * dt * 8;
      this.wasReset = false;
      this.pos.y = gy;
      this.vel.y = newVy;
    }
  }

  _airStep(dt, steer) {
    // באוויר אפשר רק לסובב את הגוף (לא משנה את כיוון התנועה)
    this.heading -= steer * 1.6 * dt;
    this.yawRate = steer * 1.6;
    this.latAccel *= Math.max(0, 1 - dt * 4);
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    this.rx = fz;
    this.rz = -fx;

    const s = Math.hypot(this.vel.x, this.vel.z);
    const drag = (0.5 * RHO * (CDA_STAND + (CDA_TUCK - CDA_STAND) * this.tuck)) / MASS;
    const ds = Math.max(0, 1 - drag * s * dt);
    this.vel.x *= ds;
    this.vel.z *= ds;
    this.vel.y -= G * dt;
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;
    this.pos.z += this.vel.z * dt;

    const gy = getHeight(this.pos.x, this.pos.z);
    if (this.pos.y <= gy) {
      // נחיתה: מורידים את רכיב המהירות שנכנס לתוך השלג
      getSlope(this.pos.x, this.pos.z, _slope);
      _normal.set(-_slope.x, 1, -_slope.y).normalize();
      const vn = this.vel.x * _normal.x + this.vel.y * _normal.y + this.vel.z * _normal.z;
      if (vn < 0) {
        this.vel.x -= _normal.x * vn;
        this.vel.z -= _normal.z * vn;
      }
      const impact = Math.max(0, -vn);
      // נחיתה קשה מאבדת מהירות
      if (impact > 6) {
        const loss = Math.min(0.4, (impact - 6) * 0.05);
        this.vel.x *= 1 - loss;
        this.vel.z *= 1 - loss;
      }
      this.landImpact = impact;
      this.compressVel += Math.min(3.5, impact * 0.45);
      this.pos.y = gy;
      this.vel.y = _slope.x * this.vel.x + _slope.y * this.vel.z;
      this.grounded = true;
      this.justLanded = true;
    }
  }

  _updateVisual(dt) {
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const rx = fz;
    const rz = -fx;
    const blend = Math.min(1, dt * 10);
    this.time += dt;

    getSlope(this.pos.x, this.pos.z, _slope);
    const gx = _slope.x;
    const gz = _slope.y;

    // הטיה: קדימה/אחורה לפי השיפוע; לצד לפי התאוצה הצידית (כמו גולש אמיתי) + שיפוע צידי
    const targetPitch = this.grounded ? Math.atan(-(gx * fx + gz * fz)) : this.pitch * 0.98;
    const sideSlope = Math.atan(gx * rx + gz * rz);
    const incline = Math.atan(this.latAccel / G);
    const targetLean = this.grounded ? clamp(sideSlope + incline, -1.1, 1.1) : incline * 0.5;
    this.pitch += (targetPitch - this.pitch) * blend;
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 7);

    this.mesh.position.copy(this.pos);
    this.mesh.rotation.set(this.pitch, this.heading, this.lean);

    // קפיץ לברכיים (בליעת זעזועים)
    this.compressVel += (-this.compress * 60 - this.compressVel * 9) * dt;
    this.compress = clamp(this.compress + this.compressVel * dt, -0.35, 1);

    this.air += ((this.grounded ? 0 : 1) - this.air) * blend;
    this.push += ((this.grounded && this.pushing ? 1 : 0) - this.push) * Math.min(1, dt * 4);
    const pose = this.pose;
    pose.tuck = this.pushing ? 0.15 : this.tuck;
    pose.brake = this.brake;
    pose.air = this.air;
    pose.turn = clamp(this.latAccel / (1.6 * G), -1, 1);
    pose.push = this.push;
    pose.compress = Math.max(0, this.compress);
    pose.time = this.time;
    poseSkier(this.rig, pose);

    const groundY = getHeight(this.pos.x, this.pos.z);
    this.shadow.position.set(this.pos.x, groundY + 0.03, this.pos.z);
    _normal.set(-gx, 1, -gz).normalize();
    this.shadow.quaternion.setFromUnitVectors(_up, _normal);
    const air = this.pos.y - groundY;
    const sc = Math.max(0.3, 1 - air * 0.12);
    this.shadow.scale.setScalar(sc);
    this.shadowMat.opacity = 0.18 * sc;
  }
}
