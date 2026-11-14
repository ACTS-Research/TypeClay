// Turns raw landmarks into named, smoothed signals.
// Pipeline per hand: raw 21 pts -> One Euro per coordinate -> derived values
// (pinch, openness, roll, palm...) -> One Euro per derived value.
import { OneEuro } from "./oneEuro";
import { settings } from "./settings";
import { LM, type HandFrame, type HandSignals, type Pt, type Side, type Signals } from "./types";

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const LOST_AFTER = 0.25; // s without a detection before a hand counts as gone

function emptyHand(side: Side): HandSignals {
  return {
    side, present: false, pts: Array.from({ length: 21 }, () => ({ x: 0, y: 0 })),
    size: 1, palm: { x: 0, y: 0 }, palmN: { x: 0.5, y: 0.5 },
    pinchDist: 1, pinch: false, pinchStart: false, pinchEnd: false, pinchPoint: { x: 0, y: 0 },
    openness: 1, roll: 0, vel: { x: 0, y: 0 }, speed: 0,
  };
}

class HandTrack {
  s: HandSignals;
  lastSeen = -Infinity;
  private lx = Array.from({ length: 21 }, () => new OneEuro(settings.landmarks));
  private ly = Array.from({ length: 21 }, () => new OneEuro(settings.landmarks));
  private fPinch = new OneEuro(settings.signals);
  private fOpen = new OneEuro(settings.signals);
  private fRoll = new OneEuro(settings.signals);
  private fvx = new OneEuro(settings.velocity);
  private fvy = new OneEuro(settings.velocity);
  private prevPalm: Pt | null = null;
  private prevT = 0;
  private prevRoll = 0;

  constructor(side: Side) {
    this.s = emptyHand(side);
  }

  reset() {
    [...this.lx, ...this.ly, this.fPinch, this.fOpen, this.fRoll, this.fvx, this.fvy].forEach((f) => f.reset());
    this.prevPalm = null;
  }

  update(frame: HandFrame | undefined, t: number, W: number, H: number) {
    const s = this.s;
    s.pinchStart = s.pinchEnd = false;
    if (!frame) {
      if (s.present && t - this.lastSeen > LOST_AFTER) {
        s.present = false;
        if (s.pinch) { s.pinch = false; s.pinchEnd = true; }
        s.vel = { x: 0, y: 0 };
        s.speed = 0;
        this.reset();
      }
      return;
    }
    this.lastSeen = t;
    s.present = true;

    // 1. smooth landmarks (in stage-height units so beta is resolution independent)
    s.pts = frame.pts.map((p, i) => ({
      x: this.lx[i].filter(p.x / H, t) * H,
      y: this.ly[i].filter(p.y / H, t) * H,
    }));
    const P = s.pts;

    // 2. derived values
    s.size = Math.max(1, dist(P[LM.WRIST], P[LM.MIDDLE_MCP]));
    const palmIdx: number[] = [LM.WRIST, LM.INDEX_MCP, LM.MIDDLE_MCP, LM.RING_MCP, LM.PINKY_MCP];
    s.palm = {
      x: palmIdx.reduce((a, i) => a + P[i].x, 0) / palmIdx.length,
      y: palmIdx.reduce((a, i) => a + P[i].y, 0) / palmIdx.length,
    };
    s.palmN = { x: s.palm.x / W, y: s.palm.y / H };
    s.pinchPoint = {
      x: (P[LM.THUMB_TIP].x + P[LM.INDEX_TIP].x) / 2,
      y: (P[LM.THUMB_TIP].y + P[LM.INDEX_TIP].y) / 2,
    };

    const g = settings.gestures;
    // Two versions of pinch distance: `rawPinch` (landmarks already smoothed once) decides
    // pinch on/off, so grabs register where the fingers closed rather than ~200 ms later;
    // the extra-smoothed `pinchDist` is for continuous mappings (e.g. an axis in A).
    const rawPinch = dist(P[LM.THUMB_TIP], P[LM.INDEX_TIP]) / s.size;
    s.pinchDist = this.fPinch.filter(rawPinch, t);
    const tips = [LM.INDEX_TIP, LM.MIDDLE_TIP, LM.RING_TIP, LM.PINKY_TIP];
    const reach = tips.reduce((a, i) => a + dist(P[i], P[LM.WRIST]), 0) / tips.length / s.size;
    s.openness = clamp01(this.fOpen.filter((reach - g.fistRatio) / (g.openRatio - g.fistRatio), t));

    // roll: angle of wrist -> middle knuckle against straight up, unwrapped so
    // the filter never sees a jump from +PI to -PI.
    const v = { x: P[LM.MIDDLE_MCP].x - P[LM.WRIST].x, y: P[LM.MIDDLE_MCP].y - P[LM.WRIST].y };
    let roll = Math.atan2(v.x, -v.y);
    while (roll - this.prevRoll > Math.PI) roll -= 2 * Math.PI;
    while (roll - this.prevRoll < -Math.PI) roll += 2 * Math.PI;
    this.prevRoll = roll;
    s.roll = this.fRoll.filter(roll, t);

    // pinch with hysteresis
    if (!s.pinch && rawPinch < g.pinchOn) { s.pinch = true; s.pinchStart = true; }
    else if (s.pinch && rawPinch > g.pinchOff) { s.pinch = false; s.pinchEnd = true; }

    // velocity from the smoothed palm
    if (this.prevPalm) {
      const dt = Math.max(1e-3, t - this.prevT);
      s.vel = {
        x: this.fvx.filter((s.palm.x - this.prevPalm.x) / dt, t),
        y: this.fvy.filter((s.palm.y - this.prevPalm.y) / dt, t),
      };
      s.speed = Math.hypot(s.vel.x, s.vel.y) / H;
    }
    this.prevPalm = { ...s.palm };
    this.prevT = t;
  }
}

export class GestureLayer {
  private left = new HandTrack("left");
  private right = new HandTrack("right");
  private fDist = new OneEuro(settings.signals);
  private handsDist = 0;

  update(frames: HandFrame[], source: Signals["source"], t: number, W: number, H: number): Signals {
    this.left.update(frames.find((f) => f.side === "left"), t, W, H);
    this.right.update(frames.find((f) => f.side === "right"), t, W, H);
    const L = this.left.s, R = this.right.s;
    const both = L.present && R.present;
    if (both) this.handsDist = this.fDist.filter(dist(L.palm, R.palm), t);
    else this.fDist.reset();
    return {
      t, source, left: L, right: R, both,
      handsDist: this.handsDist,
      handsDistN: this.handsDist / W,
    };
  }
}
