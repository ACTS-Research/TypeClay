// Copies MediaPipe's WASM runtime out of node_modules so it is served locally
// (public/mediapipe/wasm). Runs automatically before `npm run dev` and `npm run build`.
import { cpSync, existsSync, mkdirSync } from "node:fs";
const src = "node_modules/@mediapipe/tasks-vision/wasm";
const dst = "public/mediapipe/wasm";
if (!existsSync(src)) {
  console.error("MediaPipe wasm not found. Run `npm install` first.");
  process.exit(1);
}
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`copied ${src} -> ${dst}`);
