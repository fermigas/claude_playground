#!/usr/bin/env node

// --- ANSI helpers ---
const ESC = '\x1b[';
const hide = () => process.stdout.write(`${ESC}?25l`);
const show = () => process.stdout.write(`${ESC}?25h`);
const clear = () => process.stdout.write(`${ESC}2J`);
const move = (x, y) => process.stdout.write(`${ESC}${y + 1};${x + 1}H`);
const color = (fg, bg) => {
  let s = `${ESC}${fg}m`;
  if (bg) s += `${ESC}${bg}m`;
  return s;
};
const reset = `${ESC}0m`;
const bold = `${ESC}1m`;
const dim = `${ESC}2m`;

// 256-color foreground
const fg = n => `${ESC}38;5;${n}m`;
const bg = n => `${ESC}48;5;${n}m`;

// --- Terminal size ---
let W = process.stdout.columns || 80;
let H = process.stdout.rows || 24;
process.stdout.on('resize', () => { W = process.stdout.columns; H = process.stdout.rows; });

// --- Screen buffer ---
let buffer = [];
function clearBuffer() {
  buffer = [];
  for (let y = 0; y < H; y++) {
    buffer[y] = [];
    for (let x = 0; x < W; x++) {
      buffer[y][x] = { ch: ' ', style: '' };
    }
  }
}

function putChar(x, y, ch, style = '') {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix >= 0 && ix < W && iy >= 1 && iy < H - 1) {
    buffer[iy][ix] = { ch, style };
  }
}

function putString(x, y, str, style = '') {
  for (let i = 0; i < str.length; i++) {
    putChar(x + i, y, str[i], style);
  }
}

function renderBuffer() {
  let out = '';
  for (let y = 0; y < H; y++) {
    out += `${ESC}${y + 1};1H`;
    let lastStyle = '';
    for (let x = 0; x < W; x++) {
      const cell = buffer[y][x];
      if (cell.style !== lastStyle) {
        out += reset + cell.style;
        lastStyle = cell.style;
      }
      out += cell.ch;
    }
  }
  out += reset;
  process.stdout.write(out);
}

// --- Food particles ---
const foods = [];
const maxFood = 12;

function spawnFood() {
  if (foods.length >= maxFood) return;
  foods.push({
    x: 3 + Math.random() * (W - 6),
    y: 2 + Math.random() * (H - 4),
    type: Math.random() < 0.5 ? 'dot' : 'star',
    age: 0,
    eaten: false,
  });
}

function drawFood(f, tick) {
  if (f.eaten) return;
  f.age++;
  const twinkle = Math.sin(tick * 0.2 + f.x) > 0;
  if (f.type === 'dot') {
    putChar(f.x, f.y, twinkle ? '.' : ',', fg(228));
  } else {
    putChar(f.x, f.y, twinkle ? '*' : '+', fg(214) + bold);
  }
}

// --- Creature base ---
class Creature {
  constructor(name, x, y) {
    this.name = name;
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
    this.tick = 0;
    this.state = 'idle';
    this.stateTimer = 0;
    this.foodTarget = null;
    this.lastAction = '';
    this.actionTimer = 0;
  }

  clamp() {
    this.x = Math.max(2, Math.min(W - this.width() - 2, this.x));
    this.y = Math.max(2, Math.min(H - this.height() - 2, this.y));
  }

  width() { return 3; }
  height() { return 1; }

  nearestFood() {
    let best = null, bestDist = Infinity;
    for (const f of foods) {
      if (f.eaten) continue;
      const dx = f.x - this.x, dy = f.y - this.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < bestDist) { bestDist = d; best = f; }
    }
    return bestDist < 30 ? best : null;
  }

  eatNearby() {
    for (const f of foods) {
      if (f.eaten) continue;
      const dx = Math.abs(f.x - this.x);
      const dy = Math.abs(f.y - this.y);
      if (dx < 3 && dy < 2) {
        f.eaten = true;
        this.lastAction = 'nom!';
        this.actionTimer = 15;
        return true;
      }
    }
    return false;
  }

  drawAction() {
    if (this.actionTimer > 0) {
      this.actionTimer--;
      putString(this.x, this.y - 1, this.lastAction, dim + fg(250));
    }
  }
}

// --- Bouncy Blob ---
class BouncyBlob extends Creature {
  constructor(x, y) {
    super('Blob', x, y);
    this.vx = (Math.random() - 0.5) * 2;
    this.vy = (Math.random() - 0.5) * 1.5;
    this.squish = 0;
  }
  width() { return 5; }
  height() { return 3; }

  update() {
    this.tick++;
    this.vy += 0.05; // gravity

    // Chase food sometimes
    const food = this.nearestFood();
    if (food && Math.random() < 0.03) {
      this.vx += (food.x - this.x) > 0 ? 0.15 : -0.15;
      this.vy += (food.y - this.y) > 0 ? 0.1 : -0.1;
    }

    this.x += this.vx;
    this.y += this.vy;

    // Bounce off walls
    if (this.x <= 2 || this.x >= W - 7) { this.vx *= -0.8; this.squish = 5; }
    if (this.y <= 2) { this.vy *= -0.8; }
    if (this.y >= H - 5) { this.vy = -Math.abs(this.vy) * 0.85 - 0.5; this.squish = 5; }

    this.vx *= 0.99;
    if (this.squish > 0) this.squish--;
    this.clamp();
    this.eatNearby();

    // Random bounce
    if (this.tick % 80 === 0) {
      this.vy = -(Math.random() * 1.5 + 0.8);
      this.lastAction = 'boing!';
      this.actionTimer = 10;
    }
  }

  draw() {
    const s = this.squish > 0;
    const ix = Math.round(this.x), iy = Math.round(this.y);
    const c = fg(213) + bold;
    if (s) {
      putString(ix, iy,     ' ~~~ ', c);
      putString(ix, iy + 1, '(o o)', c);
      putString(ix, iy + 2, ' ~~~ ', c);
    } else {
      putString(ix, iy,     ' /-\\ ', c);
      putString(ix, iy + 1, '(o.o)', c);
      putString(ix, iy + 2, ' \\_/ ', c);
    }
    this.drawAction();
  }
}

// --- Slow Turtle ---
class SlowTurtle extends Creature {
  constructor(x, y) {
    super('Turtle', x, y);
    this.dir = Math.random() < 0.5 ? 1 : -1;
    this.restTimer = 0;
    this.sleeping = false;
  }
  width() { return 7; }
  height() { return 2; }

  update() {
    this.tick++;

    if (this.sleeping) {
      this.restTimer--;
      if (this.restTimer <= 0) {
        this.sleeping = false;
        this.lastAction = '*yawn*';
        this.actionTimer = 15;
      }
      return;
    }

    // Slow deliberate movement
    const food = this.nearestFood();
    if (food) {
      this.dir = food.x > this.x ? 1 : -1;
      this.x += this.dir * 0.15;
      if (Math.abs(food.y - this.y) > 1) this.y += (food.y > this.y ? 0.08 : -0.08);
    } else {
      this.x += this.dir * 0.08;
    }

    this.eatNearby();

    // Occasionally stop and rest
    if (this.tick % 200 === 0 && Math.random() < 0.4) {
      this.sleeping = true;
      this.restTimer = 50 + Math.floor(Math.random() * 50);
      this.lastAction = 'zzz...';
      this.actionTimer = this.restTimer;
    }

    // Turn at edges
    if (this.x <= 3) this.dir = 1;
    if (this.x >= W - 10) this.dir = -1;
    if (this.tick % 150 === 0 && Math.random() < 0.3) this.dir *= -1;

    this.clamp();
  }

  draw() {
    const ix = Math.round(this.x), iy = Math.round(this.y);
    const c = fg(71) + bold;
    const eyeOpen = !this.sleeping;
    if (this.dir > 0) {
      putString(ix, iy,     `  ___ `, c);
      putString(ix, iy + 1, `=${eyeOpen ? 'O' : '-'}|___|>`, c);
    } else {
      putString(ix, iy,     ` ___  `, c);
      putString(ix, iy + 1, `<|___|${eyeOpen ? 'O' : '-'}=`, c);
    }
    this.drawAction();
  }
}

// --- Hyperactive Squirrel ---
class HyperSquirrel extends Creature {
  constructor(x, y) {
    super('Squirrel', x, y);
    this.targetX = x;
    this.targetY = y;
    this.jittering = false;
  }
  width() { return 4; }
  height() { return 2; }

  update() {
    this.tick++;

    // Erratic movement — pick new targets frequently
    if (this.tick % 8 === 0 || Math.abs(this.x - this.targetX) < 1) {
      const food = this.nearestFood();
      if (food && Math.random() < 0.6) {
        this.targetX = food.x;
        this.targetY = food.y;
      } else {
        this.targetX = this.x + (Math.random() - 0.5) * 20;
        this.targetY = this.y + (Math.random() - 0.5) * 10;
      }
    }

    // Dash toward target
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    this.vx += dx * 0.08;
    this.vy += dy * 0.08;
    this.vx *= 0.85;
    this.vy *= 0.85;

    this.x += this.vx;
    this.y += this.vy;
    this.clamp();
    this.eatNearby();

    // Jitter
    this.jittering = Math.abs(this.vx) > 1;

    // Random freak-out
    if (this.tick % 120 === 0 && Math.random() < 0.3) {
      this.vx = (Math.random() - 0.5) * 6;
      this.vy = (Math.random() - 0.5) * 4;
      this.lastAction = '!!EEK!!';
      this.actionTimer = 8;
    }
  }

  draw() {
    const ix = Math.round(this.x), iy = Math.round(this.y);
    const c = fg(208) + bold;
    const tail = this.jittering ? '~' : 'S';
    const eyes = this.jittering ? 'OO' : 'oo';
    putString(ix, iy,     ` (${eyes})`, c);
    putString(ix, iy + 1, `${tail}(  )`, c);
    this.drawAction();
  }
}

// --- Meditative Jellyfish ---
class MeditativeJellyfish extends Creature {
  constructor(x, y) {
    super('Jellyfish', x, y);
    this.baseY = y;
    this.phase = Math.random() * Math.PI * 2;
  }
  width() { return 5; }
  height() { return 4; }

  update() {
    this.tick++;

    // Gentle sine-wave floating
    this.x += Math.sin(this.tick * 0.02 + this.phase) * 0.2;
    this.y = this.baseY + Math.sin(this.tick * 0.015 + this.phase) * 4;

    // Very slowly drift
    this.x += Math.sin(this.tick * 0.003) * 0.05;
    this.baseY += Math.sin(this.tick * 0.005 + this.phase * 2) * 0.02;

    // Gentle food attraction
    const food = this.nearestFood();
    if (food) {
      this.x += (food.x - this.x) * 0.003;
      this.baseY += (food.y - this.y) * 0.003;
    }

    this.clamp();
    this.eatNearby();

    // Occasional zen moment
    if (this.tick % 250 === 0) {
      this.lastAction = '~ om ~';
      this.actionTimer = 20;
    }
  }

  draw() {
    const ix = Math.round(this.x), iy = Math.round(this.y);
    const phase = this.tick * 0.05;
    const c1 = fg(141);
    const c2 = fg(135);

    putString(ix, iy,     ' ,-. ', c1 + bold);
    putString(ix, iy + 1, '( ~ )', c1);
    // Animated tentacles
    const t1 = Math.sin(phase) > 0 ? '/' : '\\';
    const t2 = Math.sin(phase + 1) > 0 ? '\\' : '/';
    const t3 = Math.sin(phase + 2) > 0 ? '|' : '/';
    putString(ix, iy + 2, ` ${t1}${t3}${t2} `, c2);
    putString(ix, iy + 3, ` : : `, c2 + dim);
    this.drawAction();
  }
}

// --- Dancing Crab ---
class DancingCrab extends Creature {
  constructor(x, y) {
    super('Crab', x, y);
    this.dir = 1;
    this.dancing = false;
    this.danceTimer = 0;
  }
  width() { return 7; }
  height() { return 2; }

  update() {
    this.tick++;

    if (this.dancing) {
      this.danceTimer--;
      this.x += Math.sin(this.tick * 0.3) * 0.8;
      if (this.danceTimer <= 0) this.dancing = false;
    } else {
      // Side-walk like a crab
      this.x += this.dir * 0.3;

      const food = this.nearestFood();
      if (food) {
        this.dir = food.x > this.x ? 1 : -1;
        this.x += this.dir * 0.2;
        if (Math.abs(food.y - this.y) > 1) this.y += (food.y > this.y ? 0.1 : -0.1);
      }

      if (this.x <= 3 || this.x >= W - 10) this.dir *= -1;

      // Random dance break
      if (this.tick % 100 === 0 && Math.random() < 0.35) {
        this.dancing = true;
        this.danceTimer = 30;
        this.lastAction = '~dance~';
        this.actionTimer = 30;
      }
    }

    this.clamp();
    this.eatNearby();
  }

  draw() {
    const ix = Math.round(this.x), iy = Math.round(this.y);
    const c = fg(196) + bold;
    const clawUp = this.dancing || (this.tick % 20 < 10);
    if (clawUp) {
      putString(ix, iy,     'V(o o)V', c);
      putString(ix, iy + 1, '  |||  ', c);
    } else {
      putString(ix, iy,     '>(o o)<', c);
      putString(ix, iy + 1, '  |||  ', c);
    }
    this.drawAction();
  }
}

// --- Shy Ghost ---
class ShyGhost extends Creature {
  constructor(x, y) {
    super('Ghost', x, y);
    this.hiding = false;
    this.hideTimer = 0;
    this.floatPhase = Math.random() * Math.PI * 2;
  }
  width() { return 5; }
  height() { return 3; }

  update() {
    this.tick++;

    // Check if any other creature is close
    let scared = false;
    for (const c of creatures) {
      if (c === this) continue;
      const dx = c.x - this.x, dy = c.y - this.y;
      if (Math.sqrt(dx * dx + dy * dy) < 10) {
        scared = true;
        this.vx -= dx * 0.05;
        this.vy -= dy * 0.05;
      }
    }

    if (scared && !this.hiding) {
      this.hiding = true;
      this.hideTimer = 30;
      this.lastAction = 'eep!';
      this.actionTimer = 12;
    }

    if (this.hiding) {
      this.hideTimer--;
      if (this.hideTimer <= 0) this.hiding = false;
    }

    // Float gently
    this.x += Math.sin(this.tick * 0.02 + this.floatPhase) * 0.3 + this.vx;
    this.y += Math.cos(this.tick * 0.018 + this.floatPhase) * 0.2 + this.vy;
    this.vx *= 0.92;
    this.vy *= 0.92;

    // Slow food drift
    const food = this.nearestFood();
    if (food && !this.hiding) {
      this.x += (food.x - this.x) * 0.005;
      this.y += (food.y - this.y) * 0.005;
    }

    this.clamp();
    this.eatNearby();
  }

  draw() {
    const ix = Math.round(this.x), iy = Math.round(this.y);
    const c = this.hiding ? fg(240) + dim : fg(255) + bold;
    if (this.hiding) {
      putString(ix, iy,     '     ', c);
      putString(ix, iy + 1, ' ... ', c);
      putString(ix, iy + 2, '     ', c);
    } else {
      putString(ix, iy,     ' .-. ', c);
      putString(ix, iy + 1, '(o_o)', c);
      putString(ix, iy + 2, '/| |\\', c);
    }
    this.drawAction();
  }
}

// --- Initialize creatures ---
const creatures = [];

function spawnCreatures() {
  const margin = 8;
  creatures.push(new BouncyBlob(W * 0.2, H * 0.5));
  creatures.push(new SlowTurtle(W * 0.5, H * 0.75));
  creatures.push(new HyperSquirrel(W * 0.7, H * 0.3));
  creatures.push(new MeditativeJellyfish(W * 0.3, H * 0.3));
  creatures.push(new DancingCrab(W * 0.6, H * 0.7));
  creatures.push(new ShyGhost(W * 0.8, H * 0.5));
}

// --- Status bar ---
function drawStatusBar(tick) {
  const bar = `${dim}${fg(242)} ascii-creatures | ${creatures.length} creatures | ${foods.filter(f => !f.eaten).length} food | tick ${tick} | ctrl+c to exit ${reset}`;
  process.stdout.write(`${ESC}1;1H${bar}${' '.repeat(Math.max(0, W - 80))}`);
}

// --- Ground decoration ---
function drawGround() {
  const y = H - 2;
  const c = fg(22) + dim;
  for (let x = 0; x < W; x++) {
    const ch = Math.sin(x * 0.3) > 0.3 ? ',' : (Math.sin(x * 0.7) > 0.5 ? '\'' : '.');
    putChar(x, y, ch, c);
  }
}

// --- Main loop ---
let tick = 0;

function loop() {
  clearBuffer();

  // Spawn food periodically
  if (tick % 50 === 0) spawnFood();

  // Remove eaten food
  for (let i = foods.length - 1; i >= 0; i--) {
    if (foods[i].eaten) foods.splice(i, 1);
  }

  // Ground
  drawGround();

  // Food
  for (const f of foods) drawFood(f, tick);

  // Update & draw creatures
  for (const c of creatures) c.update();
  // Sort by Y for depth
  const sorted = [...creatures].sort((a, b) => a.y - b.y);
  for (const c of sorted) c.draw();

  renderBuffer();
  drawStatusBar(tick);

  tick++;
}

// --- Setup & teardown ---
hide();
clear();
spawnCreatures();
for (let i = 0; i < 5; i++) spawnFood();

const interval = setInterval(loop, 100);

process.on('SIGINT', () => {
  clearInterval(interval);
  show();
  clear();
  move(0, 0);
  console.log('Thanks for watching the creatures! Bye.');
  process.exit(0);
});

process.on('exit', () => { show(); });
