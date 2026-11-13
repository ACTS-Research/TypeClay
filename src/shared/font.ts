// Roboto Flex via opentype.js 2.0, which applies variable-font deltas (gvar)
// itself. That lets us draw any point in the 13-axis design space as real
// outlines on canvas, and export the same outlines as SVG.
import opentype, { type Font, type PathCommand, type Variation } from "opentype.js";
import type { Pt } from "./types";

let fontPromise: Promise<Font> | null = null;

export function loadFont(): Promise<Font> {
  fontPromise ??= fetch(`${import.meta.env.BASE_URL}fonts/RobotoFlex.ttf`)
    .then((r) => {
      if (!r.ok) throw new Error(`font fetch failed: ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => opentype.parse(buf));
  return fontPromise;
}

export interface AxisInfo { tag: string; min: number; def: number; max: number; name: string }

export function axesOf(font: Font): Record<string, AxisInfo> {
  const out: Record<string, AxisInfo> = {};
  for (const a of font.tables.fvar?.axes ?? []) {
    out[a.tag] = { tag: a.tag, min: a.minValue, def: a.defaultValue, max: a.maxValue, name: a.name.en ?? a.tag };
  }
  return out;
}

export function defaultCoords(font: Font): Variation {
  const c: Variation = {};
  for (const a of Object.values(axesOf(font))) c[a.tag] = a.def;
  return c;
}

export interface PlacedGlyph {
  char: string;
  x: number; // pen position (left edge of advance), px
  advance: number; // px
  commands: PathCommand[]; // already positioned at (x, baseline), y down
}

/**
 * Lays out a word with one variation per letter (or one shared), centred on cx.
 * Spacing comes from each glyph's own varied advance width (no kerning).
 */
export function layoutWord(
  font: Font, word: string, coords: Variation | Variation[], size: number, cx: number, baseline: number,
  tracking = 0,
): PlacedGlyph[] {
  const chars = [...word];
  const scale = size / font.unitsPerEm;
  const varied = chars.map((ch, i) => {
    const v = Array.isArray(coords) ? coords[i] : coords;
    return font.variation.getTransform(font.charToGlyph(ch), v);
  });
  const advances = varied.map((g) => g.advanceWidth * scale);
  const total = advances.reduce((a, b) => a + b, 0) + tracking * size * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  return chars.map((ch, i) => {
    // Transformed glyphs lose their unitsPerEm, so opentype would assume 1000.
    // Passing the scale explicitly keeps them at the right size.
    const commands = varied[i].getPath(x, baseline, size, { xScale: scale, yScale: scale }).commands;
    const placed = { char: ch, x, advance: advances[i], commands };
    x += advances[i] + tracking * size;
    return placed;
  });
}

export function toPath2D(cmds: PathCommand[]): Path2D {
  const p = new Path2D();
  for (const c of cmds) {
    if (c.type === "M") p.moveTo(c.x, c.y);
    else if (c.type === "L") p.lineTo(c.x, c.y);
    else if (c.type === "Q") p.quadraticCurveTo(c.x1, c.y1, c.x, c.y);
    else if (c.type === "C") p.bezierCurveTo(c.x1, c.y1, c.x2, c.y2, c.x, c.y);
    else p.closePath();
  }
  return p;
}

const f = (n: number) => +n.toFixed(2);

export function toSvgD(cmds: PathCommand[]): string {
  return cmds.map((c) => {
    if (c.type === "M" || c.type === "L") return `${c.type}${f(c.x)} ${f(c.y)}`;
    if (c.type === "Q") return `Q${f(c.x1)} ${f(c.y1)} ${f(c.x)} ${f(c.y)}`;
    if (c.type === "C") return `C${f(c.x1)} ${f(c.y1)} ${f(c.x2)} ${f(c.y2)} ${f(c.x)} ${f(c.y)}`;
    return "Z";
  }).join("");
}

export function polygonsToSvgD(contours: Pt[][]): string {
  return contours.map((c) => `M${c.map((p) => `${f(p.x)} ${f(p.y)}`).join("L")}Z`).join("");
}

/** Flatten path commands into closed polylines (one per contour). */
export function flatten(cmds: PathCommand[], step = 4): Pt[][] {
  const out: Pt[][] = [];
  let cur: Pt[] = [];
  let p: Pt = { x: 0, y: 0 };
  const seg = (len: number) => Math.max(2, Math.ceil(len / step));
  for (const c of cmds) {
    if (c.type === "M") { if (cur.length > 2) out.push(cur); cur = [{ x: c.x, y: c.y }]; p = { x: c.x, y: c.y }; }
    else if (c.type === "L") { cur.push({ x: c.x, y: c.y }); p = { x: c.x, y: c.y }; }
    else if (c.type === "Q") {
      const n = seg(Math.hypot(c.x1 - p.x, c.y1 - p.y) + Math.hypot(c.x - c.x1, c.y - c.y1));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push({ x: u * u * p.x + 2 * u * t * c.x1 + t * t * c.x, y: u * u * p.y + 2 * u * t * c.y1 + t * t * c.y });
      }
      p = { x: c.x, y: c.y };
    } else if (c.type === "C") {
      const n = seg(Math.hypot(c.x1 - p.x, c.y1 - p.y) + Math.hypot(c.x2 - c.x1, c.y2 - c.y1) + Math.hypot(c.x - c.x2, c.y - c.y2));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.push({
          x: u * u * u * p.x + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          y: u * u * u * p.y + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        });
      }
      p = { x: c.x, y: c.y };
    } else if (c.type === "Z") { if (cur.length > 2) out.push(cur); cur = []; }
  }
  if (cur.length > 2) out.push(cur);
  // drop a duplicated closing point
  for (const c of out) {
    const a = c[0], b = c[c.length - 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) c.pop();
  }
  return out;
}

/** Resample a closed polyline to points spaced `spacing` px apart along its length. */
export function resampleClosed(poly: Pt[], spacing: number): Pt[] {
  const n = poly.length;
  let perim = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    perim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const count = Math.max(6, Math.round(perim / spacing));
  const step = perim / count;
  const out: Pt[] = [];
  let i = 0, segPos = 0;
  let a = poly[0], b = poly[1 % n];
  let segLen = Math.hypot(b.x - a.x, b.y - a.y);
  for (let k = 0; k < count; k++) {
    const target = k * step;
    while (segPos + segLen < target && i < n) {
      segPos += segLen;
      i++;
      a = poly[i % n];
      b = poly[(i + 1) % n];
      segLen = Math.hypot(b.x - a.x, b.y - a.y);
    }
    const t = segLen > 0 ? (target - segPos) / segLen : 0;
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  }
  return out;
}

/** Signed area (positive = clockwise in screen coords, y down). */
export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function pointInPolys(p: Pt, polys: Pt[][]): boolean {
  // non-zero winding over all contours, matching how glyphs are filled
  let wn = 0;
  for (const poly of polys) {
    for (let i = 0, n = poly.length; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      const cross = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y) { if (b.y > p.y && cross > 0) wn++; }
      else if (b.y <= p.y && cross < 0) wn--;
    }
  }
  return wn !== 0;
}
