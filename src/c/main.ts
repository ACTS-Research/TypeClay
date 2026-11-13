/* Prototype C: Soft Body
 *
 * Each letter is a lump of material on a floor: outline points joined by
 * constraints, solved with position-based dynamics at a fixed 120 Hz.
 *
 * STRUCTURE PER LETTER
 *   edge + bend springs     along every contour (keeps the outline from tearing or kinking)
 *   cross springs           point to its nearest points across the stroke, only where the
 *                           spring's midpoint is inside the glyph (so springs never bridge a
 *                           counter or the gap between two strokes)
 *   area (pressure)         each contour keeps its area: squeeze a letter and it bulges sideways
 *   shape matching          a weak pull toward the best-fit rotated rest shape; stops slow collapse
 *
 * MAPPING (retune in `params`)
 *   fingertips      small round colliders; poke and dent
 *   knuckles+palm   bigger colliders; an open flat hand presses a letter flat
 *   hand velocity   transferred on contact, so a fast swipe knocks letters over
 *   two palms       squeezing a letter between them compresses it (area pushes back)
 *   pinch           grabs the nearest few outline points: pick a letter up, throw it
 *
 * MOUSE FALLBACK differs on purpose: a mouse hand can't lift off the table, so
 * hovering never touches anything. Drag starting ON a letter = pick it up;
 * drag starting on empty space = hand pressed down (pushes, presses, swipes).
 *   plasticity      0 = rubber (springs back). 1 = clay: rest lengths and rest shape
 *                   creep toward the deformed shape once strain passes `yieldStrain`.
 *                   Area is never relaxed, so clay keeps its volume however you shape it.
 */
import { run, type App } from "../shared/app";
import { svgDocument } from "../shared/capture";
import { defaultCoords, flatten, layoutWord, pointInPolys, polygonsToSvgD, resampleClosed } from "../shared/font";
import { FINGERTIPS, type HandSignals, type Pt, type Side } from "../shared/types";

const params = {
  plasticity: 0.5,
  yieldStrain: 0.04,
  stiffness: 0.9, // spring stiffness per iteration (0..1)
  areaStiffness: 0.6,
  shapeStiffness: 0.015, // weak global pull to rest shape
  iterations: 6,
  gravity: 2200, // px/s²
  damping: 0.995,
  friction: 0.6, // floor friction (0 = ice)
  spacing: 11, // px between outline points (bigger = faster, blobbier)
  handScale: 1, // collider size multiplier
  weight: 820,
  showSprings: false,
  paper: "#e8e4dc",
};

const DT = 1 / 120;

interface Body {
  start: number; // index of first point in the shared arrays
  count: number;
  contours: { start: number; count: number; area0: number }[];
  rest: Float32Array; // rest shape, relative to rest centroid (x,y interleaved)
  color: string;
}

// shared point arrays (structure of arrays for speed)
let N = 0;
let px = new Float32Array(0), py = new Float32Array(0), ox = new Float32Array(0), oy = new Float32Array(0);
let owner = new Int32Array(0);
let bodies: Body[] = [];
let sa = new Int32Array(0), sb = new Int32Array(0), srest = new Float32Array(0);
let floorY = 0;

// colliders: circles with velocity, rebuilt from the hands each frame
interface Circle { x: number; y: number; r: number; vx: number; vy: number }
let colliders: Circle[] = [];
let prevColliders: Circle[] = [];
const grabbed: Partial<Record<Side, { idx: number[]; off: Pt[] }>> = {};
let accumulator = 0;

function build(app: App) {
  const coords = { ...defaultCoords(app.font), wght: params.weight };
  floorY = app.H - 28;
  const probe = layoutWord(app.font, app.word, coords, 100, 0, 0, 0.12);
  const w = probe.reduce((a, g) => a + g.advance, 0);
  const size = Math.min(app.H * 0.42, (app.W * 0.8 * 100) / Math.max(1, w));
  const glyphs = layoutWord(app.font, app.word, coords, size, app.W / 2, floorY - 2, 0.12);

  const pts: Pt[] = [];
  const own: number[] = [];
  const springs: [number, number][] = [];
  bodies = [];
  glyphs.forEach((g, gi) => {
    const polys = flatten(g.commands, 2).map((c) => resampleClosed(c, params.spacing));
    if (!polys.length) return;
    // sit the letter on the floor
    const maxY = Math.max(...polys.flat().map((p) => p.y));
    polys.forEach((c) => c.forEach((p) => (p.y += floorY - 1 - maxY)));

    const start = pts.length;
    const body: Body = { start, count: 0, contours: [], rest: new Float32Array(0), color: `hsl(${16 + gi * 9} 48% ${40 + (gi % 2) * 6}%)` };
    for (const c of polys) {
      const cs = pts.length;
      c.forEach((p) => { pts.push(p); own.push(bodies.length); });
      body.contours.push({ start: cs, count: c.length, area0: 0 });
      for (let i = 0; i < c.length; i++) {
        springs.push([cs + i, cs + ((i + 1) % c.length)]); // edge
        springs.push([cs + i, cs + ((i + 2) % c.length)]); // bend
        if (c.length > 12) springs.push([cs + i, cs + ((i + 5) % c.length)]); // longer bend
      }
    }
    body.count = pts.length - start;

    // cross-stroke springs: up to 4 nearest points not close along the same contour
    const maxLen = size * 0.45;
    const contourOf = (k: number) => body.contours.findIndex((c) => k >= c.start && k < c.start + c.count);
    for (let i = start; i < pts.length; i++) {
      const ci = contourOf(i);
      const cand: [number, number][] = [];
      for (let j = start; j < pts.length; j++) {
        if (j <= i) continue;
        const cj = contourOf(j);
        if (ci === cj) {
          const n = body.contours[ci].count;
          const along = Math.min(Math.abs(i - j), n - Math.abs(i - j));
          if (along < 6) continue;
        }
        const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
        if (d > maxLen) continue;
        const inside = [0.25, 0.5, 0.75].every((t) =>
          pointInPolys({ x: pts[i].x + (pts[j].x - pts[i].x) * t, y: pts[i].y + (pts[j].y - pts[i].y) * t }, polys));
        if (inside) cand.push([d, j]);
      }
      cand.sort((a, b) => a[0] - b[0]).slice(0, 4).forEach(([, j]) => springs.push([i, j]));
    }
    bodies.push(body);
  });

  N = pts.length;
  px = new Float32Array(pts.map((p) => p.x));
  py = new Float32Array(pts.map((p) => p.y));
  ox = px.slice();
  oy = py.slice();
  owner = new Int32Array(own);
  sa = new Int32Array(springs.map((s) => s[0]));
  sb = new Int32Array(springs.map((s) => s[1]));
  srest = new Float32Array(springs.map(([a, b]) => Math.hypot(px[a] - px[b], py[a] - py[b])));
  for (const b of bodies) {
    for (const c of b.contours) c.area0 = contourArea(c.start, c.count);
    const [cx, cy] = centroid(b);
    b.rest = new Float32Array(b.count * 2);
    for (let k = 0; k < b.count; k++) { b.rest[2 * k] = px[b.start + k] - cx; b.rest[2 * k + 1] = py[b.start + k] - cy; }
  }
  delete grabbed.left;
  delete grabbed.right;
}

function contourArea(s: number, n: number) {
  let a = 0;
  for (let k = 0; k < n; k++) {
    const i = s + k, j = s + ((k + 1) % n);
    a += px[i] * py[j] - px[j] * py[i];
  }
  return a / 2;
}

function centroid(b: Body): [number, number] {
  let x = 0, y = 0;
  for (let k = b.start; k < b.start + b.count; k++) { x += px[k]; y += py[k]; }
  return [x / b.count, y / b.count];
}

// ---------- hands -> colliders ----------

function handColliders(h: HandSignals, out: Circle[]) {
  const s = h.size * params.handScale;
  const P = h.pts;
  for (const i of FINGERTIPS) out.push({ x: P[i].x, y: P[i].y, r: s * 0.13, vx: 0, vy: 0 });
  for (const i of [6, 10, 14, 18]) out.push({ x: P[i].x, y: P[i].y, r: s * 0.13, vx: 0, vy: 0 });
  for (const i of [5, 9, 13, 17]) out.push({ x: P[i].x, y: P[i].y, r: s * 0.2, vx: 0, vy: 0 });
  // palm: bigger when the hand is open, so a flat hand is a flat press
  out.push({ x: h.palm.x, y: h.palm.y, r: s * (0.35 + 0.25 * h.openness), vx: 0, vy: 0 });
  out.push({ x: P[0].x, y: P[0].y, r: s * 0.25, vx: 0, vy: 0 });
}

function updateColliders(app: App, dt: number) {
  const next: Circle[] = [];
  const mouse = app.signals.source === "mouse";
  for (const side of ["left", "right"] as Side[]) {
    const h = app.signals[side];
    if (!h.present || grabbed[side]) continue; // a carrying hand doesn't push
    // camera: hands are always solid. mouse: only while the button is down (hand "on the table")
    if (mouse ? h.pinch : !h.pinch) handColliders(h, next);
  }
  // velocity from last frame (index-matched; only valid if the hand set didn't change)
  if (colliders.length === next.length) {
    next.forEach((c, i) => { c.vx = (c.x - colliders[i].x) / dt; c.vy = (c.y - colliders[i].y) / dt; });
  }
  prevColliders = colliders.length === next.length ? colliders : next;
  colliders = next;
}

// ---------- simulation ----------

function step(app: App, frac: number) {
  const g = params.gravity * DT * DT;
  const vmax = 4000 * DT; // px per step; stops a tracking glitch from launching letters
  // integrate (Verlet)
  for (let i = 0; i < N; i++) {
    let vx = (px[i] - ox[i]) * params.damping, vy = (py[i] - oy[i]) * params.damping;
    const sp = Math.hypot(vx, vy);
    if (sp > vmax) { vx *= vmax / sp; vy *= vmax / sp; }
    ox[i] = px[i]; oy[i] = py[i];
    px[i] += vx; py[i] += vy + g;
  }
  // grabbed points follow the pinch
  for (const side of ["left", "right"] as Side[]) {
    const gr = grabbed[side];
    if (!gr) continue;
    const pp = app.signals[side].pinchPoint;
    gr.idx.forEach((i, k) => {
      px[i] += (pp.x + gr.off[k].x - px[i]) * 0.7;
      py[i] += (pp.y + gr.off[k].y - py[i]) * 0.7;
    });
  }

  const iters = params.iterations;
  for (let it = 0; it < iters; it++) {
    // springs
    const k = params.stiffness;
    for (let s = 0; s < sa.length; s++) {
      const a = sa[s], b = sb[s];
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const d = Math.hypot(dx, dy) || 1e-6;
      const c = ((d - srest[s]) / d) * 0.5 * k;
      px[a] += dx * c; py[a] += dy * c;
      px[b] -= dx * c; py[b] -= dy * c;
    }
    // area per contour (pressure)
    for (const b of bodies) for (const c of b.contours) solveArea(c.start, c.count, c.area0, params.areaStiffness);
    collide(frac);
  }
  for (const b of bodies) shapeMatch(b);
  if (params.plasticity > 0) plastic();
}

let gx = new Float32Array(256), gy = new Float32Array(256); // scratch, grown as needed
function solveArea(s: number, n: number, area0: number, k: number) {
  const C = contourArea(s, n) - area0;
  let sum = 0;
  if (gx.length < n) { gx = new Float32Array(n * 2); gy = new Float32Array(n * 2); }
  for (let q = 0; q < n; q++) {
    const prev = s + ((q - 1 + n) % n), next = s + ((q + 1) % n);
    gx[q] = (py[next] - py[prev]) / 2;
    gy[q] = (px[prev] - px[next]) / 2;
    sum += gx[q] * gx[q] + gy[q] * gy[q];
  }
  if (sum < 1e-9) return;
  const l = (-C / sum) * k;
  for (let q = 0; q < n; q++) { px[s + q] += gx[q] * l; py[s + q] += gy[q] * l; }
}

function bestRotation(b: Body, cx: number, cy: number) {
  // 2D optimal rotation between rest shape and current shape
  let sxx = 0, sxy = 0;
  for (let k = 0; k < b.count; k++) {
    const qx = b.rest[2 * k], qy = b.rest[2 * k + 1];
    const dx = px[b.start + k] - cx, dy = py[b.start + k] - cy;
    sxx += qx * dx + qy * dy;
    sxy += qx * dy - qy * dx;
  }
  return Math.atan2(sxy, sxx);
}

function shapeMatch(b: Body) {
  const [cx, cy] = centroid(b);
  const th = bestRotation(b, cx, cy);
  const c = Math.cos(th), s = Math.sin(th), k = params.shapeStiffness;
  for (let q = 0; q < b.count; q++) {
    const qx = b.rest[2 * q], qy = b.rest[2 * q + 1], i = b.start + q;
    px[i] += (cx + c * qx - s * qy - px[i]) * k;
    py[i] += (cy + s * qx + c * qy - py[i]) * k;
  }
}

function plastic() {
  // clay: where strain passes the yield point, the rest state creeps toward the current state
  const rate = params.plasticity * params.plasticity * 0.08;
  const yieldS = params.yieldStrain;
  for (let s = 0; s < sa.length; s++) {
    const d = Math.hypot(px[sb[s]] - px[sa[s]], py[sb[s]] - py[sa[s]]);
    const strain = d / srest[s] - 1;
    if (Math.abs(strain) > yieldS) srest[s] += (d - srest[s]) * rate;
  }
  for (const b of bodies) {
    const [cx, cy] = centroid(b);
    const th = bestRotation(b, cx, cy);
    const c = Math.cos(-th), sn = Math.sin(-th);
    let dev = 0;
    for (let q = 0; q < b.count; q++) {
      const dx = px[b.start + q] - cx, dy = py[b.start + q] - cy;
      const rx = c * dx - sn * dy, ry = sn * dx + c * dy;
      dev += Math.hypot(rx - b.rest[2 * q], ry - b.rest[2 * q + 1]);
    }
    if (dev / b.count < params.spacing * yieldS * 4) continue;
    for (let q = 0; q < b.count; q++) {
      const dx = px[b.start + q] - cx, dy = py[b.start + q] - cy;
      b.rest[2 * q] += (c * dx - sn * dy - b.rest[2 * q]) * rate;
      b.rest[2 * q + 1] += (sn * dx + c * dy - b.rest[2 * q + 1]) * rate;
    }
  }
}

// spatial hash for letter-vs-letter contact
const CELL = 16;
const grid = new Map<number, number[]>();
const key = (x: number, y: number) => (((x + 1000) & 0xffff) << 16) | ((y + 1000) & 0xffff);

function collide(frac: number) {
  const W = 1e9;
  // hands: interpolate collider position across the frame's substeps (cheap CCD)
  for (let ci = 0; ci < colliders.length; ci++) {
    const c = colliders[ci];
    const p = prevColliders[ci] ?? c;
    const cx = p.x + (c.x - p.x) * frac, cy = p.y + (c.y - p.y) * frac;
    const r2 = c.r * c.r;
    for (let i = 0; i < N; i++) {
      const dx = px[i] - cx, dy = py[i] - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r2) continue;
      const d = Math.sqrt(d2) || 1e-6;
      const nx = dx / d, ny = dy / d;
      px[i] = cx + nx * c.r;
      py[i] = cy + ny * c.r;
      // give the point at least the collider's normal speed (this is what makes a swipe knock)
      const vx = (px[i] - ox[i]) / DT, vy = (py[i] - oy[i]) / DT;
      const vn = vx * nx + vy * ny, cn = Math.max(-2500, Math.min(2500, c.vx * nx + c.vy * ny));
      if (vn < cn) { ox[i] -= nx * (cn - vn) * DT; oy[i] -= ny * (cn - vn) * DT; }
    }
  }
  // letters bump each other: push apart points of different letters that get too close
  grid.clear();
  for (let i = 0; i < N; i++) {
    const k = key(Math.floor(px[i] / CELL), Math.floor(py[i] / CELL));
    let cell = grid.get(k);
    if (!cell) grid.set(k, (cell = []));
    cell.push(i);
  }
  const minD = params.spacing * 1.1, minD2 = minD * minD;
  for (let i = 0; i < N; i++) {
    const gx = Math.floor(px[i] / CELL), gy = Math.floor(py[i] / CELL);
    for (let ax = -1; ax <= 1; ax++) for (let ay = -1; ay <= 1; ay++) {
      const cell = grid.get(key(gx + ax, gy + ay));
      if (!cell) continue;
      for (const j of cell) {
        if (j <= i || owner[j] === owner[i]) continue;
        const dx = px[j] - px[i], dy = py[j] - py[i];
        const d2 = dx * dx + dy * dy;
        if (d2 >= minD2 || d2 < 1e-9) continue;
        const d = Math.sqrt(d2), c = ((minD - d) / d) * 0.5;
        px[i] -= dx * c; py[i] -= dy * c;
        px[j] += dx * c; py[j] += dy * c;
      }
    }
  }
  // floor and walls
  for (let i = 0; i < N; i++) {
    if (py[i] > floorY) {
      py[i] = floorY;
      ox[i] += (px[i] - ox[i]) * params.friction; // friction: kill some sliding
    }
    if (px[i] < 4) px[i] = 4;
    if (px[i] > stageW - 4) px[i] = stageW - 4;
    if (py[i] < -W) py[i] = -W;
  }
}
let stageW = 0;

function bodyPolys(b: Body): Pt[][] {
  return b.contours.map((c) => Array.from({ length: c.count }, (_, k) => ({ x: px[c.start + k], y: py[c.start + k] })));
}

function nearestPoints(p: Pt, r: number, max: number) {
  const out: [number, number][] = [];
  for (let i = 0; i < N; i++) {
    const d = Math.hypot(px[i] - p.x, py[i] - p.y);
    if (d < r) out.push([d, i]);
  }
  return out.sort((a, b) => a[0] - b[0]).slice(0, max).map(([, i]) => i);
}

// ---------- drawing ----------

function bodyPath(b: Body) {
  const path = new Path2D();
  for (const c of b.contours) {
    // smooth through midpoints so the outline reads as soft material, not a polygon
    const n = c.count, s = c.start;
    const mid = (k: number) => {
      const i = s + (k % n), j = s + ((k + 1) % n);
      return [(px[i] + px[j]) / 2, (py[i] + py[j]) / 2];
    };
    const [mx, my] = mid(n - 1);
    path.moveTo(mx, my);
    for (let k = 0; k < n; k++) {
      const [ex, ey] = mid(k);
      path.quadraticCurveTo(px[s + k], py[s + k], ex, ey);
    }
    path.closePath();
  }
  return path;
}

run({
  title: "Soft Body",
  help: ["poke, press, swipe, squeeze", "pinch  pick up a letter", "mouse: hover = no contact", "  drag on empty space = push", "  drag on a letter = pick up", "R  reset letters · V  springs"],

  init(app) {
    stageW = app.W;
    build(app);
    if (location.search.includes("inject")) {
      // test hook: per-letter height/width, and a way to set params
      (window as unknown as Record<string, unknown>).__soft = {
        params,
        boxes: () => bodies.map((b) => {
          let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
          for (let i = b.start; i < b.start + b.count; i++) {
            x0 = Math.min(x0, px[i]); x1 = Math.max(x1, px[i]); y0 = Math.min(y0, py[i]); y1 = Math.max(y1, py[i]);
          }
          return { w: Math.round(x1 - x0), h: Math.round(y1 - y0), x: Math.round((x0 + x1) / 2), y: Math.round(y1) };
        }),
      };
    }
    const f = app.gui.addFolder("Soft Body");
    f.add(params, "plasticity", 0, 1, 0.01).name("plasticity (0 rubber, 1 clay)");
    f.add(params, "yieldStrain", 0, 0.2, 0.005).name("yield strain");
    f.add(params, "stiffness", 0.05, 1, 0.01);
    f.add(params, "areaStiffness", 0, 1, 0.01).name("area (pressure)");
    f.add(params, "shapeStiffness", 0, 0.1, 0.001).name("shape matching");
    f.add(params, "iterations", 1, 16, 1);
    f.add(params, "gravity", 0, 5000, 50);
    f.add(params, "friction", 0, 1, 0.01);
    f.add(params, "handScale", 0.5, 2.5, 0.05).name("hand collider size");
    f.add(params, "spacing", 6, 24, 1).name("point spacing (rebuild)").onFinishChange(() => build(app));
    f.add(params, "weight", 100, 1000, 10).name("letter weight (rebuild)").onFinishChange(() => build(app));
    f.add(params, "showSprings").name("show springs (V)").listen();
  },

  onWord(_w, app) { build(app); },
  onResize(app) {
    stageW = app.W;
    floorY = app.H - 28;
    if (!N) build(app);
  },
  onKey(e, app) {
    const k = e.key.toLowerCase();
    if (k === "r") { build(app); app.toast("Reset"); return true; }
    if (k === "v") { params.showSprings = !params.showSprings; return true; }
    return false;
  },

  update(dt, s, app) {
    if (app.frozen) { accumulator = 0; return; } // freeze = hold the current form
    // pinch grabs / releases
    for (const side of ["left", "right"] as Side[]) {
      const h = s[side];
      if (h.pinchStart) {
        // mouse: only grab when the drag starts on a letter; otherwise the drag is a push
        const onLetter = s.source !== "mouse" || bodies.some((b) => pointInPolys(h.pinchPoint, bodyPolys(b)));
        const idx = onLetter ? nearestPoints(h.pinchPoint, h.size * 0.8, 16) : [];
        if (idx.length) grabbed[side] = { idx, off: idx.map((i) => ({ x: px[i] - h.pinchPoint.x, y: py[i] - h.pinchPoint.y })) };
      }
      if (h.pinchEnd) delete grabbed[side];
    }
    updateColliders(app, Math.max(dt, 1e-3));
    accumulator += dt;
    let steps = 0;
    const total = Math.min(4, Math.floor(accumulator / DT));
    while (accumulator >= DT && steps < 4) {
      step(app, total > 0 ? (steps + 1) / total : 1);
      accumulator -= DT;
      steps++;
    }
    if (steps === 4) accumulator = 0; // don't spiral if a frame was very slow
  },

  draw(ctx, app) {
    ctx.fillStyle = params.paper;
    ctx.fillRect(0, 0, app.W, app.H);
    ctx.fillStyle = "rgba(0,0,0,.08)";
    ctx.fillRect(0, floorY, app.W, app.H - floorY);
    for (const b of bodies) {
      ctx.fillStyle = b.color;
      ctx.fill(bodyPath(b), "nonzero");
    }
  },

  drawUI(ctx, app) {
    if (params.showSprings) {
      ctx.strokeStyle = "rgba(20,20,20,.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let s = 0; s < sa.length; s++) { ctx.moveTo(px[sa[s]], py[sa[s]]); ctx.lineTo(px[sb[s]], py[sb[s]]); }
      ctx.stroke();
    }
    // colliders, faintly, so you can see what's touching
    ctx.strokeStyle = "rgba(30,30,30,.35)";
    for (const c of colliders) { ctx.beginPath(); ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2); ctx.stroke(); }
    for (const side of ["left", "right"] as Side[]) {
      const h = app.signals[side];
      if (!h.present) continue;
      ctx.fillStyle = grabbed[side] ? "#b8693f" : "rgba(30,30,30,.5)";
      ctx.beginPath();
      ctx.arc(h.pinchPoint.x, h.pinchPoint.y, h.pinch ? 6 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },

  toSVG(app) {
    const body = bodies.map((b) => {
      return `<path d="${polygonsToSvgD(bodyPolys(b))}" fill="${b.color}" fill-rule="nonzero"/>`;
    }).join("\n");
    return svgDocument(app.W, app.H, params.paper, body);
  },
});
