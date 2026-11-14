# CLAUDE.md

Guidance for Claude Code sessions working in this repo. Read `HANDOFF.md` for the project's current state and open problems; `README.md` is the user-facing guide.

## What this is

"Type as Clay": three browser prototypes where webcam-tracked hands shape letterforms. It's an exploration. Favour quick, legible, hackable code over polish. One Vite app, four pages:

- `/` index
- `/a/` Axis Sculptor: hands drive Roboto Flex's variable axes
- `/b/` Outline Warp: glyph contours as a liquify mesh
- `/c/` Soft Body: letters as position-based soft bodies on a floor

The user is a designer who stays out of the terminal. Run commands yourself and explain results in plain language.

## Commands

```bash
npm install          # Node >= 20.19 (see .nvmrc)
npm run dev          # http://localhost:5173 ; predev copies MediaPipe wasm into public/mediapipe
npm run build        # tsc --noEmit + vite build -> dist/
npm run typecheck
npm run smoke        # headless browser test of all three prototypes (first time: npx playwright install chromium)
```

`?nocam` on any prototype URL skips the webcam (mouse only). `?inject` exposes test hooks (see below). CI (`.github/workflows/build.yml`) runs build + smoke on every push.

## Architecture

```
src/shared/
  app.ts         page shell + main loop. A prototype is an object implementing `Prototype`
                 (init/update/draw, optional drawUI/onKey/onWord/onResize/toSVG) passed to run().
  tracking.ts    webcam + MediaPipe HandLandmarker -> HandFrame[] in stage px (object-fit: cover, mirrored)
  synthetic.ts   mouse fallback: builds a FAKE 21-landmark hand, so it goes through the same pipeline
  gestures.ts    landmarks -> named signals (pinch, openness, roll, palm, velocity, two-hand distance)
  oneEuro.ts     One Euro filter; params objects are shared by reference so GUI edits apply live
  settings.ts    every shared tunable (bound to lil-gui, persisted to localStorage)
  font.ts        Roboto Flex via opentype.js 2.0: layoutWord, Path2D/SVG, flatten, resampleClosed
  debug.ts       D overlay; capture.ts  PNG/SVG download
src/a|b|c/main.ts   one file per prototype
```

Frame flow: `tracker.detect()` (camera wins when it sees hands) or `mouse.frames()` -> `GestureLayer.update()` -> `proto.update(dt, signals)` -> `proto.draw(art ctx)` -> overlay canvas: `proto.drawUI()` (preview only, never captured) + debug.

## Conventions

- **Mapping decisions live in a comment block at the top of each prototype file** (which gesture drives what and why). Update that block whenever you change a mapping. That's the user's main way to retune.
- Prototypes stay self-contained and import only from `src/shared`. Put a tunable in the prototype's `params` + GUI folder, or in `settings.ts` if it's shared.
- Keep prototypes to a few hundred lines where possible (C is the exception: it carries a solver).
- Anything drawn for feedback (cursors, brush rings, influence dots) goes in `drawUI`, so PNG/SVG captures stay clean.
- Shared keys: Space freeze, C capture, D debug, H help, L/Esc (mouse left hand). Prototype keys go through `onKey` and must not reuse these.
- Commit messages: imperative summary + short body.

## Gotchas (each cost real debugging time)

- **opentype.js 2.0 transformed glyphs lose `unitsPerEm`.** `font.variation.getTransform(glyph, coords).getPath(x, y, size)` scales as if the font were 1000 units per em. Always pass `{ xScale: size / font.unitsPerEm, yScale: ... }`; `layoutWord` does this. Roboto Flex is **2048** upm.
- opentype.js 2.0 output matches fontTools exactly. If Roboto Flex looks broken at extreme parametric settings (XOPQ/YOPQ/XTRA...), that's the font. Check with fontTools before "fixing" rendering.
- **MediaPipe handedness** assumes a mirrored image; we feed raw frames, so labels are swapped (`settings.input.swapHands`). Duplicate labels fall back to screen position.
- `detectForVideo` is synchronous on the main thread; its cost lands on every frame.
- **Pinch on/off uses `rawPinch`** (landmarks smoothed once), not the double-smoothed `pinchDist`. The double-smoothed value lagged about 200 ms, which made grabs land in the wrong place. Keep `pinchDist` for continuous mappings only.
- lil-gui 0.21's root class is `.lil-root` (not `.root`).
- `[hidden]` needs `display: none !important` in CSS, or a `display: grid` rule overrides it.
- `public/mediapipe/` is generated (gitignored); `public/models/hand_landmarker.task` and `public/fonts/` are committed.
- **C (soft body): letters are hollow outlines.** Colliders that get inside a stroke can push one contour through another, and a tangled letter can't spring back. See HANDOFF.md before changing C's collision code.

## Verifying changes

1. `npm run typecheck`.
2. `npm run smoke`. It must stay green; extend it when you add behaviour.
3. For visual changes, screenshot with Playwright (headless Chromium) via `?nocam&inject`, and look at the result.
4. Test hooks under `?inject`:
   - `window.__clay.inject(frames | null)` feeds HandFrames as if from the camera;
   - `window.__clay.app` gives the live app and signals;
   - `window.__soft` (C only) has `params`, `boxes()`, `deformation()` (px from the original shape after best-fit rotation; ignores sliding and toppling) and `state()`.
5. This container-style environment has no real webcam. With `--use-fake-device-for-media-stream`, Chromium proves the model loads and runs, but **feel can only be judged with real hands.** Say so honestly in summaries.
