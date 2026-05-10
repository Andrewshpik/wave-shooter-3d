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
    apply: p => { p.magnetRadius *= 1.6; }
  },
  {
    id: 'heal',  name: 'Лечение',  icon: '✨',
    desc: 'Восстановить 60 HP сейчас',
    apply: p => { p.hp = Math.min(p.maxHp, p.hp + 60); }
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

// ---------- Entities ----------
class Player {
  constructor() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.6, 0.6, 1.2, 16),
      new THREE.MeshStandardMaterial({ color: 0xffd84a, roughness: 0.6 })
    );
    body.position.y = 0.6;
    body.castShadow = true;
    group.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffe79a })
    );
    head.position.y = 1.5;
    head.castShadow = true;
    group.add(head);

    const gun = new THREE.Mesh(
      new THREE.BoxGeometry(0.3, 0.3, 1.2),
      new THREE.MeshStandardMaterial({ color: 0x2a2a36 })
    );
    gun.position.set(0, 1.0, 0.7);
    gun.castShadow = true;
    group.add(gun);

    this.mesh = group;
    this.gun = gun;
    this.body = body;

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
    this.body.material.emissive.setHex(flashing ? 0xffffff : 0x000000);
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
    const [sx, sy, sz] = cfg.size;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(sx, sy, sz),
      new THREE.MeshStandardMaterial({ color: cfg.color, roughness: 0.7 })
    );
    mesh.position.set(x, sy / 2, z);
    mesh.castShadow = true;
    this.mesh = mesh;

    this.type = type;
    this.cfg = cfg;
    this.baseY = sy / 2;
    this.r = cfg.r;
    this.speed = rand(cfg.speedRange[0], cfg.speedRange[1]);
    this.hp = cfg.hp;
    this.maxHp = cfg.hp;
    this.damage = cfg.damage;
    this.dead = false;
    this.hitFlash = 0;
    this.contactCd = 0;
    this.attackCd = cfg.attackCd ? rand(0, cfg.attackCd) : 0;
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
        muzzle.y = 1.0;
        game.spawnEnemyBullet(muzzle, dir, this.cfg.projectileSpeed, this.cfg.projectileDamage);
      }
    }
    if (move) {
      this.mesh.position.x += (dx / len) * this.speed * dt;
      this.mesh.position.z += (dz / len) * this.speed * dt;
    }
    this.mesh.rotation.y = Math.atan2(dx, dz);

    this.mesh.position.y = this.baseY + Math.sin(performance.now() * 0.008 + this.mesh.position.x) * 0.08;

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.contactCd = Math.max(0, this.contactCd - dt);
    this.mesh.material.emissive.setHex(this.hitFlash > 0 ? 0xff8888 : 0x000000);

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
    if (Math.random() < 0.25) {
      game.spawnHeart(this.mesh.position.clone());
    }
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const s = rand(3, 8);
      const v = new THREE.Vector3(Math.cos(a) * s, rand(2, 6), Math.sin(a) * s);
      game.spawnParticle(this.mesh.position.clone(), v, rand(0.4, 0.8), this.cfg.particleColor);
    }
  }
}

class Boss {
  constructor(x, z, tier = 1) {
    const size = 3.0 + tier * 0.4;
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * 1.2, size),
      new THREE.MeshStandardMaterial({ color: 0x4a1a6a, emissive: 0x6a3a8a, emissiveIntensity: 0.4, roughness: 0.5 })
    );
    body.position.y = size * 0.6;
    body.castShadow = true;
    group.add(body);

    // Glowing eyes
    for (const ex of [-size * 0.18, size * 0.18]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(size * 0.08, 8, 6),
        new THREE.MeshBasicMaterial({ color: 0xffd84a })
      );
      eye.position.set(ex, size * 0.85, size * 0.5 + 0.01);
      group.add(eye);
    }

    group.position.set(x, 0, z);
    this.mesh = group;
    this.body = body;
    this.size = size;

    this.r = size * 0.55;
    this.speed = 1.9 + tier * 0.2;
    this.hp = 1200 + tier * 800;
    this.maxHp = this.hp;
    this.damage = 42 + tier * 8;
    this.dead = false;
    this.hitFlash = 0;
    this.contactCd = 0;
    this.tier = tier;

    // HP bar above the boss
    const barW = size * 1.2;
    const barBg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.25),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    barBg.position.set(0, size * 1.4, 0);
    group.add(barBg);

    const barFg = new THREE.Mesh(
      new THREE.PlaneGeometry(barW, 0.22),
      new THREE.MeshBasicMaterial({ color: 0xff4040 })
    );
    barFg.position.set(0, size * 1.4, 0.01);
    group.add(barFg);
    this.barFg = barFg;
    this.barW = barW;
  }

  update(dt, game) {
    const p = game.player.mesh.position;
    const dx = p.x - this.mesh.position.x;
    const dz = p.z - this.mesh.position.z;
    const len = Math.hypot(dx, dz) || 1;
    this.mesh.position.x += (dx / len) * this.speed * dt;
    this.mesh.position.z += (dz / len) * this.speed * dt;
    // Boss doesn't rotate to keep HP bar readable; eyes always face +z.

    this.barFg.scale.x = Math.max(0.001, this.hp / this.maxHp);
    this.barFg.position.x = -this.barW * (1 - this.hp / this.maxHp) / 2;

    this.hitFlash = Math.max(0, this.hitFlash - dt);
    this.contactCd = Math.max(0, this.contactCd - dt);
    this.body.material.emissive.setHex(this.hitFlash > 0 ? 0xffffff : 0x6a3a8a);

    if (dx * dx + dz * dz < (this.r + game.player.r) ** 2 && this.contactCd <= 0) {
      game.player.takeDamage(this.damage, game);
      this.contactCd = 0.7;
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
    // Big XP + heart burst (1:1)
    const dropCount = 20 + this.tier * 8;
    for (let i = 0; i < dropCount; i++) {
      const o = this.mesh.position.clone();
      o.x += rand(-2, 2);
      o.z += rand(-2, 2);
      game.spawnXPOrb(o);
    }
    for (let i = 0; i < dropCount; i++) {
      const h = this.mesh.position.clone();
      h.x += rand(-3, 3);
      h.z += rand(-3, 3);
      game.spawnHeart(h);
    }
    // Big particle burst
    for (let i = 0; i < 60; i++) {
      const a = rand(0, TAU);
      const s = rand(6, 14);
      const v = new THREE.Vector3(Math.cos(a) * s, rand(4, 12), Math.sin(a) * s);
      game.spawnParticle(this.mesh.position.clone(), v, rand(0.6, 1.2), 0xc06bff);
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
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.35, 0),
      new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0xff1f4a, emissiveIntensity: 1.0, roughness: 0.4 })
    );
    mesh.position.copy(pos);
    mesh.position.y = 0.5;
    mesh.castShadow = true;
    this.mesh = mesh;
    this.r = 0.45;
    this.heal = 25;
    this.dead = false;
    this.spinSpeed = rand(1.5, 3);
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

// ---------- Game ----------
class Game {
  constructor() {
    this.player = new Player();
    scene.add(this.player.mesh);

    this.enemies = [];
    this.bullets = [];
    this.enemyBullets = [];
    this.particles = [];
    this.orbs = [];
    this.hearts = [];

    this.score = 0;
    this.kills = 0;
    this.elapsed = 0;
    this.spawnTimer = 0;
    this.nextBossAt = 60; // first boss at 1:00
    this.shake = 0;
    this.running = true;
    this.paused = false;
    this.pendingLevelUps = 0;
  }

  cleanup() {
    scene.remove(this.player.mesh);
    for (const e of this.enemies) scene.remove(e.mesh);
    for (const b of this.bullets) scene.remove(b.mesh);
    for (const b of this.enemyBullets) scene.remove(b.mesh);
    for (const p of this.particles) scene.remove(p.mesh);
    for (const o of this.orbs) scene.remove(o.mesh);
    for (const h of this.hearts) scene.remove(h.mesh);
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
    const x = p.x + Math.cos(a) * dist;
    const z = p.z + Math.sin(a) * dist;
    const type = this._pickEnemyType();
    const e = new Enemy(x, z, type);
    this.enemies.push(e);
    scene.add(e.mesh);
  }

  spawnBoss() {
    const tier = Math.floor(this.elapsed / 60);
    const a = rand(0, TAU);
    const dist = 32;
    const p = this.player.mesh.position;
    const x = p.x + Math.cos(a) * dist;
    const z = p.z + Math.sin(a) * dist;
    const b = new Boss(x, z, tier);
    this.enemies.push(b);
    scene.add(b.mesh);
    this.shake = Math.max(this.shake, 1.0);
    sfx.bossSpawn();
    showBossWarning();
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

  queueLevelUp() {
    this.pendingLevelUps += 1;
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

    const spawnRate = Math.min(7, 1 + this.elapsed / 25);
    this.spawnTimer += dt;
    while (this.spawnTimer >= 1 / spawnRate) {
      this.spawnTimer -= 1 / spawnRate;
      this.spawnEnemy();
    }

    if (this.elapsed >= this.nextBossAt) {
      this.spawnBoss();
      this.nextBossAt += 60;
    }

    updateAimPoint(this.player);
    this.player.update(dt, this);
    for (const e of this.enemies) e.update(dt, this);
    for (const b of this.bullets) b.update(dt, this);
    for (const b of this.enemyBullets) b.update(dt, this);
    for (const p of this.particles) p.update(dt);
    for (const o of this.orbs) o.update(dt, this);
    for (const h of this.hearts) h.update(dt, this);

    for (const e of this.enemies) if (e.dead) scene.remove(e.mesh);
    for (const b of this.bullets) if (b.dead) scene.remove(b.mesh);
    for (const b of this.enemyBullets) if (b.dead) scene.remove(b.mesh);
    for (const p of this.particles) if (p.dead) scene.remove(p.mesh);
    for (const o of this.orbs) if (o.dead) scene.remove(o.mesh);
    for (const h of this.hearts) if (h.dead) scene.remove(h.mesh);
    this.enemies = this.enemies.filter(e => !e.dead);
    this.bullets = this.bullets.filter(b => !b.dead);
    this.enemyBullets = this.enemyBullets.filter(b => !b.dead);
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

    // Enemies (red), bosses bigger purple
    for (const e of this.enemies) {
      const [x, y] = plot(e.mesh.position.x, e.mesh.position.z);
      const isBoss = e instanceof Boss;
      ctx.fillStyle = isBoss ? '#c06bff' : '#ff5b5b';
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

function showBossWarning() {
  const div = document.createElement('div');
  div.className = 'boss-warning';
  div.textContent = 'BOSS!';
  document.body.appendChild(div);
  setTimeout(() => div.remove(), 1500);
}

renderer.setAnimationLoop(now => {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  if (game) game.update(dt);
  renderer.render(scene, camera);
});
