#!/usr/bin/env node

const stdin = process.stdin;
const stdout = process.stdout;

// --- ANSI ---
const ESC = '\x1b[';
const hide = () => stdout.write(`${ESC}?25l`);
const show = () => stdout.write(`${ESC}?25h`);
const clear = () => stdout.write(`${ESC}2J`);
const moveTo = (x, y) => `${ESC}${y + 1};${x + 1}H`;
const fg = n => `${ESC}38;5;${n}m`;
const bg = n => `${ESC}48;5;${n}m`;
const reset = `${ESC}0m`;
const bold = `${ESC}1m`;
const dim = `${ESC}2m`;

// --- Game constants ---
const MAP_W = 70;
const MAP_H = 30;
const HUD_H = 3;
const LOG_H = 4;
const TILE_WALL = '#';
const TILE_FLOOR = '.';
const TILE_DOOR = '+';
const TILE_STAIRS = '>';
const TILE_CORRIDOR = '.';

// --- Game state ---
let map = [];
let visible = [];
let explored = [];
let player = { x: 0, y: 0, hp: 30, maxHp: 30, atk: 5, def: 2, gold: 0, xp: 0, level: 1, potions: 1, keys: 0, weapon: 'fists' };
let enemies = [];
let items = [];
let messages = [];
let turn = 0;
let floor = 1;
let gameOver = false;
let gameWon = false;

const WEAPONS = {
  'fists': { atk: 0, name: 'fists' },
  'dagger': { atk: 2, name: 'dagger (|)' },
  'sword': { atk: 5, name: 'sword (/)' },
  'axe': { atk: 8, name: 'battleaxe (T)' },
};

const ENEMY_TYPES = {
  r: { name: 'rat', hp: 4, atk: 2, def: 0, xp: 3, color: fg(130), chase: 3, speed: 1 },
  s: { name: 'snake', hp: 6, atk: 3, def: 1, xp: 5, color: fg(34), chase: 5, speed: 1 },
  g: { name: 'goblin', hp: 10, atk: 4, def: 1, xp: 8, color: fg(70), chase: 8, speed: 1 },
  b: { name: 'bat', hp: 5, atk: 3, def: 0, xp: 4, color: fg(93), chase: 6, speed: 2 },
  o: { name: 'orc', hp: 18, atk: 6, def: 3, xp: 15, color: fg(22) + bold, chase: 7, speed: 1 },
  S: { name: 'skeleton', hp: 14, atk: 5, def: 2, xp: 12, color: fg(255), chase: 10, speed: 1 },
  T: { name: 'troll', hp: 30, atk: 8, def: 4, xp: 25, color: fg(130) + bold, chase: 6, speed: 1 },
  D: { name: 'DRAGON', hp: 50, atk: 12, def: 6, xp: 100, color: fg(196) + bold, chase: 15, speed: 1 },
};

function msg(text) {
  messages.unshift(text);
  if (messages.length > LOG_H) messages.length = LOG_H;
}

// --- Dungeon generation ---
function generateDungeon() {
  map = [];
  visible = [];
  explored = [];
  for (let y = 0; y < MAP_H; y++) {
    map[y] = [];
    visible[y] = [];
    explored[y] = [];
    for (let x = 0; x < MAP_W; x++) {
      map[y][x] = TILE_WALL;
      visible[y][x] = false;
      explored[y][x] = false;
    }
  }

  const rooms = [];
  const maxRooms = 12 + floor * 2;
  const minSize = 4, maxSize = 9;

  for (let attempt = 0; attempt < 200 && rooms.length < maxRooms; attempt++) {
    const w = minSize + Math.floor(Math.random() * (maxSize - minSize));
    const h = minSize + Math.floor(Math.random() * (maxSize - minSize - 1));
    const x = 1 + Math.floor(Math.random() * (MAP_W - w - 2));
    const y = 1 + Math.floor(Math.random() * (MAP_H - h - 2));

    let overlap = false;
    for (const r of rooms) {
      if (x <= r.x + r.w + 1 && x + w + 1 >= r.x && y <= r.y + r.h + 1 && y + h + 1 >= r.y) {
        overlap = true; break;
      }
    }
    if (overlap) continue;

    // Carve room
    for (let ry = y; ry < y + h; ry++) {
      for (let rx = x; rx < x + w; rx++) {
        map[ry][rx] = TILE_FLOOR;
      }
    }
    rooms.push({ x, y, w, h, cx: Math.floor(x + w / 2), cy: Math.floor(y + h / 2) });
  }

  // Connect rooms with corridors
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i - 1], b = rooms[i];
    if (Math.random() < 0.5) {
      carveH(a.cx, b.cx, a.cy);
      carveV(b.cx, a.cy, b.cy);
    } else {
      carveV(a.cx, a.cy, b.cy);
      carveH(a.cx, b.cx, b.cy);
    }
  }

  // Place player in first room
  player.x = rooms[0].cx;
  player.y = rooms[0].cy;

  // Place stairs in last room
  const lastRoom = rooms[rooms.length - 1];
  map[lastRoom.cy][lastRoom.cx] = TILE_STAIRS;

  // Place enemies
  enemies = [];
  const floorEnemies = getFloorEnemies();
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    const numEnemies = Math.floor(Math.random() * 3) + (floor > 3 ? 1 : 0);
    for (let j = 0; j < numEnemies; j++) {
      const ex = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
      const ey = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
      if (ex === player.x && ey === player.y) continue;
      const type = floorEnemies[Math.floor(Math.random() * floorEnemies.length)];
      const tmpl = ENEMY_TYPES[type];
      enemies.push({
        x: ex, y: ey, ch: type, ...tmpl,
        hp: tmpl.hp + Math.floor(floor * 1.5),
        maxHp: tmpl.hp + Math.floor(floor * 1.5),
        atk: tmpl.atk + Math.floor(floor * 0.5),
        patrolDir: Math.floor(Math.random() * 4),
        patrolTimer: 0,
      });
    }
  }

  // Place items
  items = [];
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    const numItems = Math.random() < 0.6 ? 1 : (Math.random() < 0.3 ? 2 : 0);
    for (let j = 0; j < numItems; j++) {
      const ix = r.x + 1 + Math.floor(Math.random() * (r.w - 2));
      const iy = r.y + 1 + Math.floor(Math.random() * (r.h - 2));
      items.push(randomItem(ix, iy));
    }
  }
}

function getFloorEnemies() {
  if (floor <= 2) return ['r', 's', 'b'];
  if (floor <= 4) return ['s', 'g', 'b', 'S'];
  if (floor <= 6) return ['g', 'o', 'S'];
  if (floor <= 8) return ['o', 'S', 'T'];
  return ['T', 'D'];
}

function randomItem(x, y) {
  const roll = Math.random();
  if (roll < 0.35) return { x, y, ch: '$', name: 'gold', color: fg(220) + bold, effect: () => { player.gold += 5 + floor * 3; } };
  if (roll < 0.55) return { x, y, ch: '+', name: 'health potion', color: fg(196) + bold, effect: () => { player.potions++; } };
  if (roll < 0.70) return { x, y, ch: '!', name: 'elixir', color: fg(201), effect: () => { player.hp = Math.min(player.maxHp, player.hp + 10); msg('You feel refreshed! (+10 HP)'); } };
  if (roll < 0.82) {
    const weapons = floor < 3 ? ['dagger'] : (floor < 6 ? ['dagger', 'sword'] : ['sword', 'axe']);
    const w = weapons[Math.floor(Math.random() * weapons.length)];
    const wdata = WEAPONS[w];
    return { x, y, ch: w === 'axe' ? 'T' : (w === 'sword' ? '/' : '|'), name: wdata.name, color: fg(255) + bold, effect: () => {
      if (WEAPONS[w].atk > WEAPONS[player.weapon].atk) { player.weapon = w; msg(`Equipped ${wdata.name}!`); }
      else { msg(`Your weapon is already better.`); player.gold += 3; }
    }};
  }
  if (roll < 0.92) return { x, y, ch: ']', name: 'shield', color: fg(248), effect: () => { player.def += 1; msg('Defense +1!'); } };
  return { x, y, ch: '*', name: 'star gem', color: fg(226) + bold, effect: () => { player.xp += 15; msg('Gained 15 XP!'); checkLevelUp(); } };
}

function carveH(x1, x2, y) {
  for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
    if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) map[y][x] = TILE_FLOOR;
  }
}

function carveV(x, y1, y2) {
  for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
    if (y >= 0 && y < MAP_H && x >= 0 && x < MAP_W) map[y][x] = TILE_FLOOR;
  }
}

// --- FOV (simple raycasting) ---
function computeFOV() {
  for (let y = 0; y < MAP_H; y++) for (let x = 0; x < MAP_W; x++) visible[y][x] = false;

  const radius = 8;
  for (let angle = 0; angle < 360; angle += 1.5) {
    const rad = angle * Math.PI / 180;
    const dx = Math.cos(rad);
    const dy = Math.sin(rad);
    let cx = player.x + 0.5, cy = player.y + 0.5;
    for (let step = 0; step < radius; step++) {
      const ix = Math.floor(cx), iy = Math.floor(cy);
      if (ix < 0 || ix >= MAP_W || iy < 0 || iy >= MAP_H) break;
      visible[iy][ix] = true;
      explored[iy][ix] = true;
      if (map[iy][ix] === TILE_WALL) break;
      cx += dx;
      cy += dy;
    }
  }
}

// --- Combat ---
function attackEnemy(enemy) {
  const weaponAtk = WEAPONS[player.weapon].atk;
  const dmg = Math.max(1, player.atk + weaponAtk - enemy.def + Math.floor(Math.random() * 3));
  enemy.hp -= dmg;
  msg(`You hit the ${enemy.name} for ${dmg} damage!`);

  if (enemy.hp <= 0) {
    msg(`Defeated the ${enemy.name}! (+${enemy.xp} XP)`);
    player.xp += enemy.xp;
    enemies.splice(enemies.indexOf(enemy), 1);
    checkLevelUp();
  } else {
    // Enemy retaliates
    enemyAttack(enemy);
  }
}

function enemyAttack(enemy) {
  const dmg = Math.max(1, enemy.atk - player.def + Math.floor(Math.random() * 2));
  player.hp -= dmg;
  msg(`The ${enemy.name} hits you for ${dmg}!`);
  if (player.hp <= 0) {
    player.hp = 0;
    gameOver = true;
    msg('YOU HAVE DIED.');
  }
}

function checkLevelUp() {
  const needed = player.level * 20;
  if (player.xp >= needed) {
    player.level++;
    player.xp -= needed;
    player.maxHp += 5;
    player.hp = Math.min(player.maxHp, player.hp + 10);
    player.atk += 1;
    player.def += (player.level % 2 === 0) ? 1 : 0;
    msg(`*** LEVEL UP! You are now level ${player.level}! ***`);
  }
}

// --- Enemy AI ---
function moveEnemies() {
  for (const e of enemies) {
    const dx = player.x - e.x, dy = player.y - e.y;
    const dist = Math.abs(dx) + Math.abs(dy);

    // Only move every other turn for slow enemies
    e.patrolTimer++;
    if (e.speed === 1 && e.patrolTimer % 2 !== 0) continue;

    if (dist <= e.chase && visible[e.y]?.[e.x]) {
      // Chase player
      let mx = 0, my = 0;
      if (Math.abs(dx) >= Math.abs(dy)) mx = dx > 0 ? 1 : -1;
      else my = dy > 0 ? 1 : -1;

      const nx = e.x + mx, ny = e.y + my;
      if (nx === player.x && ny === player.y) {
        enemyAttack(e);
      } else if (canWalk(nx, ny) && !enemyAt(nx, ny)) {
        e.x = nx; e.y = ny;
      }
    } else {
      // Patrol randomly
      if (Math.random() < 0.3) {
        const dirs = [[0,-1],[0,1],[-1,0],[1,0]];
        const d = dirs[Math.floor(Math.random() * 4)];
        const nx = e.x + d[0], ny = e.y + d[1];
        if (canWalk(nx, ny) && !enemyAt(nx, ny) && !(nx === player.x && ny === player.y)) {
          e.x = nx; e.y = ny;
        }
      }
    }
  }
}

function canWalk(x, y) {
  if (x < 0 || x >= MAP_W || y < 0 || y >= MAP_H) return false;
  return map[y][x] !== TILE_WALL;
}

function enemyAt(x, y) {
  return enemies.find(e => e.x === x && e.y === y);
}

function itemAt(x, y) {
  return items.findIndex(i => i.x === x && i.y === y);
}

// --- Player action ---
function movePlayer(dx, dy) {
  if (gameOver || gameWon) return;
  const nx = player.x + dx, ny = player.y + dy;
  if (!canWalk(nx, ny)) return;

  const enemy = enemyAt(nx, ny);
  if (enemy) {
    attackEnemy(enemy);
  } else {
    player.x = nx;
    player.y = ny;

    // Pick up item
    const idx = itemAt(nx, ny);
    if (idx >= 0) {
      const item = items[idx];
      msg(`Picked up ${item.name}!`);
      item.effect();
      items.splice(idx, 1);
    }

    // Stairs
    if (map[ny][nx] === TILE_STAIRS) {
      floor++;
      if (floor > 9) {
        gameWon = true;
        msg('You escaped the dungeon! YOU WIN!');
      } else {
        msg(`Descending to floor ${floor}...`);
        generateDungeon();
      }
    }
  }

  turn++;
  if (!gameOver && !gameWon) moveEnemies();
  computeFOV();
}

function usePotion() {
  if (player.potions <= 0) { msg('No potions left!'); return; }
  player.potions--;
  const heal = 12 + player.level * 2;
  player.hp = Math.min(player.maxHp, player.hp + heal);
  msg(`Used potion! (+${heal} HP)`);
  turn++;
  moveEnemies();
  computeFOV();
}

// --- Rendering ---
function render() {
  let out = `${ESC}1;1H`;

  // HUD
  const hpBar = makeBar(player.hp, player.maxHp, 15, fg(196), fg(52));
  const xpBar = makeBar(player.xp, player.level * 20, 10, fg(226), fg(58));
  const weaponName = WEAPONS[player.weapon].name;
  out += `${reset}${bold}${fg(255)} HP ${hpBar} ${player.hp}/${player.maxHp}  `;
  out += `${fg(220)}$${player.gold}  ${fg(196)}+${player.potions}  `;
  out += `${fg(248)}Atk:${player.atk + WEAPONS[player.weapon].atk} Def:${player.def}  `;
  out += `${fg(255)}Lv${player.level} ${xpBar}  ${fg(242)}[${weaponName}]`;
  out += `${reset}${' '.repeat(Math.max(0, MAP_W - 65))}`;
  out += `\n${fg(242)}${'─'.repeat(MAP_W)}${reset}\n`;

  // Map
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (x === player.x && y === player.y) {
        out += `${fg(46)}${bold}@${reset}`;
      } else {
        const enemy = enemyAt(x, y);
        const itemIdx = itemAt(x, y);

        if (visible[y][x]) {
          if (enemy) {
            out += `${enemy.color}${enemy.ch}${reset}`;
          } else if (itemIdx >= 0) {
            out += `${items[itemIdx].color}${items[itemIdx].ch}${reset}`;
          } else {
            out += tileChar(map[y][x], true);
          }
        } else if (explored[y][x]) {
          out += tileChar(map[y][x], false);
        } else {
          out += ' ';
        }
      }
    }
    out += '\n';
  }

  // Log
  out += `${fg(242)}${'─'.repeat(MAP_W)}${reset}\n`;
  for (let i = 0; i < LOG_H; i++) {
    const m = messages[i] || '';
    const logColor = i === 0 ? fg(255) : fg(242);
    out += `${logColor} ${m}${reset}${' '.repeat(Math.max(0, MAP_W - m.length - 1))}\n`;
  }

  // Controls
  out += `${dim}${fg(242)} [arrows/wasd] move  [p] potion  [q] quit  Floor ${floor}/9${reset}`;

  stdout.write(out);
}

function tileChar(tile, lit) {
  if (lit) {
    switch (tile) {
      case TILE_WALL: return `${fg(240)}#${reset}`;
      case TILE_FLOOR: return `${fg(236)}·${reset}`;
      case TILE_STAIRS: return `${fg(226)}${bold}>${reset}`;
      default: return `${fg(236)}·${reset}`;
    }
  } else {
    switch (tile) {
      case TILE_WALL: return `${fg(234)}#${reset}`;
      case TILE_FLOOR: return `${fg(233)}·${reset}`;
      case TILE_STAIRS: return `${fg(58)}>${reset}`;
      default: return `${fg(233)}·${reset}`;
    }
  }
}

function makeBar(val, max, width, fgOn, fgOff) {
  const filled = Math.max(0, Math.round((val / max) * width));
  let bar = '';
  for (let i = 0; i < width; i++) {
    bar += i < filled ? `${fgOn}█` : `${fgOff}░`;
  }
  return bar + reset;
}

// --- Input ---
stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding('utf8');

stdin.on('data', key => {
  if (key === 'q' || key === '\x03') { // q or ctrl-c
    show();
    clear();
    stdout.write(`${ESC}1;1H`);
    if (gameWon) console.log(`You escaped with ${player.gold} gold at level ${player.level}! GG!`);
    else if (gameOver) console.log(`You died on floor ${floor} with ${player.gold} gold. RIP.`);
    else console.log(`Thanks for playing! Floor ${floor}, ${player.gold} gold, level ${player.level}.`);
    process.exit(0);
  }

  if (gameOver || gameWon) {
    // Any key to quit after game end
    show(); clear(); stdout.write(`${ESC}1;1H`);
    if (gameWon) console.log(`You escaped with ${player.gold} gold at level ${player.level}! GG!`);
    else console.log(`You died on floor ${floor} with ${player.gold} gold. RIP.`);
    process.exit(0);
  }

  // Arrow keys come as escape sequences
  if (key === '\x1b[A' || key === 'w') movePlayer(0, -1);
  else if (key === '\x1b[B' || key === 's') movePlayer(0, 1);
  else if (key === '\x1b[C' || key === 'd') movePlayer(1, 0);
  else if (key === '\x1b[D' || key === 'a') movePlayer(-1, 0);
  else if (key === 'p') usePotion();
  else if (key === ' ') {
    // Wait a turn
    msg('You wait...');
    turn++;
    moveEnemies();
    computeFOV();
  }

  render();
});

// --- Start ---
hide();
clear();
msg('Welcome to the dungeon! Find the stairs (>) on each floor.');
msg('Reach floor 9 to escape. Good luck!');
generateDungeon();
computeFOV();
render();
