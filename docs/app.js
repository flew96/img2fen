import { decodeImage, loadModel, recognize } from "./recognize.js";
import { guessFlipped, orient, problems, toFen, toPgn } from "./fen.js";

ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";

const $ = (id) => document.getElementById(id);
const GLYPHS = { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘", P: "♙", k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };
const DOUBT = 0.8;

const state = {
  session: null,
  pending: null,   // image dropped before the model finished loading
  image: null,     // {bitmap, rgb}
  res: null,       // {box, boardFound, picture, confidence}
  edited: new Set(),
  turn: "w",
  orientation: "auto",
  view: null,      // canvas geometry: {sx, sy, scale, sq}
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
      if (res.confidence[r][c] < DOUBT && !state.edited.has(r * 8 + c)) doubtful.push(squareName(r, c, flipped));
  if (doubtful.length) notes.push(["warn", "Please check these squares (outlined in red): " + doubtful.join(", ")]);
  for (const p of problems(board, state.turn)) notes.push(["warn", "Illegal position: " + p]);
  $("notes").replaceChildren(...notes.map(([cls, text]) => {
    const li = document.createElement("li");
    li.className = cls; li.textContent = text;
    return li;
  }));
  draw(flipped);
}

function squareName(r, c, flipped) {
  // r, c are picture coordinates
  const file = flipped ? 7 - c : c, rank = flipped ? r + 1 : 8 - r;
  return "abcdefgh"[file] + rank;
}

function draw(flipped) {
  const { bitmap } = state.image;
  const { box, picture, confidence } = state.res;
  const [x0, y0, x1, y1] = box;
  const pad = (x1 - x0) * 0.04;
  const sx = Math.max(0, x0 - pad), sy = Math.max(0, y0 - pad);
  const sw = Math.min(bitmap.width, x1 + pad) - sx, sh = Math.min(bitmap.height, y1 + pad) - sy;
  const scale = 800 / Math.max(sw, sh);
  const canvas = $("board");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  const bx = (x0 - sx) * scale, by = (y0 - sy) * scale;
  const sq = ((x1 - x0) * scale) / 8, sqy = ((y1 - y0) * scale) / 8;
  state.view = { bx, by, sq, sqy };

  ctx.strokeStyle = "rgba(122, 90, 47, 0.55)";
  ctx.lineWidth = Math.max(1, sq / 40);
  for (let k = 0; k <= 8; k++) {
    ctx.beginPath(); ctx.moveTo(bx + k * sq, by); ctx.lineTo(bx + k * sq, by + 8 * sqy); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx, by + k * sqy); ctx.lineTo(bx + 8 * sq, by + k * sqy); ctx.stroke();
  }

  const chip = Math.max(14, sq * 0.3);
  ctx.font = `600 ${chip * 0.75}px system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const ch = picture[r][c];
      const doubt = confidence[r][c] < DOUBT && !state.edited.has(r * 8 + c);
      const x = bx + c * sq, y = by + r * sqy;
      if (doubt) {
        ctx.strokeStyle = "#e53935";
        ctx.lineWidth = Math.max(2, sq / 16);
        ctx.strokeRect(x + ctx.lineWidth / 2, y + ctx.lineWidth / 2, sq - ctx.lineWidth, sqy - ctx.lineWidth);
      }
      if (!ch && !doubt) continue;
      const white = ch && ch === ch.toUpperCase();
      ctx.fillStyle = doubt ? "#e53935" : white ? "rgba(255,255,255,0.92)" : "rgba(30,28,25,0.88)";
      roundRect(ctx, x + 3, y + 3, chip, chip, chip * 0.25);
      ctx.fill();
      ctx.fillStyle = doubt || !white ? "#fff" : "#1e1c19";
      ctx.fillText(ch ? ch.toUpperCase() : "?", x + 3 + chip / 2, y + 3 + chip / 2 + 1);
    }
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---------- fixing squares by hand

$("board").addEventListener("click", (e) => {
  if (!state.view) return;
  const canvas = $("board");
  const k = canvas.width / canvas.getBoundingClientRect().width;
  const px = (e.offsetX * k - state.view.bx) / state.view.sq;
  const py = (e.offsetY * k - state.view.by) / state.view.sqy;
  if (px < 0 || py < 0 || px >= 8 || py >= 8) return hidePicker();
  openPicker(Math.floor(py), Math.floor(px), e.offsetX, e.offsetY);
});

function openPicker(r, c, x, y) {
  const picker = $("picker");
  const current = state.res.picture[r][c];
  const options = ["K", "Q", "R", "B", "N", "P", "", "k", "q", "r", "b", "n", "p", ""];
  picker.replaceChildren(...options.map((ch, i) => {
    const b = document.createElement("button");
    if (i === 13) { b.textContent = "empty"; b.className = "empty"; }
    else if (ch === "") { b.style.visibility = "hidden"; }
    else b.textContent = GLYPHS[ch] + "︎";
    if (ch === current && (i === 13 || ch)) b.classList.add("on");
    b.title = ch ? ch : "empty square";
    b.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (state.orientation === "auto") setSegment("orientation", isFlipped() ? "black" : "white");
      state.res.picture[r][c] = ch;
      state.edited.add(r * 8 + c);
      hidePicker();
      render();
    });
    return b;
  }));
  picker.hidden = false;
  const wrap = picker.parentElement.getBoundingClientRect();
  picker.style.left = Math.max(0, Math.min(x, wrap.width - picker.offsetWidth)) + "px";
  picker.style.top = Math.max(0, Math.min(y + 8, wrap.height - picker.offsetHeight)) + "px";
}

function hidePicker() { $("picker").hidden = true; }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") hidePicker(); });
document.addEventListener("click", (e) => {
  if (!e.target.closest("#picker") && e.target.id !== "board") hidePicker();
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
