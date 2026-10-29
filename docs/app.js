import { decodeImage, loadModel, recognize } from "./recognize.js";
import { guessFlipped, orient, problems, toFen, toPgn } from "./fen.js";
import { Engine } from "./engine.js";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";

// move notation (Nf3, exd5…) for engine lines; plain UCI moves if this fails to load
let Chess = null;
import("https://cdn.jsdelivr.net/npm/chess.js@1.4.0/dist/esm/chess.js").then((m) => (Chess = m.Chess)).catch(() => {});

const $ = (id) => document.getElementById(id);
const DOUBT = 0.8;
const WHITE = ["K", "Q", "R", "B", "N", "P"];
const BLACK = ["k", "q", "r", "b", "n", "p"];
const pieceSrc = (ch) => `pieces/${ch === ch.toUpperCase() ? "w" : "b"}${ch.toUpperCase()}.svg`;

// The editable position is kept in picture coordinates (row 0 = top of the
// screenshot), so changing "At the bottom" reinterprets it without losing edits.
const state = {
  session: null,
  pending: null,     // image dropped before the model finished loading
  image: null,       // {bitmap, rgb}
  res: null,         // {box, boardFound, picture, confidence}
  recognized: null,  // copy of the picture as recognized, for "Reset"
  edited: new Set(), // squares (r * 8 + c) changed by hand
  turn: "w",
  orientation: "auto",
  engine: null,
  fen: null,         // position currently shown
  bestMove: null,    // engine's first move for state.fen, drawn as an arrow
  analyzing: null,   // fen handed to the engine
  analysisTimer: 0,
};

// ---------- input

async function init() {
  try {
    state.session = await loadModel("squarenet.onnx");
    $("model-status").textContent = "Neural network ready. Images are processed in your browser.";
    if (state.pending) handle(state.pending);
  } catch (e) {
    $("model-status").textContent = "Could not load the neural network: " + e.message;
  }
}

async function handle(blob) {
  if (!state.session) {
    state.pending = blob;
    $("model-status").textContent = "Image received, loading the neural network…";
    return;
  }
  state.pending = null;
  try {
    state.image = await decodeImage(blob);
  } catch {
    alert("Could not open this image.");
    return;
  }
  state.res = await recognize(state.session, state.image.rgb);
  state.recognized = state.res.picture.map((row) => row.slice());
  state.edited.clear();
  setSegment("orientation", "auto");
  $("result").hidden = false;
  $("drop").classList.add("compact");
  render();
  $("result").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

document.addEventListener("paste", (e) => {
  const item = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"));
  if (item) { e.preventDefault(); handle(item.getAsFile()); }
});
$("file").addEventListener("change", (e) => {
  if (e.target.files[0]) handle(e.target.files[0]);
  e.target.value = "";
});
window.addEventListener("dragover", (e) => { e.preventDefault(); $("drop").classList.add("over"); });
window.addEventListener("dragleave", (e) => { if (!e.relatedTarget) $("drop").classList.remove("over"); });
window.addEventListener("drop", (e) => {
  e.preventDefault();
  $("drop").classList.remove("over");
  const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
  if (file) handle(file);
});

// ---------- options

function setSegment(name, value) {
  state[name] = value;
  document.querySelectorAll(`.segmented[data-name="${name}"] button`)
    .forEach((b) => b.classList.toggle("on", b.dataset.value === value));
}
document.querySelectorAll(".segmented").forEach((seg) => {
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    setSegment(seg.dataset.name, b.dataset.value);
    render();
  });
});

function isFlipped() {
  return state.orientation === "auto" ? guessFlipped(state.res.picture) : state.orientation === "black";
}

const isDoubtful = (r, c) => state.res.confidence[r][c] < DOUBT && !state.edited.has(r * 8 + c);

function squareName(r, c, flipped) {
  // r, c are picture coordinates
  const file = flipped ? 7 - c : c, rank = flipped ? r + 1 : 8 - r;
  return "abcdefgh"[file] + rank;
}

// ---------- output

function render() {
  const { res } = state;
  if (!res) return;
  const flipped = isFlipped();
  const board = orient(res.picture, flipped);
  const fen = toFen(board, state.turn);
  $("fen").value = fen;
  $("lichess").href = "https://lichess.org/analysis/" + fen.replaceAll(" ", "_") + (flipped ? "?color=black" : "");
  $("chesscom").href = "https://www.chess.com/analysis?fen=" + encodeURIComponent(fen) + (flipped ? "&flip=true" : "");

  const notes = [];
  if (!res.boardFound) notes.push(["warn", "Board grid not found — the whole image is treated as the board."]);
  if (state.orientation === "auto") notes.push(["", "At the bottom (detected automatically): " + (flipped ? "Black." : "White.")]);
  const doubtful = [];
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isDoubtful(r, c)) doubtful.push(squareName(r, c, flipped));
  if (doubtful.length) notes.push(["warn", "Please check these squares (outlined in red): " + doubtful.join(", ")]);
  const illegal = problems(board, state.turn);
  for (const p of illegal) notes.push(["warn", "Illegal position: " + p]);
  $("notes").replaceChildren(...notes.map(([cls, text]) => {
    const li = document.createElement("li");
    li.className = cls; li.textContent = text;
    return li;
  }));

  if (fen !== state.fen) state.bestMove = null;
  state.fen = fen;
  drawBoard(flipped);
  requestAnalysis(fen, illegal.length === 0);
  fillTray($("tray-top"), flipped ? WHITE : BLACK);
  fillTray($("tray-bottom"), flipped ? BLACK : WHITE);
  drawOriginal();
}

function pieceImg(ch) {
  const img = document.createElement("img");
  img.src = pieceSrc(ch);
  img.alt = ch;
  img.draggable = false;
  img.className = "piece";
  img.dataset.piece = ch;
  return img;
}

function drawBoard(flipped) {
  const squares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = document.createElement("div");
      sq.className = "sq " + ((r + c) % 2 ? "dark" : "light") + (isDoubtful(r, c) ? " doubt" : "");
      sq.dataset.r = r; sq.dataset.c = c;
      const ch = state.res.picture[r][c];
      if (ch) sq.append(pieceImg(ch));
      const name = squareName(r, c, flipped);
      if (c === 0) sq.append(Object.assign(document.createElement("span"), { className: "coord rank", textContent: name[1] }));
      if (r === 7) sq.append(Object.assign(document.createElement("span"), { className: "coord file", textContent: name[0] }));
      squares.push(sq);
    }
  }
  $("board").replaceChildren(...squares, arrowSvg(flipped));
}

function arrowSvg(flipped) {
  // best-move arrow over the board, in square units (viewBox 0..8)
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 8 8");
  svg.setAttribute("class", "arrows");
  const m = state.bestMove;
  if (!m) return svg;
  const center = (sq) => {
    const file = sq.charCodeAt(0) - 97, rank = Number(sq[1]);
    return flipped ? [7 - file + 0.5, rank - 1 + 0.5] : [file + 0.5, 8 - rank + 0.5];
  };
  const [x1, y1] = center(m.slice(0, 2)), [x2, y2] = center(m.slice(2, 4));
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const head = 0.42, tipX = x2 - ux * 0.12, tipY = y2 - uy * 0.12;
  const neckX = tipX - ux * head, neckY = tipY - uy * head;
  svg.innerHTML =
    `<line x1="${x1}" y1="${y1}" x2="${neckX}" y2="${neckY}" stroke-width="0.17" stroke-linecap="round"/>` +
    `<polygon points="${tipX},${tipY} ${neckX - uy * 0.27},${neckY + ux * 0.27} ${neckX + uy * 0.27},${neckY - ux * 0.27}"/>`;
  return svg;
}

function redrawArrow() {
  const old = $("board").querySelector(".arrows");
  if (old) old.replaceWith(arrowSvg(isFlipped()));
}

// ---------- engine analysis

function analysisOn() { return $("engine-on").checked; }

function requestAnalysis(fen, legal) {
  clearTimeout(state.analysisTimer);
  if (!analysisOn() || !legal) {
    state.analyzing = null;
    state.engine?.stop();
    state.bestMove = null;
    redrawArrow();
    showEval(null);
    $("lines").replaceChildren();
    $("engine-depth").textContent = "";
    $("engine-msg").textContent = !analysisOn() ? "Analysis is off." : "Fix the position to analyze it.";
    return;
  }
  if (fen === state.analyzing) return; // same position: keep the running/finished search
  state.analyzing = fen;
  if (!state.engine) {
    $("engine-msg").textContent = "Starting the engine…";
    state.engine = new Engine("engine/stockfish-19-lite-single.js", { multiPv: 3, depth: 22, onUpdate: onEngine });
  }
  // dragging pieces can change the position many times a second
  state.analysisTimer = setTimeout(() => state.engine.analyze(fen), 150);
}

function onEngine(u) {
  if (u.error) { $("engine-msg").textContent = "Engine error: " + u.error; return; }
  if (u.fen !== state.fen || !analysisOn()) return;
  const white = state.fen.split(" ")[1] === "w" ? 1 : -1; // engine scores are for the side to move
  if (u.done && u.none) {
    let text = "No legal moves.";
    if (Chess) {
      try { text = new Chess(state.fen).isCheckmate() ? "Checkmate." : "Stalemate."; } catch {}
    }
    showEval(null);
    $("lines").replaceChildren();
    $("engine-msg").textContent = text;
    return;
  }
  const lines = u.lines;
  if (!lines.length) return;
  $("engine-msg").textContent = "";
  $("engine-depth").textContent = "depth " + lines[0].depth + (u.done ? "" : "…");
  showEval(lines[0], white);
  $("lines").replaceChildren(...lines.map((l) => {
    const li = document.createElement("li");
    const ev = Object.assign(document.createElement("span"), { className: "line-eval", textContent: formatScore(l, white) });
    const moves = Object.assign(document.createElement("span"), { className: "line-moves", textContent: pvText(state.fen, l.pv) });
    li.append(ev, moves);
    return li;
  }));
  if (state.bestMove !== lines[0].pv[0]) {
    state.bestMove = lines[0].pv[0];
    redrawArrow();
  }
}

function formatScore(l, white) {
  if (l.mate !== null) return "#" + l.mate * white;
  const v = (l.cp * white) / 100;
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
}

function showEval(l, white) {
  if (!l) { $("eval-num").textContent = "–"; $("eval-fill").style.width = "50%"; return; }
  $("eval-num").textContent = formatScore(l, white);
  // White's share of the bar, like lichess's win-chance curve
  const share = l.mate !== null ? (l.mate * white > 0 ? 100 : 0)
    : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * l.cp * white)) - 1);
  $("eval-fill").style.width = share.toFixed(1) + "%";
}

function pvText(fen, pv, maxPlies = 10) {
  const moves = pv.slice(0, maxPlies);
  if (!Chess) return moves.join(" ");
  try {
    const game = new Chess(fen);
    let n = 1, out = game.turn() === "b" ? ["1…"] : [];
    for (const uci of moves) {
      if (game.turn() === "w") out.push(n + ".");
      const mv = game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      out.push(mv.san);
      if (game.turn() === "w") n++;
    }
    return out.join(" ").replace(/(\d+\.) /g, "$1 ").replace("1… ", "1… ");
  } catch {
    return moves.join(" ");
  }
}

$("engine-on").checked = (() => { try { return localStorage.getItem("engine-on") !== "0"; } catch { return true; } })();
$("engine-on").addEventListener("change", () => {
  try { localStorage.setItem("engine-on", $("engine-on").checked ? "1" : "0"); } catch {}
  render();
});

function fillTray(tray, pieces) {
  tray.replaceChildren(...pieces.map((ch) => {
    const cell = document.createElement("div");
    cell.className = "tray-cell";
    cell.append(pieceImg(ch));
    return cell;
  }));
}

function drawOriginal() {
  // the screenshot crop around the board, doubtful squares outlined
  const { bitmap } = state.image;
  const [x0, y0, x1, y1] = state.res.box;
  const pad = (x1 - x0) * 0.03;
  const sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad);
  const sw = Math.min(bitmap.width, x1 + pad) - sx, sh = Math.min(bitmap.height, y1 + pad) - sy;
  const scale = 480 / Math.max(sw, sh);
  const canvas = $("original");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  const bx = (x0 - sx) * scale, by = (y0 - sy) * scale;
  const qx = ((x1 - x0) * scale) / 8, qy = ((y1 - y0) * scale) / 8;
  ctx.strokeStyle = "#e53935";
  ctx.lineWidth = Math.max(2, qx / 14);
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (isDoubtful(r, c)) {
        const w = ctx.lineWidth;
        ctx.strokeRect(bx + c * qx + w / 2, by + r * qy + w / 2, qx - w, qy - w);
      }
}

// ---------- drag and drop editing

let drag = null; // {piece, from: [r, c] | null, ghost, source}

function startDrag(e) {
  const img = e.target.closest(".piece");
  if (!img || e.button > 0) return;
  e.preventDefault();
  const sq = img.closest(".sq");
  const size = $("board").getBoundingClientRect().width / 8;
  const ghost = pieceImg(img.dataset.piece);
  ghost.className = "ghost";
  ghost.style.width = ghost.style.height = size + "px";
  document.body.append(ghost);
  drag = { piece: img.dataset.piece, from: sq ? [+sq.dataset.r, +sq.dataset.c] : null, ghost, source: img };
  if (sq) img.classList.add("lifted");
  moveDrag(e);
}

function squareAt(x, y) {
  const rect = $("board").getBoundingClientRect();
  const c = Math.floor(((x - rect.left) / rect.width) * 8);
  const r = Math.floor(((y - rect.top) / rect.height) * 8);
  return r >= 0 && r < 8 && c >= 0 && c < 8 ? [r, c] : null;
}

function moveDrag(e) {
  if (!drag) return;
  drag.ghost.style.left = e.clientX + "px";
  drag.ghost.style.top = e.clientY + "px";
  const target = squareAt(e.clientX, e.clientY);
  document.querySelectorAll(".sq.target").forEach((s) => s.classList.remove("target"));
  if (target) $("board").children[target[0] * 8 + target[1]].classList.add("target");
}

function endDrag(e) {
  if (!drag) return;
  const { piece, from, ghost, source } = drag;
  drag = null;
  ghost.remove();
  source.classList.remove("lifted");
  const target = e.type === "pointercancel" ? null : squareAt(e.clientX, e.clientY);
  const same = target && from && target[0] === from[0] && target[1] === from[1];
  if (same || (!target && !from)) return render(); // dropped where it was / tray piece dropped outside
  // the automatic orientation guess could change after edits; keep the current one
  if (state.orientation === "auto") setSegment("orientation", isFlipped() ? "black" : "white");
  const pic = state.res.picture;
  if (from) { pic[from[0]][from[1]] = ""; state.edited.add(from[0] * 8 + from[1]); }
  if (target) { pic[target[0]][target[1]] = piece; state.edited.add(target[0] * 8 + target[1]); }
  render();
}

for (const id of ["board", "tray-top", "tray-bottom"]) $(id).addEventListener("pointerdown", startDrag);
window.addEventListener("pointermove", moveDrag);
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

$("reset").addEventListener("click", () => {
  state.res.picture = state.recognized.map((row) => row.slice());
  state.edited.clear();
  setSegment("orientation", "auto");
  render();
});

$("clear").addEventListener("click", () => {
  if (state.orientation === "auto") setSegment("orientation", isFlipped() ? "black" : "white");
  state.res.picture = Array.from({ length: 8 }, () => Array(8).fill(""));
  for (let i = 0; i < 64; i++) state.edited.add(i);
  render();
});

// ---------- actions

$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("fen").value);
  $("copy").textContent = "Copied";
  setTimeout(() => ($("copy").textContent = "Copy"), 1500);
});

$("pgn").addEventListener("click", () => {
  const now = new Date();
  const stamp = now.toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  const url = URL.createObjectURL(new Blob([toPgn($("fen").value)], { type: "application/x-chess-pgn" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `position_${stamp}.pgn` });
  a.click();
  URL.revokeObjectURL(url);
});

// link to the source when served from GitHub Pages (user.github.io/repo/)
if (location.hostname.endsWith(".github.io")) {
  const user = location.hostname.split(".")[0];
  const repo = location.pathname.split("/").filter(Boolean)[0];
  if (repo) {
    const a = Object.assign(document.createElement("a"), { href: `https://github.com/${user}/${repo}`, textContent: "Source code" });
    $("repo-link").append(a);
  }
}

init();
