// Webcam + MediaPipe HandLandmarker. Produces HandFrames in stage pixels.
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";
import { settings } from "./settings";
import type { HandFrame, Side } from "./types";

const BASE = import.meta.env.BASE_URL;

export class HandTracker {
  video = document.createElement("video");
  status: "off" | "loading" | "running" | "error" = "off";
  error = "";
  fps = 0;
  delegate = "";
  private landmarker: HandLandmarker | null = null;
  private stream: MediaStream | null = null;
  private lastVideoTime = -1;
  private last: HandFrame[] = [];
  private fpsCount = 0;
  private fpsT = performance.now();

  constructor() {
    this.video.playsInline = true;
    this.video.muted = true;
  }

  async start() {
    if (this.status === "loading" || this.status === "running") return;
    this.status = "loading";
    this.error = "";
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play();
      if (!this.landmarker) this.landmarker = await this.createLandmarker();
      this.status = "running";
    } catch (e) {
      this.status = "error";
      this.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      this.stopStream();
    }
  }

  private async createLandmarker() {
    const fileset = await FilesetResolver.forVisionTasks(`${BASE}mediapipe/wasm`);
    const make = (delegate: "GPU" | "CPU") =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${BASE}models/hand_landmarker.task`, delegate },
        runningMode: "VIDEO",
        numHands: 2,
        minHandDetectionConfidence: 0.5,
        minHandPresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });
    try {
      const lm = await make("GPU");
      this.delegate = "GPU";
      return lm;
    } catch {
      this.delegate = "CPU";
      return make("CPU");
    }
  }

  private stopStream() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }

  stop() {
    this.stopStream();
    this.status = "off";
    this.last = [];
  }

  /**
   * Run detection if the camera has a new frame. Returns hands mapped into a
   * W x H stage the way CSS `object-fit: cover` would place the video.
   */
  detect(nowMs: number, W: number, H: number): HandFrame[] {
    const v = this.video;
    if (this.status !== "running" || !this.landmarker || v.readyState < 2) return [];
    if (v.currentTime === this.lastVideoTime) return this.last;
    this.lastVideoTime = v.currentTime;

    const res = this.landmarker.detectForVideo(v, nowMs);
    this.fpsCount++;
    if (nowMs - this.fpsT > 500) {
      this.fps = (this.fpsCount * 1000) / (nowMs - this.fpsT);
      this.fpsCount = 0;
      this.fpsT = nowMs;
    }

    const vw = v.videoWidth, vh = v.videoHeight;
    const s = Math.max(W / vw, H / vh);
    const ox = (W - vw * s) / 2, oy = (H - vh * s) / 2;
    const mirror = settings.input.mirror;

    const hands: HandFrame[] = res.landmarks.map((lms, i) => {
      let label = (res.handedness[i]?.[0]?.categoryName || "Right").toLowerCase() as Side;
      if (settings.input.swapHands) label = label === "left" ? "right" : "left";
      return {
        side: label,
        pts: lms.map((p) => ({ x: (mirror ? 1 - p.x : p.x) * vw * s + ox, y: p.y * vh * s + oy })),
      };
    });
    // MediaPipe sometimes labels both hands the same. Fall back to screen
    // position: in a mirror view your left hand is on the left.
    if (hands.length === 2 && hands[0].side === hands[1].side) {
      const [a, b] = hands[0].pts[0].x < hands[1].pts[0].x ? [hands[0], hands[1]] : [hands[1], hands[0]];
      a.side = mirror ? "left" : "right";
      b.side = mirror ? "right" : "left";
    }
    this.last = hands;
    return hands;
  }
}
