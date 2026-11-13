/* Shared shell for the three prototypes: text + colour controls, the stage
 * loop, transport, and GIF export. Prototypes register themselves with
 * TypeToy.register({...}) and only provide controls + a render function.
 *
 * Every render function is a pure function of loop phase t in [0, 1), so the
 * live preview and the exported GIF are frame-identical and loop seamlessly.
 */
(function () {
  "use strict";

  const FONTS = [
    { family: "Roboto Flex", min: 100, max: 1000, fallback: "sans-serif" },
    { family: "Fraunces", min: 100, max: 900, fallback: "serif" },
    { family: "Bricolage Grotesque", min: 200, max: 800, fallback: "sans-serif" },
    { family: "Big Shoulders Display", min: 100, max: 900, fallback: "sans-serif" },
    { family: "Unbounded", min: 200, max: 900, fallback: "sans-serif" },
    { family: "Archivo", min: 100, max: 900, fallback: "sans-serif" },
    { family: "Bodoni Moda", min: 400, max: 900, fallback: "serif" },
  ];

  const PALETTES = [
    { name: "Ink on paper", fg: "#141414", bg: "#F3F3F0", alt: "#FF4F1F" },
    { name: "Paper on ink", fg: "#F3F3F0", bg: "#141414", alt: "#FF4F1F" },
    { name: "Cobalt on blush", fg: "#2335FF", bg: "#FFD3E2", alt: "#141414" },
    { name: "Lime on violet", fg: "#D8FF3C", bg: "#3B1D8F", alt: "#FFFFFF" },
    { name: "Signal red", fg: "#F2EDE4", bg: "#E0261B", alt: "#141414" },
    { name: "Concrete", fg: "#1D1F22", bg: "#B9BEC5", alt: "#F3F3F0" },
  ];

  const ASPECTS = { "1:1": 1, "4:5": 4 / 5, "16:9": 16 / 9, "9:16": 9 / 16 };

  const common = {
    word: "Kinetic",
    font: "Roboto Flex",
    fg: PALETTES[0].fg, bg: PALETTES[0].bg, alt: PALETTES[0].alt,
    aspect: "1:1",
    duration: 3,
    fps: 25,
    exportWidth: 720,
  };

  const protos = [];
  const protoState = {};
  let active = null;

  /* ---------- helpers exposed to prototypes ---------- */

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const fract = (x) => x - Math.floor(x);
  const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

  function fontInfo(c = common) { return FONTS.find((f) => f.family === c.font) || FONTS[0]; }
  function clampWeight(w, c = common) { const f = fontInfo(c); return clamp(w, f.min, f.max); }
  function fontCss(w, px, c = common) {
    const f = fontInfo(c);
    return `${Math.round(clampWeight(w, c))} ${Math.max(1, px).toFixed(2)}px "${f.family}", ${f.fallback}`;
  }
  function capHeight(ctx, px, w, c = common) {
    ctx.font = fontCss(w, px, c);
    const m = ctx.measureText("H");
    return m.actualBoundingBoxAscent || px * 0.7;
  }

  /* Lay out glyphs that may each have their own weight, size and tracking.
   * Kerning is approximated per pair at the right-hand glyph's weight. */
  function layoutGlyphs(ctx, chars, glyphs, c = common) {
    const xs = [], ws = [];
    let x = 0;
    for (let i = 0; i < chars.length; i++) {
      const g = glyphs[i];
      ctx.font = fontCss(g.weight, g.px, c);
      const w = ctx.measureText(chars[i]).width;
      if (i > 0) {
        const pair = chars[i - 1] + chars[i];
        const kern = ctx.measureText(pair).width - ctx.measureText(chars[i - 1]).width - w;
        x += kern + (g.track || 0) * g.px;
      }
      xs.push(x); ws.push(w);
      x += w;
    }
    return { xs, ws, total: x };
  }

  /* Font size at which `text` at weight `w` with tracking `trackEm` is `maxW` wide. */
  function fitSize(ctx, text, w, trackEm, maxW, c = common) {
    const chars = [...text];
    if (!chars.length) return 100;
    const g = { weight: w, px: 100, track: trackEm };
    const { total } = layoutGlyphs(ctx, chars, chars.map(() => g), c);
    return total > 0 ? (100 * maxW) / total : 100;
  }

  /* ---------- tiny control kit ---------- */

  let uid = 0;
  const el = (tag, attrs = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === "class") n.className = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v === true ? "" : v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  };

  const UI = {
    section(parent, title, hint) {
      const s = el("section", { class: "group" }, el("h3", {}, title));
      if (hint) s.append(el("p", { class: "hint" }, hint));
      parent.append(s);
      return s;
    },
    /* Range with label + live value. Double-click the label to reset. */
    slider(parent, { id, label, min, max, step = 1, value, fmt = (v) => v, onInput, onGrab, onRelease, compact }) {
      id = id || `s${++uid}`;
      const out = el("output", { for: id }, fmt(value));
      const input = el("input", { type: "range", id, min, max, step, value });
      const lab = el("label", { for: id, title: "Double-click to reset" }, label);
      const row = el("div", { class: compact ? "ctl slider compact" : "ctl slider" },
        el("div", { class: "ctl-head" }, lab, out), input);
      const initial = value;
      const set = (v, fire) => {
        input.value = v; out.value = fmt(+input.value);
        if (fire) onInput(+input.value);
      };
      input.addEventListener("input", () => { out.value = fmt(+input.value); onInput(+input.value); });
      if (onGrab) input.addEventListener("pointerdown", onGrab);
      if (onRelease) {
        input.addEventListener("pointerup", onRelease);
        input.addEventListener("pointercancel", onRelease);
      }
      lab.addEventListener("dblclick", () => set(initial, true));
      parent.append(row);
      return { row, input, set };
    },
    select(parent, { id, label, options, value, onChange }) {
      id = id || `s${++uid}`;
      const sel = el("select", { id });
      for (const [v, text] of options) sel.append(el("option", { value: v }, text));
      sel.value = value;
      sel.addEventListener("change", () => onChange(sel.value));
      parent.append(el("div", { class: "ctl" }, el("label", { for: id }, label), sel));
      return sel;
    },
    segmented(parent, { label, options, value, onChange }) {
      const name = `g${++uid}`;
      const wrap = el("div", { class: "seg", role: "radiogroup", "aria-label": label });
      for (const [v, text] of options) {
        const id = `${name}-${String(v).replace(/[^a-z0-9]/gi, "")}`;
        const r = el("input", { type: "radio", name, id, value: v });
        r.checked = String(v) === String(value);
        r.addEventListener("change", () => r.checked && onChange(v));
        wrap.append(r, el("label", { for: id }, text));
      }
      parent.append(el("div", { class: "ctl" }, el("span", { class: "ctl-label" }, label), wrap));
      return wrap;
    },
    toggle(parent, { id, label, value, onChange }) {
      id = id || `t${++uid}`;
      const cb = el("input", { type: "checkbox", id, role: "switch" });
      cb.checked = !!value;
      cb.addEventListener("change", () => onChange(cb.checked));
      parent.append(el("div", { class: "ctl toggle" }, cb, el("label", { for: id }, label)));
      return cb;
    },
    button(parent, { label, onClick, kind = "" }) {
      const b = el("button", { type: "button", class: `btn ${kind}`, onclick: onClick }, label);
      parent.append(b);
      return b;
    },
  };

  /* ---------- stage ---------- */

  const $ = (s) => document.querySelector(s);
  const stage = $("#stage");
  const frame = $("#frame");
  const canvas = $("#canvas");
  const ctx = canvas.getContext("2d");
  const playBtn = $("#play");
  const scrub = $("#scrub");
  const timeOut = $("#time");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let playing = !reduceMotion;
  let t0 = performance.now();
  let pausedT = 0.18;
  let frozenT = null;

  function phaseNow(now) {
    if (frozenT != null) return frozenT;
    if (!playing) return pausedT;
    return fract((now - t0) / 1000 / common.duration);
  }
  function setPlaying(p) {
    const now = performance.now();
    if (p && !playing) t0 = now - pausedT * common.duration * 1000;
    if (!p && playing) pausedT = phaseNow(now);
    playing = p;
    playBtn.setAttribute("aria-pressed", String(p));
    playBtn.querySelector("span").textContent = p ? "Pause" : "Play";
  }
  playBtn.addEventListener("click", () => setPlaying(!playing));
  scrub.addEventListener("input", () => { setPlaying(false); pausedT = +scrub.value; });
  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target === document.body) { e.preventDefault(); setPlaying(!playing); }
  });

  function sizeCanvas() {
    const box = stage.getBoundingClientRect();
    const a = ASPECTS[common.aspect];
    const maxW = Math.max(120, box.width - 32), maxH = Math.max(120, box.height - 32);
    let w = maxW, h = w / a;
    if (h > maxH) { h = maxH; w = h * a; }
    frame.style.width = `${Math.floor(w)}px`;
    frame.style.height = `${Math.floor(h)}px`;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  new ResizeObserver(sizeCanvas).observe(stage);

  function paint(c2d, W, H, t, state, c, env) {
    c2d.setTransform(1, 0, 0, 1, 0, 0);
    c2d.globalAlpha = 1;
    c2d.fillStyle = c.bg;
    c2d.fillRect(0, 0, W, H);
    c2d.textAlign = "left";
    c2d.textBaseline = "alphabetic";
    if ([...c.word].length) active.render(c2d, W, H, t, state, c, env);
  }

  function tick(now) {
    if (active) {
      const t = phaseNow(now);
      const W = canvas.width, H = canvas.height;
      const env = { live: true, now };
      paint(ctx, W, H, t, protoState[active.id], common, env);
      if (active.overlay) {
        ctx.save();
        active.overlay(ctx, W, H, t, protoState[active.id], common, env);
        ctx.restore();
      }
      if (document.activeElement !== scrub) scrub.value = t;
      const frames = Math.max(2, Math.round(common.duration * common.fps));
      timeOut.textContent =
        `${(t * common.duration).toFixed(2)} / ${common.duration.toFixed(1)} s · frame ${Math.floor(t * frames) + 1}/${frames}`;
    }
    requestAnimationFrame(tick);
  }

  /* pointer forwarding, for prototypes that are played by hand */
  function forward(type, e) {
    if (!active || !active.onPointer) return;
    const r = canvas.getBoundingClientRect();
    const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
    const ny = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (active.onPointer(type, nx, ny, e, api) && type === "down") canvas.setPointerCapture(e.pointerId);
  }
  canvas.addEventListener("pointerdown", (e) => forward("down", e));
  canvas.addEventListener("pointermove", (e) => forward("move", e));
  canvas.addEventListener("pointerup", (e) => forward("up", e));
  canvas.addEventListener("pointercancel", (e) => forward("up", e));

  const api = {
    freeze(t) { frozenT = t; },
    unfreeze() { frozenT = null; },
    setDuration(sec) { durationCtl.set(sec, true); },
    setPlaying,
    restart() { t0 = performance.now(); pausedT = 0; },
    stateOf: (id) => protoState[id],
    common,
    canvas,
  };

  /* ---------- fonts ---------- */

  function loadFont(c = common) {
    const f = fontInfo(c);
    const sample = c.word || "Type";
    return Promise.all([f.min, Math.round((f.min + f.max) / 2), f.max]
      .map((w) => document.fonts.load(`${w} 48px "${f.family}"`, sample))).catch(() => {});
  }

  /* ---------- common controls ---------- */

  const textPanel = $("#text-panel");
  const protoPanel = $("#proto-panel");
  const exportPanel = $("#export-panel");

  const wordInput = $("#word");
  wordInput.value = common.word;
  wordInput.addEventListener("input", () => { common.word = wordInput.value.slice(0, 24); loadFont(); });

  UI.select(textPanel, {
    id: "font", label: "Typeface",
    options: FONTS.map((f) => [f.family, `${f.family}  ${f.min}–${f.max}`]),
    value: common.font,
    onChange: (v) => { common.font = v; loadFont(); },
  });

  const sw = el("div", { class: "swatches", role: "radiogroup", "aria-label": "Colour presets" });
  const colorInputs = {};
  PALETTES.forEach((p, i) => {
    const b = el("button", {
      type: "button", class: "swatch", title: p.name, "aria-label": p.name, role: "radio",
      "aria-checked": String(i === 0), style: `--sw-bg:${p.bg};--sw-fg:${p.fg};--sw-alt:${p.alt}`,
      onclick: () => {
        Object.assign(common, { fg: p.fg, bg: p.bg, alt: p.alt });
        for (const k of ["fg", "bg", "alt"]) colorInputs[k].value = p[k].toLowerCase();
        sw.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-checked", String(s === b)));
      },
    }, el("span", { "aria-hidden": "true" }, "Aa"));
    sw.append(b);
  });
  const colorRow = el("div", { class: "colors" });
  for (const [k, label] of [["fg", "Type"], ["bg", "Ground"], ["alt", "Accent"]]) {
    const id = `color-${k}`;
    const inp = el("input", { type: "color", id, value: common[k].toLowerCase() });
    inp.addEventListener("input", () => {
      common[k] = inp.value;
      sw.querySelectorAll(".swatch").forEach((s) => s.setAttribute("aria-checked", "false"));
    });
    colorInputs[k] = inp;
    colorRow.append(el("label", { class: "color", for: id }, inp, el("span", {}, label)));
  }
  textPanel.append(el("div", { class: "ctl" }, el("span", { class: "ctl-label" }, "Colour"), sw, colorRow));

  /* ---------- loop + export controls ---------- */

  UI.segmented(exportPanel, {
    label: "Frame", options: Object.keys(ASPECTS).map((k) => [k, k]), value: common.aspect,
    onChange: (v) => { common.aspect = v; sizeCanvas(); updateEstimate(); },
  });
  const durationCtl = UI.slider(exportPanel, {
    id: "duration", label: "Loop length", min: 1, max: 8, step: 0.1, value: common.duration,
    fmt: (v) => `${v.toFixed(1)} s`,
    onInput: (v) => {
      const now = performance.now();
      const t = phaseNow(now);
      common.duration = v;
      if (playing) t0 = now - t * v * 1000;
      updateEstimate();
    },
  });
  UI.segmented(exportPanel, {
    label: "Frame rate", options: [[20, "20 fps"], [25, "25 fps"], [50, "50 fps"]], value: common.fps,
    onChange: (v) => { common.fps = +v; updateEstimate(); },
  });
  UI.select(exportPanel, {
    id: "export-width", label: "GIF width",
    options: [[480, "480 px · light"], [720, "720 px"], [1080, "1080 px · heavy"]],
    value: common.exportWidth,
    onChange: (v) => { common.exportWidth = +v; updateEstimate(); },
  });

  const estimate = el("p", { class: "estimate" });
  exportPanel.append(estimate);
  function exportDims() {
    const W = common.exportWidth;
    const H = Math.round(W / ASPECTS[common.aspect] / 2) * 2;
    return { W, H, frames: Math.max(2, Math.round(common.duration * common.fps)) };
  }
  function updateEstimate() {
    const { W, H, frames } = exportDims();
    estimate.textContent = `${W} × ${H} px · ${frames} frames · loops forever`;
  }
  updateEstimate();

  const exportBtn = UI.button(exportPanel, { label: "Render GIF", kind: "primary", onClick: () => runExport() });
  const progress = el("div", { class: "progress", hidden: true },
    el("div", { class: "bar" }, el("i")), el("p", { class: "progress-label", "aria-live": "polite" }));
  const cancelBtn = el("button", { type: "button", class: "btn ghost", onclick: () => { cancelled = true; } }, "Cancel");
  progress.append(cancelBtn);
  exportPanel.append(progress);

  const result = $("#result");
  const resultImg = $("#result-img");
  const resultMeta = $("#result-meta");
  const saveBtn = $("#save");
  const saveNote = $("#save-note");
  $("#result-close").addEventListener("click", () => { result.hidden = true; });

  let cancelled = false;
  let lastGif = null;
  const downloadsCap = window.claude && typeof window.claude.use === "function"
    ? window.claude.use("downloads").catch(() => null) : Promise.resolve(null);

  const nextTick = () => new Promise((r) => setTimeout(r, 0));

  async function runExport() {
    cancelled = false;
    exportBtn.disabled = true;
    progress.hidden = false;
    const bar = progress.querySelector("i");
    const label = progress.querySelector(".progress-label");
    const report = (phase, i, n, frac) => {
      bar.style.width = `${(frac * 100).toFixed(1)}%`;
      label.textContent = `${phase} · frame ${i}/${n}`;
    };

    const c = JSON.parse(JSON.stringify(common));
    const proto = active;
    const state = JSON.parse(JSON.stringify(protoState[proto.id]));
    const { W, H, frames } = exportDims();

    try {
      await loadFont(c);
      const off = document.createElement("canvas");
      off.width = W; off.height = H;
      const octx = off.getContext("2d", { willReadFrequently: true });
      const env = { live: false };
      const frameData = (i) => {
        paint(octx, W, H, i / frames, state, c, env);
        return octx.getImageData(0, 0, W, H).data;
      };

      const hist = new GIF.Histogram();
      for (let i = 0; i < frames; i++) {
        if (cancelled) throw new Error("cancelled");
        hist.add(frameData(i));
        report("Sampling colours", i + 1, frames, (i + 1) / frames * 0.3);
        await nextTick();
      }
      const palette = GIF.buildPalette(hist, 256);
      const enc = new GIF.Encoder(W, H, palette, { loop: 0 });
      for (let i = 0; i < frames; i++) {
        if (cancelled) throw new Error("cancelled");
        // Integer centiseconds that still add up to the exact loop length.
        const delay = Math.round(((i + 1) * 100) / c.fps) - Math.round((i * 100) / c.fps);
        enc.addFrame(frameData(i), delay);
        report("Encoding", i + 1, frames, 0.3 + (i + 1) / frames * 0.7);
        await nextTick();
      }
      const blob = new Blob([enc.finish()], { type: "image/gif" });
      const slug = (c.word || "type").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "type";
      showResult(blob, `${slug}-${proto.id}.gif`, { W, H, frames, colors: palette.length });
    } catch (err) {
      if (err.message !== "cancelled") {
        label.textContent = `Export failed: ${err.message}`;
        console.error(err);
        exportBtn.disabled = false;
        return;
      }
    }
    exportBtn.disabled = false;
    progress.hidden = true;
  }

  function showResult(blob, filename, info) {
    if (lastGif) URL.revokeObjectURL(lastGif.url);
    lastGif = { blob, filename, url: URL.createObjectURL(blob) };
    resultImg.src = lastGif.url;
    resultImg.alt = `Exported GIF of “${common.word}”`;
    const kb = blob.size / 1024;
    const size = kb > 1024 ? `${(kb / 1024).toFixed(2)} MB` : `${Math.round(kb)} KB`;
    resultMeta.textContent = `${filename} · ${info.W}×${info.H} · ${info.frames} frames · ${info.colors} colours · ${size}`;
    saveNote.textContent = "";
    result.hidden = false;
  }

  saveBtn.addEventListener("click", async () => {
    if (!lastGif) return;
    const dl = await downloadsCap;
    if (dl) {
      try {
        await dl.save({ filename: lastGif.filename, data: lastGif.blob });
        saveNote.textContent = "Saved.";
        return;
      } catch (e) {
        if (e && e.code === "declined") { saveNote.textContent = "Save cancelled."; return; }
        if (e && e.code === "rate_limited") { saveNote.textContent = "A save prompt is already open."; return; }
      }
    }
    const a = el("a", { href: lastGif.url, download: lastGif.filename });
    document.body.append(a); a.click(); a.remove();
    saveNote.textContent = "If nothing downloaded, right-click the preview and choose Save image.";
  });

  /* ---------- prototype switching ---------- */

  const tabs = $("#tabs");
  const protoTitle = $("#proto-title");
  const protoBlurb = $("#proto-blurb");

  function activate(id) {
    const p = protos.find((x) => x.id === id) || protos[0];
    if (active && active.unmount) active.unmount(api);
    active = p;
    frozenT = null;
    protoPanel.replaceChildren();
    protoTitle.textContent = p.name;
    protoBlurb.textContent = p.blurb;
    stage.dataset.proto = p.id;
    p.mount(protoPanel, protoState[p.id], api);
    tabs.querySelectorAll("a").forEach((a) => a.setAttribute("aria-current", a.dataset.id === p.id ? "page" : "false"));
  }

  function register(p) {
    protos.push(p);
    protoState[p.id] = JSON.parse(JSON.stringify(p.defaults));
  }

  function boot() {
    protos.forEach((p, i) => {
      tabs.append(el("a", { href: `#${p.id}`, "data-id": p.id },
        el("b", {}, String.fromCharCode(65 + i)), el("span", {}, p.name)));
    });
    const fromHash = () => activate(location.hash.slice(1));
    window.addEventListener("hashchange", fromHash);
    fromHash();
    setPlaying(playing);
    sizeCanvas();
    loadFont();
    requestAnimationFrame(tick);
  }

  window.TypeToy = {
    register, boot, UI, el,
    clamp, lerp, fract, smoothstep, hash,
    fontCss, clampWeight, capHeight, layoutGlyphs, fitSize, fontInfo,
  };
})();
