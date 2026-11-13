/* Prototype A: Axis Sculptor
 *
 * Hands push Roboto Flex around its own design space. No outline hacking:
 * every frame is a real instance of the font.
 *
 * MAPPING (retune in AXIS_MAP below)
 *   both hands   distance apart   -> wdth  (pull hands apart = stretch the word wide)
 *   right hand   openness         -> wght  (squeeze a fist = dense and heavy; open = thin)
 *   right hand   roll (tilt)      -> slnt  (tilt clockwise = lean forward; the font only slants one way)
 *   right hand   height           -> opsz  (raise = display optical size: tighter, higher contrast)
 *   right hand   pinch gap        -> XTRA  (close the pinch = squeeze the counters)
 *   left hand    openness         -> XOPQ  (fist = fat vertical stems)
 *   left hand    pinch gap        -> YOPQ  (close the pinch = hairline horizontals)
 *   left hand    height           -> YTUC + YTLC (raise = taller caps and x-height)
 *   left hand    roll             -> GRAD  (tilt = darker/lighter without changing width)
 *
 * Why: the right hand gets the "big" axes people already understand (weight,
 * slant, size), the left hand gets the parametric ones for the extreme feel,
 * and the one gesture that needs two hands (stretching) maps to width.
 * Values hold when hands leave the frame, like clay that stays put.
 *
 * PARAMETRIC RANGE: XTRA/XOPQ/YOPQ/YTUC/YTLC/GRAD are Roboto Flex's
 * "parametric" axes. Pushed to opposite extremes together (e.g. hairline
 * verticals + fat horizontals) the joins genuinely break; that's the font, not
 * a rendering bug (checked against fontTools). `paramRange` scales how far
 * they travel from their defaults: 1 = full extremes, 0 = locked.
 *
 * PER-LETTER MODE (P): each hand only affects letters near its palm, with a
 * gaussian falloff. Letters drift toward the hand's target at `rate` per second
 * scaled by influence, so you can sculpt a word unevenly.
 */
import type { Variation } from "opentype.js";
import { run, type App } from "../shared/app";
import { svgDocument } from "../shared/capture";
import { axesOf, defaultCoords, layoutWord, toPath2D, toSvgD, type AxisInfo, type PlacedGlyph } from "../shared/font";
import type { HandSignals, Signals } from "../shared/types";

type Source = (s: Signals) => number | null; // 0..1, or null when the driving hand is absent
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const remap = (v: number, a: number, b: number) => clamp01((v - a) / (b - a));
const DEG = 180 / Math.PI;

const R = (f: (h: HandSignals) => number): Source => (s) => (s.right.present ? f(s.right) : null);
const L = (f: (h: HandSignals) => number): Source => (s) => (s.left.present ? f(s.left) : null);

// axis tag -> [source 0..1, value at 0, value at 1, which hand's position sets per-letter influence]
const PARAMETRIC = new Set(["XTRA", "XOPQ", "YOPQ", "YTUC", "YTLC", "GRAD"]);
const AXIS_MAP: Record<string, { src: Source; at0: number; at1: number; hand: "left" | "right" | "both"; label: string }> = {
  wdth: { src: (s) => (s.both ? remap(s.handsDistN, 0.15, 0.75) : null), at0: 25, at1: 151, hand: "both", label: "hands apart" },
  wght: { src: R((h) => h.openness), at0: 1000, at1: 100, hand: "right", label: "R openness" },
  slnt: { src: R((h) => remap(h.roll * DEG, 0, 35)), at0: 0, at1: -10, hand: "right", label: "R roll" },
  opsz: { src: R((h) => 1 - remap(h.palmN.y, 0.15, 0.85)), at0: 8, at1: 144, hand: "right", label: "R height" },
  XTRA: { src: R((h) => remap(h.pinchDist, 0.1, 1.0)), at0: 323, at1: 603, hand: "right", label: "R pinch gap" },
  XOPQ: { src: L((h) => h.openness), at0: 175, at1: 27, hand: "left", label: "L openness" },
  YOPQ: { src: L((h) => remap(h.pinchDist, 0.1, 1.0)), at0: 25, at1: 135, hand: "left", label: "L pinch gap" },
  YTUC: { src: L((h) => 1 - remap(h.palmN.y, 0.15, 0.85)), at0: 528, at1: 760, hand: "left", label: "L height" },
  YTLC: { src: L((h) => 1 - remap(h.palmN.y, 0.15, 0.85)), at0: 416, at1: 570, hand: "left", label: "L height" },
  GRAD: { src: L((h) => remap(h.roll * DEG, -35, 35)), at0: -200, at1: 150, hand: "left", label: "L roll" },
};

const params = {
  perLetter: false,
  radius: 0.14, // per-letter falloff, fraction of stage width
  rate: 6, // per-letter: how fast letters move toward the hand's target (1/s)
  paramRange: 0.7, // 0..1, see PARAMETRIC RANGE above
  tracking: 0.02,
  ink: "#1b1a18",
  paper: "#e8e4dc",
};

let axes: Record<string, AxisInfo> = {};
let coords: Variation[] = [];
let glyphs: PlacedGlyph[] = [];
let size = 200;
let readout: HTMLPreElement;
let influence: number[] = []; // last frame's per-letter influence, for the little dots
let focusLetter = -1;

function resetCoords(app: App) {
  coords = [...app.word].map(() => defaultCoords(app.font));
}

/** Size the word so its widest possible instance still fits the stage. */
function fit(app: App) {
  const wide = { ...defaultCoords(app.font), wdth: 151, wght: 1000, XTRA: 603, XOPQ: 175 };
  const w = Math.max(...[8, 144].map((opsz) =>
    layoutWord(app.font, app.word, { ...wide, opsz }, 100, 0, 0, params.tracking).reduce((a, g) => a + g.advance, 0)));
  size = Math.min(app.H * 0.42, (app.W * 0.92 * 100) / Math.max(1, w));
}

function letterCentres(app: App) {
  return glyphs.length === coords.length
    ? glyphs.map((g) => g.x + g.advance / 2)
    : coords.map((_, i) => ((i + 0.5) / coords.length) * app.W);
}

run({
  title: "Axis Sculptor",
  help: ["P  per-letter mode", "R  reset axes"],

  init(app) {
    axes = axesOf(app.font);
    resetCoords(app);
    fit(app);
    readout = document.createElement("pre");
    readout.className = "readout";
    readout.style.cssText =
      "position:absolute;left:12px;top:12px;margin:0;padding:10px 12px;font:11px/1.55 ui-monospace,Menlo,monospace;" +
      "background:rgba(20,19,17,.82);color:#efe9df;border-radius:8px;pointer-events:none;white-space:pre";
    app.canvas.parentElement!.append(readout);

    const f = app.gui.addFolder("Axis Sculptor");
    f.add(params, "perLetter").name("per-letter mode (P)").listen();
    f.add(params, "radius", 0.04, 0.4, 0.01).name("per-letter radius");
    f.add(params, "rate", 0.5, 20, 0.5).name("per-letter rate");
    f.add(params, "paramRange", 0, 1, 0.05).name("parametric range");
    f.add(params, "tracking", -0.05, 0.2, 0.005).onChange(() => fit(app));
    f.addColor(params, "ink");
    f.addColor(params, "paper");
    f.add({ reset: () => resetCoords(app) }, "reset").name("reset axes (R)");
  },

  onWord(_w, app) {
    resetCoords(app);
    fit(app);
  },
  onResize(app) {
    if (coords.length) fit(app);
  },

  onKey(e, app) {
    const k = e.key.toLowerCase();
    if (k === "p") { params.perLetter = !params.perLetter; app.toast(params.perLetter ? "Per-letter mode" : "Whole-word mode"); return true; }
    if (k === "r") { resetCoords(app); app.toast("Axes reset"); return true; }
    return false;
  },

  update(dt, s, app) {
    if (app.frozen) return;
    const centres = letterCentres(app);
    const k = Math.min(1, dt * params.rate);
    const r = params.radius * app.W;
    const infl = (h: HandSignals, x: number) => (h.present ? Math.exp(-(((x - h.palm.x) / r) ** 2)) : 0);
    influence = centres.map((x) => Math.max(infl(s.left, x), infl(s.right, x)));

    for (const [tag, m] of Object.entries(AXIS_MAP)) {
      const a = axes[tag];
      const v = m.src(s);
      if (!a || v === null) continue; // hand absent: the axis holds its value
      let target = m.at0 + (m.at1 - m.at0) * v;
      if (PARAMETRIC.has(tag)) target = a.def + (target - a.def) * params.paramRange;
      target = Math.min(a.max, Math.max(a.min, target));
      coords.forEach((c, i) => {
        if (!params.perLetter) { c[tag] = target; return; }
        const w = m.hand === "both" ? Math.max(infl(s.left, centres[i]), infl(s.right, centres[i])) : infl(s[m.hand], centres[i]);
        c[tag] += (target - c[tag]) * w * k;
      });
    }
    // the letter whose values the readout shows: nearest the right hand, else the middle
    const ref = s.right.present ? s.right.palm.x : s.left.present ? s.left.palm.x : app.W / 2;
    focusLetter = centres.reduce((best, x, i) => (Math.abs(x - ref) < Math.abs(centres[best] - ref) ? i : best), 0);
  },

  draw(ctx, app) {
    ctx.fillStyle = params.paper;
    ctx.fillRect(0, 0, app.W, app.H);
    const baseline = app.H * 0.5 + size * 0.36;
    glyphs = layoutWord(app.font, app.word, coords, size, app.W / 2, baseline, params.tracking);
    ctx.fillStyle = params.ink;
    for (const g of glyphs) ctx.fill(toPath2D(g.commands));

    // readout (DOM, so it never lands in the PNG)
    const c = coords[params.perLetter ? focusLetter : 0] ?? {};
    const head = params.perLetter ? `letter "${[...app.word][focusLetter] ?? ""}"  (per-letter)` : "whole word";
    const rows = Object.entries(AXIS_MAP).map(([tag, m]) => {
      const a = axes[tag];
      const v = c[tag] ?? a.def;
      const t = (v - a.min) / (a.max - a.min);
      const bar = "█".repeat(Math.round(t * 10)).padEnd(10, "·");
      return `${tag.padEnd(5)}${v.toFixed(0).padStart(5)} ${bar}  ${m.label}`;
    });
    readout.textContent = [head, ...rows].join("\n");
  },

  drawUI(ctx, app) {
    // per-letter influence dots under each letter (preview only)
    if (!params.perLetter || app.frozen) return;
    const baseline = app.H * 0.5 + size * 0.36;
    ctx.fillStyle = params.ink;
    glyphs.forEach((g, i) => {
      ctx.globalAlpha = 0.15 + 0.85 * (influence[i] ?? 0);
      ctx.beginPath();
      ctx.arc(g.x + g.advance / 2, baseline + size * 0.18, 3 + 5 * (influence[i] ?? 0), 0, Math.PI * 2);
      ctx.fill();
    });
  },

  toSVG(app) {
    const body = glyphs.map((g) => `<path d="${toSvgD(g.commands)}" fill="${params.ink}"/>`).join("\n");
    return svgDocument(app.W, app.H, params.paper, body);
  },
});
