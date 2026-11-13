/* Minimal animated GIF encoder.
 *
 * Two-pass design so memory stays flat no matter how many frames:
 *   1. feed every frame to a Histogram (5 bits per channel, with exact colour sums)
 *   2. buildPalette() runs median cut over that histogram (<= 256 colours)
 *   3. feed every frame again to an Encoder, which maps pixels and LZW-compresses
 *
 * No dithering: kinetic type is mostly flat colour plus anti-aliasing ramps,
 * and dithering makes those edges crawl from frame to frame.
 */
(function () {
  "use strict";

  const BINS = 1 << 15;
  const keyOf = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

  class Histogram {
    constructor() {
      this.count = new Uint32Array(BINS);
      this.r = new Float64Array(BINS);
      this.g = new Float64Array(BINS);
      this.b = new Float64Array(BINS);
    }
    add(rgba) {
      const { count, r, g, b } = this;
      for (let i = 0; i < rgba.length; i += 4) {
        const R = rgba[i], G = rgba[i + 1], B = rgba[i + 2];
        const k = keyOf(R, G, B);
        count[k]++; r[k] += R; g[k] += G; b[k] += B;
      }
    }
  }

  /* Median cut over the occupied histogram bins. Returns [[r,g,b], ...]. */
  function buildPalette(hist, maxColors = 256) {
    const bins = [];
    for (let k = 0; k < BINS; k++) {
      const n = hist.count[k];
      if (n) bins.push({ n, c: [hist.r[k] / n, hist.g[k] / n, hist.b[k] / n] });
    }
    if (bins.length === 0) return [[0, 0, 0]];
    if (bins.length <= maxColors) return bins.map((b) => b.c.map(Math.round));

    const boxOf = (items) => {
      let lo = [255, 255, 255], hi = [0, 0, 0], n = 0;
      for (const it of items) {
        n += it.n;
        for (let ch = 0; ch < 3; ch++) {
          if (it.c[ch] < lo[ch]) lo[ch] = it.c[ch];
          if (it.c[ch] > hi[ch]) hi[ch] = it.c[ch];
        }
      }
      let axis = 0;
      for (let ch = 1; ch < 3; ch++) if (hi[ch] - lo[ch] > hi[axis] - lo[axis]) axis = ch;
      return { items, n, axis, range: hi[axis] - lo[axis] };
    };

    const boxes = [boxOf(bins)];
    while (boxes.length < maxColors) {
      let best = -1;
      for (let i = 0; i < boxes.length; i++) {
        const b = boxes[i];
        if (b.items.length < 2 || b.range <= 0) continue;
        if (best < 0 || b.range > boxes[best].range ||
            (b.range === boxes[best].range && b.n > boxes[best].n)) best = i;
      }
      if (best < 0) break;
      const box = boxes[best];
      const ax = box.axis;
      box.items.sort((a, b) => a.c[ax] - b.c[ax]);
      let acc = 0, cut = 1;
      for (let i = 0; i < box.items.length - 1; i++) {
        acc += box.items[i].n;
        cut = i + 1;
        if (acc >= box.n / 2) break;
      }
      boxes.splice(best, 1, boxOf(box.items.slice(0, cut)), boxOf(box.items.slice(cut)));
    }

    return boxes.map((box) => {
      let r = 0, g = 0, b = 0;
      for (const it of box.items) { r += it.c[0] * it.n; g += it.c[1] * it.n; b += it.c[2] * it.n; }
      return [Math.round(r / box.n), Math.round(g / box.n), Math.round(b / box.n)];
    });
  }

  class ByteWriter {
    constructor(size = 1 << 20) { this.buf = new Uint8Array(size); this.len = 0; }
    ensure(n) {
      if (this.len + n <= this.buf.length) return;
      let cap = this.buf.length * 2;
      while (cap < this.len + n) cap *= 2;
      const next = new Uint8Array(cap);
      next.set(this.buf.subarray(0, this.len));
      this.buf = next;
    }
    byte(b) { this.ensure(1); this.buf[this.len++] = b; }
    u16(v) { this.byte(v & 255); this.byte((v >> 8) & 255); }
    str(s) { for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i)); }
    bytes(arr, n = arr.length) { this.ensure(n); this.buf.set(arr.subarray(0, n), this.len); this.len += n; }
    result() { return this.buf.slice(0, this.len); }
  }

  class Encoder {
    /* palette: [[r,g,b], ...] up to 256 entries. loop: 0 = forever. */
    constructor(width, height, palette, { loop = 0 } = {}) {
      this.w = width; this.h = height;
      let bits = 1;
      while ((1 << bits) < palette.length) bits++;
      this.bits = bits;
      this.palette = palette;
      this.lut = new Int16Array(BINS).fill(-1);
      this.indices = new Uint8Array(width * height);
      // LZW dictionary keyed by (prefixCode << 8 | byte); a generation stamp
      // replaces clearing 1M entries on every table reset.
      this.tCode = new Int16Array(1 << 20);
      this.tGen = new Int32Array(1 << 20);
      this.gen = 0;

      const out = (this.out = new ByteWriter());
      out.str("GIF89a");
      out.u16(width); out.u16(height);
      out.byte(0x80 | ((bits - 1) << 4) | (bits - 1)); // global colour table present
      out.byte(0); out.byte(0);
      for (let i = 0; i < 1 << bits; i++) {
        const c = palette[i] || [0, 0, 0];
        out.byte(c[0]); out.byte(c[1]); out.byte(c[2]);
      }
      // NETSCAPE2.0 looping block
      out.byte(0x21); out.byte(0xff); out.byte(11); out.str("NETSCAPE2.0");
      out.byte(3); out.byte(1); out.u16(loop); out.byte(0);
    }

    nearest(k) {
      const r = ((k >> 10) & 31) * 8 + 4, g = ((k >> 5) & 31) * 8 + 4, b = (k & 31) * 8 + 4;
      let best = 0, bestD = Infinity;
      const p = this.palette;
      for (let i = 0; i < p.length; i++) {
        const dr = p[i][0] - r, dg = p[i][1] - g, db = p[i][2] - b;
        const d = 2 * dr * dr + 4 * dg * dg + 3 * db * db;
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    }

    /* rgba: Uint8ClampedArray of w*h*4. delayCs: frame delay in 1/100 s. */
    addFrame(rgba, delayCs) {
      const { lut, indices, out } = this;
      // Exact palette colours map to themselves; everything else to the nearest entry.
      // Seed the LUT from the palette so flat fills stay pixel-exact.
      if (!this.seeded) {
        this.palette.forEach((c, i) => { lut[keyOf(c[0], c[1], c[2])] = i; });
        this.seeded = true;
      }
      for (let i = 0, j = 0; j < indices.length; i += 4, j++) {
        const k = keyOf(rgba[i], rgba[i + 1], rgba[i + 2]);
        let v = lut[k];
        if (v < 0) v = lut[k] = this.nearest(k);
        indices[j] = v;
      }

      out.byte(0x21); out.byte(0xf9); out.byte(4);
      out.byte(0); // no disposal, no transparency
      out.u16(Math.max(2, Math.round(delayCs)));
      out.byte(0); out.byte(0);

      out.byte(0x2c);
      out.u16(0); out.u16(0); out.u16(this.w); out.u16(this.h);
      out.byte(0);

      this.lzw(Math.max(2, this.bits), indices);
    }

    lzw(minCodeSize, idx) {
      const out = this.out, tCode = this.tCode, tGen = this.tGen;
      out.byte(minCodeSize);
      const clearCode = 1 << minCodeSize, eoi = clearCode + 1;
      let codeSize = minCodeSize + 1, next = eoi + 1;
      let gen = ++this.gen;

      const block = new Uint8Array(255);
      let blen = 0, cur = 0, shift = 0;
      const emitByte = (b) => {
        block[blen++] = b;
        if (blen === 255) { out.byte(255); out.bytes(block, 255); blen = 0; }
      };
      const emit = (code) => {
        cur |= code << shift;
        shift += codeSize;
        while (shift >= 8) { emitByte(cur & 255); cur >>>= 8; shift -= 8; }
      };

      emit(clearCode);
      let prefix = idx[0];
      for (let i = 1; i < idx.length; i++) {
        const k = idx[i];
        const key = (prefix << 8) | k;
        if (tGen[key] === gen) { prefix = tCode[key]; continue; }
        emit(prefix);
        if (next === 4096) {
          emit(clearCode);
          codeSize = minCodeSize + 1;
          next = eoi + 1;
          gen = ++this.gen;
        } else {
          if (next >= 1 << codeSize) codeSize++;
          tGen[key] = gen;
          tCode[key] = next++;
        }
        prefix = k;
      }
      emit(prefix);
      emit(eoi);
      if (shift > 0) emitByte(cur & 255);
      if (blen > 0) { out.byte(blen); out.bytes(block, blen); }
      out.byte(0);
    }

    finish() { this.out.byte(0x3b); return this.out.result(); }
  }

  window.GIF = { Histogram, buildPalette, Encoder };
})();
