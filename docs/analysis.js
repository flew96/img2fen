// Lichess-style analysis board: play moves from the recognized position,
// step through them, and let Stockfish evaluate every position.
import { Chess } from "./vendor/chess.js";
import { Engine } from "./engine.js";

const $ = (id) => document.getElementById(id);
const FILES = "abcdefgh";
const pieceSrc = (p) => `pieces/${p.color}${p.type.toUpperCase()}.svg`;

const av = {
  start: null,      // starting FEN
  moves: [],        // main line: [{san, uci, fen}]
  ply: 0,           // moves applied to reach the shown position (0 = start)
  flipped: false,
  selected: null,   // selected square, e.g. "e2"
  drag: null,       // {from, ghost, img}
  promo: null,      // {from, to} waiting for a promotion piece
  engine: null,
  bestMove: null,   // engine's first move for the shown position
  onClose: null,
};

// ---------- opening and closing

export function openAnalysis(fen, flipped, onClose) {
  try {
    new Chess(fen);
  } catch (e) {
    alert("This position can't be analyzed: " + e.message);
    return false;
  }
  Object.assign(av, { start: fen, moves: [], ply: 0, flipped, selected: null, promo: null, bestMove: null, onClose });
  $("analysis-view").hidden = false;
  render();
  $("analysis-view").scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

export function closeAnalysis() {
  if ($("analysis-view").hidden) return;
  av.engine?.stop();
  $("analysis-view").hidden = true;
  av.onClose?.();
}

const isOpen = () => !$("analysis-view").hidden;
const currentFen = () => (av.ply === 0 ? av.start : av.moves[av.ply - 1].fen);

// ---------- making moves

function play(move) {
  // move: {from, to, promotion?}; returns false if illegal
  const g = new Chess(currentFen());
  let mv;
  try { mv = g.move(move); } catch { return false; }
  const uci = mv.from + mv.to + (mv.promotion || "");
  if (av.moves[av.ply]?.uci === uci) av.ply++; // same as the next move already in the list
  else {
    av.moves = av.moves.slice(0, av.ply);
    av.moves.push({ san: mv.san, uci, fen: g.fen() });
    av.ply++;
  }
  return true;
}

function playUci(list) {
  for (const uci of list) if (!play({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] })) break;
  av.selected = null;
  render();
}

function tryMove(from, to) {
  const g = new Chess(currentFen());
  const legal = g.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!legal.length) return false;
  if (legal.some((m) => m.promotion)) {
    av.promo = { from, to };
    render();
    return true;
  }
  playUci([from + to]);
  return true;
}

function goTo(ply) {
  av.ply = Math.max(0, Math.min(av.moves.length, ply));
  av.selected = null;
  av.promo = null;
  render();
}

// ---------- drawing

function squareOf(r, c) {
  return av.flipped ? FILES[7 - c] + (r + 1) : FILES[c] + (8 - r);
}

function cellOf(sq) {
  const f = FILES.indexOf(sq[0]), rank = Number(sq[1]);
  return av.flipped ? [rank - 1, 7 - f] : [8 - rank, f];
}

function render() {
  const fen = currentFen();
  const g = new Chess(fen);
  drawBoard(g);
  drawMoves();
  // White's part of the eval bar is on White's side of the board
  $("av-evalbar").classList.toggle("flipped", av.flipped);
  $("av-fen").value = fen;
  $("av-first").disabled = $("av-prev").disabled = av.ply === 0;
  $("av-next").disabled = $("av-last").disabled = av.ply === av.moves.length;

  if (g.isGameOver()) {
    av.engine?.stop();
    av.bestMove = null;
    drawArrow();
    $("av-lines").replaceChildren();
    $("av-depth").textContent = "";
    const result = g.isCheckmate() ? (g.turn() === "w" ? "0-1" : "1-0") : "½-½";
    setEval(g.isCheckmate() ? { mate: 0, white: g.turn() === "w" ? -1 : 1 } : { cp: 0, white: 1 }, result);
    $("av-msg").textContent = g.isCheckmate() ? "Checkmate." : g.isStalemate() ? "Stalemate." : "Draw.";
    return;
  }
  if (!$("av-engine-on").checked) {
    av.engine?.stop();
    av.bestMove = null;
    drawArrow();
    $("av-lines").replaceChildren();
    $("av-depth").textContent = "";
    setEval(null);
    $("av-msg").textContent = "Stockfish is off.";
    return;
  }
  if (!av.engine) {
    $("av-msg").textContent = "Starting the engine…";
    av.engine = new Engine("engine/stockfish-19-lite-single.js", { multiPv: 3, depth: 22, onUpdate: onEngine });
  }
  av.bestMove = null;
  av.engine.analyze(fen);
}

function drawBoard(g) {
  const last = av.ply ? av.moves[av.ply - 1].uci : null;
  const dests = av.selected ? g.moves({ square: av.selected, verbose: true }).map((m) => m.to) : [];
  const checkSq = g.inCheck() ? g.findPiece({ type: "k", color: g.turn() })[0] : null;
  const squares = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const sq = squareOf(r, c);
      const el = document.createElement("div");
      const piece = g.get(sq);
      el.className = "sq " + ((r + c) % 2 ? "dark" : "light");
      if (last && (sq === last.slice(0, 2) || sq === last.slice(2, 4))) el.classList.add("last");
      if (sq === av.selected) el.classList.add("sel");
      if (sq === checkSq) el.classList.add("check");
      if (dests.includes(sq)) el.classList.add(piece ? "cap" : "dest");
      el.dataset.sq = sq;
      if (piece) {
        const img = document.createElement("img");
        img.src = pieceSrc(piece);
        img.alt = piece.type;
        img.draggable = false;
        img.className = "piece" + (av.drag?.from === sq ? " lifted" : "");
        el.append(img);
      }
      if (c === 0) el.append(Object.assign(document.createElement("span"), { className: "coord rank", textContent: sq[1] }));
      if (r === 7) el.append(Object.assign(document.createElement("span"), { className: "coord file", textContent: sq[0] }));
      squares.push(el);
    }
  }
  $("av-board").replaceChildren(...squares, arrowSvg(), promoPicker(g));
}

function arrowSvg() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 8 8");
  svg.setAttribute("class", "arrows");
  const m = av.bestMove;
  if (!m) return svg;
  const [r1, c1] = cellOf(m.slice(0, 2)), [r2, c2] = cellOf(m.slice(2, 4));
  const x1 = c1 + 0.5, y1 = r1 + 0.5, x2 = c2 + 0.5, y2 = r2 + 0.5;
  const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len;
  const tipX = x2 - ux * 0.12, tipY = y2 - uy * 0.12, neckX = tipX - ux * 0.42, neckY = tipY - uy * 0.42;
  svg.innerHTML =
    `<line x1="${x1}" y1="${y1}" x2="${neckX}" y2="${neckY}" stroke-width="0.17" stroke-linecap="round"/>` +
    `<polygon points="${tipX},${tipY} ${neckX - uy * 0.27},${neckY + ux * 0.27} ${neckX + uy * 0.27},${neckY - ux * 0.27}"/>`;
  return svg;
}

function drawArrow() {
  $("av-board").querySelector(".arrows")?.replaceWith(arrowSvg());
}

function promoPicker(g) {
  const box = document.createElement("div");
  box.className = "promo";
  if (!av.promo) { box.hidden = true; return box; }
  const color = g.turn();
  const [r, c] = cellOf(av.promo.to);
  box.style.left = `${c * 12.5}%`;
  // the column of choices grows away from the edge the pawn reached
  const down = r === 0;
  box.style.top = down ? "0" : "auto";
  box.style.bottom = down ? "auto" : "0";
  for (const type of ["q", "n", "r", "b"]) {
    const b = document.createElement("button");
    b.append(Object.assign(document.createElement("img"), { src: pieceSrc({ color, type }), alt: type, draggable: false }));
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const { from, to } = av.promo;
      av.promo = null;
      playUci([from + to + type]);
    });
    box.append(b);
  }
  return box;
}

function drawMoves() {
  const list = $("av-moves");
  if (!av.moves.length) {
    list.replaceChildren(Object.assign(document.createElement("span"), {
      className: "moves-empty", textContent: "Make a move on the board or click a move in an engine line.",
    }));
    return;
  }
  const blackFirst = av.start.split(" ")[1] === "b";
  let num = Number(av.start.split(" ")[5]) || 1;
  const parts = [];
  av.moves.forEach((m, i) => {
    const whiteMove = blackFirst ? i % 2 === 1 : i % 2 === 0;
    if (whiteMove) parts.push(Object.assign(document.createElement("span"), { className: "num", textContent: num + "." }));
    else if (i === 0) parts.push(Object.assign(document.createElement("span"), { className: "num", textContent: num + "…" }));
    const b = Object.assign(document.createElement("button"), { className: "mv" + (i + 1 === av.ply ? " on" : ""), textContent: m.san });
    b.addEventListener("click", () => goTo(i + 1));
    parts.push(b);
    if (!whiteMove) num++;
  });
  list.replaceChildren(...parts);
  list.querySelector(".mv.on")?.scrollIntoView({ block: "nearest" });
}

// ---------- engine output

function onEngine(u) {
  if (u.error) { $("av-msg").textContent = "Engine error: " + u.error; return; }
  if (u.fen !== currentFen() || !isOpen()) return;
  const lines = u.lines;
  if (!lines.length) return;
  const white = u.fen.split(" ")[1] === "w" ? 1 : -1; // engine scores are for the side to move
  $("av-msg").textContent = "";
  $("av-depth").textContent = "depth " + lines[0].depth + (u.done ? "" : "…");
  setEval({ ...lines[0], white });
  $("av-lines").replaceChildren(...lines.map((l) => lineItem(u.fen, l, white)));
  if (av.bestMove !== lines[0].pv[0]) {
    av.bestMove = lines[0].pv[0];
    drawArrow();
  }
}

function lineItem(fen, l, white) {
  const li = document.createElement("li");
  li.append(Object.assign(document.createElement("span"), { className: "line-eval", textContent: formatScore(l, white) }));
  const moves = document.createElement("span");
  moves.className = "line-moves";
  const g = new Chess(fen);
  let n = Number(fen.split(" ")[5]) || 1;
  const pv = l.pv.slice(0, 12);
  pv.forEach((uci, i) => {
    let mv;
    try { mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }); } catch { return; }
    if (mv.color === "w") moves.append(n + ". ");
    else if (i === 0) moves.append(n + "… ");
    if (mv.color === "b") n++;
    const b = Object.assign(document.createElement("button"), { className: "mv", textContent: mv.san });
    b.title = "Play up to this move";
    b.addEventListener("click", () => playUci(pv.slice(0, i + 1)));
    moves.append(b, " ");
  });
  li.append(moves);
  return li;
}

function formatScore(l, white) {
  if (l.mate !== null && l.mate !== undefined) return "#" + l.mate * white;
  const v = (l.cp * white) / 100;
  return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(2);
}

function setEval(l, label) {
  const fill = $("av-evalbar-fill");
  if (!l) { $("av-eval").textContent = "–"; fill.style.height = "50%"; return; }
  const white = l.white;
  $("av-eval").textContent = label ?? formatScore(l, white);
  const share = l.mate !== null && l.mate !== undefined
    ? (l.mate * white > 0 || (l.mate === 0 && white > 0) ? 100 : 0)
    : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * l.cp * white)) - 1);
  fill.style.height = share.toFixed(1) + "%";
}

// ---------- input

function squareAt(x, y) {
  const rect = $("av-board").getBoundingClientRect();
  const c = Math.floor(((x - rect.left) / rect.width) * 8);
  const r = Math.floor(((y - rect.top) / rect.height) * 8);
  return r >= 0 && r < 8 && c >= 0 && c < 8 ? squareOf(r, c) : null;
}

$("av-board").addEventListener("pointerdown", (e) => {
  if (e.button > 0 || av.promo) return;
  const sq = squareAt(e.clientX, e.clientY);
  if (!sq) return;
  e.preventDefault();
  if (av.selected && av.selected !== sq && tryMove(av.selected, sq)) return;
  const g = new Chess(currentFen());
  const piece = g.get(sq);
  if (!piece || piece.color !== g.turn()) {
    av.selected = null;
    render();
    return;
  }
  av.selected = sq;
  const size = $("av-board").getBoundingClientRect().width / 8;
  const ghost = Object.assign(document.createElement("img"), { src: pieceSrc(piece), className: "ghost", draggable: false });
  ghost.style.width = ghost.style.height = size + "px";
  ghost.style.left = e.clientX + "px";
  ghost.style.top = e.clientY + "px";
  document.body.append(ghost);
  av.drag = { from: sq, ghost };
  drawBoard(g);
});

window.addEventListener("pointermove", (e) => {
  if (!av.drag) return;
  av.drag.ghost.style.left = e.clientX + "px";
  av.drag.ghost.style.top = e.clientY + "px";
});

function endDrag(e) {
  if (!av.drag) return;
  const { from, ghost } = av.drag;
  av.drag = null;
  ghost.remove();
  const to = e.type === "pointercancel" ? null : squareAt(e.clientX, e.clientY);
  if (to && to !== from && tryMove(from, to)) return;
  if (to !== from) av.selected = null; // dropped elsewhere: put the piece back
  drawBoard(new Chess(currentFen()));
}
window.addEventListener("pointerup", endDrag);
window.addEventListener("pointercancel", endDrag);

$("av-first").addEventListener("click", () => goTo(0));
$("av-prev").addEventListener("click", () => goTo(av.ply - 1));
$("av-next").addEventListener("click", () => goTo(av.ply + 1));
$("av-last").addEventListener("click", () => goTo(av.moves.length));
$("av-flip").addEventListener("click", () => { av.flipped = !av.flipped; render(); });
$("av-back").addEventListener("click", closeAnalysis);

document.addEventListener("keydown", (e) => {
  if (!isOpen() || e.target.closest?.("input, textarea")) return;
  const keys = { ArrowLeft: av.ply - 1, ArrowRight: av.ply + 1, ArrowUp: 0, Home: 0, ArrowDown: av.moves.length, End: av.moves.length };
  if (e.key in keys) { e.preventDefault(); goTo(keys[e.key]); }
  else if (e.key === "f") { av.flipped = !av.flipped; render(); }
  else if (e.key === "Escape" && av.promo) { av.promo = null; render(); }
});

$("av-engine-on").checked = (() => { try { return localStorage.getItem("engine-on") !== "0"; } catch { return true; } })();
$("av-engine-on").addEventListener("change", () => {
  try { localStorage.setItem("engine-on", $("av-engine-on").checked ? "1" : "0"); } catch {}
  render();
});

$("av-copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText($("av-fen").value);
  $("av-copy").textContent = "Copied";
  setTimeout(() => ($("av-copy").textContent = "Copy"), 1500);
});

$("av-pgn").addEventListener("click", () => {
  // the starting position plus the moves played here
  const g = new Chess(av.start);
  for (const m of av.moves) g.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] });
  g.setHeader("Event", "Analysis of a position from an image");
  g.setHeader("Date", new Date().toISOString().slice(0, 10).replaceAll("-", "."));
  const stamp = new Date().toISOString().slice(0, 16).replace("T", "_").replace(":", "-");
  const url = URL.createObjectURL(new Blob([g.pgn() + "\n"], { type: "application/x-chess-pgn" }));
  Object.assign(document.createElement("a"), { href: url, download: `analysis_${stamp}.pgn` }).click();
  URL.revokeObjectURL(url);
});

$("av-lichess").addEventListener("click", () => {
  const fen = currentFen();
  window.open("https://lichess.org/analysis/" + fen.replaceAll(" ", "_") + (av.flipped ? "?color=black" : ""), "_blank", "noopener");
});
