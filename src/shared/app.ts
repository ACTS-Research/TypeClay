// Page shell shared by every prototype: stage canvas, word field, camera,
// gesture layer, GUI, keys (Space freeze, C capture, D debug, H help).
import GUI from "lil-gui";
import type { Font } from "opentype.js";
import { download, stamp } from "./capture";
import { drawDebug } from "./debug";
import { loadFont } from "./font";
import { GestureLayer } from "./gestures";
import { loadSettings, saveSettings, settings } from "./settings";
import { MouseHands } from "./synthetic";
import { HandTracker } from "./tracking";
import type { HandFrame, Signals } from "./types";
import "./style.css";

export interface App {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  word: string;
  frozen: boolean;
  signals: Signals;
  gui: GUI;
  font: Font;
  toast(msg: string): void;
}

export interface Prototype {
  title: string;
  /** extra key help, e.g. ["Z  undo", "R  reset"] */
  help: string[];
  init(app: App): void;
  /** Called every frame. Respect app.frozen yourself (some prototypes keep animating). */
  update(dt: number, s: Signals, app: App): void;
  draw(ctx: CanvasRenderingContext2D, app: App): void;
  /** Optional preview-only layer (cursors, brush rings). Never part of captures. */
  drawUI?(ctx: CanvasRenderingContext2D, app: App): void;
  onWord?(word: string, app: App): void;
  onResize?(app: App): void;
  onKey?(e: KeyboardEvent, app: App): boolean;
  toSVG?(app: App): string;
}

const SHARED_HELP = [
  "Space  freeze / unfreeze",
  "C  capture PNG (+ SVG)",
  "D  debug overlay",
  "H  hide this help",
  "— mouse fallback —",
  "drag  pinch-move (right hand)",
  "scroll  openness",
  "shift-drag  twist",
  "alt + move/drag  left hand",
  "L  latch left pinch · Esc hide left",
];

export async function run(proto: Prototype) {
  loadSettings();
  document.title = `${proto.title} · Type as Clay`;
  document.body.innerHTML = `
    <header class="bar">
      <a class="home" href="../">Type as Clay</a>
      <span class="proto">${proto.title}</span>
      <label class="word"><span>Word</span><input id="word" maxlength="14" spellcheck="false" autocomplete="off"></label>
      <span id="chip" class="chip"></span>
    </header>
    <main id="stage">
      <canvas id="art"></canvas>
      <canvas id="overlay"></canvas>
      <div id="preview"></div>
      <pre id="help"></pre>
      <div id="toast" hidden></div>
    </main>`;

  const stage = document.getElementById("stage")!;
  const canvas = document.getElementById("art") as HTMLCanvasElement;
  const overlay = document.getElementById("overlay") as HTMLCanvasElement;
  const octx = overlay.getContext("2d")!;
  const ctx = canvas.getContext("2d")!;
  const chip = document.getElementById("chip")!;
  const help = document.getElementById("help")!;
  const toastEl = document.getElementById("toast")!;
  const wordInput = document.getElementById("word") as HTMLInputElement;
  help.textContent = [...SHARED_HELP, "— this prototype —", ...proto.help].join("\n");
  try { help.hidden = localStorage.getItem("type-as-clay:help") === "hidden"; } catch { /* storage blocked */ }

  const tracker = new HandTracker();
  document.getElementById("preview")!.append(tracker.video);
  const mouse = new MouseHands(overlay);
  const gestures = new GestureLayer();
  const font = await loadFont();

  let toastTimer = 0;
  const gui = new GUI({ container: stage, title: "Tuning" });
  const app: App = {
    canvas, ctx, W: 0, H: 0, word: "CLAY", frozen: false, font, gui,
    signals: gestures.update([], "none", 0, 1, 1),
    toast(msg) {
      toastEl.textContent = msg;
      toastEl.hidden = false;
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => (toastEl.hidden = true), 1800);
    },
  };
  wordInput.value = app.word;

  // ---- GUI: shared folders, closed by default so the prototype folder leads
  const fIn = gui.addFolder("Input");
  fIn.add({ toggle: () => (tracker.status === "running" ? tracker.stop() : tracker.start()) }, "toggle").name("camera on / off");
  fIn.add(settings.input, "mirror");
  fIn.add(settings.input, "swapHands").name("swap L/R labels");
  fIn.add(settings.input, "preview").name("camera preview");
  fIn.add(settings.input, "debug").name("debug overlay (D)").listen();
  const fSm = gui.addFolder("Smoothing (One Euro)");
  fSm.add(settings.landmarks, "minCutoff", 0.05, 8, 0.05).name("landmarks minCutoff");
  fSm.add(settings.landmarks, "beta", 0, 60, 0.5).name("landmarks beta");
  fSm.add(settings.signals, "minCutoff", 0.05, 8, 0.05).name("signals minCutoff");
  fSm.add(settings.signals, "beta", 0, 10, 0.05).name("signals beta");
  fSm.add(settings.velocity, "minCutoff", 0.05, 10, 0.05).name("velocity minCutoff");
  const fG = gui.addFolder("Gestures");
  fG.add(settings.gestures, "pinchOn", 0.05, 0.8, 0.01).name("pinch on <");
  fG.add(settings.gestures, "pinchOff", 0.1, 1, 0.01).name("pinch off >");
  fG.add(settings.gestures, "fistRatio", 0.6, 1.6, 0.01).name("fist ratio");
  fG.add(settings.gestures, "openRatio", 1.2, 2.6, 0.01).name("open ratio");
  for (const f of [fIn, fSm, fG]) f.close();
  gui.onFinishChange(saveSettings);

  // ---- sizing
  const resize = () => {
    const r = stage.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    app.W = r.width;
    app.H = r.height;
    for (const c of [canvas, overlay]) {
      c.width = Math.round(r.width * dpr);
      c.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    proto.onResize?.(app);
  };
  new ResizeObserver(resize).observe(stage);
  resize();

  // ---- keys
  wordInput.addEventListener("input", () => {
    app.word = wordInput.value.trim() || "CLAY";
    proto.onWord?.(app.word, app);
  });
  wordInput.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === "Escape") wordInput.blur(); });
  addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement)?.tagName === "INPUT") return;
    if (e.metaKey || e.ctrlKey) return;
    if (proto.onKey?.(e, app)) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space") { e.preventDefault(); app.frozen = !app.frozen; app.toast(app.frozen ? "Frozen. Space to release" : "Released"); }
    else if (k === "c") capture();
    else if (k === "d") { settings.input.debug = !settings.input.debug; saveSettings(); }
    else if (k === "h") {
      help.hidden = !help.hidden;
      try { localStorage.setItem("type-as-clay:help", help.hidden ? "hidden" : "shown"); } catch { /* ignore */ }
    }
  });

  function capture() {
    const name = `clay-${proto.title.toLowerCase().replace(/\W+/g, "-")}-${stamp(app.word)}`;
    canvas.toBlob((b) => b && download(b, `${name}.png`), "image/png");
    const svg = proto.toSVG?.(app);
    if (svg) download(new Blob([svg], { type: "image/svg+xml" }), `${name}.svg`);
    app.toast(svg ? "Saved PNG + SVG" : "Saved PNG");
  }

  // ---- test hook: ?inject lets automated tests feed hand frames as if from the camera
  const injected: { frames: HandFrame[] | null } = { frames: null };
  if (new URLSearchParams(location.search).has("inject")) {
    (window as unknown as { __clay: unknown }).__clay = {
      inject: (f: HandFrame[] | null) => (injected.frames = f),
      app,
    };
  }

  proto.init(app);
  gui.close(); // collapsed by default so it doesn't cover the art; click "Tuning"
  // ?nocam skips the webcam (mouse only); handy for quick tuning and tests
  if (settings.input.camera && !new URLSearchParams(location.search).has("nocam")) tracker.start();

  // ---- loop
  let last = performance.now();
  let fps = 60, fpsN = 0, fpsT = last;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    fpsN++;
    if (now - fpsT > 500) { fps = (fpsN * 1000) / (now - fpsT); fpsN = 0; fpsT = now; }

    // Camera wins whenever it sees a hand; otherwise the mouse drives.
    const cam = tracker.detect(now, app.W, app.H);
    const synth = mouse.frames(dt, app.H);
    let frames: HandFrame[] = [];
    let source: Signals["source"] = "none";
    if (injected.frames) { frames = injected.frames; source = "camera"; }
    else if (cam.length) { frames = cam; source = "camera"; }
    else if (synth.length) { frames = synth; source = "mouse"; }
    app.signals = gestures.update(frames, source, now / 1000, app.W, app.H);

    proto.update(dt, app.signals, app);
    ctx.save();
    proto.draw(ctx, app);
    ctx.restore();

    octx.clearRect(0, 0, app.W, app.H);
    if (proto.drawUI) { octx.save(); proto.drawUI(octx, app); octx.restore(); }
    if (settings.input.debug) {
      drawDebug(octx, app.signals, {
        renderFps: fps, trackFps: tracker.fps, W: app.W,
        status: tracker.status === "running" ? `camera ${tracker.delegate}` : tracker.status === "error" ? "camera unavailable" : `camera ${tracker.status}`,
      });
    }

    const camText = tracker.status === "running" ? "camera" : tracker.status === "loading" ? "starting camera…" : "mouse";
    chip.textContent = app.frozen ? "FROZEN" : app.signals.source === "camera" ? "hands" : camText;
    chip.dataset.state = app.frozen ? "frozen" : app.signals.source;
    chip.title = tracker.error;
    (document.getElementById("preview") as HTMLElement).hidden = !(settings.input.preview && tracker.status === "running");
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
