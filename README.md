# Type as Clay

Three browser prototypes exploring one idea: your hands, tracked through a webcam, shape letterforms in real time. You pinch, stretch, twist and squeeze them.

This is an exploration. The code favours quick, readable and hackable over polished. Every mapping decision is written as a comment at the top of each prototype file, so you can retune it fast.

**Picking this up?** Read [`HANDOFF.md`](HANDOFF.md) for the current state, what's verified, known problems and next steps. Claude Code sessions also read [`CLAUDE.md`](CLAUDE.md) automatically.

## Run it

You need Node.js 20.19 or newer (`.nvmrc` pins 22).

```bash
git clone https://github.com/ACTS-Research/TypeClay.git
cd TypeClay
npm install
npm run dev
```

Open http://localhost:5173 and allow camera access. The index page links to the three prototypes:

- [`/a/`](a/index.html): Axis Sculptor
- [`/b/`](b/index.html): Outline Warp
- [`/c/`](c/index.html): Soft Body

Everything runs offline after `npm install`:
- the hand model is in `public/models/`;
- the Roboto Flex variable font and its OFL licence are in `public/fonts/`;
- the MediaPipe WASM files are copied out of `node_modules` automatically before `dev` and `build` (`scripts/copy-mediapipe-wasm.mjs`).

Other commands:
- `npm run build` type-checks and builds to `dist/`.
- `npm run preview` serves that build.
- `npm run smoke` runs a headless-browser check of all three prototypes using the mouse fallback (the first time, run `npx playwright install chromium`).
- Add `?nocam` to any prototype URL to skip the webcam and use only the mouse.

GitHub Actions runs the build and the smoke test on every push (`.github/workflows/build.yml`).

**Stack:** Vite + vanilla TypeScript, MediaPipe Tasks Vision `HandLandmarker` (2 hands, 21 landmarks each), opentype.js 2.0 and lil-gui.

All three prototypes draw real glyph outlines on Canvas 2D. opentype.js 2.0 applies Roboto Flex's variation data itself, which matters for two reasons:
- Canvas `ctx.font` can't reach XOPQ, YTUC and the other parametric axes; outlines can.
- PNG and SVG export come from the same geometry.

I checked its output against fontTools at extreme axis settings, and it matches exactly.

## Shared controls (all prototypes)

| Key / input | What it does |
|---|---|
| Space | Freeze or unfreeze. This holds the current form so you can let go of a shape you like. |
| C | Capture a PNG, plus an SVG of the outlines. |
| D | Debug overlay: skeleton, L/R labels, pinch ring, roll needle, openness bar, per-hand values, render and tracking FPS. |
| H | Show or hide the key help (it remembers). |
| Word field (top right) | Type to change the word. The default is CLAY. |
| **Tuning** panel | One Euro smoothing, pinch thresholds, the openness range, and each prototype's own settings. Changes are saved locally. |

**Mouse / trackpad fallback.** It builds a fake 21-point hand that goes through exactly the same gesture layer as a real one. The camera takes over whenever it sees a hand.

| Mouse | Hand gesture |
|---|---|
| move | the right hand follows the cursor (the cursor sits between thumb and index) |
| drag | pinch and move |
| scroll | openness (fist ↔ open hand) |
| Shift + drag | twist (roll) |
| Alt + move or drag | the same, for the left hand (it stays where you leave it) |
| L | latch the left hand's pinch, for two-hand gestures with one mouse |
| Esc | hide the left hand |

## The gesture layer (`src/shared/gestures.ts`)

Raw landmarks are smoothed with a One Euro filter, then turned into named signals per hand. Each signal is smoothed again.

| Signal | Definition |
|---|---|
| `pinchDist` | thumb-to-index gap ÷ hand size (wrist → middle knuckle), so distance from the camera doesn't matter. About 0.1 pinched, about 1 open. |
| `pinch` | `pinchDist` with hysteresis: on below 0.28, off above 0.42. `pinchStart` and `pinchEnd` fire on the transition frame. |
| `openness` | average fingertip-to-wrist reach ÷ hand size, mapped from fist (1.05) to open (1.85) → 0..1. |
| `roll` | angle of wrist → middle knuckle against straight up (twisting the hand like a dial). Unwrapped before filtering. |
| `palm`, `palmN` | average of the wrist and four knuckles, in pixels and 0..1. |
| `vel`, `speed` | palm velocity. |
| `handsDist`, `handsDistN` | distance between the palms (keeps the last value when a hand drops out). |

MediaPipe's left/right labels assume a mirrored image. The tracker feeds raw frames, so it swaps them (this is a toggle in the Input folder). It also falls back to screen position when both hands get the same label.

## A · Axis Sculptor (`src/a/main.ts`)

Your hands push Roboto Flex around its own design space. Every frame is a real instance of the font.

| Gesture | Axis | Why |
|---|---|---|
| both hands apart / together | `wdth` 25–151 | stretching is the one gesture that needs two hands |
| right fist ↔ open | `wght` 1000–100 | squeezing makes it dense |
| right tilt clockwise | `slnt` 0 → −10 | lean forward (the font only slants one way) |
| right hand height | `opsz` 8–144 | raising your hand gives the display cut |
| right pinch gap | `XTRA` | closing the pinch squeezes the counters |
| left fist ↔ open | `XOPQ` | fist = fat vertical stems |
| left pinch gap | `YOPQ` | closing the pinch = hairline horizontals |
| left hand height | `YTUC` + `YTLC` | raising your hand gives taller caps and x-height |
| left tilt | `GRAD` | darker or lighter without changing width |

Values hold when your hands leave. A live readout shows each axis, its value and the gesture driving it.

**P** switches to per-letter mode. Each letter drifts toward the hand's target values, weighted by a gaussian falloff from the palm, so you can sculpt a word unevenly. Dots under the letters show each one's influence. **R** resets the axes.

## B · Outline Warp (`src/b/main.ts`)

Glyph contours are flattened and resampled into evenly spaced points (5 px by default), then deformed like liquify.

| Gesture | Effect |
|---|---|
| pinch near the outline | grabs the points within the brush radius, with falloff (1 − (d/r)²)² |
| move while pinched | pulls them. Release and the shape stays. |
| open / close your hand before pinching | sets the brush size (the size locks when the pinch starts) |
| both hands pinch the same letter | stretch / squash. Each point moves by a blend of the two hands' movements, weighted by where it sits between the grab points. Pull apart = stretch, push together = squash, opposite directions = shear. |

Keys:
- **Z** undo (one step per gesture, 50 deep)
- **R** reset (undoable)
- **O** outline + points view

Contours are resampled again on release so point spacing stays even. The starting weight and width are settings. SVG export writes the deformed polygons.

## C · Soft Body (`src/c/main.ts`)

Each letter is a lump of material on a floor, simulated with position-based dynamics at a fixed 120 Hz.

**Structure per letter:**
- edge and bend springs along each contour;
- cross-stroke springs to the 4 nearest points across the stroke, kept only where the spring's midpoint is inside the glyph, so springs never bridge a counter;
- an area (pressure) constraint per contour;
- a weak shape-matching pull toward the rotated rest shape.

| Gesture | Effect |
|---|---|
| whole hand | one solid shape around the 21 landmarks (like a mitten). Moving, it pushes material out of its leading edge, so a palm coming down presses a letter flat; held still, it pushes to the nearest edge |
| a fast swipe | the hand's speed transfers on contact, so letters get knocked over |
| two palms around a letter | squeezes it; the area constraint makes it bulge and push back |
| pinch near a letter | picks it up by the nearest 16 points (carry it, drop it) |

**Plasticity slider:**
- 0 behaves like rubber: everything springs back.
- 1 behaves like clay: once strain passes the yield point, the spring rest lengths and the rest shape move toward the deformed shape.
- Area is never relaxed, so clay keeps its volume.

**The mouse works differently in C on purpose.** A mouse hand can't lift off the table:
- hovering touches nothing;
- dragging from empty space presses the hand down (push, press, swipe);
- dragging that starts on a letter picks it up.

Keys: **R** resets the letters, **V** shows the springs and colliders.

## Project layout

```
index.html, a/ b/ c/index.html   Vite multi-page entries
src/shared/
  app.ts         page shell: stage, word field, keys, GUI, main loop, capture
  tracking.ts    webcam + HandLandmarker → hands in stage pixels
  synthetic.ts   mouse fallback → fake 21-landmark hands
  gestures.ts    landmarks → named, smoothed signals
  oneEuro.ts     One Euro filter
  settings.ts    every shared tunable (bound to the GUI, persisted)
  debug.ts       debug overlay
  font.ts        Roboto Flex via opentype.js: layout, Path2D/SVG, flatten, resample
  capture.ts     PNG/SVG download helpers
src/a|b|c/main.ts   the prototypes (mapping notes at the top of each)
```

Line counts: A is about 200, B about 255, the shared code about 1,100 in total. C is about 520, because the soft body needs its solver; it's the one file over budget.

## Findings

**How this was tested.** The build container has no webcam, so these notes come from:
- headless Chromium with a fake camera, which proved the model loads and runs on the GPU path;
- the mouse fallback, driven by scripts;
- measurements of the simulation (letter sizes before and after each gesture).

They are not from real hands in front of a laptop. Treat "felt good" as "behaves as designed, and looks promising". The real feel needs a session with a camera.

### What worked

- **The gesture layer stays clean.** Normalising by hand size makes pinch and openness independent of distance from the camera. Hysteresis gives pinch a crisp start and end, which both B (grab/release) and C (pick up) depend on.
- **The mouse fallback goes through the real code.** Building a fake hand instead of faking the signals means mouse testing exercises the gesture layer, the debug overlay and C's colliders. That's how most bugs here were found.
- **A:** weight on a fist and width on two hands read straight away. Per-letter mode produces truly uneven words: the C stays regular while the L, A and Y take the hand's values.
- **B:** a single pinch-pull reads exactly like liquify, and the two-hand stretch shears letters convincingly. Resampling on release keeps the edges smooth after big pulls.
- **C:** the plasticity slider makes a clear, measurable difference. After the same press, the C returns to within 2 px of its original shape at plasticity 0 and keeps a dent of about 37 px at plasticity 1. The area constraint makes squeezed letters bulge instead of vanishing. Letters pile up, fall over and slump in a way that reads as clay.

### What didn't, or needs work

- **A:** Roboto Flex's parametric axes break their joins when pushed to opposite extremes together (for example hairline verticals with fat horizontals). That's the font itself; fontTools renders the same broken shapes. There's now a "parametric range" setting (default 70%) that limits how far those axes travel.
- **B:** the brush can catch two neighbouring letters at once. Contours can fold over themselves, and the fill then looks odd. (A fast grab used to land behind where you pinched; pinch on/off now skips one smoothing stage, so it registers about 80 ms after the fingers close instead of about 200 ms.)
- **C, lifting:** a lifted letter stretches like taffy, because only the grabbed points are pulled and position-based solvers spread a pull slowly through a body.
- **C, tangling:** letters are hollow outlines. A hand pressing hard into a letter with a closed counter (O, A, B) can push the inner contour through the outer one, and then even rubber can't spring back (3 of 5 presses on an O). The fix is an interior triangle mesh; see HANDOFF.md for the measurements.
- **C, toppling:** tall thin letters (L, I, T) tend to topple rather than compress when pressed from above.
- **C, contact:** contact between letters is point-to-point, so at high speed letters can pass through each other.
- **C, input spikes:** a sudden jump in hand position (a tracking glitch, or a scripted mouse) used to send letters flying. Point speed is now capped.
- **Speed:** MediaPipe runs synchronously on the main thread, so its time per frame is added to every frame. Drawing alone holds 60 fps with a 9-letter word in all three prototypes. With the camera on, a laptop GPU should land somewhere between 30 and 60 fps; I couldn't measure that here.

### Ideas for next steps

1. **Record and replay hand streams.** `?inject` already lets code feed hand data in. Recording real sessions to JSON would make tuning repeatable and allow regression tests.
2. Move detection into a Web Worker so tracking never steals frame time.
3. Use landmark depth (`z`) as "hand on the table" in C, instead of treating every visible hand as solid.
4. Combine A and B: warp outlines on top of a live axis instance (pose the font with A, then hand-finish the result in B).
5. C: fill each glyph with interior points (a triangulated mesh) for better volume and grabbing, and add soft shading so it reads as material.
6. Export a short GIF or video of a session, not just stills.
