# Type Toy

A kinetic type toy for designers. Type a word, shape its motion, export a looping GIF.

Open `index.html` in a browser. There's no build step and no dependencies apart from Google Fonts. The scripts are plain `<script>` tags, so opening it as a `file://` page works too.

## Three prototypes

All three use the same shell: word, typeface, colour, loop length, frame rate and GIF export. They differ in how you control the motion. Switch between them with the A / B / C tabs, or link to `#wave`, `#tween` or `#echo`.

| | Prototype | How you control it | Question it answers |
|---|---|---|---|
| A | **Wave** | Classic slider panel. A signal (wave, pulse, snap, flicker) travels letter to letter and drives weight, size, lift and tilt. | Are well-labelled sliders enough? |
| B | **Tween** | Two keyframes, A and B, plus an easing curve, stagger and hold. Grabbing an A or B slider pins the stage on that pose. | Do designers want to think in poses and easing, the way After Effects works? |
| C | **Echo** | Performed by hand. Drag on the stage: up is heavier, right is wider. On release the gesture becomes the loop, replayed down a stack of rows with a delay. | Is performing motion more fun and more expressive than dialling it in? |

## How it works

- Every prototype renders a frame as a pure function of loop phase `t ∈ [0, 1)`. The preview and the export draw identical frames, and loops close without a seam.
- Weight changes use variable fonts (Roboto Flex, Fraunces, Bricolage Grotesque and others) drawn on canvas. Each glyph is measured every frame, so heavier letters push their neighbours aside.
- `js/gif.js` is a small GIF89a encoder with no dependencies. It makes two passes so memory stays flat: first a colour histogram across all frames, then median cut to one shared 256-colour palette, then LZW. There's no dithering, so anti-aliased edges don't shimmer between frames.

```
index.html          page, styles, layout
js/shell.js         shared state, controls kit, stage loop, export
js/gif.js           GIF encoder
js/proto-wave.js    A
js/proto-tween.js   B
js/proto-echo.js    C
```

## Adding a prototype

Call `TypeToy.register({ id, name, blurb, defaults, mount(panel, state, api), render(ctx, W, H, t, state, common, env) })`. You can also add `overlay()`, which draws on the preview only, and `onPointer()` for stage input. Then add a `<script>` tag before `TypeToy.boot()`.
