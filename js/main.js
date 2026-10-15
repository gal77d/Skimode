// main.js — נקודת ההתחלה: יוצר סצנה, מצלמה, אור, ומריץ את לולאת המשחק
import * as THREE from 'three';
import { createTerrain, getHeight, SLOPE_LENGTH } from './terrain.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Snowfall } from './snow.js';

window.__gameLoaded = true; // מסמן ל-index.html שהכול נטען

// ---------- רנדרר (מה שמצייר על המסך) ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false, // כבוי לטובת ביצועים בטלפון
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);

// ---------- סצנה, שמיים וערפל ----------
const SKY = 0xa9cbea;
const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY);
scene.fog = new THREE.Fog(SKY, 60, 420);

// ---------- מצלמה ----------
const BASE_FOV = 65;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 600);

// ---------- תאורה ----------
const hemi = new THREE.HemisphereLight(0xeaf4ff, 0x9aa8bd, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6e8, 1.3);
sun.position.set(-50, 100, 30);
scene.add(sun);

// ---------- עולם, שחקן, שלג, שליטה ----------
createTerrain(scene);
const player = new Player(scene);
const snow = new Snowfall(scene);
const input = new Input();

// ---------- מסך פתיחה ----------
let started = false;
document.getElementById('startBtn').addEventListener('click', () => {
  started = true;
  document.getElementById('overlay').classList.add('hidden');
  document.body.classList.add('playing');
  // מסך מלא באנדרואיד (באייפון זה לא נתמך, וזה בסדר)
  const el = document.documentElement;
  if (el.requestFullscreen) {
    el.requestFullscreen().catch(() => {});
  }
});

// ---------- מצלמה שעוקבת אחרי הגולש ----------
const camLook = new THREE.Vector3();
let camHeading = 0;
let camY = player.pos.y + 3;

function updateCamera(dt) {
  // המצלמה מסתובבת אחרי הגולש בעיכוב קטן (נראה חלק יותר)
  let diff = player.heading - camHeading;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  camHeading += diff * Math.min(1, dt * 3);

  const fx = Math.sin(camHeading);
  const fz = Math.cos(camHeading);
  const dist = 6 + player.speed * 0.05;
  const p = player.pos;

  const cx = p.x - fx * dist;
  const cz = p.z - fz * dist;
  const targetY = Math.max(p.y + 2.8, getHeight(cx, cz) + 1.5);
  camY += (targetY - camY) * Math.min(1, dt * 6);

  camera.position.set(cx, camY, cz);
  camLook.set(p.x + fx * 12, p.y - 1.5, p.z + fz * 12);
  camera.lookAt(camLook);

  // זווית ראייה רחבה יותר במהירות = תחושת מהירות
  const fov = BASE_FOV + Math.min(18, player.speed * 0.35);
  if (Math.abs(camera.fov - fov) > 0.1) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
}

// ---------- נתונים על המסך (מתעדכנים כמה פעמים בשנייה, לא בכל פריים) ----------
const speedEl = document.getElementById('speed');
const distEl = document.getElementById('dist');
const fpsEl = document.getElementById('fps');
let hudTimer = 0;
let fpsTimer = 0;
let fpsFrames = 0;

function updateHud(realDt) {
  fpsFrames++;
  fpsTimer += realDt;
  hudTimer += realDt;
  if (hudTimer >= 0.15) {
    hudTimer = 0;
    speedEl.textContent = Math.round(player.speed * 3.6);
    distEl.textContent = Math.max(0, Math.round(SLOPE_LENGTH - player.pos.z));
  }
  if (fpsTimer >= 0.5) {
    fpsEl.textContent = 'FPS: ' + Math.round(fpsFrames / fpsTimer);
    fpsFrames = 0;
    fpsTimer = 0;
  }
}

// ---------- שינוי גודל מסך / סיבוב טלפון ----------
function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

// ---------- לולאת המשחק: רצה כ-60 פעמים בשנייה ----------
const clock = new THREE.Clock();

function tick() {
  const realDt = clock.getDelta();
  const dt = Math.min(realDt, 1 / 20); // אם הטלפון נתקע לרגע, לא "קופצים" קדימה

  if (started) {
    input.update();
    if (input.consumeReset()) player.reset();
    player.update(dt, input);
  }

  updateCamera(dt);
  snow.update(dt, camera.position);
  renderer.render(scene, camera);
  updateHud(realDt);
}

updateCamera(1);
renderer.setAnimationLoop(tick);
