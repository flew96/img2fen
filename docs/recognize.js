// Image -> board box -> 64 squares -> pieces — a port of chessfen/recognize.py.
// Expects onnxruntime-web loaded as the global `ort`.
import { findBoard, rgbaToRgb, splitSquares } from "./detect.js";
import { CLASSES } from "./fen.js";

const TILE = 64;

export async function loadModel(url) {
  return ort.InferenceSession.create(url, { executionProviders: ["wasm"] });
}

export async function decodeImage(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return { bitmap, rgb: rgbaToRgb(data, bitmap.width, bitmap.height) };
}

function mirrored(tiles) {
  const out = new Float32Array(tiles.length);
  for (let row = 0; row < tiles.length / TILE; row++) {
    const o = row * TILE;
    for (let x = 0; x < TILE; x++) out[o + x] = tiles[o + TILE - 1 - x];
  }
  return out;
}

// Returns {box, boardFound, picture: 8x8 letters as seen in the image, confidence: 8x8}
export async function recognize(session, rgb, box = null) {
  const found = box ?? findBoard(rgb);
  const usedBox = found ?? [0, 0, rgb.width, rgb.height];
  const tiles = splitSquares(rgb, usedBox, TILE);
  const n = 64 * 3 * TILE * TILE;
  const both = new Float32Array(2 * n);
  both.set(tiles, 0);
  both.set(mirrored(tiles), n); // mirror test-time augmentation
  const input = new ort.Tensor("float32", both, [128, 3, TILE, TILE]);
  const { logits } = await session.run({ tiles: input });
  const k = CLASSES.length;
  const picture = [], confidence = [];
  for (let r = 0; r < 8; r++) {
    picture.push([]); confidence.push([]);
    for (let c = 0; c < 8; c++) {
      const i = r * 8 + c;
      const z = [];
      for (let j = 0; j < k; j++) z.push((logits.data[i * k + j] + logits.data[(64 + i) * k + j]) / 2);
      const m = Math.max(...z);
      const e = z.map((v) => Math.exp(v - m));
      const s = e.reduce((a, b) => a + b, 0);
      const best = z.indexOf(m);
      picture[r].push(CLASSES[best]);
      confidence[r].push(e[best] / s);
    }
  }
  return { box: usedBox, boardFound: found !== null, picture, confidence };
}
