/* Prototype B: Outline Warp
 *
 * Glyph contours become a deformable point mesh, like Photoshop's liquify.
 *
 * MAPPING (retune in `params`)
 *   pinch (either hand)     grab the outline points within `radius` of the pinch point.
 *                           Falloff (1 - (d/r)^2)^2: full pull at the centre, zero at the edge.
 *   move while pinched      pull them along. Release and the shape stays (it's clay).
 *   both hands pinch the    stretch / squash: each point of that letter moves by a blend of the
 *   SAME letter             two hands' movements, weighted by where it sits on the line between
 *                           the two grab points. Pull apart = stretch, push together = squash,
 *                           move in opposite directions = shear.
 *   openness (while open)   brush radius: open hand = big soft brush, half-closed = small.
 *                           Locked at grab time, so the pinch itself doesn't change it.
 *
 * Why pinch: it's the one hand pose that reads as "holding a bit of material",
 * and it has a crisp start/end (with hysteresis), which is what grab/release needs.
 * On release, touched contours are resampled so point spacing stays even.
 */
import { run, type App } from "../shared/app";
import { svgDocument } from "../shared/capture";
import { defaultCoords, flatten, layoutWord, polygonsToSvgD, resampleClosed } from "../shared/font";
import type { HandSignals, Pt, Side } from "../shared/types";

const params = {
  radius: 0.09, // brush radius at full openness, fraction of stage height
  opennessSizesBrush: true,
  spacing: 5, // px between resampled outline points
  resampleOnRelease: true,
  weight: 760, // the instance the clay starts from
  width: 100,
  showPoints: false, // O
  ink: "#24211d",
  paper: "#e8e4dc",
  clayTint: "#b8693f", // highlight for grabbed points
};

type Contours = Pt[][]; // one letter
let letters: Contours[] = [];
const undoStack: Contours[][] = [];

interface Grab {
  start: Pt;
  letter: number; // letter of the nearest grabbed point, -1 if nothing grabbed
  pts: { li: number; ci: number; pi: number; w: number; orig: Pt }[];
}
const grabs: Partial<Record<Side, Grab>> = {};
let stretch: null | {
  letter: number;
  a0: Pt; b0: Pt; // grab points at the moment the stretch began
  pts: { ci: number; pi: number; s: number; orig: Pt }[];
} = null;

const clone = (ls: Contours[]) => ls.map((l) => l.map((c) => c.map((p) => ({ ...p }))));
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

function build(app: App) {
  const coords = { ...defaultCoords(app.font), wght: params.weight, wdth: params.width };
  const probe = layoutWord(app.font, app.word, coords, 100, 0, 0, 0.04);
  const w = probe.reduce((a, g) => a + g.advance, 0);
  const size = Math.min(app.H * 0.55, (app.W * 0.78 * 100) / Math.max(1, w));
  const glyphs = layoutWord(app.font, app.word, coords, size, app.W / 2, app.H * 0.5 + size * 0.36, 0.04);
  letters = glyphs.map((g) => flatten(g.commands, 2).map((c) => resampleClosed(c, params.spacing)));
  stretch = null;
  delete grabs.left;
  delete grabs.right;
}

function pushUndo() {
  undoStack.push(clone(letters));
  if (undoStack.length > 50) undoStack.shift();
}

function brushRadius(h: HandSignals, app: App) {
  const k = params.opennessSizesBrush ? 0.35 + 0.65 * h.openness : 1;
  return params.radius * app.H * k;
}
const lockedRadius: Partial<Record<Side, number>> = {};

function beginGrab(side: Side, h: HandSignals, app: App) {
  if (!grabs.left && !grabs.right) pushUndo(); // one undo step per gesture
  const r = lockedRadius[side] ?? brushRadius(h, app);
  const g: Grab = { start: { ...h.pinchPoint }, letter: -1, pts: [] };
  let best = Infinity;
  letters.forEach((l, li) => l.forEach((c, ci) => c.forEach((p, pi) => {
    const d = dist(p, h.pinchPoint);
    if (d < r) {
      const t = d / r;
      g.pts.push({ li, ci, pi, w: (1 - t * t) ** 2, orig: { ...p } });
    }
    if (d < best && d < r) { best = d; g.letter = li; }
  })));
  grabs[side] = g;
}

function beginStretch(app: App) {
  const L = grabs.left!, R = grabs.right!;
  const li = L.letter;
  const a0 = { ...app.signals.left.pinchPoint }, b0 = { ...app.signals.right.pinchPoint };
  const ab = { x: b0.x - a0.x, y: b0.y - a0.y };
  const len2 = Math.max(1, ab.x * ab.x + ab.y * ab.y);
  const pts: NonNullable<typeof stretch>["pts"] = [];
  letters[li].forEach((c, ci) => c.forEach((p, pi) => {
    const s = Math.min(1, Math.max(0, ((p.x - a0.x) * ab.x + (p.y - a0.y) * ab.y) / len2));
    pts.push({ ci, pi, s, orig: { ...p } });
  }));
  stretch = { letter: li, a0, b0, pts };
  L.pts = []; R.pts = []; // the stretch now owns this letter
}

function endGesture() {
  if (grabs.left || grabs.right) return;
  stretch = null;
  if (params.resampleOnRelease) letters = letters.map((l) => l.map((c) => resampleClosed(c, params.spacing)));
}

run({
  title: "Outline Warp",
  help: ["pinch + move  pull the outline", "two-hand pinch on a letter  stretch", "open/close hand  brush size", "Z  undo · R  reset", "O  outline + points view"],

  init(app) {
    build(app);
    const f = app.gui.addFolder("Outline Warp");
    f.add(params, "radius", 0.02, 0.3, 0.005).name("brush radius");
    f.add(params, "opennessSizesBrush").name("openness sizes brush");
    f.add(params, "spacing", 2, 14, 1).name("point spacing (px)").onFinishChange(() => { pushUndo(); build(app); });
    f.add(params, "resampleOnRelease").name("resample on release");
    f.add(params, "weight", 100, 1000, 10).name("start weight").onFinishChange(() => { pushUndo(); build(app); });
    f.add(params, "width", 25, 151, 1).name("start width").onFinishChange(() => { pushUndo(); build(app); });
    f.add(params, "showPoints").name("outline + points (O)").listen();
    f.addColor(params, "ink");
    f.addColor(params, "paper");
  },

  onWord(_w, app) { pushUndo(); build(app); },
  onResize(app) { if (!letters.length) build(app); },

  onKey(e, app) {
    const k = e.key.toLowerCase();
    if (k === "z") {
      const prev = undoStack.pop();
      if (prev) { letters = prev; stretch = null; delete grabs.left; delete grabs.right; app.toast("Undo"); }
      else app.toast("Nothing to undo");
      return true;
    }
    if (k === "r") { pushUndo(); build(app); app.toast("Reset (Z to undo)"); return true; }
    if (k === "o") { params.showPoints = !params.showPoints; return true; }
    return false;
  },

  update(_dt, s, app) {
    for (const side of ["left", "right"] as Side[]) {
      const h = s[side];
      if (!h.pinch && h.present) lockedRadius[side] = brushRadius(h, app); // brush size follows openness until you pinch
      if (app.frozen) continue;
      if (h.pinchStart) beginGrab(side, h, app);
      if (h.pinchEnd && grabs[side]) {
        delete grabs[side];
        if (stretch) stretch = null; // the other hand needs a fresh pinch
        endGesture();
      }
    }
    if (app.frozen) return;

    // two hands on the same letter -> stretch
    if (!stretch && grabs.left && grabs.right && grabs.left.letter >= 0 && grabs.left.letter === grabs.right.letter) beginStretch(app);

    if (stretch) {
      const dA = { x: s.left.pinchPoint.x - stretch.a0.x, y: s.left.pinchPoint.y - stretch.a0.y };
      const dB = { x: s.right.pinchPoint.x - stretch.b0.x, y: s.right.pinchPoint.y - stretch.b0.y };
      const l = letters[stretch.letter];
      for (const p of stretch.pts) {
        l[p.ci][p.pi] = { x: p.orig.x + dA.x + (dB.x - dA.x) * p.s, y: p.orig.y + dA.y + (dB.y - dA.y) * p.s };
      }
      return;
    }
    for (const side of ["left", "right"] as Side[]) {
      const g = grabs[side];
      if (!g) continue;
      const pp = s[side].pinchPoint;
      const d = { x: pp.x - g.start.x, y: pp.y - g.start.y };
      for (const p of g.pts) letters[p.li][p.ci][p.pi] = { x: p.orig.x + d.x * p.w, y: p.orig.y + d.y * p.w };
    }
  },

  draw(ctx, app) {
    ctx.fillStyle = params.paper;
    ctx.fillRect(0, 0, app.W, app.H);
    for (const l of letters) {
      const path = new Path2D();
      for (const c of l) {
        path.moveTo(c[0].x, c[0].y);
        for (let i = 1; i < c.length; i++) path.lineTo(c[i].x, c[i].y);
        path.closePath();
      }
      if (params.showPoints) {
        ctx.fillStyle = "rgba(36,33,29,.08)";
        ctx.fill(path, "nonzero");
        ctx.strokeStyle = params.ink;
        ctx.lineWidth = 1;
        ctx.stroke(path);
        ctx.fillStyle = params.ink;
        for (const c of l) for (const p of c) ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3);
      } else {
        ctx.fillStyle = params.ink;
        ctx.fill(path, "nonzero");
      }
    }
  },

  drawUI(ctx, app) {
    const s = app.signals;
    for (const side of ["left", "right"] as Side[]) {
      const h = s[side];
      if (!h.present) continue;
      const r = lockedRadius[side] ?? brushRadius(h, app);
      ctx.strokeStyle = params.clayTint;
      ctx.lineWidth = h.pinch ? 2.5 : 1.5;
      ctx.setLineDash(h.pinch ? [] : [5, 5]);
      ctx.beginPath();
      ctx.arc(h.pinchPoint.x, h.pinchPoint.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = params.clayTint;
      ctx.beginPath();
      ctx.arc(h.pinchPoint.x, h.pinchPoint.y, h.pinch ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // grabbed points, sized by their weight
    ctx.fillStyle = params.clayTint;
    for (const g of [grabs.left, grabs.right]) {
      if (!g) continue;
      for (const p of g.pts) {
        const q = letters[p.li][p.ci][p.pi];
        ctx.globalAlpha = 0.3 + 0.7 * p.w;
        ctx.fillRect(q.x - 2, q.y - 2, 4, 4);
      }
    }
    ctx.globalAlpha = 1;
    if (stretch && s.left.present && s.right.present) {
      ctx.strokeStyle = params.clayTint;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(s.left.pinchPoint.x, s.left.pinchPoint.y);
      ctx.lineTo(s.right.pinchPoint.x, s.right.pinchPoint.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  },

  toSVG(app) {
    const body = letters.map((l) => `<path d="${polygonsToSvgD(l)}" fill="${params.ink}" fill-rule="nonzero"/>`).join("\n");
    return svgDocument(app.W, app.H, params.paper, body);
  },
});
