export interface Pt {
  x: number;
  y: number;
}

export type Side = "left" | "right";

/** One detected (or synthetic) hand, in stage CSS pixels. 21 MediaPipe landmarks. */
export interface HandFrame {
  side: Side;
  pts: Pt[];
}

/** Clean, smoothed, named signals for one hand. Positions in stage px unless noted. */
export interface HandSignals {
  side: Side;
  present: boolean;
  pts: Pt[]; // smoothed landmarks
  size: number; // px, wrist -> middle-finger knuckle; the hand's own ruler
  palm: Pt; // px, centre of the palm
  palmN: Pt; // palm normalised to 0..1 across the stage
  pinchDist: number; // thumb-index gap divided by hand size (~0.1 pinched, ~1 open)
  pinch: boolean; // with hysteresis
  pinchStart: boolean; // true on the frame the pinch begins
  pinchEnd: boolean; // true on the frame the pinch ends (or the hand is lost)
  pinchPoint: Pt; // px, midpoint between thumb tip and index tip
  openness: number; // 0 = fist, 1 = flat open hand
  roll: number; // radians; 0 = fingers straight up, + = tilted clockwise on screen
  vel: Pt; // palm velocity, px per second
  speed: number; // |vel| in stage heights per second
}

export interface Signals {
  t: number; // seconds
  source: "camera" | "mouse" | "none";
  left: HandSignals;
  right: HandSignals;
  both: boolean;
  handsDist: number; // px between palms (last known)
  handsDistN: number; // handsDist / stage width
}

// MediaPipe landmark indices
export const LM = {
  WRIST: 0,
  THUMB_TIP: 4,
  INDEX_MCP: 5,
  INDEX_TIP: 8,
  MIDDLE_MCP: 9,
  MIDDLE_TIP: 12,
  RING_MCP: 13,
  RING_TIP: 16,
  PINKY_MCP: 17,
  PINKY_TIP: 20,
} as const;

export const FINGERTIPS = [4, 8, 12, 16, 20];

export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
