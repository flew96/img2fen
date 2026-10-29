// Board detection and square slicing — a port of chessfen/detect.py.
//
// The boundaries between neighbouring squares of a digital board are long,
// straight, equally spaced edges: 7 internal vertical lines spanning the
// board's full height and 7 horizontal lines spanning its full width. So the
// vertical lines give the board's top/bottom and the horizontal lines give its
// left/right; a candidate is accepted when enough lines sit on the 1/8 grid.
//
// Images are {data: Uint8ClampedArray|Float32Array (RGB, interleaved), width, height}.

const MIN_BOARD = 64; // px, smallest board we try to find

// numpy/Python round(): halves go to the even neighbour
export function roundHalfEven(x) {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export function rgbaToRgb(rgba, width, height) {
  const data = new Uint8ClampedArray(width * height * 3);
  for (let i = 0, j = 0; i < width * height; i++, j += 4) {
    data[i * 3] = rgba[j];
    data[i * 3 + 1] = rgba[j + 1];
    data[i * 3 + 2] = rgba[j + 2];
  }
  return { data, width, height };
}

// ---------- resizing (OpenCV INTER_AREA for shrinking, INTER_CUBIC for enlarging)

function areaWeights(srcLen, dstLen) {
  const scale = srcLen / dstLen;
  const out = [];
  for (let d = 0; d < dstLen; d++) {
    const a = d * scale, b = (d + 1) * scale;
    const taps = [];
    for (let s = Math.floor(a); s < Math.min(srcLen, Math.ceil(b)); s++) {
      const w = Math.min(b, s + 1) - Math.max(a, s);
      if (w > 1e-9) taps.push([s, w / scale]);
    }
    out.push(taps);
  }
  return out;
}

function cubicWeights(srcLen, dstLen) {
  const A = -0.75;
  const scale = srcLen / dstLen;
  const k = (x) => {
    x = Math.abs(x);
    if (x <= 1) return ((A + 2) * x - (A + 3)) * x * x + 1;
    if (x < 2) return ((A * x - 5 * A) * x + 8 * A) * x - 4 * A;
    return 0;
  };
  const out = [];
  for (let d = 0; d < dstLen; d++) {
    const f = (d + 0.5) * scale - 0.5;
    const s0 = Math.floor(f);
    const t = f - s0;
    const taps = [];
    for (let i = -1; i <= 2; i++) {
      const s = Math.min(srcLen - 1, Math.max(0, s0 + i));
      taps.push([s, k(i - t)]);
    }
    out.push(taps);
  }
  return out;
}

export function resize(img, dw, dh, mode) {
  const { data, width: sw, height: sh } = img;
  const wx = mode === "area" ? areaWeights(sw, dw) : cubicWeights(sw, dw);
  const wy = mode === "area" ? areaWeights(sh, dh) : cubicWeights(sh, dh);
  const tmp = new Float32Array(sh * dw * 3); // horizontal pass
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0;
      for (const [s, w] of wx[x]) {
        const i = (y * sw + s) * 3;
        r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w;
      }
      const o = (y * dw + x) * 3;
      tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b;
    }
  }
  const out = new Uint8ClampedArray(dh * dw * 3); // vertical pass, rounded like uint8 images
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0;
      for (const [s, w] of wy[y]) {
        const i = (s * dw + x) * 3;
        r += tmp[i] * w; g += tmp[i + 1] * w; b += tmp[i + 2] * w;
      }
      const o = (y * dw + x) * 3;
      out[o] = Math.round(r); out[o + 1] = Math.round(g); out[o + 2] = Math.round(b);
    }
  }
  return { data: out, width: dw, height: dh };
}

// ---------- edge maps and line segments

function blur3(img) {
  // cv2.GaussianBlur(ksize=3, sigma=0) is [1, 2, 1] / 4 with BORDER_REFLECT_101
  const { data, width: w, height: h } = img;
  const refl = (i, n) => (i < 0 ? -i : i >= n ? 2 * n - 2 - i : i);
  const tmp = new Float32Array(w * h * 3);
  const out = new Float32Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const l = (y * w + refl(x - 1, w)) * 3, c = (y * w + x) * 3, r = (y * w + refl(x + 1, w)) * 3;
      for (let k = 0; k < 3; k++) tmp[c + k] = (data[l + k] + 2 * data[c + k] + data[r + k]) / 4;
    }
  }
  for (let y = 0; y < h; y++) {
    const yu = refl(y - 1, h), yd = refl(y + 1, h);
    for (let x = 0; x < w; x++) {
      const u = (yu * w + x) * 3, c = (y * w + x) * 3, d = (yd * w + x) * 3;
      for (let k = 0; k < 3; k++) out[c + k] = (tmp[u + k] + 2 * tmp[c + k] + tmp[d + k]) / 4;
    }
  }
  return { data: out, width: w, height: h };
}

function edges(a, thresh) {
  // binary maps of strong horizontal (ex) and vertical (ey) color changes
  const { data, width: w, height: h } = a;
  const ex = new Uint8Array(w * h), ey = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0 && x < w - 1) {
        let m = 0;
        for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(data[(i + 1) * 3 + k] - data[(i - 1) * 3 + k]));
        ex[i] = m > thresh ? 1 : 0;
      }
      if (y > 0 && y < h - 1) {
        let m = 0;
        for (let k = 0; k < 3; k++) m = Math.max(m, Math.abs(data[(i + w) * 3 + k] - data[(i - w) * 3 + k]));
        ey[i] = m > thresh ? 1 : 0;
      }
    }
  }
  return { ex, ey };
}

function segments(binary, w, h, vertical, minLen, gap) {
  // Long straight runs -> [pos, start, end]. "Lines" are columns for vertical
  // segments and rows for horizontal ones; runs go along each line.
  const nLines = vertical ? w : h, len = vertical ? h : w;
  const at = vertical ? (line, i) => binary[i * w + line] : (line, i) => binary[line * w + i];
  const runsPerLine = [];
  const buf = new Uint8Array(len);
  for (let line = 0; line < nLines; line++) {
    for (let i = 0; i < len; i++) buf[i] = at(line, i);
    // closing: fill short gaps between edge pixels
    let i = 0;
    while (i < len) {
      if (buf[i]) { i++; continue; }
      let j = i;
      while (j < len && !buf[j]) j++;
      if (i > 0 && j < len && j - i < gap) buf.fill(1, i, j);
      i = j;
    }
    // opening: keep only runs at least minLen long
    const runs = [];
    i = 0;
    while (i < len) {
      if (!buf[i]) { i++; continue; }
      let j = i;
      while (j < len && buf[j]) j++;
      if (j - i >= minLen) runs.push([i, j]);
      i = j;
    }
    runsPerLine.push(runs);
  }
  // runs on neighbouring lines with the same ends form one segment
  let open = [];
  const done = [];
  for (let r = 0; r < nLines; r++) {
    for (const [a, b] of runsPerLine[r]) {
      let merged = false;
      for (const seg of open) {
        if (seg.last >= r - 1 && Math.abs(seg.a - a) <= gap && Math.abs(seg.b - b) <= gap) {
          seg.rows.push(r);
          seg.a = Math.min(seg.a, a); seg.b = Math.max(seg.b, b); seg.last = r;
          merged = true;
          break;
        }
      }
      if (!merged) open.push({ rows: [r], a, b, last: r });
      if (open.length > 64) {
        for (const s of open) if (s.last < r - 1) done.push(s);
        open = open.filter((s) => s.last >= r - 1);
      }
    }
  }
  return done.concat(open).map((s) => [s.rows.reduce((x, y) => x + y, 0) / s.rows.length + 0.5, s.a, s.b]);
}

function extents(segs, tol) {
  // distinct [start, end] spans that at least two segments share
  const out = [];
  const sorted = segs.slice().sort((p, q) => (p[1] - p[2]) - (q[1] - q[2]));
  for (const [, a, b] of sorted) {
    if (out.some(([a2, b2]) => Math.abs(a - a2) <= tol && Math.abs(b - b2) <= tol)) continue;
    let support = 0;
    for (const s of segs) if (Math.abs(a - s[1]) <= tol && Math.abs(b - s[2]) <= tol) support++;
    if (support >= 2) out.push([a, b]);
  }
  return out;
}

function unionLen(intervals) {
  let total = 0, curA = null, curB = null;
  for (const [a, b] of intervals.slice().sort((p, q) => p[0] - q[0] || p[1] - q[1])) {
    if (curB === null || a > curB) {
      if (curB !== null) total += curB - curA;
      curA = a; curB = b;
    } else curB = Math.max(curB, b);
  }
  return total + (curB === null ? 0 : curB - curA);
}

function lines(segs, start, end, lo, hi) {
  // positions of lines near [lo, hi] whose segments cover most of start..end
  const span = end - start, margin = 0.1 * (hi - lo);
  const rel = segs
    .filter(([p, a, b]) => a < end && b > start && p >= lo - margin && p <= hi + margin)
    .map(([p, a, b]) => [p, Math.max(a, start), Math.min(b, end)])
    .sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]);
  const out = [];
  let cluster = [];
  for (const seg of rel.concat([[Infinity, 0, 0]])) {
    if (cluster.length && seg[0] - cluster[cluster.length - 1][0] > 2) {
      if (unionLen(cluster.map(([, a, b]) => [a, b])) >= 0.6 * span) {
        let sw = 0, sp = 0;
        for (const [p, a, b] of cluster) { sw += b - a; sp += p * (b - a); }
        out.push(sp / sw);
      }
      cluster = [];
    }
    cluster.push(seg);
  }
  return out;
}

function fitGrid(ps, lo, hi) {
  // 9 equally spaced lines (k = 0..8) near the rough range [lo, hi]
  const step0 = (hi - lo) / 8;
  const tol = Math.max(1.5, 0.06 * step0);
  let best = [];
  for (let i = 0; i < 25; i++) {
    const step = step0 * (0.94 + (0.12 * i) / 24);
    for (const p of ps) {
      for (let k = 0; k < 9; k++) {
        const origin = p - k * step;
        if (Math.abs(origin - lo) > 0.5 * step0) continue;
        const hits = new Map();
        for (const q of ps) {
          const kk = roundHalfEven((q - origin) / step);
          if (Math.abs(q - origin - kk * step) <= tol && kk >= 0 && kk <= 8) hits.set(kk, q);
        }
        if (hits.size > best.length) best = [...hits.entries()];
      }
    }
  }
  if (best.length < 2) return [lo, hi, []];
  const n = best.length;
  const mk = best.reduce((s, [k]) => s + k, 0) / n, mp = best.reduce((s, [, p]) => s + p, 0) / n;
  let cov = 0, vk = 0;
  for (const [k, p] of best) { cov += (k - mk) * (p - mp); vk += (k - mk) ** 2; }
  const step = cov / vk, origin = mp - step * mk;
  return [origin, origin + 8 * step, best];
}

function find(a, thresh) {
  const { width: w, height: h } = a;
  const { ex, ey } = edges(a, thresh);
  const gap = Math.max(3, Math.floor(Math.min(h, w) / 150));
  const v = segments(ex, w, h, true, MIN_BOARD / 2, gap);
  const hz = segments(ey, w, h, false, MIN_BOARD / 2, gap);
  const longV = v.filter((s) => s[2] - s[1] >= MIN_BOARD);
  const longH = hz.filter((s) => s[2] - s[1] >= MIN_BOARD);
  let best = null, bestScore = 0;
  for (const [y1, y2] of extents(longV, 3)) {
    for (const [x1, x2] of extents(longH, 3)) {
      const sideV = y2 - y1, sideH = x2 - x1;
      if (Math.abs(sideV - sideH) > 0.06 * Math.max(sideV, sideH) + 4) continue;
      const [fx1, fx2, cx] = fitGrid(lines(v, y1, y2, x1, x2), x1, x2);
      const [fy1, fy2, cy] = fitGrid(lines(hz, x1, x2, y1, y2), y1, y2);
      if (cx.length < 5 || cy.length < 5) continue;
      const score = cx.length + cy.length + sideH / 1e5; // prefer bigger boards on ties
      if (score > bestScore) { best = [fx1, fy1, fx2, fy2]; bestScore = score; }
    }
  }
  return best;
}

export function findBoard(img) {
  // img: RGB image. Returns [x0, y0, x1, y1] or null.
  const { width: w, height: h } = img;
  const scale = Math.min(1, 1600 / Math.max(h, w));
  const small = scale < 1 ? resize(img, roundHalfEven(w * scale), roundHalfEven(h * scale), "area") : img;
  const a = blur3(small);
  for (const thresh of [14, 7]) {
    const box = find(a, thresh);
    if (box) return box.map((c) => roundHalfEven(c / scale));
  }
  return null;
}

export function splitSquares(img, box, tile = 64) {
  // crop the board (edges replicated) and cut it into 64 tiles:
  // Float32Array (64, 3, tile, tile), row-major from the top-left square
  const { data, width: w, height: h } = img;
  const [x0, y0, x1, y1] = box.map(roundHalfEven);
  const cw = x1 - x0, ch = y1 - y0;
  const crop = new Uint8ClampedArray(cw * ch * 3);
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(h - 1, Math.max(0, y0 + y));
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(w - 1, Math.max(0, x0 + x));
      const i = (sy * w + sx) * 3, o = (y * cw + x) * 3;
      crop[o] = data[i]; crop[o + 1] = data[i + 1]; crop[o + 2] = data[i + 2];
    }
  }
  const size = 8 * tile;
  const board = resize({ data: crop, width: cw, height: ch }, size, size, ch > size ? "area" : "cubic").data;
  const out = new Float32Array(64 * 3 * tile * tile);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const t = (r * 8 + c) * 3 * tile * tile;
      for (let y = 0; y < tile; y++) {
        for (let x = 0; x < tile; x++) {
          const i = ((r * tile + y) * size + c * tile + x) * 3;
          const o = y * tile + x;
          out[t + o] = board[i];
          out[t + tile * tile + o] = board[i + 1];
          out[t + 2 * tile * tile + o] = board[i + 2];
        }
      }
    }
  }
  return out;
}
