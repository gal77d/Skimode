// input.js — קריאת השליטה: ג'ויסטיק, כפתורים, הטיית טלפון ומקלדת
// התוצאה נשמרת בשדות פשוטים: steer, tuck, brake, ו"קפיצה ממתינה".

const DEADZONE = 0.12; // תנועה קטנה מאוד בג'ויסטיק לא נחשבת
const TILT_MAX_DEG = 22; // כמה מעלות הטיה = היגוי מלא
const TILT_DEADZONE_DEG = 2;

function clamp(v, min, max) {
  return v < min ? min : v > max ? max : v;
}

function applyDeadzone(v) {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  return Math.sign(v) * (a - DEADZONE) / (1 - DEADZONE);
}

function getScreenAngle() {
  if (screen.orientation && typeof screen.orientation.angle === 'number') {
    return screen.orientation.angle;
  }
  if (typeof window.orientation === 'number') {
    return window.orientation;
  }
  return 0;
}

export class Input {
  constructor() {
    // תוצאות (מתעדכנות ב-update)
    this.steer = 0; // -1 שמאלה ... +1 ימינה
    this.tuck = 0; // 0..1 כפיפה למהירות
    this.brake = 0; // 0..1 בלימה

    // מצב פנימי
    this.joyX = 0;
    this.joyY = 0;
    this.brakeBtn = false;
    this.keys = { left: false, right: false, up: false, down: false };
    this.jumpQueued = false;
    this.resetQueued = false;

    this.tiltEnabled = false;
    this.tiltRaw = 0;
    this.tiltZero = null;

    this._onOrient = (e) => {
      if (e.beta === null || e.gamma === null) return;
      const angle = getScreenAngle();
      let t;
      if (angle === 90) t = e.beta;
      else if (angle === 270 || angle === -90) t = -e.beta;
      else t = e.gamma;
      if (this.tiltZero === null) this.tiltZero = t; // כיול: המצב הנוכחי = ישר
      this.tiltRaw = t;
    };
    const recalibrate = () => {
      this.tiltZero = null;
    };
    window.addEventListener('orientationchange', recalibrate);
    if (screen.orientation && screen.orientation.addEventListener) {
      screen.orientation.addEventListener('change', recalibrate);
    }

    this._initJoystick();
    this._initButtons();
    this._initKeyboard();
  }

  // ---------- ג'ויסטיק צף: מופיע איפה שהאגודל נוגע ----------
  _initJoystick() {
    const zone = document.getElementById('joyZone');
    const base = document.getElementById('joyBase');
    const stick = document.getElementById('joyStick');
    let activeId = null;
    let cx = 0;
    let cy = 0;
    let radius = 60;

    const move = (e) => {
      let dx = e.clientX - cx;
      let dy = e.clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius) {
        dx = (dx / d) * radius;
        dy = (dy / d) * radius;
      }
      stick.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
      this.joyX = applyDeadzone(dx / radius);
      this.joyY = applyDeadzone(-dy / radius); // למעלה = חיובי
    };

    zone.addEventListener('pointerdown', (e) => {
      if (activeId !== null) return;
      e.preventDefault();
      activeId = e.pointerId;
      zone.setPointerCapture(e.pointerId);
      const half = base.offsetWidth / 2;
      radius = half * 0.8;
      cx = e.clientX;
      cy = e.clientY;
      base.style.left = cx - half + 'px';
      base.style.top = cy - half + 'px';
      base.style.bottom = 'auto';
      base.classList.add('active');
      move(e);
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId === activeId) move(e);
    });

    const end = (e) => {
      if (e.pointerId !== activeId) return;
      activeId = null;
      this.joyX = 0;
      this.joyY = 0;
      stick.style.transform = '';
      base.style.left = '';
      base.style.top = '';
      base.style.bottom = '';
      base.classList.remove('active');
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
    zone.addEventListener('lostpointercapture', end);
  }

  // ---------- כפתורים ----------
  _bindHold(id, onDown, onUp) {
    const el = document.getElementById(id);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('pressed');
      onDown();
    });
    const up = () => {
      el.classList.remove('pressed');
      if (onUp) onUp();
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('lostpointercapture', up);
  }

  _initButtons() {
    this._bindHold('jumpBtn', () => { this.jumpQueued = true; });
    this._bindHold('brakeBtn', () => { this.brakeBtn = true; }, () => { this.brakeBtn = false; });
    this._bindHold('resetBtn', () => { this.resetQueued = true; });

    // הטיה: חייב להיות 'click' כי באייפון צריך אישור מהמשתמש בלחיצה
    const tiltBtn = document.getElementById('tiltBtn');
    tiltBtn.addEventListener('click', async () => {
      const on = await this.toggleTilt();
      tiltBtn.textContent = on ? '📱 הטיה: פועל' : '📱 הטיה: כבוי';
      tiltBtn.classList.toggle('on', on);
    });
  }

  async toggleTilt() {
    if (this.tiltEnabled) {
      this.tiltEnabled = false;
      window.removeEventListener('deviceorientation', this._onOrient);
      return false;
    }
    if (typeof DeviceOrientationEvent === 'undefined') {
      alert('המכשיר הזה לא תומך בהטיה. השתמש בג׳ויסטיק.');
      return false;
    }
    try {
      if (typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission(); // אייפון
        if (res !== 'granted') {
          alert('לא ניתנה הרשאה לחיישן התנועה.');
          return false;
        }
      }
    } catch (err) {
      alert('לא ניתן להפעיל הטיה: ' + err.message);
      return false;
    }
    this.tiltZero = null;
    this.tiltEnabled = true;
    window.addEventListener('deviceorientation', this._onOrient);
    return true;
  }

  // ---------- מקלדת (לבדיקה במחשב) ----------
  _initKeyboard() {
    const set = (code, value) => {
      switch (code) {
        case 'ArrowLeft': case 'KeyA': this.keys.left = value; return true;
        case 'ArrowRight': case 'KeyD': this.keys.right = value; return true;
        case 'ArrowUp': case 'KeyW': this.keys.up = value; return true;
        case 'ArrowDown': case 'KeyS': this.keys.down = value; return true;
      }
      return false;
    };
    window.addEventListener('keydown', (e) => {
      if (set(e.code, true)) e.preventDefault();
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) this.jumpQueued = true;
      }
      if (e.code === 'KeyR' && !e.repeat) this.resetQueued = true;
    });
    window.addEventListener('keyup', (e) => {
      set(e.code, false);
    });
  }

  // ---------- חישוב התוצאה פעם אחת בכל פריים ----------
  update() {
    let steer = this.joyX;
    let thr = this.joyY;
    if (this.keys.left) steer -= 1;
    if (this.keys.right) steer += 1;
    if (this.keys.up) thr += 1;
    if (this.keys.down) thr -= 1;

    if (this.tiltEnabled && this.tiltZero !== null) {
      let d = this.tiltRaw - this.tiltZero;
      if (Math.abs(d) < TILT_DEADZONE_DEG) d = 0;
      else d -= Math.sign(d) * TILT_DEADZONE_DEG;
      steer += d / TILT_MAX_DEG;
    }

    this.steer = clamp(steer, -1, 1);
    thr = clamp(thr, -1, 1);
    this.tuck = thr > 0 ? thr : 0;
    this.brake = Math.max(this.brakeBtn ? 1 : 0, thr < 0 ? -thr : 0);
  }

  consumeJump() {
    const j = this.jumpQueued;
    this.jumpQueued = false;
    return j;
  }

  consumeReset() {
    const r = this.resetQueued;
    this.resetQueued = false;
    return r;
  }
}
