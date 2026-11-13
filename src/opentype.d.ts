// Minimal typings for opentype.js 2.0 (the package ships none). Only what we use.
declare module "opentype.js" {
  export type Variation = Record<string, number>;
  export type PathCommand =
    | { type: "M" | "L"; x: number; y: number }
    | { type: "Q"; x1: number; y1: number; x: number; y: number }
    | { type: "C"; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
    | { type: "Z" };
  export interface Path { commands: PathCommand[]; getBoundingBox(): { x1: number; y1: number; x2: number; y2: number } }
  export interface Glyph {
    advanceWidth: number;
    getPath(x: number, y: number, fontSize: number, options?: { variation?: Variation; xScale?: number; yScale?: number }, font?: Font): Path;
  }
  export interface Axis { tag: string; minValue: number; defaultValue: number; maxValue: number; name: Record<string, string> }
  export interface Font {
    defaultRenderOptions: { variation?: Variation };
    unitsPerEm: number;
    ascender: number;
    descender: number;
    tables: { fvar?: { axes: Axis[] }; [k: string]: unknown };
    charToGlyph(c: string): Glyph;
    variation: { getTransform(glyph: Glyph, coords: Variation): Glyph };
  }
  export function parse(buffer: ArrayBuffer): Font;
  const opentype: { parse: typeof parse };
  export default opentype;
}
