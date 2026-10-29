import { decodeImage, loadModel, recognize } from "./recognize.js";
import { guessFlipped, orient, problems, toFen, toPgn } from "./fen.js";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";

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
  for (const p of problems(board, state.turn)) notes.push(["warn", "Illegal position: " + p]);
  $("notes").replaceChildren(...notes.map(([cls, text]) => {
    const li = document.createElement("li");
    li.className = cls; li.textContent = text;
    return li;
  }));

  drawBoard(flipped);
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
  $("board").replaceChildren(...squares);
}

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
