# Handoff: Type as Clay

Status as of 14 November 2026. All work is on `main`, the repo's default branch, so a plain `git clone` gets this code.

## In one paragraph

Three working browser prototypes in one Vite + TypeScript app, all sharing a hand-tracking foundation (MediaPipe HandLandmarker → One Euro smoothing → named gesture signals), with a mouse fallback that produces the same signals.
- **A** maps gestures onto Roboto Flex's 13 variable axes.
- **B** turns glyph outlines into a pinch-and-pull liquify mesh.
- **C** simulates letters as soft bodies you can press, squeeze, swipe and pick up.

Everything builds, type-checks, and passes an automated browser smoke test. **Nobody has used it with real hands yet.** The build environment has no webcam, so "feel" is unverified, and that's the most important next step.

## Getting it running (no terminal needed for the person)

The repo is **public**, so anyone can clone and run it. A GitHub collaborator invite is only needed to **push** changes.

From a Claude Code session on the machine that has the webcam (for example the Claude desktop app), ask:

> Clone https://github.com/ACTS-Research/type-toy.git into my Documents folder, run `npm install`, then `npm run dev`, and open http://localhost:5173 in my browser. Install Node.js LTS first if it's missing.

Allow camera access when the browser asks.

## Where things are

See `CLAUDE.md` for the architecture map, commands, conventions and gotchas, and `README.md` for user-facing controls. Each prototype's gesture mappings are documented in the comment block at the top of `src/a|b|c/main.ts`.

## What's verified, and how

| Claim | Evidence |
|---|---|
| Builds and type-checks | `npm run build` (CI runs it on every push) |
| HandLandmarker loads and runs (GPU, with CPU fallback) | headless Chromium with a fake camera device; tracking loop ran and frames were processed |
| Gesture signals respond correctly | `npm run smoke`, using the mouse fallback: pinch hysteresis, openness, roll, left hand, two-hand distance |
| A: fist → heavy weight, twist → slant, two hands → width; per-letter mode | smoke test + screenshots |
| A: outlines are correct at extreme axis settings | compared with fontTools: identical |
| B: pinch-pull deforms, Z undoes exactly, SVG export matches | smoke test + rendered SVG |
| C: hovering mouse never disturbs letters; plasticity 0 recovers, 1 keeps the dent | smoke test, using the `deformation()` metric |
| 60 fps with a 9-letter word in all three, camera off | headless measurement (software rendering) |

**Not verified:**
- real hands;
- frame rate with the camera on, on real hardware;
- Safari and Firefox (only Chromium was tested);
- touch devices.

## Decisions worth knowing (and why)

- **One renderer for all three: opentype.js 2.0 outlines on Canvas 2D.** Canvas `ctx.font` can't set parametric axes; outlines can, and they give true SVG export in every prototype. opentype.js 2.0 applies variation data (gvar/HVAR) itself.
- **The mouse builds a fake hand instead of faking signals.** Mouse testing then exercises the real gesture layer, debug overlay and colliders. Most bugs were found this way.
- **Pinch on/off uses once-smoothed landmarks (`rawPinch`).** Using the twice-smoothed value added about 200 ms of lag, so grabs landed in the wrong place. Fixed during handoff review; this also improves B.
- **A's parametric axes go through a range limiter (default 70%).** At opposite extremes Roboto Flex's joins genuinely break.
- **C's mouse mode is deliberately different.** Hovering touches nothing (a mouse can't lift off the table). Dragging from empty space pushes; dragging that starts on a letter picks it up.
- **The hand model, font and WASM are local.** It runs offline; the model is committed (7.8 MB) and the WASM is copied from `node_modules` before dev/build.

## Known problems (most important first)

1. **C: hollow letters can tangle.** Letters are outlines with springs, not filled meshes. A hand pressing hard into a letter with a counter (O, A, B…) can push the inner contour through the outer one; the springs are then satisfied in the tangled shape, so even "rubber" can't spring back. Measured during review, as deformation in px after the same press with the mouse hand, 5 tries each:

   | Collider design | O, rubber | O, clay | C, rubber | C, clay |
   |---|---|---|---|---|
   | first version: a few big circles | 0–1 (never tangles) | 8–12 | 1 | 9 |
   | **current: one solid shape per hand** | 0–48 (**tangled 3 of 5**) | 40–50 | recovers (80 → 3) | holds ~37 |

   The big circles never tangled because they hardly deformed anything. The solid hand actually shapes material, so it was kept. A third try (a cloud of small circles) let outlines slip through the gaps and was dropped.
   **Real fix:** give each glyph an interior triangle mesh (constrained Delaunay of the outline) with triangle-area/anti-inversion constraints, so contours can't cross. That's the biggest single improvement available.
2. **C: tall thin letters topple instead of compressing** when pressed from above unless the hand is dead-centre. That's physically honest, but it makes "press flat" unreliable on L, I, T.
3. **C: lifted letters stretch like taffy.** Only the grabbed points are pulled, and position-based solvers spread a pull slowly through a body. Raising iterations or adding interior structure (see 1) helps.
4. **C: letter-to-letter contact is point-to-point**, so fast letters can pass through each other.
5. **B: contours can fold over themselves** after big pulls, and the fill then looks wrong. The brush can also grab two neighbouring letters at once.
6. **Speed:** MediaPipe runs synchronously on the main thread. On a laptop, expect 30–60 fps with the camera on (unmeasured).
7. Minor: the camera preview is always shown mirrored even if `mirror` is off. B keeps its letters where they are on window resize (by design, to keep deformations), so they can end up off-centre.

## Suggested next steps

1. **First real-hands session.** Run all three with the debug overlay on (D). Tune these in the Tuning panel (values persist per browser):
   - pinch thresholds;
   - openness range (fist/open ratios);
   - One Euro `minCutoff` / `beta`.

   Note what feels good; update the mapping comment blocks.
2. **Record and replay hand data.** Save real landmark streams to JSON and replay them through `window.__clay.inject()`. That makes tuning repeatable and lets the smoke test use real gestures.
3. C: interior triangle mesh (fixes known problems 1, 3 and partly 4).
4. Move detection into a Web Worker.
5. Combine A and B: pose the font with A, then hand-finish it with B.
6. Session export as GIF or video.

## Housekeeping

- The first commit on the branch is an earlier, unrelated "Type Toy" GIF prototype, replaced by this project. A claude.ai artifact published from that earlier version still exists and is now stale.
