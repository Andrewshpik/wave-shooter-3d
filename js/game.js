'use strict';

// ---------- HUD refs ----------
const HUD = {
  hpFill: document.getElementById('hp-fill'),
  hpText: document.getElementById('hp-text'),
  xpFill: document.getElementById('xp-fill'),
  xpText: document.getElementById('xp-text'),
  level: document.getElementById('level'),
  score: document.getElementById('score'),
  time: document.getElementById('time'),
  kills: document.getElementById('kills'),
  minimap: document.getElementById('minimap'),
};
HUD.minimapCtx = HUD.minimap.getContext('2d');

// Super-strike charge indicator (created programmatically so we don't touch the HTML).
const superHudEl = document.createElement('div');
superHudEl.id = 'super-hud';
superHudEl.style.cssText = [
  'position:fixed', 'top:90px', 'right:20px',
  'color:#ff8030', 'font:bold 22px system-ui,sans-serif',
  'text-shadow:0 0 8px rgba(255,128,48,0.7)',
  'background:rgba(0,0,0,0.45)', 'padding:6px 12px', 'border-radius:8px',
  'pointer-events:none', 'opacity:0.45',
].join(';');
superHudEl.textContent = '⚡ Space  ×0';
document.body.appendChild(superHudEl);
HUD.superHud = superHudEl;
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over');
const levelUpScreen = document.getElementById('levelup');
const pauseScreen = document.getElementById('pause-screen');
const upgradeCardsRoot = document.getElementById('upgrade-cards');
const finalStats = document.getElementById('final-stats');
const bestScoreEl = document.getElementById('best-score');
const soundToggleBtn = document.getElementById('sound-toggle');
document.getElementById('start-btn').onclick = () => startGame();
document.getElementById('restart-btn').onclick = () => startGame();
document.getElementById('resume-btn').onclick = () => togglePause();

// ---------- High score ----------
const HS_KEY = 'waveshooter.bestScore';
function getBest() { return parseInt(localStorage.getItem(HS_KEY) || '0', 10); }
function setBest(v) { localStorage.setItem(HS_KEY, String(v)); }
function refreshBestUI() {
  const b = getBest();
  bestScoreEl.textContent = b > 0 ? `Лучший счёт: ${b}` : '';
}
refreshBestUI();

// ---------- Sound (Web Audio synth) ----------
class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('waveshooter.muted') === '1';
    this._updateBtn();
  }
  _ensure() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
  toggle() {
    this.muted = !this.muted;
    localStorage.setItem('waveshooter.muted', this.muted ? '1' : '0');
    this._updateBtn();
  }
  _updateBtn() {
    soundToggleBtn.textContent = this.muted ? '🔇' : '🔊';
  }
  _tone({ freq, type = 'square', dur = 0.1, vol = 0.15, freqEnd = null, attack = 0.005 }) {
    if (this.muted) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (freqEnd !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t + dur);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(vol, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }
  _noise({ dur = 0.1, vol = 0.12, lowpass = 1500 }) {
    if (this.muted) return;
    this._ensure();
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(gain).connect(this.ctx.destination);
    src.start(t);
    src.stop(t + dur);
  }
  shoot() { this._tone({ freq: 720, freqEnd: 280, type: 'square', dur: 0.06, vol: 0.06 }); }
  hit()   { this._noise({ dur: 0.06, vol: 0.08, lowpass: 2500 }); }
  enemyDeath() {
    this._tone({ freq: 320, freqEnd: 80, type: 'sawtooth', dur: 0.18, vol: 0.10 });
    this._noise({ dur: 0.18, vol: 0.06, lowpass: 1200 });
  }
  playerHurt() { this._tone({ freq: 220, freqEnd: 90, type: 'square', dur: 0.25, vol: 0.16 }); }
  pickup()     { this._tone({ freq: 880, freqEnd: 1320, type: 'triangle', dur: 0.07, vol: 0.05 }); }
  levelUp() {
    [523, 659, 784, 1047].forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: 'triangle', dur: 0.18, vol: 0.12 }), i * 70);
    });
  }
  bossSpawn() {
    this._tone({ freq: 60, freqEnd: 140, type: 'sawtooth', dur: 0.8, vol: 0.18 });
    this._noise({ dur: 0.8, vol: 0.06, lowpass: 400 });
  }
  bossDeath() {
    [200, 160, 120, 80].forEach((f, i) => {
      setTimeout(() => this._tone({ freq: f, type: 'sawtooth', dur: 0.4, vol: 0.18 }), i * 90);
    });
    this._noise({ dur: 0.6, vol: 0.12, lowpass: 800 });
  }
}
const sfx = new Sfx();
soundToggleBtn.onclick = () => sfx.toggle();

// ---------- Device detection ----------
const isTouch = (navigator.maxTouchPoints > 0) || ('ontouchstart' in window) || matchMedia('(pointer: coarse)').matches;
const isMobile = isTouch && /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
if (isTouch) document.body.classList.add('is-touch');

// ---------- Three.js setup ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isMobile });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.25 : 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(0x0a0a12);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x0a0a12, 40, 120);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 200);
const CAMERA_OFFSET = new THREE.Vector3(0, 22, 22);
camera.position.copy(CAMERA_OFFSET);
camera.lookAt(0, 0, 0);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

scene.add(new THREE.AmbientLight(0xffffff, 0.45));
const sun = new THREE.DirectionalLight(0xfff2c2, 1.1);
sun.position.set(20, 40, 15);
sun.castShadow = true;
sun.shadow.mapSize.set(isMobile ? 512 : 1024, isMobile ? 512 : 1024);
sun.shadow.camera.left = -40;
sun.shadow.camera.right = 40;
sun.shadow.camera.top = 40;
sun.shadow.camera.bottom = -40;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 100;
scene.add(sun);
scene.add(sun.target);

const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a3a25, roughness: 0.95, metalness: 0 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), groundMat);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(400, 100, 0x3a5230, 0x3a5230);
grid.material.transparent = true;
grid.material.opacity = 0.3;
grid.position.y = 0.01;
scene.add(grid);

// ---------- Map boundary ----------
// Playable area is a square centered on origin; entities are clamped to it.
const MAP_BOUND = 45;
const WALL_H = 2.6;
const WALL_T = 1.2;
const wallMat = new THREE.MeshStandardMaterial({ color: 0x555a52, roughness: 0.95, metalness: 0 });
const wallTopMat = new THREE.MeshStandardMaterial({ color: 0x3a3f38, roughness: 0.9 });
function buildWall(cx, cz, w, d) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, WALL_H, d), wallMat);
  body.position.y = WALL_H / 2;
  body.castShadow = true;
  body.receiveShadow = true;
  g.add(body);
  // Darker top cap so the wall reads from above.
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.15, d + 0.1), wallTopMat);
  cap.position.y = WALL_H + 0.05;
  g.add(cap);
  g.position.set(cx, 0, cz);
  scene.add(g);
}
const SIDE = MAP_BOUND * 2 + WALL_T * 2;
buildWall(0,  MAP_BOUND + WALL_T / 2, SIDE, WALL_T);
buildWall(0, -MAP_BOUND - WALL_T / 2, SIDE, WALL_T);
buildWall( MAP_BOUND + WALL_T / 2, 0, WALL_T, MAP_BOUND * 2);
buildWall(-MAP_BOUND - WALL_T / 2, 0, WALL_T, MAP_BOUND * 2);

function clampToMap(entity) {
  const m = MAP_BOUND - entity.r;
  const p = entity.mesh.position;
  if (p.x >  m) p.x =  m;
  else if (p.x < -m) p.x = -m;
  if (p.z >  m) p.z =  m;
  else if (p.z < -m) p.z = -m;
}

// ---------- Input ----------
const keys = new Set();
const mouseNDC = new THREE.Vector2(0, 0);
const mouseState = { down: false, hasMoved: false };

window.addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === 'escape' || k === 'p') {
    if (game && game.running && !game.pendingLevelUps) togglePause();
  }
  if (k === 'm') sfx.toggle();
  if (e.code === 'Space') {
    if (game && game.running && !game.paused && game.player.superCharges > 0) {
      e.preventDefault();
      game.player.superCharges -= 1;
      game.triggerSuperStrike();
    }
  }
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));

// ---------- Virtual joysticks (twin-stick for touch) ----------
class Joystick {
  constructor(elem) {
    this.elem = elem;
    this.knob = elem.querySelector('.knob');
    this.active = false;
    this.pointerId = null;
    this.startX = 0;
    this.startY = 0;
    this.x = 0; // -1..1
    this.y = 0;
    this.maxRadius = 60;
  }
  start(pointerId, cx, cy) {
    this.active = true;
    this.pointerId = pointerId;
    this.startX = cx;
    this.startY = cy;
    this.elem.style.left = cx + 'px';
    this.elem.style.top = cy + 'px';
    this.elem.classList.add('active');
    this.x = 0; this.y = 0;
    this.knob.style.transform = 'translate(0, 0)';
  }
  move(cx, cy) {
    let dx = cx - this.startX;
    let dy = cy - this.startY;
    const len = Math.hypot(dx, dy);
    if (len > this.maxRadius) {
      dx = (dx / len) * this.maxRadius;
      dy = (dy / len) * this.maxRadius;
    }
    this.x = dx / this.maxRadius;
    this.y = dy / this.maxRadius;
    this.knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  end() {
    this.active = false;
    this.pointerId = null;
    this.elem.classList.remove('active');
    this.x = 0; this.y = 0;
  }
}
const leftJoy = new Joystick(document.getElementById('joy-left'));
const rightJoy = new Joystick(document.getElementById('joy-right'));

// Mouse handlers (only for non-touch pointer events)
canvas.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
  mouseState.hasMoved = true;
});
canvas.addEventListener('pointerdown', e => {
  if (e.pointerType === 'mouse') {
    if (e.button === 0) mouseState.down = true;
    return;
  }
  // Touch / pen
  e.preventDefault();
  const half = window.innerWidth / 2;
  const isLeftSide = e.clientX < half;
  const stick = isLeftSide ? leftJoy : rightJoy;
  if (!stick.active) stick.start(e.pointerId, e.clientX, e.clientY);
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') return;
  if (leftJoy.pointerId === e.pointerId) leftJoy.move(e.clientX, e.clientY);
  else if (rightJoy.pointerId === e.pointerId) rightJoy.move(e.clientX, e.clientY);
});
function endPointer(e) {
  if (e.pointerType === 'mouse') {
    if (e.button === 0) mouseState.down = false;
    return;
  }
  if (leftJoy.pointerId === e.pointerId) leftJoy.end();
  else if (rightJoy.pointerId === e.pointerId) rightJoy.end();
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', e => {
  // Only kill touch joysticks on leave; mouse handled by pointerup.
  if (e.pointerType === 'mouse') return;
  if (leftJoy.pointerId === e.pointerId) leftJoy.end();
  else if (rightJoy.pointerId === e.pointerId) rightJoy.end();
});
canvas.addEventListener('contextmenu', e => e.preventDefault());

const raycaster = new THREE.Raycaster();
const aimPoint = new THREE.Vector3();
function updateAimPoint(player) {
  // Touch: right joystick drives aim, fixed offset from player.
  if (rightJoy.active) {
    const len = Math.hypot(rightJoy.x, rightJoy.y);
    if (len > 0.05) {
      aimPoint.set(
        player.mesh.position.x + (rightJoy.x / Math.max(len, 1)) * 30,
        0,
        player.mesh.position.z + (rightJoy.y / Math.max(len, 1)) * 30
      );
      return;
    }
  }
  // Mouse: raycast ground plane.
  raycaster.setFromCamera(mouseNDC, camera);
  const hits = raycaster.intersectObject(ground);
  if (hits.length) aimPoint.copy(hits[0].point);
}

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));

// ---------- Upgrades ----------
const UPGRADES = [
  {
    id: 'damage',  name: 'Урон',  icon: '💥',
    desc: '+25% урона пуль',
    apply: p => { p.bulletDamage *= 1.25; }
  },
  {
    id: 'firerate',  name: 'Скорострельность',  icon: '⚡',
    desc: '-15% к кулдауну выстрела',
    apply: p => { p.fireRate *= 0.85; }
  },
  {
    id: 'speed',  name: 'Скорость',  icon: '👟',
    desc: '+15% скорости движения',
    apply: p => { p.speed *= 1.15; }
  },
  {
    id: 'maxhp',  name: 'Здоровье',  icon: '❤️',
    desc: '+30 макс. HP и +30 HP',
    apply: p => { p.maxHp += 30; p.hp = Math.min(p.maxHp, p.hp + 30); }
  },
  {
    id: 'multishot',  name: 'Мультивыстрел',  icon: '🔱',
    desc: '+1 пуля за выстрел (веером)',
    apply: p => { p.multishot += 1; }
  },
  {
    id: 'pierce',  name: 'Пробивание',  icon: '🏹',
    desc: 'Пуля пробивает +1 врага',
    apply: p => { p.pierce += 1; }
  },
  {
    id: 'magnet',  name: 'Магнит опыта',  icon: '🧲',
    desc: '+60% радиус притяжения опыта',
    apply: p => { p.magnetRadius *= 1.6; },
    noObstacle: true,
  },
  {
    id: 'heal',  name: 'Лечение',  icon: '✨',
    desc: 'Восстановить 60 HP сейчас',
    apply: p => { p.hp = Math.min(p.maxHp, p.hp + 60); },
    noObstacle: true,
  },
  {
    id: 'bulletspeed',  name: 'Скорость пуль',  icon: '💨',
    desc: '+30% скорости пуль и +30% дальности',
    apply: p => { p.bulletSpeed *= 1.3; p.bulletLife *= 1.3; }
  },
];

function pickUpgrades(n) {
  const pool = UPGRADES.slice();
  const out = [];
  for (let i = 0; i < n && pool.length; i++) {
    const idx = randInt(0, pool.length - 1);
    out.push(pool.splice(idx, 1)[0]);
  }
  return out;
}

// ---------- Humanoid figure ----------
// Builds a simple stickman: torso + head + 2 arms + 2 legs.
// Limbs are wrapped in pivot groups so we can swing them around the hip/shoulder.
function buildHumanoid({ color, headColor = null, height = 1.8 }) {
  const group = new THREE.Group();
  const legH = height * 0.40;
  const torsoH = height * 0.32;
  const headR = height * 0.18;
  const torsoW = height * 0.32;
  const torsoD = height * 0.20;
  const limbW = height * 0.13;
  const armH = height * 0.36;

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const headMat = headColor !== null
    ? new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.6 })
    : bodyMat;

  function makeLimb(x, y, len, w, pivotOffset) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, len, w),
      bodyMat
    );
    mesh.position.y = pivotOffset;
    mesh.castShadow = true;
    pivot.add(mesh);
    group.add(pivot);
    return pivot;
  }

  // Legs hang down from the hips.
  const leftLeg  = makeLimb(-torsoW * 0.22, legH, legH, limbW, -legH / 2);
  const rightLeg = makeLimb( torsoW * 0.22, legH, legH, limbW, -legH / 2);

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(torsoW, torsoH, torsoD),
    bodyMat
  );
  torso.position.y = legH + torsoH / 2;
  torso.castShadow = true;
  group.add(torso);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(headR, 12, 10),
    headMat
  );
  head.position.y = legH + torsoH + headR * 0.85;
  head.castShadow = true;
  group.add(head);

  // Arms hang down from the shoulders.
  const armW = limbW * 0.85;
  const shoulderY = legH + torsoH - armH * 0.08;
  const leftArm  = makeLimb(-torsoW / 2 - armW * 0.55, shoulderY, armH, armW, -armH / 2);
  const rightArm = makeLimb( torsoW / 2 + armW * 0.55, shoulderY, armH, armW, -armH / 2);

  return {
    group,
    parts: { head, torso, leftArm, rightArm, leftLeg, rightLeg },
    bodyMat,
    headMat,
    centerY: legH + torsoH * 0.5,
  };
}

function animateRun(parts, phase, legAmp = 0.7, armAmp = 0.6) {
  const swing = Math.sin(phase);
  parts.leftLeg.rotation.x  =  swing * legAmp;
  parts.rightLeg.rotation.x = -swing * legAmp;
  parts.leftArm.rotation.x  = -swing * armAmp;
  parts.rightArm.rotation.x =  swing * armAmp;
}

function relaxRun(parts, factor = 0.85) {
  parts.leftLeg.rotation.x  *= factor;
  parts.rightLeg.rotation.x *= factor;
  parts.leftArm.rotation.x  *= factor;
  parts.rightArm.rotation.x *= factor;
}

// Push entity (circle of radius .r) out of any overlapping obstacles (AABB on XZ).
function resolveObstacles(entity, obstacles) {
  for (const obs of obstacles) {
    const dx = entity.mesh.position.x - obs.mesh.position.x;
    const dz = entity.mesh.position.z - obs.mesh.position.z;
    const adx = Math.abs(dx);
    const adz = Math.abs(dz);
    if (adx > obs.halfW + entity.r || adz > obs.halfD + entity.r) continue;

    if (adx <= obs.halfW && adz <= obs.halfD) {
      // Circle center is inside the AABB — squeeze out along the shorter axis.
      const pushX = obs.halfW + entity.r - adx;
      const pushZ = obs.halfD + entity.r - adz;
      const sgnX = dx === 0 ? 1 : Math.sign(dx);
      const sgnZ = dz === 0 ? 1 : Math.sign(dz);
      if (pushX < pushZ) entity.mesh.position.x += sgnX * (pushX + 0.01);
      else               entity.mesh.position.z += sgnZ * (pushZ + 0.01);
    } else {
      const cx = Math.max(-obs.halfW, Math.min(dx, obs.halfW));
      const cz = Math.max(-obs.halfD, Math.min(dz, obs.halfD));
      const ddx = dx - cx;
      const ddz = dz - cz;
      const d2 = ddx * ddx + ddz * ddz;
      if (d2 < entity.r * entity.r) {
        const d = Math.sqrt(d2) || 1;
        const overlap = entity.r - d + 0.01;
        entity.mesh.position.x += (ddx / d) * overlap;
        entity.mesh.position.z += (ddz / d) * overlap;
      }
    }
  }
}

function bulletHitsObstacle(bullet, obstacles) {
  for (const obs of obstacles) {
    const dx = Math.abs(bullet.mesh.position.x - obs.mesh.position.x);
    const dz = Math.abs(bullet.mesh.position.z - obs.mesh.position.z);
    if (dx < obs.halfW + bullet.r && dz < obs.halfD + bullet.r) return true;
  }
  return false;
}

// ---------- Entities ----------
class Player {
  constructor() {
    const h = buildHumanoid({ color: 0xffd84a, headColor: 0xffe79a, height: 1.8 });
    const group = h.group;

    // Right arm is posed forward as if gripping the gun; it doesn't swing.
    h.parts.rightArm.rotation.x = -Math.PI / 2;

    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.28, 1.1),
      new THREE.MeshStandardMaterial({ color: 0x2a2a36 })
    );
    gun.position.set(0.42, 1.2, 0.95);
    gun.castShadow = true;
    group.add(gun);

    this.mesh = group;
    this.gun = gun;
    this.parts = h.parts;
    this.bodyMat = h.bodyMat;
    this.walkPhase = 0;

    this.r = 0.7;
    this.speed = 8;
    this.hp = 100;
    this.maxHp = 100;

    this.shootCd = 0;
    this.fireRate = 0.18;
    this.bulletSpeed = 35;
    this.bulletDamage = 25;
    this.bulletLife = 1.5;

    this.multishot = 1;     // bullets per shot
    this.pierce = 0;        // extra enemies a bullet can pierce

    this.magnetRadius = 5;
    this.pickupRadius = 1.4;

    this.iframes = 0;

    this.xp = 0;
    this.level = 1;
    this.xpToNext = 5;

    this.superCharges = 0; // earned from destroyed loot crates
  }

  update(dt, game) {
    let dx = 0, dz = 0;
    if (leftJoy.active) {
      dx = leftJoy.x;
      dz = leftJoy.y;
    } else {
      if (keys.has('w') || keys.has('ц') || keys.has('arrowup')) dz -= 1;
      if (keys.has('s') || keys.has('ы') || keys.has('arrowdown')) dz += 1;
      if (keys.has('a') || keys.has('ф') || keys.has('arrowleft')) dx -= 1;
      if (keys.has('d') || keys.has('в') || keys.has('arrowright')) dx += 1;
      const len = Math.hypot(dx, dz);
      if (len > 1) { dx /= len; dz /= len; }
    }
    this.mesh.position.x += dx * this.speed * dt;
    this.mesh.position.z += dz * this.speed * dt;

    resolveObstacles(this, game.obstacles);
    resolveObstacles(this, game.crates);
    clampToMap(this);

    const moveLen = Math.hypot(dx, dz);
    if (moveLen > 0.05) {
      this.walkPhase += dt * 12;
      const swing = Math.sin(this.walkPhase);
      this.parts.leftLeg.rotation.x  =  swing * 0.7;
      this.parts.rightLeg.rotation.x = -swing * 0.7;
      // Right arm stays in firing pose; only the left arm swings.
      this.parts.leftArm.rotation.x  = -swing * 0.5;
    } else {
      this.parts.leftLeg.rotation.x  *= 0.85;
      this.parts.rightLeg.rotation.x *= 0.85;
      this.parts.leftArm.rotation.x  *= 0.85;
    }

    const ax = aimPoint.x - this.mesh.position.x;
    const az = aimPoint.z - this.mesh.position.z;
    if (ax * ax + az * az > 0.0001) {
      this.mesh.rotation.y = Math.atan2(ax, az);
    }

    this.shootCd = Math.max(0, this.shootCd - dt);
    const firing = mouseState.down || (rightJoy.active && Math.hypot(rightJoy.x, rightJoy.y) > 0.15);
    if (firing && this.shootCd <= 0) this.shoot(game);

    if (this.iframes > 0) this.iframes -= dt;
    const flashing = this.iframes > 0 && Math.floor(this.iframes * 20) % 2 === 0;
    this.bodyMat.emissive.setHex(flashing ? 0xffffff : 0x000000);
  }

  shoot(game) {
    this.shootCd = this.fireRate;
    sfx.shoot();
    const muzzle = new THREE.Vector3(0, 1.0, 1.4);
    muzzle.applyEuler(this.mesh.rotation);
    muzzle.add(this.mesh.position);

    const baseDir = new THREE.Vector3(aimPoint.x - muzzle.x, 0, aimPoint.z - muzzle.z).normalize();
    const baseAng = Math.atan2(baseDir.x, baseDir.z);

    const n = this.multishot;
    const spread = (n - 1) * 0.12; // total spread in radians
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : (i / (n - 1)) * 2 - 1; // -1..+1
      const ang = baseAng + t * spread;
      const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
      game.spawnBullet(muzzle, dir, this.bulletSpeed, this.bulletDamage, this.bulletLife, this.pierce);
    }

    for (let i = 0; i < 4; i++) {
      const p = new THREE.Vector3(
        muzzle.x + rand(-0.1, 0.1),
        muzzle.y + rand(-0.1, 0.1),
        muzzle.z + rand(-0.1, 0.1)
      );
      const v = baseDir.clone().multiplyScalar(rand(2, 5));
      v.x += rand(-2, 2); v.y += rand(0, 2); v.z += rand(-2, 2);
      game.spawnParticle(p, v, 0.25, 0xffcf6b);
    }
  }

  takeDamage(amount, game) {
    if (this.iframes > 0) return;
    this.hp -= amount;
    this.iframes = 0.4;
    sfx.playerHurt();
    game.shake = Math.min(1.5, game.shake + 0.6);
    if (this.hp <= 0) {
      this.hp = 0;
      game.gameOver();
    }
  }

  addXP(amount, game) {
    this.xp += amount;
    while (this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level += 1;
      this.xpToNext = 5 + this.level * 3;
      sfx.levelUp();
      game.queueLevelUp();
    }
  }
}

const ENEMY_TYPES = {
  grunt: {
    hp: 75, speedRange: [2.8, 4.0], damage: 14, color: 0xc83a3a,
    size: [1.2, 1.6, 1.2], r: 0.7, xp: 1, score: 10, particleColor: 0xff5b5b,
  },
  fast: {
    hp: 34, speedRange: [6.2, 7.8], damage: 12, color: 0x4ad0ff,
    size: [0.8, 1.2, 0.8], r: 0.5, xp: 1, score: 12, particleColor: 0x6be5ff,
  },
  tank: {
    hp: 270, speedRange: [1.2, 1.7], damage: 32, color: 0x6a1f1f,
    size: [1.8, 2.2, 1.8], r: 1.0, xp: 3, score: 30, particleColor: 0xffaa55,
  },
  shooter: {
    hp: 60, speedRange: [1.8, 2.4], damage: 0, color: 0xc23ad0,
    size: [1.0, 1.6, 1.0], r: 0.6, xp: 2, score: 20, particleColor: 0xe06bff,
    ranged: true, attackRange: 18, attackCd: 1.2,
    projectileSpeed: 18, projectileDamage: 18,
  },
};

class Enemy {
  constructor(x, z, type = 'grunt') {
    const cfg = ENEMY_TYPES[type];
    const h = buildHumanoid({ color: cfg.color, height: cfg.size[1] });
    h.group.position.set(x, 0, z);
    this.mesh = h.group;
    this.parts = h.parts;
    this.bodyMat = h.bodyMat;
    this.centerY = h.centerY;

    this.type = type;
    this.cfg = cfg;
    this.r = cfg.r;
    this.speed = rand(cfg.speedRange[0], cfg.speedRange[1]);
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.damage = cfg.damage;
    this.dead = false;
    this.hitFlash = 0;
    this.contactCd = 0;
    this.attackCd = cfg.attackCd ? rand(0, cfg.attackCd) : 0;
    this.walkPhase = rand(0, TAU);
  }

  update(dt, game) {
    const p = game.player.mesh.position;
    const dx = p.x - this.mesh.position.x;
    const dz = p.z - this.mesh.position.z;
    const d2 = dx * dx + dz * dz;
    const len = Math.sqrt(d2) || 1;

    // Ranged enemies stop at range and shoot. Others charge.
    let move = true;
    if (this.cfg.ranged && len < this.cfg.attackRange) {
      move = false;
      this.attackCd = Math.max(0, this.attackCd - dt);
      if (this.attackCd <= 0) {
        this.attackCd = this.cfg.attackCd;
        const dir = new THREE.Vector3(dx / len, 0, dz / len);
        const muzzle = this.mesh.position.clone();
        muzzle.y = this.centerY + 0.2;
        game.spawnEnemyBullet(muzzle, dir, this.cfg.projectileSpeed, this.cfg.projectileDamage);
      }
    }
    if (move) {
      this.mesh.position.x += (dx / len) * this.speed * dt;
      this.mesh.position.z += (dz / len) * this.speed * dt;
      this.walkPhase += dt * this.speed * 1.8;
      animateRun(this.parts, this.walkPhase, 0.7, 0.55);
    } else {
      relaxRun(this.parts);
    }
    resolveObstacles(this, game.obstacles);
    resolveObstacles(this, game.crates);
    clampToMap(this);
    this.mesh.rotation.y = Math.atan2(dx, dz);

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.contactCd = Math.max(0, this.contactCd - dt);
    this.bodyMat.emissive.setHex(this.hitFlash > 0 ? 0xff8888 : 0x000000);

    if (this.damage > 0 && d2 < (this.r + game.player.r) ** 2 && this.contactCd <= 0) {
      game.player.takeDamage(this.damage, game);
      this.contactCd = 0.6;
    }
  }

  hit(damage, game) {
    this.hp -= damage;
    this.hitFlash = 0.1;
    sfx.hit();
    if (this.hp <= 0) this._die(game);
  }

  _die(game) {
    this.dead = true;
    sfx.enemyDeath();
    game.score += this.cfg.score;
    game.kills += 1;
    for (let k = 0; k < this.cfg.xp; k++) {
      const o = this.mesh.position.clone();
      o.x += rand(-0.5, 0.5);
      o.z += rand(-0.5, 0.5);
      game.spawnXPOrb(o);
    }
    if (Math.random() < 0.08) {
      game.spawnHeart(this.mesh.position.clone());
    }
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const s = rand(3, 8);
      const v = new THREE.Vector3(Math.cos(a) * s, rand(2, 6), Math.sin(a) * s);
      const burstAt = this.mesh.position.clone();
      burstAt.y += this.centerY;
      game.spawnParticle(burstAt, v, rand(0.4, 0.8), this.cfg.particleColor);
    }
  }
}

const BOSS_TYPES = {
  charger: {
    name: 'CHARGER',
    bodyColor: 0x4a1a6a, emissive: 0x6a3a8a, eyeColor: 0xffd84a, particleColor: 0xc06bff,
    scale: 1.0, speed: 1.9, hpBase: 1200, damage: 42,
    behavior: 'charge',
  },
  sniper: {
    name: 'SNIPER',
    bodyColor: 0x1a4a7a, emissive: 0x3a7a9a, eyeColor: 0x6bd0ff, particleColor: 0x6bd0ff,
    scale: 0.9, speed: 1.3, hpBase: 900, damage: 24,
    behavior: 'snipe',
    attackRange: 22, fireRate: 1.7, bulletSpeed: 26, bulletDamage: 40,
  },
  spinner: {
    name: 'SPINNER',
    bodyColor: 0x8a2010, emissive: 0xff5828, eyeColor: 0xffd066, particleColor: 0xff7030,
    scale: 1.1, speed: 1.5, hpBase: 1400, damage: 30,
    behavior: 'spin',
    fireRate: 1.4, bulletsPerWave: 10, bulletDamage: 20, bulletSpeed: 11,
  },
  summoner: {
    name: 'SUMMONER',
    bodyColor: 0x205a3a, emissive: 0x40a060, eyeColor: 0xa6f5b6, particleColor: 0x70e090,
    scale: 1.0, speed: 1.4, hpBase: 1100, damage: 26,
    behavior: 'summon',
    summonRate: 5.0, summonCount: 2,
  },
};

class Boss {
  constructor(x, z, tier = 1, kind = 'charger') {
    const cfg = BOSS_TYPES[kind];
    this.kind = kind;
    this.cfg = cfg;
    this.tier = tier;

    const size = (3.0 + tier * 0.4) * cfg.scale;
    this.size = size;

    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * 1.2, size),
      new THREE.MeshStandardMaterial({
        color: cfg.bodyColor, emissive: cfg.emissive, emissiveIntensity: 0.4, roughness: 0.5,
      })
    );
    body.position.y = size * 0.6;
    body.castShadow = true;
    group.add(body);
    this.body = body;

    this._buildVisuals(group, size, cfg);

    group.position.set(x, 0, z);
    this.mesh = group;

    this.r = size * 0.55;
    this.speed = cfg.speed + tier * 0.15;
    this.hp = cfg.hpBase + tier * 600;
    this.maxHp = this.hp;
    this.damage = cfg.damage + tier * 6;
    this.dead = false;
    this.hitFlash = 0;
    this.contactCd = 0;

    // Initial attack cooldowns — give the player a moment after the spawn warning.
    const startCd = { charge: 0, snipe: 0.6, spin: 0.8, summon: 1.5 }[cfg.behavior] ?? 0;
    this.attackCd = startCd;

    // Movement pattern state.
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.orbitDir  = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = 0;
    this.zigzagPhase = rand(0, TAU);

    // HP bar
    const barW = size * 1.2;
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.25),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    barBg.position.set(0, size * 1.55, 0);
    group.add(barBg);

    const barFg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xff4040 })
    );
    barFg.position.set(0, size * 1.55, 0.01);
    group.add(barFg);
    this.barFg = barFg;
    this.barW = barW;
  }

  _buildVisuals(group, size, cfg) {
    if (this.kind === 'charger') {
      for (const ex of [-size * 0.18, size * 0.18]) {
        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(size * 0.08, 8, 6),
          new THREE.MeshBasicMaterial({ color: cfg.eyeColor })
        );
        eye.position.set(ex, size * 0.85, size * 0.5 + 0.01);
        group.add(eye);
      }
    } else if (this.kind === 'sniper') {
      const scope = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.17, 14, 10),
        new THREE.MeshBasicMaterial({ color: cfg.eyeColor })
      );
      scope.position.set(0, size * 0.85, size * 0.5 + 0.05);
      group.add(scope);
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(size * 0.09, size * 0.11, size * 0.9, 10),
        new THREE.MeshStandardMaterial({ color: 0x1a1a22, roughness: 0.4 })
      );
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, size * 0.55, size * 0.5 + size * 0.45);
      barrel.castShadow = true;
      group.add(barrel);
    } else if (this.kind === 'spinner') {
      const armGroup = new THREE.Group();
      armGroup.position.y = size * 0.6;
      const armMat = new THREE.MeshStandardMaterial({
        color: cfg.bodyColor, emissive: cfg.emissive, emissiveIntensity: 0.7, roughness: 0.4,
      });
      for (let i = 0; i < 4; i++) {
        const pivot = new THREE.Group();
        pivot.rotation.y = (i / 4) * TAU;
        const arm = new THREE.Mesh(
          new THREE.BoxGeometry(size * 0.35, size * 0.18, size * 1.3),
          armMat
        );
        arm.position.z = size * 0.85;
        arm.castShadow = true;
        pivot.add(arm);
        armGroup.add(pivot);
      }
      group.add(armGroup);
      this.armGroup = armGroup;
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.16, 12, 10),
        new THREE.MeshBasicMaterial({ color: cfg.eyeColor })
      );
      eye.position.set(0, size * 1.05, 0);
      group.add(eye);
    } else if (this.kind === 'summoner') {
      for (const ex of [-size * 0.18, size * 0.18]) {
        const eye = new THREE.Mesh(
          new THREE.SphereGeometry(size * 0.08, 8, 6),
          new THREE.MeshBasicMaterial({ color: cfg.eyeColor })
        );
        eye.position.set(ex, size * 0.85, size * 0.5 + 0.01);
        group.add(eye);
      }
      this.orbs = [];
      for (let i = 0; i < 3; i++) {
        const orb = new THREE.Mesh(
          new THREE.SphereGeometry(size * 0.15, 12, 10),
          new THREE.MeshStandardMaterial({
            color: cfg.eyeColor, emissive: cfg.emissive, emissiveIntensity: 0.9, roughness: 0.3,
          })
        );
        orb.userData.baseAngle = (i / 3) * TAU;
        orb.userData.radius = size * 0.7;
        orb.castShadow = true;
        group.add(orb);
        this.orbs.push(orb);
      }
    }
  }

  update(dt, game) {
    const p = game.player.mesh.position;
    const dx = p.x - this.mesh.position.x;
    const dz = p.z - this.mesh.position.z;
    const dist2 = dx * dx + dz * dz;
    const len = Math.sqrt(dist2) || 1;
    const nx = dx / len, nz = dz / len;
    // Right-perpendicular of the player direction.
    const tx = -nz, tz = nx;

    let vx = 0, vz = 0;
    const beh = this.cfg.behavior;
    if (beh === 'charge') {
      vx = nx * this.speed;
      vz = nz * this.speed;
    } else if (beh === 'snipe') {
      if (len > this.cfg.attackRange) {
        // Out of range — close in.
        vx = nx * this.speed;
        vz = nz * this.speed;
      } else {
        // In range — strafe sideways, flip direction every ~3s.
        this.strafeTimer += dt;
        if (this.strafeTimer > 3.0) {
          this.strafeTimer = 0;
          this.strafeDir = -this.strafeDir;
        }
        vx = tx * this.speed * this.strafeDir;
        vz = tz * this.speed * this.strafeDir;
        // Gentle pull toward optimal stand-off range.
        const target = this.cfg.attackRange * 0.7;
        const radial = (target - len) * 0.4;
        vx -= nx * radial;
        vz -= nz * radial;
      }
    } else if (beh === 'spin') {
      // Orbit the player at ~14 units, sweeping bullets across the field.
      const target = 14;
      vx = tx * this.speed * this.orbitDir;
      vz = tz * this.speed * this.orbitDir;
      const radial = (target - len) * 0.6; // pull toward orbit radius
      vx -= nx * radial * 0.5;
      vz -= nz * radial * 0.5;
    } else if (beh === 'summon') {
      // Kite away when close, approach slowly when far. Add a sideways zigzag.
      this.zigzagPhase += dt * 1.8;
      const zigzag = Math.sin(this.zigzagPhase);
      const approach = len < 15 ? -0.6 : 0.4;
      vx = nx * this.speed * approach;
      vz = nz * this.speed * approach;
      vx += tx * this.speed * 0.5 * zigzag;
      vz += tz * this.speed * 0.5 * zigzag;
    }

    this.mesh.position.x += vx * dt;
    this.mesh.position.z += vz * dt;
    resolveObstacles(this, game.obstacles);
    resolveObstacles(this, game.crates);
    clampToMap(this);

    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.attackCd <= 0) this._attack(game, dx, dz, len);

    // Visual animation.
    if (this.armGroup) this.armGroup.rotation.y += dt * 4;
    if (this.orbs) {
      const tt = performance.now() * 0.002;
      for (const orb of this.orbs) {
        const a = orb.userData.baseAngle + tt;
        orb.position.x = Math.cos(a) * orb.userData.radius;
        orb.position.z = Math.sin(a) * orb.userData.radius;
        orb.position.y = this.size * 1.5 + Math.sin(tt + orb.userData.baseAngle) * 0.25;
      }
    }

    this.barFg.scale.x = Math.max(0.001, this.hp / this.maxHp);
    this.barFg.position.x = -this.barW * (1 - this.hp / this.maxHp) / 2;

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.contactCd = Math.max(0, this.contactCd - dt);
    this.body.material.emissive.setHex(this.hitFlash > 0 ? 0xffffff : this.cfg.emissive);

    if (dist2 < (this.r + game.player.r) ** 2 && this.contactCd <= 0) {
      game.player.takeDamage(this.damage, game);
      this.contactCd = 0.7;
    }
  }

  _attack(game, dx, dz, len) {
    const beh = this.cfg.behavior;
    const muzzleY = this.size * 0.6;
    if (beh === 'snipe' && len < this.cfg.attackRange) {
      this.attackCd = this.cfg.fireRate;
      const dir = new THREE.Vector3(dx / len, 0, dz / len);
      const muzzle = this.mesh.position.clone();
      muzzle.y = muzzleY;
      muzzle.x += dir.x * this.size * 0.7;
      muzzle.z += dir.z * this.size * 0.7;
      game.spawnEnemyBullet(muzzle, dir, this.cfg.bulletSpeed, this.cfg.bulletDamage);
    } else if (beh === 'spin') {
      this.attackCd = this.cfg.fireRate;
      const n = this.cfg.bulletsPerWave;
      const phase = this.armGroup ? this.armGroup.rotation.y : 0;
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + phase;
        const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
        const muzzle = this.mesh.position.clone();
        muzzle.y = muzzleY;
        muzzle.x += dir.x * this.size * 0.5;
        muzzle.z += dir.z * this.size * 0.5;
        game.spawnEnemyBullet(muzzle, dir, this.cfg.bulletSpeed, this.cfg.bulletDamage);
      }
    } else if (beh === 'summon') {
      this.attackCd = this.cfg.summonRate;
      for (let i = 0; i < this.cfg.summonCount; i++) {
        const a = rand(0, TAU);
        const sx = this.mesh.position.x + Math.cos(a) * 2.5;
        const sz = this.mesh.position.z + Math.sin(a) * 2.5;
        const type = Math.random() < 0.6 ? 'grunt' : 'fast';
        const e = new Enemy(sx, sz, type);
        game.enemies.push(e);
        scene.add(e.mesh);
        // Pop of particles at the spawn point so it reads as a summon.
        for (let k = 0; k < 5; k++) {
          const va = rand(0, TAU);
          const vv = new THREE.Vector3(Math.cos(va) * rand(2, 4), rand(2, 4), Math.sin(va) * rand(2, 4));
          game.spawnParticle(new THREE.Vector3(sx, 0.5, sz), vv, rand(0.3, 0.6), this.cfg.particleColor);
        }
      }
    } else {
      // Charger has no ranged attack — back off the cooldown so we don't hot-loop.
      this.attackCd = 1.0;
    }
  }

  hit(damage, game) {
    this.hp -= damage;
    this.hitFlash = 0.08;
    sfx.hit();
    if (this.hp <= 0) this._die(game);
  }

  _die(game) {
    this.dead = true;
    sfx.bossDeath();
    game.score += 200 * this.tier;
    game.kills += 1;

    const orbCount = 20 + this.tier * 8;
    for (let i = 0; i < orbCount; i++) {
      const o = this.mesh.position.clone();
      o.x += rand(-2, 2);
      o.z += rand(-2, 2);
      game.spawnXPOrb(o);
    }
    const heartCount = 4 + this.tier * 2;
    for (let i = 0; i < heartCount; i++) {
      const h = this.mesh.position.clone();
      h.x += rand(-3, 3);
      h.z += rand(-3, 3);
      game.spawnHeart(h);
    }
    for (let i = 0; i < 60; i++) {
      const a = rand(0, TAU);
      const s = rand(6, 14);
      const v = new THREE.Vector3(Math.cos(a) * s, rand(4, 12), Math.sin(a) * s);
      game.spawnParticle(this.mesh.position.clone(), v, rand(0.6, 1.2), this.cfg.particleColor);
    }
    game.shake = 1.5;
  }
}

class Bullet {
  constructor(pos, dir, speed, damage, life, pierce) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xfff3a8, emissive: 0xff8a3a, emissiveIntensity: 1.5 })
    );
    mesh.position.copy(pos);
    this.mesh = mesh;

    this.vel = dir.clone().multiplyScalar(speed);
    this.r = 0.18;
    this.damage = damage;
    this.life = life;
    this.pierce = pierce;        // remaining piercings
    this.hitSet = new Set();     // enemies already hit (avoid hitting same enemy twice)
    this.dead = false;
  }
  update(dt, game) {
    this.mesh.position.x += this.vel.x * dt;
    this.mesh.position.z += this.vel.z * dt;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }

    if (bulletHitsObstacle(this, game.obstacles)) { this.dead = true; return; }

    // Crates: take damage, but bullets respect pierce just like enemies.
    for (const c of game.crates) {
      if (c.dead || this.hitSet.has(c)) continue;
      const dx = c.mesh.position.x - this.mesh.position.x;
      const dz = c.mesh.position.z - this.mesh.position.z;
      if (dx * dx + dz * dz < (this.r + c.r) ** 2) {
        c.hit(this.damage, game);
        this.hitSet.add(c);
        if (this.pierce > 0) this.pierce -= 1;
        else { this.dead = true; return; }
      }
    }

    for (const e of game.enemies) {
      if (e.dead || this.hitSet.has(e)) continue;
      const dx = e.mesh.position.x - this.mesh.position.x;
      const dz = e.mesh.position.z - this.mesh.position.z;
      if (dx * dx + dz * dz < (this.r + e.r) ** 2) {
        e.hit(this.damage, game);
        this.hitSet.add(e);
        if (this.pierce > 0) this.pierce -= 1;
        else { this.dead = true; return; }
      }
    }
  }
}

class EnemyBullet {
  constructor(pos, dir, speed, damage) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xff6bff, emissive: 0xc23ad0, emissiveIntensity: 1.5 })
    );
    mesh.position.copy(pos);
    this.mesh = mesh;
    this.vel = dir.clone().multiplyScalar(speed);
    this.r = 0.22;
    this.damage = damage;
    this.life = 3.0;
    this.dead = false;
  }
  update(dt, game) {
    this.mesh.position.x += this.vel.x * dt;
    this.mesh.position.z += this.vel.z * dt;
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }

    if (bulletHitsObstacle(this, game.obstacles)) { this.dead = true; return; }
    if (bulletHitsObstacle(this, game.crates)) { this.dead = true; return; }

    const p = game.player;
    const dx = p.mesh.position.x - this.mesh.position.x;
    const dz = p.mesh.position.z - this.mesh.position.z;
    if (dx * dx + dz * dz < (this.r + p.r) ** 2) {
      p.takeDamage(this.damage, game);
      this.dead = true;
    }
  }
}

class Particle {
  constructor(pos, vel, life, color) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ color, transparent: true })
    );
    mesh.position.copy(pos);
    this.mesh = mesh;
    this.vel = vel.clone();
    this.life = life;
    this.maxLife = life;
    this.dead = false;
  }
  update(dt) {
    this.mesh.position.addScaledVector(this.vel, dt);
    this.vel.y -= 12 * dt;
    this.vel.multiplyScalar(0.97);
    this.life -= dt;
    this.mesh.material.opacity = Math.max(0, this.life / this.maxLife);
    if (this.life <= 0) this.dead = true;
  }
}

class XPOrb {
  constructor(pos) {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({ color: 0x6bd0ff, emissive: 0x4a9bff, emissiveIntensity: 1.2 })
    );
    mesh.position.copy(pos);
    mesh.position.y = 0.4;
    this.mesh = mesh;
    this.r = 0.22;
    this.value = 1;
    this.dead = false;
    this.spinSpeed = rand(2, 5);
  }
  update(dt, game) {
    this.mesh.rotation.y += this.spinSpeed * dt;
    this.mesh.position.y = 0.4 + Math.sin(performance.now() * 0.005 + this.mesh.position.x) * 0.1;

    const p = game.player;
    const px = p.mesh.position.x, pz = p.mesh.position.z;
    const dx = px - this.mesh.position.x;
    const dz = pz - this.mesh.position.z;
    const d2 = dx * dx + dz * dz;

    if (d2 < (p.pickupRadius + this.r) ** 2) {
      this.dead = true;
      sfx.pickup();
      p.addXP(this.value, game);
      return;
    }
    if (d2 < p.magnetRadius * p.magnetRadius) {
      const len = Math.sqrt(d2) || 1;
      const speed = 12 + (1 - len / p.magnetRadius) * 18;
      this.mesh.position.x += (dx / len) * speed * dt;
      this.mesh.position.z += (dz / len) * speed * dt;
    }
  }
}

class Heart {
  constructor(pos) {
    const mesh = new THREE.Mesh(HEART_GEOM, HEART_MAT);
    mesh.position.copy(pos);
    mesh.position.y = 0.5;
    // Tilt slightly forward so the heart face reads well from the top-down camera.
    mesh.rotation.x = -0.35;
    mesh.castShadow = true;
    this.mesh = mesh;
    this.r = 0.45;
    this.heal = 25;
    this.dead = false;
    this.spinSpeed = rand(0.9, 1.6);
    this.life = 20; // despawn after 20s so the field stays clean
  }
  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.mesh.rotation.y += this.spinSpeed * dt;
    this.mesh.position.y = 0.5 + Math.sin(performance.now() * 0.004 + this.mesh.position.x) * 0.12;

    const p = game.player;
    const dx = p.mesh.position.x - this.mesh.position.x;
    const dz = p.mesh.position.z - this.mesh.position.z;
    const d2 = dx * dx + dz * dz;

    if (d2 < (p.r + this.r) ** 2) {
      this.dead = true;
      sfx.pickup();
      p.hp = Math.min(p.maxHp, p.hp + this.heal);
    }
  }
}

// ---------- Procedural textures for obstacles ----------
function makeCanvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const TEX_BARK = makeCanvasTex(128, (g, S) => {
  g.fillStyle = '#5a3a20';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 120; i++) {
    g.strokeStyle = `rgba(${20 + Math.random() * 40}, ${15 + Math.random() * 25}, 8, ${0.3 + Math.random() * 0.4})`;
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    const x = Math.random() * S;
    g.moveTo(x, 0);
    g.bezierCurveTo(x + (Math.random() - 0.5) * 12, S * 0.3, x + (Math.random() - 0.5) * 12, S * 0.7, x + (Math.random() - 0.5) * 8, S);
    g.stroke();
  }
});

const TEX_BRICK = makeCanvasTex(256, (g, S) => {
  g.fillStyle = '#807068';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 800; i++) {
    g.fillStyle = `rgba(60, 50, 40, ${Math.random() * 0.35})`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  const bw = 64, bh = 32;
  g.strokeStyle = '#352a22';
  g.lineWidth = 3;
  for (let y = 0; y <= S; y += bh) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
  }
  for (let y = 0; y < S; y += bh) {
    const off = (y / bh) % 2 === 0 ? 0 : bw / 2;
    for (let x = off; x <= S + bw; x += bw) {
      g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + bh); g.stroke();
    }
  }
});

const TEX_WOOD = makeCanvasTex(256, (g, S) => {
  g.fillStyle = '#8a5a2a';
  g.fillRect(0, 0, S, S);
  // Grain
  g.strokeStyle = 'rgba(60, 30, 10, 0.35)';
  g.lineWidth = 1;
  for (let i = 0; i < 60; i++) {
    g.beginPath();
    g.moveTo(0, Math.random() * S);
    g.bezierCurveTo(S * 0.33, Math.random() * S, S * 0.66, Math.random() * S, S, Math.random() * S);
    g.stroke();
  }
  // Plank seams
  const ph = 64;
  g.strokeStyle = '#3a200f';
  g.lineWidth = 5;
  for (let y = 0; y <= S; y += ph) {
    g.beginPath(); g.moveTo(0, y); g.lineTo(S, y); g.stroke();
  }
});

const OBSTACLE_MATS = {
  bark:   new THREE.MeshStandardMaterial({ map: TEX_BARK, roughness: 0.95 }),
  leaves: new THREE.MeshStandardMaterial({ color: 0x2d6a2d, roughness: 0.85, flatShading: true }),
  leaves2: new THREE.MeshStandardMaterial({ color: 0x3a7a35, roughness: 0.85, flatShading: true }),
  leaves3: new THREE.MeshStandardMaterial({ color: 0x247020, roughness: 0.85, flatShading: true }),
  brick:  new THREE.MeshStandardMaterial({ map: TEX_BRICK, roughness: 0.95 }),
  wood:   new THREE.MeshStandardMaterial({ map: TEX_WOOD, roughness: 0.85 }),
  woodEdge: new THREE.MeshStandardMaterial({ color: 0x3a200f, roughness: 0.9 }),
  rock:   new THREE.MeshStandardMaterial({ color: 0x6a6566, roughness: 0.9, flatShading: true }),
  rockDark: new THREE.MeshStandardMaterial({ color: 0x4a4546, roughness: 0.9, flatShading: true }),
};

// ---------- Heart pickup: shared shape + texture ----------
const TEX_HEART = makeCanvasTex(128, (g, S) => {
  // Radial gradient: bright pink core fading to dark red rim.
  const grad = g.createRadialGradient(S * 0.35, S * 0.35, 0, S * 0.5, S * 0.5, S * 0.65);
  grad.addColorStop(0,   '#ffd0dd');
  grad.addColorStop(0.4, '#ff4768');
  grad.addColorStop(1,   '#9a1530');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  // Sparkle highlights
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (let i = 0; i < 8; i++) {
    g.beginPath();
    g.arc(Math.random() * S, Math.random() * S, 1 + Math.random() * 3, 0, TAU);
    g.fill();
  }
});

const HEART_GEOM = (() => {
  const s = new THREE.Shape();
  // Heart: bottom V at (0, -1), lobes at top.
  s.moveTo(0, -1);
  s.bezierCurveTo(0.6, -0.5, 1.0,  0.05, 1.0, 0.5);
  s.bezierCurveTo(1.0,  0.85, 0.55, 1.05, 0,   0.7);
  s.bezierCurveTo(-0.55, 1.05, -1.0, 0.85, -1.0, 0.5);
  s.bezierCurveTo(-1.0, 0.05, -0.6, -0.5, 0,   -1);
  const geom = new THREE.ExtrudeGeometry(s, {
    depth: 0.55,
    bevelEnabled: true,
    bevelSegments: 3,
    steps: 1,
    bevelSize: 0.12,
    bevelThickness: 0.12,
  });
  geom.center();
  geom.scale(0.38, 0.38, 0.38);
  return geom;
})();

const HEART_MAT = new THREE.MeshStandardMaterial({
  map: TEX_HEART,
  color: 0xff5070,
  emissive: 0xff1f4a,
  emissiveIntensity: 0.55,
  roughness: 0.35,
  metalness: 0.1,
});

class Obstacle {
  constructor(x, z) {
    // Collision footprint stays a 2.5×2.5 square so gameplay doesn't depend on the visual variant.
    this.halfW = 1.25;
    this.halfD = 1.25;

    const variant = Math.floor(rand(0, 4));
    let group;
    if      (variant === 0) group = this._tree();
    else if (variant === 1) group = this._stoneBlock();
    else if (variant === 2) group = this._crate();
    else                    group = this._rock();

    group.position.set(x, 0, z);
    // Quarter-turn rotation keeps box-shaped variants aligned with the AABB collision.
    group.rotation.y = Math.floor(rand(0, 4)) * (Math.PI / 2);
    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.mesh = group;
  }

  _tree() {
    const g = new THREE.Group();
    const trunkH = 1.4;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.45, 0.6, trunkH, 10),
      OBSTACLE_MATS.bark
    );
    trunk.position.y = trunkH / 2;
    g.add(trunk);

    const leafMats = [OBSTACLE_MATS.leaves, OBSTACLE_MATS.leaves2, OBSTACLE_MATS.leaves3];
    for (let i = 0; i < 4; i++) {
      const r = rand(0.85, 1.15);
      const foliage = new THREE.Mesh(
        new THREE.IcosahedronGeometry(r, 0),
        leafMats[Math.floor(rand(0, leafMats.length))]
      );
      foliage.position.set(rand(-0.5, 0.5), trunkH + rand(0.1, 0.7), rand(-0.5, 0.5));
      g.add(foliage);
    }
    return g;
  }

  _stoneBlock() {
    const g = new THREE.Group();
    const w = 2.3, h = 2.1, d = 2.3;
    const block = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), OBSTACLE_MATS.brick);
    block.position.y = h / 2;
    g.add(block);
    // A capstone slab on top.
    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.15, 0.2, d + 0.15),
      OBSTACLE_MATS.rock
    );
    cap.position.y = h + 0.1;
    g.add(cap);
    return g;
  }

  _crate() {
    const g = new THREE.Group();
    const s = 2.0;
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), OBSTACLE_MATS.wood);
    crate.position.y = s / 2;
    g.add(crate);
    // Wooden edge frames along the 4 vertical corners + top/bottom bands.
    const t = 0.08;
    const make = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, OBSTACLE_MATS.woodEdge);
      m.position.set(x, y, z);
      g.add(m);
    };
    const vert = new THREE.BoxGeometry(t, s, t);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) make(vert, sx * s / 2, s / 2, sz * s / 2);
    const bandH = new THREE.BoxGeometry(s, t, t);
    const bandD = new THREE.BoxGeometry(t, t, s);
    for (const y of [t / 2 + 0.02, s - t / 2 - 0.02]) {
      for (const sz of [-1, 1]) make(bandH, 0, y, sz * s / 2);
      for (const sx of [-1, 1]) make(bandD, sx * s / 2, y, 0);
    }
    return g;
  }

  _rock() {
    const g = new THREE.Group();
    const main = new THREE.Mesh(
      new THREE.DodecahedronGeometry(1.35, 0),
      OBSTACLE_MATS.rock
    );
    main.position.y = 1.0;
    main.scale.set(1, 0.78, 1);
    main.rotation.set(rand(-0.3, 0.3), rand(0, TAU), rand(-0.3, 0.3));
    g.add(main);
    for (let i = 0; i < 2; i++) {
      const small = new THREE.Mesh(
        new THREE.DodecahedronGeometry(rand(0.4, 0.7), 0),
        OBSTACLE_MATS.rockDark
      );
      small.position.set(rand(-0.9, 0.9), rand(0.3, 0.6), rand(-0.9, 0.9));
      small.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      g.add(small);
    }
    return g;
  }
}

// ---------- Ash patch left by the super-strike ----------
class Ash {
  constructor(x, z) {
    const r = rand(0.9, 1.6);
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(r, 18),
      new THREE.MeshBasicMaterial({ color: 0x1c1612, transparent: true, opacity: 0.85, side: THREE.DoubleSide })
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.03 + Math.random() * 0.01, z);
    this.mesh = mesh;
    this.life = 14;
    this.dead = false;
  }
  update(dt) {
    this.life -= dt;
    if (this.life < 3) this.mesh.material.opacity = Math.max(0, 0.85 * (this.life / 3));
    if (this.life <= 0) this.dead = true;
  }
}

// ---------- Loot crate (destructible) ----------
class Crate {
  constructor(x, z) {
    const s = 1.5;
    const group = new THREE.Group();
    // Per-instance material so its emissive flash doesn't leak to other crates / obstacles.
    this.bodyMat = new THREE.MeshStandardMaterial({ map: TEX_WOOD, roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), this.bodyMat);
    body.position.y = s / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Dark wooden edge bands so it reads as a loot crate.
    const edgeMat = OBSTACLE_MATS.woodEdge;
    const t = 0.06;
    const vert = new THREE.BoxGeometry(t, s, t);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const m = new THREE.Mesh(vert, edgeMat);
      m.position.set(sx * s / 2, s / 2, sz * s / 2);
      group.add(m);
    }

    // Glowing star marker so the player notices them from a distance.
    const star = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.22, 0),
      new THREE.MeshStandardMaterial({ color: 0xfff080, emissive: 0xffd040, emissiveIntensity: 1.2 })
    );
    star.position.y = s + 0.45;
    group.add(star);
    this.star = star;

    group.position.set(x, 0, z);
    this.mesh = group;

    this.halfW = s / 2;
    this.halfD = s / 2;
    this.r = s * 0.55;
    this.hp = 60;
    this.maxHp = 60;
    this.dead = false;
    this.hitFlash = 0;
  }

  hit(damage, game) {
    this.hp -= damage;
    this.hitFlash = 0.1;
    sfx.hit();
    if (this.hp <= 0) this._die(game);
  }

  _die(game) {
    this.dead = true;
    sfx.enemyDeath();
    const pos = this.mesh.position.clone();
    pos.y = 0.6;
    const roll = Math.random();
    if (roll < 0.65) {
      // Main reward: super-strike charge.
      game.spawnSuperPickup(pos);
    } else if (roll < 0.9) {
      for (let i = 0; i < 3; i++) {
        const h = pos.clone();
        h.x += rand(-0.8, 0.8);
        h.z += rand(-0.8, 0.8);
        game.spawnHeart(h);
      }
    } else {
      for (let i = 0; i < 5; i++) {
        const o = pos.clone();
        o.x += rand(-0.6, 0.6);
        o.z += rand(-0.6, 0.6);
        game.spawnXPOrb(o);
      }
    }
    // Wooden splinter particles.
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const s = rand(2, 5);
      const v = new THREE.Vector3(Math.cos(a) * s, rand(2, 5), Math.sin(a) * s);
      const p = this.mesh.position.clone();
      p.y += 0.7;
      game.spawnParticle(p, v, rand(0.3, 0.6), 0xc89060);
    }
  }

  update(dt) {
    this.star.rotation.y += dt * 2;
    this.star.position.y = 1.95 + Math.sin(performance.now() * 0.004) * 0.12;
    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.bodyMat.emissive.setHex(this.hitFlash > 0 ? 0xffaa00 : 0x000000);
  }
}

// ---------- Super-strike charge pickup ----------
class SuperPickup {
  constructor(pos) {
    const mesh = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({
        color: 0xff8030, emissive: 0xff5028, emissiveIntensity: 1.5, roughness: 0.3,
      })
    );
    mesh.position.copy(pos);
    mesh.position.y = 0.7;
    mesh.castShadow = true;
    this.mesh = mesh;
    this.r = 0.6;
    this.dead = false;
    this.spinSpeed = rand(1.8, 2.6);
    this.life = 25;
  }

  update(dt, game) {
    this.life -= dt;
    if (this.life <= 0) { this.dead = true; return; }
    this.mesh.rotation.y += this.spinSpeed * dt;
    this.mesh.rotation.x += this.spinSpeed * 0.6 * dt;
    this.mesh.position.y = 0.7 + Math.sin(performance.now() * 0.005) * 0.2;

    const p = game.player;
    const dx = p.mesh.position.x - this.mesh.position.x;
    const dz = p.mesh.position.z - this.mesh.position.z;
    if (dx * dx + dz * dz < (p.r + this.r) ** 2) {
      this.dead = true;
      sfx.pickup();
      p.superCharges += 1;
    }
  }
}

// ---------- HQ (central base, heals the player) ----------
class HQ {
  constructor() {
    const group = new THREE.Group();
    const W = 6, H = 3.5, D = 6;
    // Collision footprint shaped like an obstacle so bullets and enemies bump off it.
    this.halfW = W / 2 + 0.15;
    this.halfD = D / 2 + 0.15;
    this.healRadius = 9;
    this.healRate = 14;

    const walls = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), OBSTACLE_MATS.brick);
    walls.position.y = H / 2;
    walls.castShadow = true;
    walls.receiveShadow = true;
    group.add(walls);

    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(W * 0.82, 1.8, 4),
      new THREE.MeshStandardMaterial({ color: 0x4a2814, roughness: 0.85 })
    );
    roof.position.y = H + 0.9;
    roof.rotation.y = Math.PI / 4;
    roof.castShadow = true;
    group.add(roof);

    const lantern = new THREE.Mesh(
      new THREE.SphereGeometry(0.4, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff0a0, emissive: 0xffd040, emissiveIntensity: 1.2 })
    );
    lantern.position.y = H + 2.1;
    group.add(lantern);
    // Subtle point light from the lantern.
    const lanternLight = new THREE.PointLight(0xffd060, 0.6, 14);
    lanternLight.position.y = H + 2.0;
    group.add(lanternLight);

    const door = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 1.9, 0.12),
      OBSTACLE_MATS.woodEdge
    );
    door.position.set(0, 0.95, D / 2 + 0.07);
    group.add(door);

    const windowMat = new THREE.MeshStandardMaterial({
      color: 0xffe488, emissive: 0xffc040, emissiveIntensity: 0.9,
    });
    for (const sx of [-1.5, 1.5]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.12), windowMat);
      w.position.set(sx, 1.7, D / 2 + 0.07);
      group.add(w);
    }
    for (const sx of [-1, 1]) for (const sz of [-1.5, 1.5]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 0.65), windowMat);
      w.position.set(sx * (W / 2 + 0.07), 1.7, sz);
      group.add(w);
    }

    // Heal zone — pulsing glow ring on the ground.
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.healRadius - 0.35, this.healRadius, 48),
      new THREE.MeshBasicMaterial({ color: 0x88ffcc, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    group.add(ring);
    this.healRing = ring;

    this.mesh = group;
  }

  update(dt, game) {
    this.healRing.material.opacity = 0.3 + Math.sin(performance.now() * 0.003) * 0.15;
    const p = game.player;
    const dx = p.mesh.position.x;
    const dz = p.mesh.position.z;
    if (dx * dx + dz * dz < this.healRadius * this.healRadius && p.hp < p.maxHp) {
      p.hp = Math.min(p.maxHp, p.hp + this.healRate * dt);
    }
  }
}

// ---------- Game ----------
class Game {
  constructor() {
    this.player = new Player();
    // Spawn the player just south of the HQ so they don't start inside it.
    this.player.mesh.position.set(0, 0, 11);
    scene.add(this.player.mesh);

    this.hq = new HQ();
    scene.add(this.hq.mesh);

    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.particles = [];
    this.orbs = [];
    this.hearts = [];
    this.obstacles = [this.hq]; // HQ collides like an obstacle (blocks bullets & enemies)
    this.crates = [];
    this.superPickups = [];
    this.ash = [];

    this.score = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.spawnTimer = 0;
    this.bossCount = 0; // bosses are tied to player level-ups, not a timer
    this.pendingBosses = 0; // queued boss spawns deferred while another boss is alive
    this.shake = 0;
    this.running = true;
    this.paused = false;
    this.pendingLevelUps = 0;
  }

  cleanup() {
    this.running = false; // stops pending super-strike timers from touching the scene
    scene.remove(this.player.mesh);
    for (const e of this.enemies) scene.remove(e.mesh);
    for (const b of this.bullets) scene.remove(b.mesh);
    for (const b of this.enemyBullets) scene.remove(b.mesh);
    for (const p of this.particles) scene.remove(p.mesh);
    for (const o of this.orbs) scene.remove(o.mesh);
    for (const h of this.hearts) scene.remove(h.mesh);
    for (const o of this.obstacles) scene.remove(o.mesh);
    for (const c of this.crates) scene.remove(c.mesh);
    for (const s of this.superPickups) scene.remove(s.mesh);
    for (const a of this.ash) scene.remove(a.mesh);
  }

  _pickEnemyType() {
    const t = this.elapsed;
    // Weighted pool of types unlocked by elapsed time.
    const pool = [['grunt', 100]];
    if (t > 25) pool.push(['fast', 50]);
    if (t > 50) pool.push(['tank', 25]);
    if (t > 80) pool.push(['shooter', 35]);
    let total = 0;
    for (const [, w] of pool) total += w;
    let r = Math.random() * total;
    for (const [name, w] of pool) {
      if ((r -= w) <= 0) return name;
    }
    return 'grunt';
  }

  spawnEnemy() {
    const a = rand(0, TAU);
    const dist = 30;
    const p = this.player.mesh.position;
    const m = MAP_BOUND - 2;
    const x = Math.max(-m, Math.min(m, p.x + Math.cos(a) * dist));
    const z = Math.max(-m, Math.min(m, p.z + Math.sin(a) * dist));
    const type = this._pickEnemyType();
    const e = new Enemy(x, z, type);
    this.enemies.push(e);
    scene.add(e.mesh);
  }

  spawnBoss() {
    this.bossCount += 1;
    const tier = this.bossCount;
    const a = rand(0, TAU);
    const dist = 32;
    const p = this.player.mesh.position;
    const m = MAP_BOUND - 3;
    const x = Math.max(-m, Math.min(m, p.x + Math.cos(a) * dist));
    const z = Math.max(-m, Math.min(m, p.z + Math.sin(a) * dist));
    // Cycle boss kinds per tier so each "level" gets a different boss.
    const kinds = ['charger', 'spinner', 'sniper', 'summoner'];
    const kind = kinds[(tier - 1 + kinds.length) % kinds.length];
    const b = new Boss(x, z, tier, kind);
    this.enemies.push(b);
    scene.add(b.mesh);
    this.shake = Math.max(this.shake, 1.0);
    sfx.bossSpawn();
    showBossWarning(BOSS_TYPES[kind].name);
  }

  spawnBullet(pos, dir, speed, damage, life, pierce) {
    const b = new Bullet(pos, dir, speed, damage, life, pierce);
    this.bullets.push(b);
    scene.add(b.mesh);
  }

  spawnParticle(pos, vel, life, color) {
    const p = new Particle(pos, vel, life, color);
    this.particles.push(p);
    scene.add(p.mesh);
  }

  spawnXPOrb(pos) {
    const o = new XPOrb(pos);
    this.orbs.push(o);
    scene.add(o.mesh);
  }

  spawnHeart(pos) {
    const h = new Heart(pos);
    this.hearts.push(h);
    scene.add(h.mesh);
  }

  spawnEnemyBullet(pos, dir, speed, damage) {
    const b = new EnemyBullet(pos, dir, speed, damage);
    this.enemyBullets.push(b);
    scene.add(b.mesh);
  }

  spawnObstacle(x, z) {
    const o = new Obstacle(x, z);
    this.obstacles.push(o);
    scene.add(o.mesh);
  }

  spawnCrate(x, z) {
    const c = new Crate(x, z);
    this.crates.push(c);
    scene.add(c.mesh);
  }

  spawnSuperPickup(pos) {
    const s = new SuperPickup(pos);
    this.superPickups.push(s);
    scene.add(s.mesh);
  }

  spawnAsh(x, z) {
    const a = new Ash(x, z);
    this.ash.push(a);
    scene.add(a.mesh);
  }

  // Super-strike (Змей Горыныч): 5 concentric bullet rings, knockback,
  // and 3 fire streams that leave ash patches.
  triggerSuperStrike() {
    const p = this.player;
    const origin = p.mesh.position.clone();
    const muzzleY = 1.0;

    // 1. Knockback nearby enemies (instant push outward).
    for (const e of this.enemies) {
      if (e.dead) continue;
      const dx = e.mesh.position.x - origin.x;
      const dz = e.mesh.position.z - origin.z;
      const d = Math.hypot(dx, dz);
      if (d < 9 && d > 0.001) {
        const push = 7 * (1 - d / 9);
        e.mesh.position.x += (dx / d) * push;
        e.mesh.position.z += (dz / d) * push;
        clampToMap(e);
      }
    }

    // 2. Five bullet rings staggered ~140ms apart.
    for (let w = 0; w < 5; w++) {
      setTimeout(() => {
        if (!this.running) return;
        const o = this.player.mesh.position.clone();
        o.y = muzzleY;
        const n = 14 + w * 3;
        const offset = w * 0.14;
        for (let i = 0; i < n; i++) {
          const ang = (i / n) * TAU + offset;
          const dir = new THREE.Vector3(Math.sin(ang), 0, Math.cos(ang));
          this.spawnBullet(o, dir, p.bulletSpeed * 1.15, p.bulletDamage * 1.4, 1.2, 6);
        }
      }, w * 140);
    }

    // 3. Three fire streams (Zmey Gorynych) — burning enemies, leaving ash.
    const baseAng = rand(0, TAU);
    for (let h = 0; h < 3; h++) {
      const angle = baseAng + h * (TAU / 3);
      this._spawnFireStream(origin, angle);
    }

    this.shake = Math.max(this.shake, 1.2);
    sfx.bossSpawn();
  }

  _spawnFireStream(origin, angle) {
    const dir = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const steps = 9;
    const stepDist = 2.5;
    for (let step = 0; step < steps; step++) {
      setTimeout(() => {
        if (!this.running) return;
        const dist = (step + 1) * stepDist;
        const px = origin.x + dir.x * dist;
        const pz = origin.z + dir.z * dist;
        // Stop if we walked off the map (clip to bounds).
        if (Math.abs(px) > MAP_BOUND || Math.abs(pz) > MAP_BOUND) return;

        // Burn nearby enemies.
        const burnR2 = 9; // radius 3
        for (const e of this.enemies) {
          if (e.dead) continue;
          const ex = e.mesh.position.x - px;
          const ez = e.mesh.position.z - pz;
          if (ex * ex + ez * ez < burnR2) {
            e.hit(80, this);
          }
        }
        // Also burn crates — they go up satisfyingly.
        for (const c of this.crates) {
          if (c.dead) continue;
          const cx = c.mesh.position.x - px;
          const cz = c.mesh.position.z - pz;
          if (cx * cx + cz * cz < burnR2) c.hit(80, this);
        }

        // Flame particles up & out.
        const flamePos = new THREE.Vector3(px, 0.6, pz);
        for (let i = 0; i < 10; i++) {
          const v = new THREE.Vector3(
            dir.x * rand(2, 5) + rand(-1.5, 1.5),
            rand(3, 7),
            dir.z * rand(2, 5) + rand(-1.5, 1.5)
          );
          const color = [0xff7028, 0xffa040, 0xffd060][Math.floor(Math.random() * 3)];
          this.spawnParticle(flamePos.clone(), v, rand(0.45, 0.85), color);
        }

        // Ash patch every other step.
        if (step % 2 === 0) this.spawnAsh(px, pz);
      }, step * 55);
    }
  }

  queueLevelUp() {
    this.pendingLevelUps += 1;
    this.pendingBosses += 1;
    if (!this.paused) this._showLevelUp();
  }

  _showLevelUp() {
    if (this.pendingLevelUps <= 0) return;
    this.paused = true;
    levelUpScreen.classList.remove('hidden');
    const choices = pickUpgrades(3);
    upgradeCardsRoot.innerHTML = '';
    for (const u of choices) {
      const card = document.createElement('div');
      card.className = 'upgrade-card';
      card.innerHTML = `
        <div class="icon">${u.icon}</div>
        <div class="name">${u.name}</div>
        <div class="desc">${u.desc}</div>
      `;
      card.onclick = () => this._applyUpgrade(u);
      upgradeCardsRoot.appendChild(card);
    }
  }

  _applyUpgrade(u) {
    if (!u.noObstacle) {
      const p = this.player.mesh.position;
      // 40% of the time the spawned block is a destructible loot crate instead of a wall.
      if (Math.random() < 0.4) this.spawnCrate(p.x, p.z);
      else                     this.spawnObstacle(p.x, p.z);
    }
    u.apply(this.player);
    this.pendingLevelUps -= 1;
    levelUpScreen.classList.add('hidden');
    if (this.pendingLevelUps > 0) {
      // Show next pending level-up
      setTimeout(() => this._showLevelUp(), 0);
    } else {
      this.paused = false;
    }
  }

  update(dt) {
    if (!this.running || this.paused) {
      this.updateHUD();
      return;
    }
    this.elapsed += dt;

    const bossAlive = this.enemies.some(e => e instanceof Boss && !e.dead);
    if (bossAlive) {
      // Pause regular spawns while a boss is active so the player can focus on it.
      this.spawnTimer = 0;
    } else {
      // Release one queued boss now that the field is clear.
      if (this.pendingBosses > 0) {
        this.pendingBosses -= 1;
        this.spawnBoss();
      } else {
        const spawnRate = Math.min(7, 1 + this.elapsed / 25);
        this.spawnTimer += dt;
        while (this.spawnTimer >= 1 / spawnRate) {
          this.spawnTimer -= 1 / spawnRate;
          this.spawnEnemy();
        }
      }
    }

    updateAimPoint(this.player);
    this.hq.update(dt, this);
    this.player.update(dt, this);
    for (const e of this.enemies) e.update(dt, this);
    for (const b of this.bullets) b.update(dt, this);
    for (const b of this.enemyBullets) b.update(dt, this);
    for (const c of this.crates) c.update(dt);
    for (const s of this.superPickups) s.update(dt, this);
    for (const a of this.ash) a.update(dt);
    for (const p of this.particles) p.update(dt);
    for (const o of this.orbs) o.update(dt, this);
    for (const h of this.hearts) h.update(dt, this);

    for (const e of this.enemies) if (e.dead) scene.remove(e.mesh);
    for (const b of this.bullets) if (b.dead) scene.remove(b.mesh);
    for (const b of this.enemyBullets) if (b.dead) scene.remove(b.mesh);
    for (const c of this.crates) if (c.dead) scene.remove(c.mesh);
    for (const s of this.superPickups) if (s.dead) scene.remove(s.mesh);
    for (const a of this.ash) if (a.dead) scene.remove(a.mesh);
    for (const p of this.particles) if (p.dead) scene.remove(p.mesh);
    for (const o of this.orbs) if (o.dead) scene.remove(o.mesh);
    for (const h of this.hearts) if (h.dead) scene.remove(h.mesh);
    this.enemies = this.enemies.filter(e => !e.dead);
    this.bullets = this.bullets.filter(b => !b.dead);
    this.enemyBullets = this.enemyBullets.filter(b => !b.dead);
    this.crates = this.crates.filter(c => !c.dead);
    this.superPickups = this.superPickups.filter(s => !s.dead);
    this.ash = this.ash.filter(a => !a.dead);
    this.particles = this.particles.filter(p => !p.dead);
    this.orbs = this.orbs.filter(o => !o.dead);
    this.hearts = this.hearts.filter(h => !h.dead);

    const target = this.player.mesh.position;
    const desired = new THREE.Vector3(target.x, 0, target.z).add(CAMERA_OFFSET);
    const shakeX = this.shake ? rand(-this.shake, this.shake) : 0;
    const shakeZ = this.shake ? rand(-this.shake, this.shake) : 0;
    camera.position.lerp(desired, 0.15);
    camera.position.x += shakeX;
    camera.position.z += shakeZ;
    camera.lookAt(target.x, 0.5, target.z);

    sun.position.set(target.x + 20, 40, target.z + 15);
    sun.target.position.set(target.x, 0, target.z);

    this.shake = Math.max(0, this.shake - dt * 4);

    this.updateHUD();
  }

  updateHUD() {
    const p = this.player;
    HUD.hpFill.style.width = (p.hp / p.maxHp) * 100 + '%';
    HUD.hpText.textContent = `${Math.ceil(p.hp)} / ${p.maxHp}`;
    HUD.xpFill.style.width = (p.xp / p.xpToNext) * 100 + '%';
    HUD.xpText.textContent = `${p.xp} / ${p.xpToNext} XP`;
    HUD.level.textContent = `Level ${p.level}`;
    HUD.score.textContent = `Score: ${this.score}`;
    HUD.time.textContent = `Time: ${Math.floor(this.elapsed)}s`;
    HUD.kills.textContent = `Kills: ${this.kills}`;
    const sc = this.player.superCharges;
    HUD.superHud.textContent = `⚡ Space  ×${sc}`;
    HUD.superHud.style.opacity = sc > 0 ? '1' : '0.45';
    this.drawMinimap();
  }

  drawMinimap() {
    const ctx = HUD.minimapCtx;
    const cv = HUD.minimap;
    const W = cv.width, H = cv.height;
    const cx = W / 2, cy = H / 2;
    const R = Math.min(cx, cy) - 2;
    const range = 40; // world units shown from edge to edge of half-radius
    const scale = R / range;

    ctx.clearRect(0, 0, W, H);

    // Clip to circle so dots outside don't bleed past the border
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.closePath();
    ctx.clip();

    // Concentric rings as range hints
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 1; i <= 2; i++) {
      ctx.beginPath();
      ctx.arc(cx, cy, (R / 3) * i, 0, TAU);
      ctx.stroke();
    }

    const px = this.player.mesh.position.x;
    const pz = this.player.mesh.position.z;

    const plot = (wx, wz) => {
      const dx = (wx - px) * scale;
      const dz = (wz - pz) * scale;
      return [cx + dx, cy + dz];
    };

    // Heal zone for the HQ.
    {
      const [hx, hy] = plot(this.hq.mesh.position.x, this.hq.mesh.position.z);
      ctx.fillStyle = 'rgba(136, 255, 204, 0.15)';
      ctx.beginPath();
      ctx.arc(hx, hy, this.hq.healRadius * scale, 0, TAU);
      ctx.fill();
    }

    // Obstacles (tan squares); HQ rendered distinctly.
    for (const obs of this.obstacles) {
      const [x, y] = plot(obs.mesh.position.x, obs.mesh.position.z);
      const w = obs.halfW * 2 * scale;
      const h = obs.halfD * 2 * scale;
      ctx.fillStyle = obs === this.hq ? '#a8c8b0' : '#9a8a6a';
      ctx.fillRect(x - w / 2, y - h / 2, w, h);
    }

    // Loot crates (yellow squares with a glow dot).
    ctx.fillStyle = '#ffd060';
    for (const c of this.crates) {
      const [x, y] = plot(c.mesh.position.x, c.mesh.position.z);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }

    // Super-strike pickups (bright orange).
    ctx.fillStyle = '#ff7028';
    for (const s of this.superPickups) {
      const [x, y] = plot(s.mesh.position.x, s.mesh.position.z);
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, TAU);
      ctx.fill();
    }

    // XP orbs (small cyan)
    ctx.fillStyle = '#6bd0ff';
    for (const o of this.orbs) {
      const [x, y] = plot(o.mesh.position.x, o.mesh.position.z);
      ctx.fillRect(x - 1, y - 1, 2, 2);
    }

    // Hearts (pink)
    ctx.fillStyle = '#ff4d6d';
    for (const h of this.hearts) {
      const [x, y] = plot(h.mesh.position.x, h.mesh.position.z);
      ctx.beginPath();
      ctx.arc(x, y, 2.5, 0, TAU);
      ctx.fill();
    }

    // Enemies (red); bosses larger, tinted by their kind.
    for (const e of this.enemies) {
      const [x, y] = plot(e.mesh.position.x, e.mesh.position.z);
      const isBoss = e instanceof Boss;
      if (isBoss) {
        ctx.fillStyle = '#' + e.cfg.particleColor.toString(16).padStart(6, '0');
      } else {
        ctx.fillStyle = '#ff5b5b';
      }
      ctx.beginPath();
      ctx.arc(x, y, isBoss ? 5 : 2.5, 0, TAU);
      ctx.fill();
    }

    ctx.restore();

    // Border ring (drawn after restore so it's not clipped)
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.stroke();

    // Player triangle pointing toward aim
    const ax = aimPoint.x - px;
    const az = aimPoint.z - pz;
    const angle = Math.atan2(az, ax);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = '#ffd84a';
    ctx.beginPath();
    ctx.moveTo(6, 0);
    ctx.lineTo(-4, -4);
    ctx.lineTo(-4, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  gameOver() {
    this.running = false;
    const prevBest = getBest();
    const isNewBest = this.score > prevBest;
    if (isNewBest) setBest(this.score);
    refreshBestUI();
    finalStats.innerHTML = `
      Level: <b>${this.player.level}</b><br>
      Score: <b>${this.score}</b>${isNewBest ? '  <span style="color:#ffd84a">★ NEW BEST</span>' : ''}<br>
      Time: <b>${Math.floor(this.elapsed)}s</b><br>
      Kills: <b>${this.kills}</b><br>
      Best: <b>${getBest()}</b>
    `;
    gameOverScreen.classList.remove('hidden');
  }
}

// ---------- Loop ----------
let game = null;
let lastTime = 0;

function startGame() {
  if (game) game.cleanup();
  game = new Game();
  startScreen.classList.add('hidden');
  gameOverScreen.classList.add('hidden');
  levelUpScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  // Unlock audio context (iOS requires init from a user gesture).
  sfx._ensure();
  lastTime = performance.now();
}

function togglePause() {
  if (!game || !game.running) return;
  if (game.pendingLevelUps > 0) return; // can't pause during upgrade selection
  game.paused = !game.paused;
  pauseScreen.classList.toggle('hidden', !game.paused);
}

function showBossWarning(text = 'BOSS!') {
  const div = document.createElement('div');
  div.className = 'boss-warning';
  div.textContent = text;
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1500);
}

renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (game) game.update(dt);
  renderer.render(scene, camera);
});
