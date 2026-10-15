// main.js — נקודת ההתחלה: רנדרר, תאורה וצללים, שמיים, מצלמה, ולולאת המשחק
import * as THREE from 'three';
import { createTerrain, getHeight, SLOPE_LENGTH } from './terrain.js';
import { createForest } from './trees.js';
import { createSky } from './sky.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { Snowfall } from './snow.js';
import { SkiTracks, SnowSpray } from './effects.js';
import { SkiAudio } from './audio.js';

window.__gameLoaded = true;

// ---------- רנדרר ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const MAX_PR = Math.min(window.devicePixelRatio || 1, 1.5);
let pixelRatio = MAX_PR;
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------- סצנה, שמיים, אובך ----------
const HORIZON = new THREE.Color(0xc9dcee);
const ZENITH = new THREE.Color(0x2f6fc0);
const SUN_DIR = new THREE.Vector3(-0.62, 0.5, 0.35).normalize();
const scene = new THREE.Scene();
scene.background = HORIZON;
scene.fog = new THREE.Fog(HORIZON, 120, 2400);
const sky = createSky(scene, SUN_DIR, HORIZON, ZENITH);

// ---------- מצלמה ----------
const BASE_FOV = 62;
const camera = new THREE.PerspectiveCamera(BASE_FOV, window.innerWidth / window.innerHeight, 0.1, 5000);

// ---------- תאורה: שמיים + שמש עם צל אמיתי שעוקב אחרי הגולש ----------
const hemi = new THREE.HemisphereLight(0xbfd6ff, 0xeef3ff, 1.0);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -16;
sun.shadow.camera.right = 16;
sun.shadow.camera.top = 16;
sun.shadow.camera.bottom = -16;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 160;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);
scene.add(sun.target);

// ---------- עולם ----------
const terrain = createTerrain(scene);
const forest = createForest(scene);
const player = new Player(scene);
const snow = new Snowfall(scene, 700, 45, 24);
const tracks = new SkiTracks(scene);
const spray = new SnowSpray(scene);
const audio = new SkiAudio();
const input = new Input();

// ---------- מסך פתיחה ----------
let started = false;
document.getElementById('startBtn').addEventListener('click', () => {
  started = true;
  document.getElementById('overlay').classList.add('hidden');
  document.body.classList.add('playing');
  audio.start();
  const el = document.documentElement;
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
});
const muteBtn = document.getElementById('muteBtn');
muteBtn.addEventListener('click', () => {
  muteBtn.textContent = audio.toggleMute() ? '🔇' : '🔊';
});

// ---------- מצלמה עוקבת (עם רעידה במהירות ובנחיתות) ----------
const camLook = new THREE.Vector3();
const camPos = new THREE.Vector3();
let camYaw = 0;
let camY = player.pos.y + 2;
let shake = 0;
let camTime = 0;

function updateCamera(dt) {
  camTime += dt;
  // המצלמה מסתכלת לכיוון התנועה (כמו מצלמת מרדף), ולאט — לכיוון הגולש
  const moving = player.speed > 3;
  const targetYaw = moving ? Math.atan2(player.vel.x, player.vel.z) : player.heading;
  let diff = targetYaw - camYaw;
  diff = Math.atan2(Math.sin(diff), Math.cos(diff));
  camYaw += diff * Math.min(1, dt * 2.5);

  const fx = Math.sin(camYaw);
  const fz = Math.cos(camYaw);
  const dist = 4.6 + player.speed * 0.035;
  const p = player.pos;
  const cx = p.x - fx * dist;
  const cz = p.z - fz * dist;
  const targetY = Math.max(p.y + 1.9, getHeight(cx, cz) + 1.2);
  camY += (targetY - camY) * Math.min(1, dt * 7);

  // רעידה: קלה במהירות גבוהה, חזקה בנחיתה קשה
  if (player.justLanded) shake = Math.min(1, shake + player.landImpact * 0.06);
  shake = Math.max(0, shake - dt * 2.5);
  const speedShake = Math.max(0, player.speed - 18) * 0.0015;
  const amp = speedShake + shake * 0.12;
  const sx = Math.sin(camTime * 37) * amp;
  const sy = Math.sin(camTime * 43 + 1.3) * amp;

  camPos.set(cx + sx, camY + sy, cz);
  camera.position.copy(camPos);
  camLook.set(p.x + fx * 10, p.y - 0.6, p.z + fz * 10);
  camera.lookAt(camLook);

  const fov = BASE_FOV + Math.min(16, player.speed * 0.3);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov += (fov - camera.fov) * Math.min(1, dt * 2);
    camera.updateProjectionMatrix();
  }
}

// ---------- אפקטים: עקבות + רסס שלג ----------
const _skiA = new THREE.Vector3();
const _skiB = new THREE.Vector3();

function updateEffects(dt) {
  const p = player.pos;
  if (player.resetEvent) {
    tracks.reset();
    player.resetEvent = false;
  }
  if (player.grounded) {
    const off = 0.12 + player.brake * 0.15;
    _skiA.set(p.x + player.rx * off, p.y, p.z + player.rz * off);
    _skiB.set(p.x - player.rx * off, p.y, p.z - player.rz * off);
    tracks.add(_skiA, _skiB);

    // רסס כשמחליקים הצידה / בולמים במהירות
    const sp = player.speed;
    if (sp > 4 && player.skid > 0.15) {
      const n = Math.min(8, Math.floor(player.skid * sp * 0.35 * (dt * 60)));
      if (n > 0) {
        const side = player.skidSign;
        const ox = player.rx * side;
        const oz = player.rz * side;
        spray.emit(
          p.x + ox * 0.3, p.y + 0.05, p.z + oz * 0.3,
          player.vel.x * 0.45 + ox * sp * 0.25, 1.2 + sp * 0.06, player.vel.z * 0.45 + oz * sp * 0.25,
          n, 1.8,
        );
      }
    }
  } else {
    tracks.break();
  }
  if (player.justLanded && player.landImpact > 2) {
    spray.emit(p.x, p.y + 0.05, p.z, player.vel.x * 0.4, 1.5, player.vel.z * 0.4,
      Math.min(40, Math.floor(player.landImpact * 4)), 3.5);
  }
  tracks.update();
  spray.update(dt);
}

// ---------- נתונים על המסך ----------
const speedEl = document.getElementById('speed');
const distEl = document.getElementById('dist');
const fpsEl = document.getElementById('fps');
let hudTimer = 0;
let fpsTimer = 0;
let fpsFrames = 0;
let perfTimer = 0;
let perfFrames = 0;

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

// ---------- רזולוציה דינמית: אם הטלפון מתקשה, מורידים קצת רזולוציה ----------
function adaptQuality(realDt) {
  perfFrames++;
  perfTimer += realDt;
  if (perfTimer < 2) return;
  const fps = perfFrames / perfTimer;
  perfFrames = 0;
  perfTimer = 0;
  let changed = false;
  if (fps < 50 && pixelRatio > 0.75) {
    pixelRatio = Math.max(0.75, pixelRatio - 0.15);
    changed = true;
  } else if (fps < 40 && sun.castShadow) {
    sun.castShadow = false;
  } else if (fps > 58 && pixelRatio < MAX_PR) {
    pixelRatio = Math.min(MAX_PR, pixelRatio + 0.1);
    changed = true;
  }
  if (changed) renderer.setPixelRatio(pixelRatio);
}

// ---------- שינוי גודל מסך ----------
function onResize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', onResize);
window.addEventListener('orientationchange', () => setTimeout(onResize, 200));

// ---------- לולאת המשחק ----------
const clock = new THREE.Clock();

function tick() {
  const realDt = clock.getDelta();
  const dt = Math.min(realDt, 1 / 20);

  if (started) {
    input.update();
    if (input.consumeReset()) player.reset();
    // שני צעדי פיזיקה קטנים בכל פריים = יציבות טובה יותר במהירות גבוהה
    player.update(dt * 0.5, input);
    player.update(dt * 0.5, input);
    updateEffects(dt);
    audio.update(player.speed, player.grounded, player.skid);
  }

  updateCamera(dt);

  // השמש והצל זזים עם הגולש
  sun.position.copy(player.pos).addScaledVector(SUN_DIR, 80);
  sun.target.position.copy(player.pos);
  sky.position.copy(camera.position);

  terrain.update(camera.position);
  forest.update(camera.position);
  snow.update(dt, camera.position);
  renderer.render(scene, camera);
  updateHud(realDt);
  if (started) adaptQuality(realDt);
  player.justLanded = false;
  player.justTookOff = false;
}

updateCamera(1);
renderer.setAnimationLoop(tick);
