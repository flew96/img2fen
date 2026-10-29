"""Class labels shared by training and inference."""

# label index -> FEN letter ("" = empty square)
CLASSES = ["", "K", "Q", "R", "B", "N", "P", "k", "q", "r", "b", "n", "p"]
EMPTY = 0
PIECE_TO_LABEL = {
    ("w" if ch.isupper() else "b") + ch.upper(): i for i, ch in enumerate(CLASSES) if ch
}
