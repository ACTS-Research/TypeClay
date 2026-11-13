/* Prototype C: Echo.
 * Performed, not programmed. Drag on the stage: up/down sets weight,
 * left/right sets tracking. Release and your gesture becomes the loop.
 * The word is stacked in rows, and each row replays the gesture a little
 * later than the one before, so one hand movement ripples down the poster.
 */
(function () {
  const TT = window.TypeToy;
  const { lerp, fract, clamp } = TT;

  const N = 240; // samples per recorded loop
  const PRESETS = {
    figure8: (p) => [0.5 + 0.42 * Math.sin(2 * Math.PI * p), 0.5 + 0.42 * Math.sin(4 * Math.PI * p)],
    orbit: (p) => [0.5 + 0.42 * Math.cos(2 * Math.PI * p), 0.5 + 0.42 * Math.sin(2 * Math.PI * p)],
    breathe: (p) => [0.5 - 0.3 * Math.cos(2 * Math.PI * p), 0.5 + 0.45 * Math.cos(2 * Math.PI * p)],
  };

  function samplePath(s, p) {
    p = fract(p);
    if (!s.path) return PRESETS[s.preset](p);
    const f = p * N, i = Math.floor(f) % N, j = (i + 1) % N, k = f - Math.floor(f);
    return [lerp(s.path.x[i], s.path.x[j], k), lerp(s.path.y[i], s.path.y[j], k)];
  }

  /* Live recording state (preview only, never part of the exported state). */
  let rec = null;
  let presetSeg = null;
  let status = null;

  function historyAt(ms) {
    const h = rec.samples;
    if (ms <= h[0].ms) return [h[0].x, h[0].y];
    for (let i = h.length - 1; i >= 0; i--) if (h[i].ms <= ms) return [h[i].x, h[i].y];
    return [h[0].x, h[0].y];
  }

  /* Resample a recorded drag into N evenly spaced points that loop.
   * A stroke that ends near where it began is kept as a loop (the small gap
   * is spread across the take). A one-way stroke plays forward, then back. */
  function bake(samples) {
    const t0 = samples[0].ms, len = samples[samples.length - 1].ms - t0;
    const at = (ms) => {
      let j = 0;
      while (j < samples.length - 2 && samples[j + 1].ms < ms) j++;
      const a = samples[j], b = samples[Math.min(j + 1, samples.length - 1)];
      const k = b.ms > a.ms ? clamp((ms - a.ms) / (b.ms - a.ms), 0, 1) : 0;
      return [lerp(a.x, b.x, k), lerp(a.y, b.y, k)];
    };
    const first = samples[0], last = samples[samples.length - 1];
    const closed = Math.hypot(last.x - first.x, last.y - first.y) < 0.15;
    const x = new Array(N), y = new Array(N);
    for (let i = 0; i < N; i++) {
      const u = i / N;
      // forward-and-back uses a smooth turnaround so the reversal does not snap
      const v = closed ? u : 0.5 - 0.5 * Math.cos(2 * Math.PI * u);
      [x[i], y[i]] = at(t0 + v * len);
    }
    if (closed) {
      const dx = last.x - first.x, dy = last.y - first.y;
      for (let i = 0; i < N; i++) {
        const k = i / N;
        x[i] = clamp(x[i] - dx * k, 0, 1);
        y[i] = clamp(y[i] - dy * k, 0, 1);
      }
    }
    return { x, y, seconds: closed ? len / 1000 : (2 * len) / 1000, closed };
  }

  const statusText = (path) =>
    `Playing your take${path.closed ? "" : ", forward then back"} (${path.seconds.toFixed(1)} s). Drag again to replace it.`;

  TT.register({
    id: "echo",
    name: "Echo",
    blurb: "Performed by hand. Drag on the stage: up is heavier, right is wider. Release to loop your gesture down a stack of echoes.",
    defaults: {
      preset: "figure8", path: null,
      rows: 7, delay: 0.06, mirror: true,
      wMin: 100, wMax: 1000, tMin: -0.06, tMax: 0.35,
      fill: 0.82, bleed: false, style: "alt", twoTone: false,
    },

    mount(panel, s, api) {
      const { UI, el } = TT;
      const g = UI.section(panel, "Gesture");
      status = el("p", { class: "hint gesture-status" });
      g.append(status);
      const setStatus = () => {
        status.textContent = s.path
          ? statusText(s.path)
          : "Playing a preset. Press and drag on the stage to record your own.";
      };
      setStatus();
      presetSeg = UI.segmented(g, {
        label: "Preset", options: [["figure8", "Figure 8"], ["orbit", "Orbit"], ["breathe", "Breathe"]],
        value: s.path ? null : s.preset,
        onChange: (v) => { s.preset = v; s.path = null; setStatus(); },
      });

      const stack = UI.section(panel, "Stack");
      UI.slider(stack, { id: "echo-rows", label: "Rows", min: 1, max: 21, step: 1, value: s.rows,
        onInput: (v) => (s.rows = v) });
      UI.slider(stack, { id: "echo-delay", label: "Echo delay", min: 0, max: 0.25, step: 0.005, value: s.delay,
        fmt: (v) => `${Math.round(v * 100)}% of loop`, onInput: (v) => (s.delay = v) });
      UI.toggle(stack, { id: "echo-mirror", label: "Ripple out from the middle row", value: s.mirror,
        onChange: (v) => (s.mirror = v) });
      UI.slider(stack, { id: "echo-fill", label: "Row height", min: 0.4, max: 1.3, step: 0.01, value: s.fill,
        fmt: (v) => `${Math.round(v * 100)}%`, onInput: (v) => (s.fill = v) });
      UI.toggle(stack, { id: "echo-bleed", label: "Let long words bleed off the edges", value: s.bleed,
        onChange: (v) => (s.bleed = v) });
      UI.segmented(stack, {
        label: "Rows drawn as", options: [["fill", "Solid"], ["alt", "Alternate"], ["outline", "Outline"]],
        value: s.style, onChange: (v) => (s.style = v),
      });
      UI.toggle(stack, { id: "echo-two", label: "Accent colour on alternate rows", value: s.twoTone,
        onChange: (v) => (s.twoTone = v) });

      const range = UI.section(panel, "Gesture range");
      UI.slider(range, { id: "echo-wmin", label: "Weight at bottom", min: 100, max: 1000, step: 10, value: s.wMin,
        onInput: (v) => (s.wMin = v) });
      UI.slider(range, { id: "echo-wmax", label: "Weight at top", min: 100, max: 1000, step: 10, value: s.wMax,
        onInput: (v) => (s.wMax = v) });
      UI.slider(range, { id: "echo-tmin", label: "Tracking at left", min: -0.15, max: 0.8, step: 0.005, value: s.tMin,
        fmt: (v) => `${Math.round(v * 1000)}`, onInput: (v) => (s.tMin = v) });
      UI.slider(range, { id: "echo-tmax", label: "Tracking at right", min: -0.15, max: 0.8, step: 0.005, value: s.tMax,
        fmt: (v) => `${Math.round(v * 1000)}`, onInput: (v) => (s.tMax = v) });
    },

    unmount() { rec = null; status = null; presetSeg = null; },

    onPointer(type, nx, ny, e, api) {
      const now = performance.now();
      if (type === "down") {
        rec = { start: now, samples: [{ ms: now, x: nx, y: ny }] };
        return true;
      }
      if (!rec) return false;
      rec.samples.push({ ms: now, x: nx, y: ny });
      if (type === "up") {
        const take = rec;
        rec = null;
        const len = take.samples[take.samples.length - 1].ms - take.start;
        if (len < 300 || take.samples.length < 8) return false; // a click, not a gesture
        const baked = bake(take.samples);
        api.stateOf("echo").path = baked;
        if (presetSeg) presetSeg.querySelectorAll("input").forEach((r) => (r.checked = false));
        api.setDuration(Math.round(clamp(baked.seconds, 1, 8) * 10) / 10);
        api.restart();
        api.setPlaying(true);
        if (status) status.textContent = statusText(baked);
      }
      return false;
    },

    render(ctx, W, H, t, s, c, env) {
      const rows = s.rows;
      const lineH = H / rows;
      const cap100 = TT.capHeight(ctx, 100, 400, c) / 100;
      let px = (lineH * s.fill) / cap100;
      if (!s.bleed) {
        const heavy = TT.clampWeight(Math.max(s.wMin, s.wMax), c);
        px = Math.min(px, TT.fitSize(ctx, c.word, heavy, Math.max(s.tMin, s.tMax), W * 0.9, c));
      }
      const chars = [...c.word];
      const mid = (rows - 1) / 2;
      const lead = s.mirror ? Math.round(mid) : 0;
      const live = env.live && rec;
      const nowMs = env.now;

      for (let r = 0; r < rows; r++) {
        const d = s.mirror ? Math.abs(r - mid) : r;
        let pos;
        if (live) pos = historyAt(nowMs - d * s.delay * c.duration * 1000);
        else pos = samplePath(s, t - d * s.delay);
        const weight = lerp(s.wMin, s.wMax, 1 - pos[1]);
        const track = lerp(s.tMin, s.tMax, pos[0]);
        const g = { weight, px, track };
        const lay = TT.layoutGlyphs(ctx, chars, chars.map(() => g), c);
        const cap = cap100 * px;
        const x0 = (W - lay.total) / 2;
        const baseline = lineH * r + lineH / 2 + cap / 2;

        const color = s.twoTone && r % 2 !== lead % 2 ? c.alt : c.fg;
        const outline = s.style === "outline" ? r !== lead : s.style === "alt" ? r % 2 !== lead % 2 : false;
        ctx.font = TT.fontCss(weight, px, c);
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, px * 0.022);
        ctx.lineJoin = "round";
        for (let i = 0; i < chars.length; i++) {
          if (outline) ctx.strokeText(chars[i], x0 + lay.xs[i], baseline);
          else ctx.fillText(chars[i], x0 + lay.xs[i], baseline);
        }
      }
    },

    /* Not exported: a small XY pad showing the gesture and where the lead row is. */
    overlay(ctx, W, H, t, s, c, env) {
      const size = Math.min(W, H) * 0.16;
      const m = Math.min(W, H) * 0.02;
      const x0 = W - size - m, y0 = H - size - m;
      ctx.globalAlpha = 0.7;
      ctx.fillStyle = c.bg;
      ctx.fillRect(x0, y0, size, size);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = c.fg;
      ctx.lineWidth = Math.max(1, size / 120);
      ctx.strokeRect(x0, y0, size, size);
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      if (rec) {
        rec.samples.forEach((p, i) => (i ? ctx.lineTo(x0 + p.x * size, y0 + p.y * size) : ctx.moveTo(x0 + p.x * size, y0 + p.y * size)));
      } else {
        for (let k = 0; k <= 120; k++) {
          const p = samplePath(s, k / 120);
          k ? ctx.lineTo(x0 + p[0] * size, y0 + p[1] * size) : ctx.moveTo(x0 + p[0] * size, y0 + p[1] * size);
        }
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      const p = rec ? [rec.samples[rec.samples.length - 1].x, rec.samples[rec.samples.length - 1].y] : samplePath(s, t);
      ctx.fillStyle = rec ? c.alt : c.fg;
      ctx.beginPath();
      ctx.arc(x0 + p[0] * size, y0 + p[1] * size, size / 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = `600 ${Math.round(size / 9)}px "JetBrains Mono", monospace`;
      ctx.fillStyle = c.fg;
      ctx.fillText(rec ? "● REC" : "drag stage", x0 + size * 0.06, y0 + size * 0.14);
    },
  });
})();
