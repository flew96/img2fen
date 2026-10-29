// 8x8 grid of piece letters -> FEN — a port of chessfen/fen.py.
// Grids are arrays of 8 rows of 8 FEN letters ("" = empty).

export const CLASSES = ["", "K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"];
const WEIGHTS = { p: 3, k: 2 }; // pawns and kings say most about orientation

// True if the picture looks like it is shown from Black's side
// (picture grid: row 0 = top of the picture; White normally sits at the bottom).
export function guessFlipped(grid) {
  const meanRow = (white) => {
    let total = 0, sum = 0;
    grid.forEach((row, r) => row.forEach((ch) => {
      if (ch && (ch === ch.toUpperCase()) === white) {
        const w = WEIGHTS[ch.toLowerCase()] ?? 1;
        total += w; sum += r * w;
      }
    }));
    return total ? sum / total : null;
  };
  const w = meanRow(true), b = meanRow(false);
  return w !== null && b !== null && w < b;
}

// rotate a picture grid so that row 0 is rank 8 and column 0 is file a
export function orient(grid, flipped) {
  return flipped ? grid.slice().reverse().map((row) => row.slice().reverse()) : grid.map((row) => row.slice());
}

export function placement(board) {
  return board.map((row) => {
    let s = "", empty = 0;
    for (const ch of row) {
      if (ch) { s += (empty || "") + ch; empty = 0; } else empty++;
    }
    return s + (empty || "");
  }).join("/");
}

// castling is assumed possible when king and rook stand on their home squares
export function castlingRights(board) {
  const r1 = board[7], r8 = board[0];
  let rights = "";
  if (r1[4] === "K") rights += (r1[7] === "R" ? "K" : "") + (r1[0] === "R" ? "Q" : "");
  if (r8[4] === "k") rights += (r8[7] === "r" ? "k" : "") + (r8[0] === "r" ? "q" : "");
  return rights || "-";
}

export function toFen(board, turn = "w") {
  return `${placement(board)} ${turn} ${castlingRights(board)} - 0 1`;
}

function attacked(board, row, col, byWhite) {
  const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? board[r][c] : null);
  const own = (ch, letter) => ch === (byWhite ? letter.toUpperCase() : letter);
  const pr = byWhite ? row + 1 : row - 1; // white pawns attack upwards (towards row 0)
  if (own(at(pr, col - 1), "p") || own(at(pr, col + 1), "p")) return true;
  for (const [dr, dc] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]])
    if (own(at(row + dr, col + dc), "n")) return true;
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++)
      if ((dr || dc) && own(at(row + dr, col + dc), "k")) return true;
  const rays = [[[1, 0], [-1, 0], [0, 1], [0, -1]], [[1, 1], [1, -1], [-1, 1], [-1, -1]]];
  for (const [i, dirs] of rays.entries()) {
    const slider = i === 0 ? "r" : "b";
    for (const [dr, dc] of dirs) {
      let r = row + dr, c = col + dc;
      while (at(r, c) === "") { r += dr; c += dc; }
      const ch = at(r, c);
      if (own(ch, slider) || own(ch, "q")) return true;
    }
  }
  return false;
}

// human-readable reasons why the position is not legal (empty if fine)
export function problems(board, turn) {
  const count = (ch) => board.flat().filter((x) => x === ch).length;
  const side = (upper) => board.flat().filter((x) => x && (x === x.toUpperCase()) === upper).length;
  const out = [];
  if (count("K") === 0) out.push("no white king");
  if (count("k") === 0) out.push("no black king");
  if (count("K") > 1 || count("k") > 1) out.push("more than one king of the same color");
  if (count("P") > 8) out.push("more than 8 white pawns");
  if (count("p") > 8) out.push("more than 8 black pawns");
  if ([...board[0], ...board[7]].some((x) => x === "P" || x === "p")) out.push("pawn on the first or last rank");
  if (side(true) > 16) out.push("more than 16 white pieces");
  if (side(false) > 16) out.push("more than 16 black pieces");
  if (count("K") === 1 && count("k") === 1) {
    // the side that just moved cannot be in check
    const waiting = turn === "w" ? "k" : "K";
    for (let r = 0; r < 8; r++)
      for (let c = 0; c < 8; c++)
        if (board[r][c] === waiting && attacked(board, r, c, turn === "w"))
          out.push("the side not to move is in check (check whose turn it is)");
  }
  return out;
}

export function toPgn(fen) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}.${pad(now.getMonth() + 1)}.${pad(now.getDate())}`;
  const label = `${pad(now.getDate())}.${pad(now.getMonth() + 1)} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  return `[Event "Position from image ${label}"]\n[Site "?"]\n[Date "${date}"]\n[Round "?"]\n` +
    `[White "?"]\n[Black "?"]\n[Result "*"]\n[SetUp "1"]\n[FEN "${fen}"]\n\n*\n`;
}
