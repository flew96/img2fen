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
        chess.STATUS_NO_WHITE_KING: "нет белого короля",
        chess.STATUS_NO_BLACK_KING: "нет чёрного короля",
        chess.STATUS_TOO_MANY_KINGS: "больше одного короля одного цвета",
        chess.STATUS_TOO_MANY_WHITE_PAWNS: "больше 8 белых пешек",
        chess.STATUS_TOO_MANY_BLACK_PAWNS: "больше 8 чёрных пешек",
        chess.STATUS_PAWNS_ON_BACKRANK: "пешка на первой/последней горизонтали",
        chess.STATUS_TOO_MANY_WHITE_PIECES: "больше 16 белых фигур",
        chess.STATUS_TOO_MANY_BLACK_PIECES: "больше 16 чёрных фигур",
        chess.STATUS_OPPOSITE_CHECK: "шах стороне, которая не ходит (проверьте, чей ход)",
        chess.STATUS_TOO_MANY_CHECKERS: "слишком много шахующих фигур",
        chess.STATUS_IMPOSSIBLE_CHECK: "невозможный шах",
    }
    return [text for flag, text in messages.items() if status & flag]


def ascii_board(board_grid):
    lines = []
    for r, row in enumerate(board_grid):
        lines.append(f"{8 - r} " + " ".join(ch or "." for ch in row))
    lines.append("  a b c d e f g h")
    return "\n".join(lines)
