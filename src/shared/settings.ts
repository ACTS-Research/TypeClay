// Every shared tunable lives here so the GUI, the gesture layer and the
// tracker all read the same objects. Values persist in localStorage.
import type { EuroParams } from "./oneEuro";

export const settings = {
  input: {
    camera: true, // try the webcam on load
    mirror: true, // show the camera like a mirror (recommended)
    swapHands: true, // MediaPipe labels assume a pre-mirrored image; we feed raw frames
    debug: false, // landmark overlay (D)
    preview: true, // small camera preview in the corner
  },
  // Landmark positions are filtered in units of stage height, so beta is in
  // "stage heights per second". Raise beta if fast moves feel laggy.
  landmarks: { minCutoff: 1.2, beta: 10, dCutoff: 1 } as EuroParams,
  // Derived scalar signals (pinch distance, openness, roll, hands distance).
  signals: { minCutoff: 1.5, beta: 1.5, dCutoff: 1 } as EuroParams,
  // Palm velocity is noisy by nature; smoothed harder.
  velocity: { minCutoff: 2.5, beta: 0.05, dCutoff: 1 } as EuroParams,
  gestures: {
    pinchOn: 0.28, // pinch starts when thumb-index gap < this * hand size
    pinchOff: 0.42, // and ends when it opens past this (hysteresis gap = no flicker)
    fistRatio: 1.05, // avg fingertip-to-wrist / hand size for a closed fist
    openRatio: 1.85, // ... and for a flat open hand
  },
};

const KEY = "type-as-clay:settings";

export function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (const group of Object.keys(saved)) {
      const target = (settings as unknown as Record<string, Record<string, unknown>>)[group];
      if (target) Object.assign(target, saved[group]);
    }
  } catch {
    /* ignore corrupt or blocked storage */
  }
}

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}
