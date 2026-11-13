// One Euro filter (Casiez et al. 2012): an adaptive low-pass filter.
// Slow movement -> heavy smoothing (kills jitter). Fast movement -> light
// smoothing (kills lag). Two knobs matter:
//   minCutoff: lower = smoother when still, but laggier.
//   beta:      higher = less lag when moving fast.
// Params objects are shared by reference, so editing them in the GUI
// retunes every filter that uses them immediately.

export interface EuroParams {
  minCutoff: number;
  beta: number;
  dCutoff: number;
}

const alpha = (cutoff: number, dt: number) => {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
};

export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(public p: EuroParams) {}

  filter(v: number, tSec: number): number {
    if (this.x === null) {
      this.x = v;
      this.t = tSec;
      this.dx = 0;
      return v;
    }
    const dt = Math.max(1e-3, tSec - this.t);
    this.t = tSec;
    const rawDx = (v - this.x) / dt;
    this.dx += alpha(this.p.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.p.minCutoff + this.p.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    return this.x;
  }

  /** Derivative estimate (units per second), useful as a cheap velocity. */
  get velocity() {
    return this.dx;
  }

  reset() {
    this.x = null;
    this.dx = 0;
  }
}
