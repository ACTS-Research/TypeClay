/* Prototype B: Tween.
 * Motion-design thinking: set two poses, A and B, and pick an easing.
 * The word travels A → B → A with an optional stagger across letters.
 * Grabbing any A or B slider freezes the stage on that pose while you edit.
 */
(function () {
  const TT = window.TypeToy;
  const { lerp, clamp, hash } = TT;

  const EASE = {
    linear: (x) => x,
    smooth: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    expo: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : (2 - Math.pow(2, -20 * x + 10)) / 2),
    back: (x) => {
      const c2 = 1.70158 * 1.525;
      return x < 0.5
        ? (Math.pow(2 * x, 2) * ((c2 + 1) * 2 * x - c2)) / 2
        : (Math.pow(2 * x - 2, 2) * ((c2 + 1) * (x * 2 - 2) + c2) + 2) / 2;
    },
    elastic: (x) => (x <= 0 ? 0 : x >= 1 ? 1 : Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
    steps: (x) => Math.min(1, Math.floor(x * 5) / 4),
  };

  const PROPS = [
    { key: "weight", label: "Weight", min: 100, max: 1000, step: 10, fmt: (v) => `${v}` },
    { key: "track", label: "Tracking", min: -0.15, max: 0.8, step: 0.005, fmt: (v) => `${Math.round(v * 1000)}` },
    { key: "size", label: "Size", min: 0.3, max: 1.4, step: 0.01, fmt: (v) => `${Math.round(v * 100)}%` },
    { key: "skew", label: "Slant", min: -25, max: 25, step: 1, fmt: (v) => `${v}°` },
    { key: "rotate", label: "Turn", min: -180, max: 180, step: 1, fmt: (v) => `${v}°` },
    { key: "shift", label: "Rise", min: -0.8, max: 0.8, step: 0.01, fmt: (v) => `${v.toFixed(2)} em` },
  ];

  function order(mode, i, n) {
    if (n < 2) return 0;
    const u = i / (n - 1);
    switch (mode) {
      case "rtl": return 1 - u;
      case "center": return Math.abs(u - 0.5) * 2;
      case "edges": return 1 - Math.abs(u - 0.5) * 2;
      case "random": {
        const r = Array.from({ length: n }, (_, k) => k).sort((a, b) => hash(a + 9.1) - hash(b + 9.1));
        return r.indexOf(i) / (n - 1);
      }
      default: return u;
    }
  }

  /* Eased progress (0 = pose A, 1 = pose B) for letter i at loop phase t. */
  function progress(s, i, n, t) {
    t = TT.fract(t);
    const pingpong = s.loop === "pingpong";
    const half = pingpong ? (t < 0.5 ? 0 : 1) : 0;
    const u = pingpong ? (t % 0.5) / 0.5 : t;
    const active = 1 - s.hold;
    const delay = s.stagger * active * order(s.order, i, n);
    const dur = Math.max(1e-6, active * (1 - s.stagger));
    const local = clamp((u - delay) / dur, 0, 1);
    const e = EASE[s.ease](local);
    return half === 0 ? e : 1 - e;
  }

  let curve = null;

  TT.register({
    id: "tween",
    name: "Tween",
    blurb: "Two keyframes and an easing curve. Grab an A or B slider to pin the stage on that pose.",
    defaults: {
      a: { weight: 120, track: 0.42, size: 0.78, skew: 0, rotate: 0, shift: 0 },
      b: { weight: 920, track: 0.01, size: 1, skew: -12, rotate: 0, shift: 0 },
      ease: "back", stagger: 0.35, order: "ltr", hold: 0.2, loop: "pingpong",
    },

    mount(panel, s, api) {
      const { UI, el } = TT;

      const poses = UI.section(panel, "Keyframes", "Left column is pose A, right column is pose B.");
      const grid = el("div", { class: "ab-grid" },
        el("span", { class: "ab-head", "aria-hidden": "true" }, "A"),
        el("span", { class: "ab-head", "aria-hidden": "true" }, "B"));
      poses.append(grid);
      const ctls = { a: {}, b: {} };
      for (const p of PROPS) {
        grid.append(el("p", { class: "ab-label" }, p.label));
        for (const k of ["a", "b"]) {
          ctls[k][p.key] = UI.slider(grid, {
            id: `tween-${k}-${p.key}`, label: `${k.toUpperCase()}`, compact: true,
            min: p.min, max: p.max, step: p.step, value: s[k][p.key], fmt: p.fmt,
            onInput: (v) => (s[k][p.key] = v),
            onGrab: () => api.freeze(k === "a" ? 0 : s.loop === "pingpong" ? 0.5 : 0.999),
            onRelease: () => api.unfreeze(),
          });
          ctls[k][p.key].row.querySelector("label").setAttribute("aria-label", `${p.label}, pose ${k.toUpperCase()}`);
        }
      }
      const tools = el("div", { class: "btn-row" });
      poses.append(tools);
      const sync = () => { for (const k of ["a", "b"]) for (const p of PROPS) ctls[k][p.key].set(s[k][p.key]); };
      UI.button(tools, { label: "Swap A ↔ B", kind: "ghost", onClick: () => { [s.a, s.b] = [s.b, s.a]; sync(); } });
      UI.button(tools, { label: "Copy A → B", kind: "ghost", onClick: () => { s.b = { ...s.a }; sync(); } });

      const timing = UI.section(panel, "Timing");
      curve = el("canvas", { class: "curve", width: 560, height: 220, "aria-label": "Easing curve" });
      timing.append(curve);
      UI.select(timing, {
        id: "tween-ease", label: "Easing",
        options: [["linear", "Linear"], ["smooth", "Smooth (cubic in-out)"], ["expo", "Expo in-out"],
          ["back", "Back (overshoot)"], ["elastic", "Elastic"], ["steps", "Steps (4)"]],
        value: s.ease, onChange: (v) => (s.ease = v),
      });
      UI.slider(timing, { id: "tween-stagger", label: "Stagger", min: 0, max: 0.9, step: 0.01, value: s.stagger,
        fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => (s.stagger = v) });
      UI.select(timing, {
        id: "tween-order", label: "Stagger order",
        options: [["ltr", "Left to right"], ["rtl", "Right to left"], ["center", "From the centre"],
          ["edges", "From the edges"], ["random", "Shuffled"]],
        value: s.order, onChange: (v) => (s.order = v),
      });
      UI.slider(timing, { id: "tween-hold", label: "Hold on each pose", min: 0, max: 0.7, step: 0.01, value: s.hold,
        fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => (s.hold = v) });
      UI.segmented(timing, {
        label: "Loop", options: [["pingpong", "A → B → A"], ["cut", "A → B, cut"]],
        value: s.loop, onChange: (v) => (s.loop = v),
      });
    },

    unmount() { curve = null; },

    render(ctx, W, H, t, s, c) {
      const chars = [...c.word];
      const n = chars.length;
      const heavy = TT.clampWeight(Math.max(s.a.weight, s.b.weight), c);
      const unit = Math.min(
        TT.fitSize(ctx, c.word, heavy, Math.max(s.a.track, s.b.track), W * 0.86, c),
        H * 0.5);

      const ps = chars.map((_, i) => progress(s, i, n, t));
      const at = (key, e) => lerp(s.a[key], s.b[key], e);
      const glyphs = ps.map((e) => ({
        weight: at("weight", e),
        px: Math.max(1, unit * at("size", e)),
        track: at("track", e),
      }));
      const lay = TT.layoutGlyphs(ctx, chars, glyphs, c);
      const cap = TT.capHeight(ctx, unit, 400, c);
      const x0 = (W - lay.total) / 2;
      const baseline = H / 2 + cap / 2;

      ctx.fillStyle = c.fg;
      for (let i = 0; i < n; i++) {
        const e = ps[i], g = glyphs[i];
        const gcap = cap * (g.px / unit);
        ctx.save();
        ctx.translate(x0 + lay.xs[i] + lay.ws[i] / 2, baseline - at("shift", e) * unit);
        ctx.transform(1, 0, -Math.tan((at("skew", e) * Math.PI) / 180), 1, 0, 0);
        ctx.translate(0, -gcap / 2);
        ctx.rotate((at("rotate", e) * Math.PI) / 180);
        ctx.font = TT.fontCss(g.weight, g.px, c);
        ctx.fillText(chars[i], -lay.ws[i] / 2, gcap / 2);
        ctx.restore();
      }
    },

    /* Not exported: draws the easing curve in the panel with a playhead. */
    overlay(_ctx, _W, _H, t, s) {
      if (!curve) return;
      const g = curve.getContext("2d");
      const W = curve.width, H = curve.height;
      const css = getComputedStyle(curve);
      const ink = css.getPropertyValue("--ink").trim() || "#111";
      const line = css.getPropertyValue("--line").trim() || "#ccc";
      const accent = css.getPropertyValue("--accent").trim() || "#33f";
      g.clearRect(0, 0, W, H);
      const pad = 22, top = H * 0.22, bot = H * 0.78;
      const y = (v) => bot - v * (bot - top);
      g.strokeStyle = line; g.lineWidth = 2; g.setLineDash([6, 6]);
      g.beginPath(); g.moveTo(pad, y(0)); g.lineTo(W - pad, y(0)); g.moveTo(pad, y(1)); g.lineTo(W - pad, y(1)); g.stroke();
      g.setLineDash([]);
      g.fillStyle = ink; g.font = "600 20px 'JetBrains Mono', monospace";
      g.fillText("B", 4, y(1) + 7); g.fillText("A", 4, y(0) + 7);
      g.strokeStyle = ink; g.lineWidth = 3; g.beginPath();
      for (let k = 0; k <= 200; k++) {
        const tt = k / 200;
        const v = progress(s, 0, 1, tt);
        const X = pad + tt * (W - 2 * pad);
        k ? g.lineTo(X, y(v)) : g.moveTo(X, y(v));
      }
      g.stroke();
      const v = progress(s, 0, 1, t);
      const X = pad + t * (W - 2 * pad);
      g.strokeStyle = accent; g.lineWidth = 2;
      g.beginPath(); g.moveTo(X, 6); g.lineTo(X, H - 6); g.stroke();
      g.fillStyle = accent; g.beginPath(); g.arc(X, y(v), 8, 0, Math.PI * 2); g.fill();
    },
  });
})();
