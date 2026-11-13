// Debug overlay: skeleton, L/R labels, pinch + openness, roll, FPS.
import { HAND_CONNECTIONS, FINGERTIPS, type HandSignals, type Signals } from "./types";

const COLORS = { left: "#ff7a3d", right: "#2fd3ff" };

function drawHand(ctx: CanvasRenderingContext2D, h: HandSignals) {
  const c = COLORS[h.side];
  const P = h.pts;
  ctx.strokeStyle = c;
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [a, b] of HAND_CONNECTIONS) { ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); }
  ctx.stroke();
  ctx.fillStyle = c;
  P.forEach((p, i) => {
    ctx.beginPath();
    ctx.arc(p.x, p.y, FINGERTIPS.includes(i) ? 4.5 : 2.5, 0, Math.PI * 2);
    ctx.fill();
  });

  // pinch ring: hollow = open, filled = pinching
  ctx.beginPath();
  ctx.arc(h.pinchPoint.x, h.pinchPoint.y, h.pinch ? 9 : 13, 0, Math.PI * 2);
  if (h.pinch) ctx.fill(); else ctx.stroke();

  // roll needle from the palm
  ctx.beginPath();
  ctx.moveTo(h.palm.x, h.palm.y);
  ctx.lineTo(h.palm.x + Math.sin(h.roll) * h.size * 0.8, h.palm.y - Math.cos(h.roll) * h.size * 0.8);
  ctx.setLineDash([4, 4]);
  ctx.stroke();
  ctx.setLineDash([]);

  // label + mini readout below the wrist
  const w = P[0];
  ctx.font = "600 12px ui-monospace, Menlo, monospace";
  ctx.textAlign = "center";
  const lines = [
    `${h.side === "left" ? "L" : "R"}  ${h.pinch ? "PINCH" : "open"}`,
    `pinch ${h.pinchDist.toFixed(2)}  open ${h.openness.toFixed(2)}`,
    `roll ${((h.roll * 180) / Math.PI).toFixed(0)}°  v ${h.speed.toFixed(2)}`,
  ];
  lines.forEach((t, i) => {
    const y = w.y + 22 + i * 15;
    ctx.fillStyle = "rgba(0,0,0,.65)";
    const m = ctx.measureText(t).width;
    ctx.fillRect(w.x - m / 2 - 4, y - 11, m + 8, 15);
    ctx.fillStyle = c;
    ctx.fillText(t, w.x, y);
  });
  // openness bar
  ctx.fillStyle = "rgba(0,0,0,.5)";
  ctx.fillRect(w.x - 30, w.y + 70, 60, 5);
  ctx.fillStyle = c;
  ctx.fillRect(w.x - 30, w.y + 70, 60 * h.openness, 5);
  ctx.textAlign = "left";
}

export function drawDebug(
  ctx: CanvasRenderingContext2D, s: Signals,
  info: { renderFps: number; trackFps: number; status: string },
) {
  for (const h of [s.left, s.right]) if (h.present) drawHand(ctx, h);
  if (s.both) {
    ctx.strokeStyle = "rgba(255,255,255,.5)";
    ctx.setLineDash([2, 6]);
    ctx.beginPath();
    ctx.moveTo(s.left.palm.x, s.left.palm.y);
    ctx.lineTo(s.right.palm.x, s.right.palm.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  const lines = [
    `render ${info.renderFps.toFixed(0)} fps   tracking ${info.trackFps.toFixed(0)} fps`,
    `input ${s.source}   ${info.status}`,
    `hands ${s.left.present ? "L" : "-"}${s.right.present ? "R" : "-"}   distance ${s.handsDistN.toFixed(2)}`,
  ];
  ctx.font = "12px ui-monospace, Menlo, monospace";
  ctx.fillStyle = "rgba(0,0,0,.6)";
  ctx.fillRect(8, 8, 330, lines.length * 16 + 8);
  ctx.fillStyle = "#fff";
  lines.forEach((t, i) => ctx.fillText(t, 14, 24 + i * 16));
}
