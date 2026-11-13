// Mouse / trackpad fallback. Instead of faking the *signals*, it builds a
// fake 21-landmark hand, so it flows through exactly the same gesture layer,
// debug overlay and colliders as a real tracked hand.
//
//   move            right hand follows the cursor (cursor = between thumb and index tips)
//   drag            right hand pinches while dragging
//   scroll          openness (fist <-> open)
//   shift + drag    roll (twist) the hand
//   alt + move/drag same, for the LEFT hand (it stays where you leave it)
//   L               latch the left hand's pinch on/off (for two-hand gestures)
//   Esc             hide the left hand
import type { HandFrame, Pt, Side } from "./types";

interface VHand {
  visible: boolean;
  pos: Pt;
  openness: number;
  roll: number;
  pinch: boolean;
  pinchAmt: number; // animated 0..1 so pinch distance crosses the hysteresis band smoothly
}

const newHand = (x: number, y: number): VHand => ({
  visible: false, pos: { x, y }, openness: 0.85, roll: 0, pinch: false, pinchAmt: 0,
});

// Hand skeleton in "hand units" (1 = wrist to middle knuckle), right hand,
// palm facing the camera, mirror view: thumb points toward screen-left.
const MCP: Pt[] = [{ x: -0.3, y: -0.4 }, { x: -0.08, y: -0.45 }, { x: 0.13, y: -0.42 }, { x: 0.32, y: -0.33 }];
const FINGER_ANGLE = [-0.17, -0.03, 0.1, 0.24]; // radians from vertical, fanned
const FINGER_SEGS = [[0.42, 0.26, 0.22], [0.48, 0.29, 0.24], [0.44, 0.27, 0.22], [0.34, 0.21, 0.19]];
const THUMB: Pt[] = [{ x: -0.28, y: 0.32 }, { x: -0.5, y: 0.1 }, { x: -0.66, y: -0.1 }, { x: -0.8, y: -0.3 }];
const WRIST: Pt = { x: -0.05, y: 0.55 };

function buildHand(h: VHand, side: Side, size: number): Pt[] {
  const o = 0.08 + 0.92 * h.openness; // finger extension (fist = fingertips near knuckles)
  const local: Pt[] = new Array(21);
  local[0] = { ...WRIST };
  THUMB.forEach((p, i) => {
    const k = i === 0 ? 1 : 0.55 + 0.45 * o;
    local[1 + i] = { x: WRIST.x + (p.x - WRIST.x) * k, y: WRIST.y + (p.y - WRIST.y) * k };
  });
  for (let f = 0; f < 4; f++) {
    const base = 5 + f * 4;
    let p = { ...MCP[f] };
    local[base] = p;
    const a = FINGER_ANGLE[f];
    for (let j = 0; j < 3; j++) {
      const len = FINGER_SEGS[f][j] * o;
      p = { x: p.x + Math.sin(a) * len, y: p.y - Math.cos(a) * len };
      local[base + 1 + j] = p;
    }
  }
  // pinch: pull thumb tip and index tip together around their midpoint
  const t4 = local[4], t8 = local[8];
  const mid = { x: (t4.x + t8.x) / 2, y: (t4.y + t8.y) / 2 };
  const k = h.pinchAmt * 0.94;
  local[4] = { x: t4.x + (mid.x - t4.x) * k, y: t4.y + (mid.y - t4.y) * k };
  local[8] = { x: t8.x + (mid.x - t8.x) * k, y: t8.y + (mid.y - t8.y) * k };
  local[3] = { x: local[3].x + (mid.x - local[3].x) * k * 0.4, y: local[3].y + (mid.y - local[3].y) * k * 0.4 };
  local[7] = { x: local[7].x + (mid.x - local[7].x) * k * 0.4, y: local[7].y + (mid.y - local[7].y) * k * 0.4 };

  // place so the pinch point sits exactly on the cursor, then rotate by roll
  const anchor = { x: (local[4].x + local[8].x) / 2, y: (local[4].y + local[8].y) / 2 };
  const flip = side === "left" ? -1 : 1;
  const c = Math.cos(h.roll), s = Math.sin(h.roll);
  return local.map((p) => {
    const x = (p.x - anchor.x) * flip * size, y = (p.y - anchor.y) * size;
    return { x: h.pos.x + x * c - y * s, y: h.pos.y + x * s + y * c };
  });
}

export class MouseHands {
  right: VHand;
  left: VHand;
  private drag: { side: Side; mode: "pinch" | "roll"; x0: number; roll0: number } | null = null;
  private latchLeft = false;
  private inside = false;
  active = false; // true once the mouse has been used on the stage

  constructor(private el: HTMLElement) {
    this.right = newHand(innerWidth * 0.6, innerHeight * 0.5);
    this.left = newHand(innerWidth * 0.35, innerHeight * 0.5);
    el.addEventListener("pointerenter", () => (this.inside = true));
    el.addEventListener("pointerleave", () => (this.inside = false));
    el.addEventListener("pointermove", (e) => this.onMove(e));
    el.addEventListener("pointerdown", (e) => this.onDown(e));
    addEventListener("pointerup", () => this.onUp());
    el.addEventListener("wheel", (e) => this.onWheel(e), { passive: false });
    addEventListener("keydown", (e) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "l" || e.key === "L") {
        this.latchLeft = !this.latchLeft;
        this.left.visible = true;
        this.left.pinch = this.latchLeft;
      }
      if (e.key === "Escape") { this.left.visible = false; this.latchLeft = false; this.left.pinch = false; }
    });
  }

  private local(e: PointerEvent | WheelEvent): Pt {
    const r = this.el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private onMove(e: PointerEvent) {
    this.inside = true;
    this.active = true;
    const p = this.local(e);
    if (this.drag) {
      const h = this[this.drag.side];
      if (this.drag.mode === "roll") h.roll = this.drag.roll0 + (p.x - this.drag.x0) * 0.008;
      else h.pos = p;
      return;
    }
    const h = e.altKey ? this.left : this.right;
    if (e.altKey) h.visible = true;
    h.pos = p;
  }

  private onDown(e: PointerEvent) {
    if (e.button !== 0) return;
    this.active = true;
    const side: Side = e.altKey ? "left" : "right";
    const h = this[side];
    h.visible = true;
    const p = this.local(e);
    if (e.shiftKey) this.drag = { side, mode: "roll", x0: p.x, roll0: h.roll };
    else {
      h.pos = p;
      h.pinch = true;
      this.drag = { side, mode: "pinch", x0: p.x, roll0: h.roll };
    }
    e.preventDefault();
  }

  private onUp() {
    if (!this.drag) return;
    const h = this[this.drag.side];
    if (this.drag.mode === "pinch") h.pinch = this.drag.side === "left" ? this.latchLeft : false;
    this.drag = null;
  }

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    this.active = true;
    const h = e.altKey ? this.left : this.right;
    h.openness = Math.min(1, Math.max(0, h.openness - e.deltaY * 0.0015));
  }

  /** Synthetic hands for this frame, in stage px. */
  frames(dt: number, H: number): HandFrame[] {
    const out: HandFrame[] = [];
    const size = H * 0.13;
    this.right.visible = this.inside || !!this.drag;
    for (const side of ["left", "right"] as Side[]) {
      const h = this[side];
      h.pinchAmt += ((h.pinch ? 1 : 0) - h.pinchAmt) * Math.min(1, dt * 25);
      if (h.visible) out.push({ side, pts: buildHand(h, side, size) });
    }
    return out;
  }
}
