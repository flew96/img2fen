"""Turning an 8x8 grid of piece letters into a FEN string."""
import chess

WEIGHTS = {"p": 3, "k": 2}  # pawns and kings say most about orientation


def guess_flipped(grid):
    """True if the picture looks like it is shown from Black's side.

    grid: 8x8 FEN letters ('' for empty), row 0 = top of the picture.
    White's army normally sits at the bottom of the picture."""
    def mean_row(white):
        rows = [(r, WEIGHTS.get(ch.lower(), 1)) for r in range(8) for ch in grid[r]
                if ch and ch.isupper() == white]
        total = sum(w for _, w in rows)
        return sum(r * w for r, w in rows) / total if total else None

    w, b = mean_row(True), mean_row(False)
    return w is not None and b is not None and w < b


def orient(grid, flipped):
    """Rotate a picture grid so that row 0 is rank 8 and column 0 is file a."""
    return [row[::-1] for row in grid[::-1]] if flipped else [list(row) for row in grid]


def placement(board_grid):
    parts = []
    for row in board_grid:
        s, empty = "", 0
        for ch in row:
            if ch:
                s += (str(empty) if empty else "") + ch
                empty = 0
            else:
                empty += 1
        parts.append(s + (str(empty) if empty else ""))
    return "/".join(parts)


def castling_rights(board_grid):
    """Assume castling is still possible when king and rook stand on their home squares."""
    rank1, rank8 = board_grid[7], board_grid[0]
    rights = ""
    if rank1[4] == "K":
        rights += ("K" if rank1[7] == "R" else "") + ("Q" if rank1[0] == "R" else "")
    if rank8[4] == "k":
        rights += ("k" if rank8[7] == "r" else "") + ("q" if rank8[0] == "r" else "")
    return rights or "-"


def to_fen(board_grid, turn="w", castling=None):
    rights = castling_rights(board_grid) if castling is None else (castling or "-")
    return f"{placement(board_grid)} {turn} {rights} - 0 1"


def problems(fen):
    """Human-readable reasons why the position is not legal (empty list if fine)."""
    board = chess.Board(fen)
    status = board.status()
    messages = {
        chess.STATUS_NO_WHITE_KING: "no white king",
        chess.STATUS_NO_BLACK_KING: "no black king",
        chess.STATUS_TOO_MANY_KINGS: "more than one king of the same color",
        chess.STATUS_TOO_MANY_WHITE_PAWNS: "more than 8 white pawns",
        chess.STATUS_TOO_MANY_BLACK_PAWNS: "more than 8 black pawns",
        chess.STATUS_PAWNS_ON_BACKRANK: "pawn on the first or last rank",
        chess.STATUS_TOO_MANY_WHITE_PIECES: "more than 16 white pieces",
        chess.STATUS_TOO_MANY_BLACK_PIECES: "more than 16 black pieces",
        chess.STATUS_OPPOSITE_CHECK: "the side not to move is in check (check whose turn it is)",
        chess.STATUS_TOO_MANY_CHECKERS: "too many checking pieces",
        chess.STATUS_IMPOSSIBLE_CHECK: "impossible check",
    }
    return [text for flag, text in messages.items() if status & flag]


def ascii_board(board_grid):
    lines = []
    for r, row in enumerate(board_grid):
        lines.append(f"{8 - r} " + " ".join(ch or "." for ch in row))
    lines.append("  a b c d e f g h")
    return "\n".join(lines)
