/* Digger v2 - upgraded visuals, UI, and simulation logic (no build step) */

const RES = { EMPTY: 0, DIRT: 1, STONE: 2, COAL: 3, IRON: 4, GOLD: 5, DIAMOND: 6 };
const RES_ORDER = [RES.STONE, RES.COAL, RES.IRON, RES.GOLD, RES.DIAMOND];
const RES_META = {
  [RES.STONE]: { key: "stone", name: "Stone", color: "#8ea0b1", value: 1 },
  [RES.COAL]: { key: "coal", name: "Coal", color: "#2e3034", value: 3 },
  [RES.IRON]: { key: "iron", name: "Iron", color: "#d27461", value: 5 },
  [RES.GOLD]: { key: "gold", name: "Gold", color: "#ffd34a", value: 9 },
  [RES.DIAMOND]: { key: "diamond", name: "Diamond", color: "#71f1ff", value: 16 },
};

const WORLD_W = 110;
const WORLD_H = 72;
const BASE_X = Math.floor(WORLD_W / 2);
const BASE_Y = 0;
const START_DWARFS = 4;

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const resourcesEl = document.getElementById("resources");
const hudEl = document.getElementById("hud");

let dpr = 1;
let cellPx = 10;
let grid = new Uint8Array(WORLD_W * WORLD_H);
let totals = makeTotals();
let dwarfs = [];
let nextDwarfId = 1;

let simAcc = 0;
let lastT = performance.now();
let gameSpeed = 1;
let paused = false;

const upgrades = {
  autoHire: { key: "autoHire", label: "Auto Hire", level: 0, max: 4, base: 70, growth: 1.8, desc: "Automatically recruits dwarfs over time." },
  bag: { key: "bag", label: "Bigger Bags", level: 0, max: 6, base: 60, growth: 1.7, desc: "+3 bag capacity per level." },
  picks: { key: "picks", label: "Steel Picks", level: 0, max: 5, base: 90, growth: 2.1, desc: "Improves mining speed." },
  lamps: { key: "lamps", label: "Lanterns", level: 0, max: 5, base: 80, growth: 1.9, desc: "Improves pathing range and visibility." },
};

function makeTotals() { return { stone: 0, coal: 0, iron: 0, gold: 0, diamond: 0, credits: 0 }; }
const idx = (x, y) => y * WORLD_W + x;
const inBounds = (x, y) => x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H;
function getCell(x, y) { if (!inBounds(x, y) || y === 0) return RES.EMPTY; return grid[idx(x, y)]; }
function setCell(x, y, t) { if (!inBounds(x, y) || y === 0) return; grid[idx(x, y)] = t; }
const isEmpty = (x, y) => getCell(x, y) === RES.EMPTY;

function pickCellType(y) {
  const d = Math.min(1, Math.max(0, (y - 1) / (WORLD_H - 2)));
  let wStone = 0.52 - d * 0.07;
  let wCoal = 0.14 + d * 0.03;
  let wIron = 0.08 + d * 0.06;
  let wGold = 0.03 + d * 0.05;
  let wDiamond = 0.004 + d * 0.03;
  let wDirt = Math.max(0.08, 1 - (wStone + wCoal + wIron + wGold + wDiamond));
  if (y < 5) { wDirt += 0.12; wStone -= 0.08; }
  const sum = wStone + wCoal + wIron + wGold + wDiamond + wDirt;
  const r = Math.random() * sum;
  if (r < wDirt) return RES.DIRT;
  if (r < wDirt + wStone) return RES.STONE;
  if (r < wDirt + wStone + wCoal) return RES.COAL;
  if (r < wDirt + wStone + wCoal + wIron) return RES.IRON;
  if (r < wDirt + wStone + wCoal + wIron + wGold) return RES.GOLD;
  return RES.DIAMOND;
}

function createDwarf() {
  const bagCap = 18 + upgrades.bag.level * 3;
  return {
    id: nextDwarfId++,
    x: BASE_X, y: BASE_Y, fx: BASE_X, fy: BASE_Y,
    state: "dig", bagCap, bagCount: 0, bag: makeTotals(),
    digTimer: 0, path: null, pathAt: 0, mood: 1 + Math.random() * 0.3,
  };
}

function generateWorld() {
  grid = new Uint8Array(WORLD_W * WORLD_H);
  for (let y = 1; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) setCell(x, y, pickCellType(y));
  for (let y = 1; y < 4; y++) setCell(BASE_X, y, RES.EMPTY);
  for (let x = BASE_X - 2; x <= BASE_X + 2; x++) setCell(x, 1, RES.EMPTY);
}

function resetGame() {
  totals = makeTotals();
  dwarfs = [];
  nextDwarfId = 1;
  Object.values(upgrades).forEach((u) => (u.level = 0));
  generateWorld();
  for (let i = 0; i < START_DWARFS; i++) dwarfs.push(createDwarf());
  renderResourceBar();
  bindButtons();
}

function creditValueForCell(t) { return RES_META[t]?.value || 0; }
function addToBag(d, t) {
  if (t === RES.DIRT) t = RES.STONE;
  const meta = RES_META[t];
  if (!meta) return;
  d.bag[meta.key] += 1;
  d.bagCount++;
}
function depositBag(d) {
  for (const k of ["stone", "coal", "iron", "gold", "diamond"]) {
    totals[k] += d.bag[k];
    totals.credits += d.bag[k] * ({ stone: 1, coal: 3, iron: 5, gold: 9, diamond: 16 }[k]);
    d.bag[k] = 0;
  }
  d.bagCount = 0;
}

function bfsPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];
  const qx = new Int16Array(WORLD_W * WORLD_H), qy = new Int16Array(WORLD_W * WORLD_H);
  const visited = new Uint8Array(WORLD_W * WORLD_H), prev = new Int32Array(WORLD_W * WORLD_H); prev.fill(-1);
  let qh = 0, qt = 0; visited[idx(sx, sy)] = 1; qx[qt] = sx; qy[qt++] = sy;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  while (qh < qt) {
    const x = qx[qh], y = qy[qh++];
    for (const [dx, dy] of dirs) {
      const nx = x + dx, ny = y + dy; if (!inBounds(nx, ny) || visited[idx(nx, ny)] || !isEmpty(nx, ny)) continue;
      visited[idx(nx, ny)] = 1; prev[idx(nx, ny)] = idx(x, y);
      if (nx === tx && ny === ty) {
        const path = [{ x: nx, y: ny }];
        let cur = prev[idx(nx, ny)], s = idx(sx, sy);
        while (cur !== -1 && cur !== s) { path.push({ x: cur % WORLD_W, y: (cur / WORLD_W) | 0 }); cur = prev[cur]; }
        path.push({ x: sx, y: sy }); return path.reverse();
      }
      qx[qt] = nx; qy[qt++] = ny;
    }
  }
  return null;
}

function nearestDigTarget(d) {
  const r = 8 + upgrades.lamps.level * 4;
  let best = null;
  for (let y = Math.max(1, d.y - r); y <= Math.min(WORLD_H - 1, d.y + r); y++) {
    for (let x = Math.max(0, d.x - r); x <= Math.min(WORLD_W - 1, d.x + r); x++) {
      const cell = getCell(x, y); if (cell === RES.EMPTY) continue;
      const neighbors = [[x+1,y],[x-1,y],[x,y+1],[x,y-1]];
      for (const [nx, ny] of neighbors) {
        if (!isEmpty(nx, ny)) continue;
        const path = bfsPath(d.x, d.y, nx, ny);
        if (!path) continue;
        const score = path.length - creditValueForCell(cell) * 0.2;
        if (!best || score < best.score) best = { x, y, path, score };
      }
    }
  }
  return best;
}

function hireDwarf() {
  const cost = 40 + dwarfs.length * 15;
  if (totals.credits < cost) return false;
  totals.credits -= cost;
  dwarfs.push(createDwarf());
  return true;
}

function tick(dt) {
  const autoHireRate = upgrades.autoHire.level * 0.28;
  if (autoHireRate > 0 && Math.random() < dt * autoHireRate) hireDwarf();

  for (const d of dwarfs) {
    d.bagCap = 18 + upgrades.bag.level * 3;
    const speed = (3.4 + upgrades.picks.level * 0.35) * d.mood;

    if (d.state === "return") {
      if (d.x === BASE_X && d.y === BASE_Y) { depositBag(d); d.state = "dig"; d.path = null; continue; }
      if (!d.path || d.pathAt >= d.path.length) d.path = bfsPath(d.x, d.y, BASE_X, BASE_Y), d.pathAt = 0;
      const p = d.path?.[d.pathAt + 1];
      if (p) { d.x = p.x; d.y = p.y; d.pathAt++; }
      continue;
    }

    if (d.bagCount >= d.bagCap) { d.state = "return"; d.path = null; continue; }

    const target = nearestDigTarget(d);
    if (target?.path?.length > 1) {
      const step = target.path[1]; d.x = step.x; d.y = step.y;
      if (Math.abs(d.x - target.x) + Math.abs(d.y - target.y) === 1) {
        d.digTimer += dt * speed;
        if (d.digTimer >= 0.6) {
          d.digTimer = 0;
          const t = getCell(target.x, target.y);
          if (t !== RES.EMPTY) { addToBag(d, t); setCell(target.x, target.y, RES.EMPTY); }
        }
      }
    }

    d.fx += (d.x - d.fx) * 0.35;
    d.fy += (d.y - d.fy) * 0.35;
  }
}

function drawWorld() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const w = WORLD_W * cellPx, h = WORLD_H * cellPx;
  const ox = ((canvas.width / dpr) - w) * 0.5, oy = 20;
  ctx.save(); ctx.translate(ox, oy);

  // Sky + ground ambience
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#2f4d77"); g.addColorStop(0.09, "#202f45"); g.addColorStop(0.15, "#121824"); g.addColorStop(1, "#07090d");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  for (let y = 1; y < WORLD_H; y++) for (let x = 0; x < WORLD_W; x++) {
    const t = getCell(x, y); if (t === RES.EMPTY) continue;
    const px = x * cellPx, py = y * cellPx;
    if (t === RES.DIRT) ctx.fillStyle = `hsl(30 28% ${24 + (y / WORLD_H) * 8}%)`;
    else ctx.fillStyle = RES_META[t].color;
    ctx.fillRect(px, py, cellPx, cellPx);
  }

  // Base
  ctx.fillStyle = "#ffe7a4"; ctx.fillRect(BASE_X * cellPx - cellPx, 0, cellPx * 3, cellPx * 0.6);

  for (const d of dwarfs) {
    const x = d.fx * cellPx + cellPx * 0.5, y = d.fy * cellPx + cellPx * 0.5;
    ctx.beginPath(); ctx.arc(x, y, Math.max(2, cellPx * 0.38), 0, Math.PI * 2); ctx.fillStyle = "#ff8e66"; ctx.fill();
    ctx.beginPath(); ctx.arc(x, y, Math.max(8, cellPx * (2 + upgrades.lamps.level * 0.3)), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,220,120,0.04)"; ctx.fill();
  }
  ctx.restore();
}

function renderResourceBar() {
  resourcesEl.innerHTML = "";
  const items = [
    { name: "Credits", color: "#8dffb9", value: totals.credits },
    ...RES_ORDER.map((r) => ({ name: RES_META[r].name, color: RES_META[r].color, value: totals[RES_META[r].key] })),
  ];
  for (const item of items) {
    const pill = document.createElement("div"); pill.className = "pill";
    pill.innerHTML = `<span class="dot" style="background:${item.color}"></span><span class="count">${item.value.toLocaleString()}</span><span class="name">${item.name}</span>`;
    resourcesEl.appendChild(pill);
  }
}

function upgradeCost(u) { return Math.floor(u.base * Math.pow(u.growth, u.level)); }
function bindButtons() {
  const actions = document.querySelector(".actions");
  actions.innerHTML = "";
  const mk = (txt, fn, cls="btn") => { const b = document.createElement("button"); b.className = cls; b.textContent = txt; b.onclick = fn; actions.appendChild(b); return b; };
  mk("Hire dwarf", () => hireDwarf(), "btn btn--gold");
  mk(paused ? "Resume" : "Pause", () => paused = !paused);
  mk(gameSpeed === 1 ? "Speed x1" : gameSpeed === 2 ? "Speed x2" : "Speed x4", () => gameSpeed = gameSpeed === 1 ? 2 : gameSpeed === 2 ? 4 : 1);
  mk("Reset world", resetGame);
}

function updateHUD() {
  const avgBag = dwarfs.length ? (dwarfs.reduce((a, d) => a + d.bagCount / d.bagCap, 0) / dwarfs.length) : 0;
  hudEl.innerHTML = `
    <div><b>Dwarfs:</b> ${dwarfs.length} &nbsp; <b>Speed:</b> x${gameSpeed} ${paused ? "(Paused)" : ""}</div>
    <div><b>Efficiency:</b> ${(avgBag * 100).toFixed(0)}% bag utilization</div>
    <hr>
    ${Object.values(upgrades).map((u) => {
      const cost = upgradeCost(u);
      const can = u.level < u.max && totals.credits >= cost;
      return `<div class="upg"><button data-upg="${u.key}" class="btn ${can ? "" : "disabled"}">${u.label} Lv.${u.level}/${u.max} - ${u.level >= u.max ? "MAX" : cost + " cr"}</button><span>${u.desc}</span></div>`;
    }).join("")}
  `;
  hudEl.querySelectorAll("button[data-upg]").forEach((b) => {
    b.onclick = () => {
      const u = upgrades[b.dataset.upg];
      const cost = upgradeCost(u);
      if (u.level < u.max && totals.credits >= cost) { totals.credits -= cost; u.level++; }
    };
  });
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
  const availableW = rect.width - 30;
  cellPx = Math.max(6, Math.floor(availableW / WORLD_W));
}

function frame(now) {
  const dt = Math.min(0.08, (now - lastT) / 1000); lastT = now;
  if (!paused) {
    simAcc += dt * gameSpeed;
    while (simAcc >= 0.1) { tick(0.1); simAcc -= 0.1; }
  }
  drawWorld(); renderResourceBar(); updateHUD(); bindButtons();
  requestAnimationFrame(frame);
}

window.addEventListener("resize", resize);
resetGame(); resize(); requestAnimationFrame(frame);
