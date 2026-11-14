// Smoke test: starts Vite, opens each prototype in headless Chromium with the
// camera off (?nocam) and the test hooks on (?inject), drives it with the
// mouse fallback, and checks the result. Exits non-zero on any failure.
//
//   npm run smoke            (first time: npx playwright install chromium)
//
// This proves the code paths work. It cannot judge how real hands feel.
import { createServer } from "vite";
import { chromium } from "playwright";

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

const server = await createServer({ server: { port: 5199, strictPort: true }, logLevel: "error" });
await server.listen();
const base = "http://localhost:5199";
const browser = await chromium.launch();

async function open(path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${base}${path}`);
  await page.waitForFunction(() => window.__clay?.app?.W > 0, null, { timeout: 15000 });
  await page.waitForTimeout(800);
  const box = await (await page.$("#overlay")).boundingBox();
  const at = (x, y) => [box.x + x, box.y + y];
  return { page, errors, at };
}

const fps = (page) => page.evaluate(() => new Promise((r) => {
  let n = 0; const t0 = performance.now();
  const f = () => { n++; performance.now() - t0 < 1000 ? requestAnimationFrame(f) : r(n); };
  requestAnimationFrame(f);
}));

try {
  // ---- index
  {
    const page = await browser.newPage();
    await page.goto(base);
    check("index lists three prototypes", (await page.$$("main a")).length === 3);
    await page.close();
  }

  // ---- shared gesture layer, via the mouse fallback
  {
    const { page, errors, at } = await open("/a/?nocam&inject");
    const sig = () => page.evaluate(() => {
      const s = window.__clay.app.signals;
      return { src: s.source, pinch: s.right.pinch, open: s.right.openness, roll: s.right.roll, L: s.left.present, pp: s.right.pinchPoint };
    });
    await page.mouse.move(...at(700, 400)); await page.waitForTimeout(400);
    let s = await sig();
    check("mouse fallback drives the right hand", s.src === "mouse" && Math.abs(s.pp.x - 700) < 3 && Math.abs(s.pp.y - 400) < 3);
    await page.mouse.down(); await page.waitForTimeout(400);
    check("drag = pinch (with hysteresis)", (await sig()).pinch === true);
    await page.mouse.up(); await page.waitForTimeout(400);
    check("release ends the pinch", (await sig()).pinch === false);
    for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 150); await page.waitForTimeout(30); }
    await page.waitForTimeout(500);
    s = await sig();
    check("scroll = openness", s.open < 0.1, `openness ${s.open.toFixed(2)}`);
    await page.keyboard.down("Shift"); await page.mouse.down();
    await page.mouse.move(...at(780, 400), { steps: 6 }); await page.mouse.up(); await page.keyboard.up("Shift");
    await page.waitForTimeout(500);
    check("shift-drag = roll", (await sig()).roll > 0.3);
    await page.keyboard.down("Alt"); await page.mouse.move(...at(300, 450), { steps: 4 }); await page.keyboard.up("Alt");
    await page.waitForTimeout(400);
    check("alt = left hand", (await sig()).L === true);

    // ---- A: axis values follow the gestures
    const read = async () => Object.fromEntries((await page.textContent(".readout")).split("\n").slice(1)
      .map((l) => l.trim().split(/\s+/)).map(([tag, v]) => [tag, +v]));
    const axes = await read();
    check("A: fist -> heavy wght", axes.wght > 900, `wght ${axes.wght}`);
    check("A: twist -> slnt", axes.slnt < -3, `slnt ${axes.slnt}`);
    check("A: two hands -> wdth set", axes.wdth > 25 && axes.wdth < 151, `wdth ${axes.wdth}`);
    check("A: 30+ fps", (await fps(page)) >= 30);
    check("A: no console errors", errors.length === 0, errors[0]);
    await page.close();
  }

  // ---- B: pulling the outline changes the art, undo restores it
  {
    const { page, errors, at } = await open("/b/?nocam&inject");
    const snap = () => page.evaluate(() => document.querySelector("#art").toDataURL());
    await page.mouse.move(...at(1200, 120)); await page.waitForTimeout(300);
    const before = await snap();
    await page.mouse.move(...at(330, 285), { steps: 3 }); await page.mouse.down(); await page.waitForTimeout(200);
    await page.mouse.move(...at(250, 140), { steps: 12 }); await page.mouse.up(); await page.waitForTimeout(300);
    const after = await snap();
    check("B: pinch-pull deforms the outline", before !== after);
    await page.keyboard.press("z"); await page.waitForTimeout(300);
    check("B: Z undoes it", (await snap()) === before);
    check("B: 30+ fps", (await fps(page)) >= 30);
    check("B: no console errors", errors.length === 0, errors[0]);
    await page.close();
  }

  // ---- C: hover touches nothing; a press dents; plasticity decides if it recovers
  {
    const { page, errors, at } = await open("/c/?nocam&inject");
    const boxes = () => page.evaluate(() => window.__soft.boxes());
    const start = await boxes();
    await page.mouse.move(...at(100, 650)); await page.mouse.move(...at(1200, 650), { steps: 30 });
    await page.mouse.move(...at(1200, 100), { steps: 5 }); await page.waitForTimeout(600);
    const hover = await boxes();
    check("C: hovering mouse hand touches nothing", hover.every((b, i) => Math.abs(b.h - start[i].h) <= 2 && Math.abs(b.x - start[i].x) <= 2));
    // Press the C from above, then measure deformation (px from its original shape after
    // best-fit rotation, so sliding or toppling doesn't count). The C is used because it's
    // wide and has no closed counter; see HANDOFF.md for why an O can tangle.
    for (const [plasticity, expectRecover] of [[0, true], [1, false]]) {
      await page.keyboard.press("r"); await page.waitForTimeout(800);
      await page.evaluate((v) => (window.__soft.params.plasticity = v), plasticity);
      const C = (await boxes())[0];
      await page.mouse.move(...at(C.x, C.y - C.h - 120)); await page.waitForTimeout(200);
      await page.mouse.down(); await page.waitForTimeout(150);
      await page.mouse.move(...at(C.x, C.y - C.h * 0.5), { steps: 40 }); await page.waitForTimeout(400);
      await page.mouse.move(...at(C.x, 100), { steps: 15 }); await page.mouse.up(); await page.waitForTimeout(2500);
      const d = (await page.evaluate(() => window.__soft.deformation()))[0];
      const ok = expectRecover ? d < 10 : d > 15;
      check(`C: plasticity ${plasticity} -> ${expectRecover ? "springs back" : "keeps the dent"}`, ok, `deformation ${d}px`);
    }
    check("C: 30+ fps", (await fps(page)) >= 30);
    check("C: no console errors", errors.length === 0, errors[0]);
    await page.close();
  }
} catch (e) {
  check("smoke run completed", false, e.message);
} finally {
  await browser.close();
  await server.close();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
