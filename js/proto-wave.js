/* Prototype A: Wave.
 * The classic slider panel. A periodic signal travels across the letters;
 * each letter's weight, size, lift and tilt follow it. Because each glyph is
 * re-measured every frame, heavy letters shoulder their neighbours aside.
 */
(function () {
  const TT = window.TypeToy;
  const { lerp, fract, smoothstep, hash, clampWeight } = TT;

  const SHAPES = {
    wave: (p) => 0.5 - 0.5 * Math.cos(2 * Math.PI * p),
    pulse: (p) => Math.pow(0.5 - 0.5 * Math.cos(2 * Math.PI * p), 4),
    snap: (p) => smoothstep(0.3, 0.7, 0.5 - 0.5 * Math.cos(2 * Math.PI * p)),
  };

  function signal(s, i, n, t) {
    if (s.shape === "flicker") {
      const steps = 6 * s.cycles;
      const k = Math.floor(fract(t) * steps);
      return hash(i * 31.7 + k * 7.3 + 1.1) > 0.5 ? 1 : 0.15 * hash(i + k);
    }
    const p = fract(t * s.cycles - i * s.spread);
    return SHAPES[s.shape](p);
  }

  TT.register({
    id: "wave",
    name: "Wave",
    blurb: "A slider panel. A signal travels letter to letter and drives weight, size, lift and tilt.",
    defaults: {
      shape: "wave", wMin: 150, wMax: 900, track: 0.02, scale: 1,
      cycles: 1, spread: 0.12, grow: 0.15, lift: 0.12, tilt: 0,
    },

    mount(panel, s) {
      const { UI } = TT;
      const motion = UI.section(panel, "Signal");
      UI.segmented(motion, {
        label: "Shape",
        options: [["wave", "Wave"], ["pulse", "Pulse"], ["snap", "Snap"], ["flicker", "Flicker"]],
        value: s.shape, onChange: (v) => (s.shape = v),
      });
      UI.slider(motion, { id: "wave-cycles", label: "Cycles per loop", min: 1, max: 4, step: 1, value: s.cycles,
        fmt: (v) => `${v}×`, onInput: (v) => (s.cycles = v) });
      UI.slider(motion, { id: "wave-spread", label: "Letter offset", min: -0.5, max: 0.5, step: 0.01, value: s.spread,
        fmt: (v) => `${v > 0 ? "+" : ""}${v.toFixed(2)} cycle`, onInput: (v) => (s.spread = v) });

      const type = UI.section(panel, "Type");
      UI.slider(type, { id: "wave-wmin", label: "Weight at rest", min: 100, max: 1000, step: 10, value: s.wMin,
        onInput: (v) => (s.wMin = v) });
      UI.slider(type, { id: "wave-wmax", label: "Weight at peak", min: 100, max: 1000, step: 10, value: s.wMax,
        onInput: (v) => (s.wMax = v) });
      UI.slider(type, { id: "wave-track", label: "Tracking", min: -0.15, max: 0.6, step: 0.005, value: s.track,
        fmt: (v) => `${Math.round(v * 1000)}`, onInput: (v) => (s.track = v) });
      UI.slider(type, { id: "wave-scale", label: "Size", min: 0.4, max: 1.3, step: 0.01, value: s.scale,
        fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => (s.scale = v) });

      const move = UI.section(panel, "Movement at peak");
      UI.slider(move, { id: "wave-grow", label: "Grow", min: 0, max: 0.6, step: 0.01, value: s.grow,
        fmt: (v) => `+${Math.round(v * 100)}%`, onInput: (v) => (s.grow = v) });
      UI.slider(move, { id: "wave-lift", label: "Lift", min: -0.5, max: 0.5, step: 0.01, value: s.lift,
        fmt: (v) => `${v.toFixed(2)} em`, onInput: (v) => (s.lift = v) });
      UI.slider(move, { id: "wave-tilt", label: "Tilt", min: -30, max: 30, step: 1, value: s.tilt,
        fmt: (v) => `${v}°`, onInput: (v) => (s.tilt = v) });
    },

    render(ctx, W, H, t, s, c) {
      const chars = [...c.word];
      const n = chars.length;
      const peakW = clampWeight(Math.max(s.wMin, s.wMax), c);
      // Fit the word at its heaviest, grown state so peaks never clip.
      let base = TT.fitSize(ctx, c.word, peakW, s.track, W * 0.84, c) / (1 + s.grow);
      base = Math.min(base, H * 0.55) * s.scale;

      const vals = chars.map((_, i) => signal(s, i, n, t));
      const glyphs = vals.map((v) => ({
        weight: lerp(s.wMin, s.wMax, v),
        px: base * (1 + s.grow * v),
        track: s.track,
      }));
      const lay = TT.layoutGlyphs(ctx, chars, glyphs, c);
      const cap = TT.capHeight(ctx, base, s.wMin, c);
      const x0 = (W - lay.total) / 2;
      const baseline = H / 2 + cap / 2;

      ctx.fillStyle = c.fg;
      for (let i = 0; i < n; i++) {
        const g = glyphs[i], v = vals[i];
        const cx = x0 + lay.xs[i] + lay.ws[i] / 2;
        const y = baseline - s.lift * base * v;
        ctx.save();
        ctx.translate(cx, y - cap / 2);
        ctx.rotate((s.tilt * v * Math.PI) / 180);
        ctx.font = TT.fontCss(g.weight, g.px, c);
        ctx.fillText(chars[i], -lay.ws[i] / 2, cap / 2);
        ctx.restore();
      }
    },
  });
})();
