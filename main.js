/* Digger - watchable dwarf digging sim (no build step) */

const RES = {
  EMPTY: 0,
  DIRT: 1,
  STONE: 2,
  COAL: 3,
  IRON: 4,
  GOLD: 5,
  DIAMOND: 6,
};

const RES_ORDER = [RES.STONE, RES.COAL, RES.IRON, RES.GOLD, RES.DIAMOND];
const RES_META = {
  [RES.STONE]: { key: "stone", name: "Stone", color: "#8d99a6", value: 1 },
  [RES.COAL]: { key: "coal", name: "Coal", color: "#2a2b2e", value: 2 },
  [RES.IRON]: { key: "iron", name: "Iron", color: "#c26a5a", value: 3 },
  [RES.GOLD]: { key: "gold", name: "Gold", color: "#f9c22b", value: 6 },
  [RES.DIAMOND]: { key: "diamond", name: "Diamond", color: "#5fe6ff", value: 12 },
};

const WORLD_W = 96;
const WORLD_H = 64; // y=0 is surface row (always empty)
const BASE_X = Math.floor(WORLD_W / 2);
const BASE_Y = 0;

const BAG_CAPACITY = 18;
const HIRE_COST_GOLD = 100;
const AUTO_HIRE_COOLDOWN_S = 0.8; // rate-limit auto hiring for nicer pacing

const SIM_STEP = 0.12; // seconds per logic step
const MOVE_LERP = 0.38; // render smoothing

/** @type {HTMLCanvasElement} */
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const resourcesEl = document.getElementById("resources");
const hireBtn = document.getElementById("hireBtn");
const resetBtn = document.getElementById("resetBtn");
const hudEl = document.getElementById("hud");

let dpr = 1;
let cellPx = 10;

/** Grid stored as a flat array. */
let grid = new Uint8Array(WORLD_W * WORLD_H);
let totals = makeTotals();
let dwarfs = [];
let nextDwarfId = 1;
let autoHireCooldown = 0;

let simAcc = 0;
let lastT = performance.now();

function makeTotals() {
  return {
    stone: 0,
    coal: 0,
    iron: 0,
    gold: 0,
    diamond: 0,
  };
}

function idx(x, y) {
  return y * WORLD_W + x;
}

function inBounds(x, y) {
  return x >= 0 && x < WORLD_W && y >= 0 && y < WORLD_H;
}

function isEmpty(x, y) {
  if (!inBounds(x, y)) return false;
  if (y === 0) return true; // surface always passable
  return grid[idx(x, y)] === RES.EMPTY;
}

function isSolid(x, y) {
  if (!inBounds(x, y)) return false;
  if (y === 0) return false;
  return grid[idx(x, y)] !== RES.EMPTY;
}

function getCell(x, y) {
  if (!inBounds(x, y)) return RES.EMPTY;
  if (y === 0) return RES.EMPTY;
  return grid[idx(x, y)];
}

function setCell(x, y, t) {
  if (!inBounds(x, y)) return;
  if (y === 0) return;
  grid[idx(x, y)] = t;
}

function rand() {
  return Math.random();
}

function pickCellType(y) {
  // Depth factor 0..1
  const d = Math.min(1, Math.max(0, (y - 1) / (WORLD_H - 2)));
  // Base weights
  let wStone = 0.58 - 0.10 * d;
  let wCoal = 0.13 + 0.02 * d;
  let wIron = 0.08 + 0.05 * d;
  let wGold = 0.035 + 0.03 * d;
  let wDiamond = 0.007 + 0.02 * d;
  let wDirt = 1 - (wStone + wCoal + wIron + wGold + wDiamond);
  wDirt = Math.max(0.10, wDirt);

  // Slightly more dirt near surface
  if (y <= 3) {
    wDirt += 0.12;
    wStone -= 0.08;
  }

  // Normalize
  const sum = wDirt + wStone + wCoal + wIron + wGold + wDiamond;
  wDirt /= sum;
  wStone /= sum;
  wCoal /= sum;
  wIron /= sum;
  wGold /= sum;
  wDiamond /= sum;

  const r = rand();
  if (r < wDirt) return RES.DIRT;
  if (r < wDirt + wStone) return RES.STONE;
  if (r < wDirt + wStone + wCoal) return RES.COAL;
  if (r < wDirt + wStone + wCoal + wIron) return RES.IRON;
  if (r < wDirt + wStone + wCoal + wIron + wGold) return RES.GOLD;
  return RES.DIAMOND;
}

function generateWorld() {
  grid = new Uint8Array(WORLD_W * WORLD_H);
  for (let y = 1; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      setCell(x, y, pickCellType(y));
    }
  }
  // Carve a small starter shaft under the base so dwarfs can begin immediately.
  for (let y = 1; y <= 3; y++) {
    setCell(BASE_X, y, RES.EMPTY);
  }
  for (let x = BASE_X - 1; x <= BASE_X + 1; x++) {
    setCell(x, 1, RES.EMPTY);
  }
}

function createDwarf() {
  const dwarf = {
    id: nextDwarfId++,
    x: BASE_X,
    y: BASE_Y,
    fx: BASE_X,
    fy: BASE_Y,
    state: "dig", // dig | return
    bagCap: BAG_CAPACITY,
    bagCount: 0,
    bag: makeTotals(),
    path: null, // array of {x,y}
    pathAt: 0,
    stuck: 0,
  };
  return dwarf;
}

function resetGame() {
  totals = makeTotals();
  dwarfs = [];
  nextDwarfId = 1;
  autoHireCooldown = 0;
  generateWorld();
  // Start with 3 dwarfs
  dwarfs.push(createDwarf(), createDwarf(), createDwarf());
  renderResourceBar();
  updateHUD();
}

function addToBag(dwarf, cellType) {
  // We only track 5 resources in the UI; treat dirt as "stone" for hauling.
  if (cellType === RES.DIRT) cellType = RES.STONE;
  const meta = RES_META[cellType];
  if (!meta) return;
  dwarf.bag[meta.key] += 1;
  dwarf.bagCount += 1;
}

function depositBag(dwarf) {
  for (const k of Object.keys(totals)) {
    totals[k] += dwarf.bag[k];
    dwarf.bag[k] = 0;
  }
  dwarf.bagCount = 0;
}

function bfsPath(sx, sy, tx, ty) {
  if (sx === tx && sy === ty) return [{ x: sx, y: sy }];

  const qx = new Int16Array(WORLD_W * WORLD_H);
  const qy = new Int16Array(WORLD_W * WORLD_H);
  let qh = 0;
  let qt = 0;

  const visited = new Uint8Array(WORLD_W * WORLD_H);
  const prev = new Int32Array(WORLD_W * WORLD_H);
  prev.fill(-1);

  const sI = idx(sx, sy);
  visited[sI] = 1;
  qx[qt] = sx;
  qy[qt] = sy;
  qt++;

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  while (qh < qt) {
    const x = qx[qh];
    const y = qy[qh];
    qh++;

    for (const [dx, dy] of dirs) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const nI = idx(nx, ny);
      if (visited[nI]) continue;

      // Passable cells: empty (or surface row).
      // Also allow stepping onto the target even if it's surface (already passable).
      if (!isEmpty(nx, ny)) continue;

      visited[nI] = 1;
      prev[nI] = idx(x, y);

      if (nx === tx && ny === ty) {
        // reconstruct
        const path = [{ x: nx, y: ny }];
        let cur = prev[nI];
        while (cur !== -1 && cur !== sI) {
          const cx = cur % WORLD_W;
          const cy = (cur / WORLD_W) | 0;
          path.push({ x: cx, y: cy });
          cur = prev[cur];
        }
        path.push({ x: sx, y: sy });
        path.reverse();
        return path;
      }

      qx[qt] = nx;
      qy[qt] = ny;
      qt++;
    }
  }

  return null;
}

function pickDigNeighbor(dwarf) {
  const options = [];
  const dirs = [
    [0, 1], // down
    [1, 0],
    [-1, 0],
    [0, -1], // up
  ];

  for (const [dx, dy] of dirs) {
    const nx = dwarf.x + dx;
    const ny = dwarf.y + dy;
    if (!inBounds(nx, ny)) continue;
    if (!isSolid(nx, ny)) continue;
    const t = getCell(nx, ny);

    let score = 0;
    if (dy === 1) score += 6;
    if (dy === -1) score -= 2;

    const meta = RES_META[t];
    if (meta) score += meta.value * 1.8;

    // Prefer staying near a vertical shaft early for nicer visuals
    score += Math.max(0, 10 - Math.abs(nx - BASE_X)) * 0.06;
    score += (rand() - 0.5) * 1.2;

    options.push({ nx, ny, t, score });
  }

  if (options.length === 0) return null;
  options.sort((a, b) => b.score - a.score);
  return options[0];
}

function pickMoveNeighborToExplore(dwarf) {
  const candidates = [];
  const dirs = [
    [0, 1],
    [1, 0],
    [-1, 0],
    [0, -1],
  ];
  for (const [dx, dy] of dirs) {
    const nx = dwarf.x + dx;
    const ny = dwarf.y + dy;
    if (!isEmpty(nx, ny)) continue;
    // Score by "how many solids adjacent", encouraging movement near frontiers.
    let adjSolids = 0;
    for (const [adx, ady] of dirs) {
      if (isSolid(nx + adx, ny + ady)) adjSolids++;
    }
    let score = adjSolids * 2.0;
    // Bias deeper a bit
    score += dy === 1 ? 0.8 : 0;
    // Keep near base-ish
    score += Math.max(0, 12 - Math.abs(nx - BASE_X)) * 0.05;
    score += (rand() - 0.5) * 0.8;
    candidates.push({ nx, ny, score });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0];
}

function stepDwarf(dwarf) {
  // Smooth render position toward logical position
  dwarf.fx += (dwarf.x - dwarf.fx) * MOVE_LERP;
  dwarf.fy += (dwarf.y - dwarf.fy) * MOVE_LERP;

  if (dwarf.state === "dig") {
    if (dwarf.bagCount >= dwarf.bagCap) {
      dwarf.state = "return";
      dwarf.path = bfsPath(dwarf.x, dwarf.y, BASE_X, BASE_Y);
      dwarf.pathAt = 0;
      dwarf.stuck = 0;
      return;
    }

    const dig = pickDigNeighbor(dwarf);
    if (dig) {
      setCell(dig.nx, dig.ny, RES.EMPTY);
      addToBag(dwarf, dig.t);
      dwarf.x = dig.nx;
      dwarf.y = dig.ny;
      return;
    }

    const move = pickMoveNeighborToExplore(dwarf);
    if (move) {
      dwarf.x = move.nx;
      dwarf.y = move.ny;
      dwarf.stuck = 0;
      return;
    }

    // No moves found (rare). Try to dig upward to create space.
    if (isSolid(dwarf.x, dwarf.y - 1)) {
      const t = getCell(dwarf.x, dwarf.y - 1);
      setCell(dwarf.x, dwarf.y - 1, RES.EMPTY);
      addToBag(dwarf, t);
      dwarf.y -= 1;
      return;
    }

    dwarf.stuck++;
    return;
  }

  // Returning
  if (dwarf.x === BASE_X && dwarf.y === BASE_Y) {
    depositBag(dwarf);
    dwarf.state = "dig";
    dwarf.path = null;
    dwarf.pathAt = 0;
    dwarf.stuck = 0;
    return;
  }

  if (!dwarf.path || dwarf.path.length < 2) {
    dwarf.path = bfsPath(dwarf.x, dwarf.y, BASE_X, BASE_Y);
    dwarf.pathAt = 0;
  }

  if (dwarf.path) {
    // Path includes current position at [0]
    if (dwarf.pathAt < dwarf.path.length - 1) {
      const next = dwarf.path[dwarf.pathAt + 1];
      if (isEmpty(next.x, next.y)) {
        dwarf.x = next.x;
        dwarf.y = next.y;
        dwarf.pathAt++;
        dwarf.stuck = 0;
        return;
      }
    }
  }

  // If no path, forcibly "escape" upward by digging a route.
  dwarf.stuck++;
  if (dwarf.y > 0 && isSolid(dwarf.x, dwarf.y - 1)) {
    const t = getCell(dwarf.x, dwarf.y - 1);
    setCell(dwarf.x, dwarf.y - 1, RES.EMPTY);
    addToBag(dwarf, t);
    dwarf.y -= 1;
    return;
  }
  if (dwarf.y > 0 && isEmpty(dwarf.x, dwarf.y - 1)) {
    dwarf.y -= 1;
    return;
  }
  // Side-step if needed
  const side = rand() < 0.5 ? -1 : 1;
  if (isEmpty(dwarf.x + side, dwarf.y)) dwarf.x += side;
}

function renderResourceBar() {
  resourcesEl.innerHTML = "";
  for (const t of RES_ORDER) {
    const meta = RES_META[t];
    const pill = document.createElement("div");
    pill.className = "pill";
    pill.dataset.key = meta.key;

    const dot = document.createElement("div");
    dot.className = "dot";
    dot.style.background = meta.color;

    const count = document.createElement("div");
    count.className = "count";
    count.textContent = String(totals[meta.key]);

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = meta.name;

    pill.appendChild(dot);
    pill.appendChild(count);
    pill.appendChild(name);
    resourcesEl.appendChild(pill);
  }
}

function updateResourceBarCounts() {
  for (const t of RES_ORDER) {
    const meta = RES_META[t];
    const pill = resourcesEl.querySelector(`.pill[data-key="${meta.key}"]`);
    if (!pill) continue;
    const countEl = pill.querySelector(".count");
    if (countEl) countEl.textContent = String(totals[meta.key]);
  }
}

function updateHUD() {
  const totalMiners = dwarfs.length;
  const carrying = dwarfs.reduce((a, d) => a + d.bagCount, 0);
  const deepest = dwarfs.reduce((m, d) => Math.max(m, d.y), 0);
  hudEl.innerHTML = `
    <div><b>Dwarfs</b>: ${totalMiners}</div>
    <div><b>Carrying</b>: ${carrying} blocks</div>
    <div><b>Deepest</b>: y=${deepest}</div>
    <div style="margin-top:6px">Hire more once you have <b style="color:var(--gold)">100 gold</b>.</div>
  `;
}

function updateHireButton() {
  // Hiring is automatic; keep this button as a read-only status indicator.
  const canHire = totals.gold >= HIRE_COST_GOLD && autoHireCooldown <= 0;
  hireBtn.disabled = true;
  hireBtn.textContent = canHire
    ? `Auto-hiring ready (${HIRE_COST_GOLD} gold)`
    : `Auto-hiring dwarfs (${HIRE_COST_GOLD} gold)`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);

  const pxW = canvas.width;
  const pxH = canvas.height;
  cellPx = Math.floor(Math.min(pxW / WORLD_W, pxH / WORLD_H));
  cellPx = Math.max(4, cellPx);
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const wPx = WORLD_W * cellPx;
  const hPx = WORLD_H * cellPx;
  const ox = Math.floor((canvas.width - wPx) / 2);
  const oy = Math.floor((canvas.height - hPx) / 2);
  ctx.translate(ox, oy);

  // Surface band
  ctx.fillStyle = "#091018";
  ctx.fillRect(0, 0, wPx, cellPx);
  ctx.fillStyle = "rgba(255,255,255,0.04)";
  ctx.fillRect(0, cellPx - 2, wPx, 2);

  // Draw cells
  for (let y = 1; y < WORLD_H; y++) {
    for (let x = 0; x < WORLD_W; x++) {
      const t = getCell(x, y);
      if (t === RES.EMPTY) continue;

      let c = "#40312a"; // dirt
      if (t === RES.STONE) c = "#4e5966";
      if (t === RES.COAL) c = "#22272e";
      if (t === RES.IRON) c = "#7f4b44";
      if (t === RES.GOLD) c = "#8a6b1d";
      if (t === RES.DIAMOND) c = "#0b586a";

      ctx.fillStyle = c;
      ctx.fillRect(x * cellPx, y * cellPx, cellPx, cellPx);
    }
  }

  // Subtle gridlines for readability
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#0f1a26";
  ctx.lineWidth = 1;
  for (let x = 0; x <= WORLD_W; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x * cellPx + 0.5, 0);
    ctx.lineTo(x * cellPx + 0.5, hPx);
    ctx.stroke();
  }
  for (let y = 0; y <= WORLD_H; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellPx + 0.5);
    ctx.lineTo(wPx, y * cellPx + 0.5);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Base marker
  ctx.fillStyle = "rgba(249,194,43,0.14)";
  ctx.fillRect(BASE_X * cellPx, 0, cellPx, cellPx);
  ctx.strokeStyle = "rgba(249,194,43,0.55)";
  ctx.lineWidth = 2;
  ctx.strokeRect(BASE_X * cellPx + 1, 1, cellPx - 2, cellPx - 2);

  // Draw dwarfs
  for (const d of dwarfs) {
    const cx = (d.fx + 0.5) * cellPx;
    const cy = (d.fy + 0.5) * cellPx;

    // Body
    ctx.fillStyle = "#7aa8ff";
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(3, cellPx * 0.33), 0, Math.PI * 2);
    ctx.fill();

    // Helmet
    ctx.fillStyle = "#cbd6e8";
    ctx.beginPath();
    ctx.arc(cx, cy - cellPx * 0.12, Math.max(2, cellPx * 0.19), Math.PI, 0);
    ctx.fill();

    // Bag fill bar
    const barW = cellPx * 0.9;
    const barH = Math.max(3, cellPx * 0.13);
    const bx = cx - barW / 2;
    const by = cy - cellPx * 0.8;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bx, by, barW, barH);
    ctx.fillStyle = "rgba(249,194,43,0.85)";
    ctx.fillRect(bx, by, barW * (d.bagCount / d.bagCap), barH);
    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    ctx.strokeRect(bx + 0.5, by + 0.5, barW - 1, barH - 1);
  }
}

function stepSim(dt) {
  simAcc += dt;
  let didDeposit = false;
  autoHireCooldown = Math.max(0, autoHireCooldown - dt);

  while (simAcc >= SIM_STEP) {
    simAcc -= SIM_STEP;
    for (const d of dwarfs) {
      const beforeGold = totals.gold;
      const beforeBag = d.bagCount;
      stepDwarf(d);
      if (d.state === "dig" && beforeBag > 0 && d.bagCount === 0 && totals.gold !== beforeGold) {
        didDeposit = true;
      }
    }

    // Deposits affect totals; update UI on step.
    // Auto-hire at most one dwarf per cooldown window.
    if (autoHireCooldown <= 0 && totals.gold >= HIRE_COST_GOLD) {
      totals.gold -= HIRE_COST_GOLD;
      dwarfs.push(createDwarf());
      autoHireCooldown = AUTO_HIRE_COOLDOWN_S;
    }

    updateResourceBarCounts();
    updateHireButton();
    updateHUD();
    if (didDeposit) didDeposit = false;
  }
}

function frame(t) {
  const dt = Math.min(0.05, Math.max(0, (t - lastT) / 1000));
  lastT = t;
  stepSim(dt);
  draw();
  requestAnimationFrame(frame);
}

// Hiring is automatic; this is intentionally non-interactive.

resetBtn.addEventListener("click", () => {
  resetGame();
});

window.addEventListener("resize", () => {
  resizeCanvas();
});

// Boot
resetGame();
resizeCanvas();
requestAnimationFrame(frame);


