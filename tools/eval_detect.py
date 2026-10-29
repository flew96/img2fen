"""Measure board detection accuracy on synthetic screenshots."""
import random
import sys
import time

import numpy as np

sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent.parent))
from chessfen.detect import find_board  # noqa: E402
from chessfen.pieces import load_piece_sets  # noqa: E402
from chessfen.synth import embed_in_screenshot, random_board  # noqa: E402


def main(n=300, seed=7):
    sets = load_piece_sets()
    rng = random.Random(seed)
    ok, worst, t = 0, [], 0.0
    for i in range(n):
        board, _ = random_board(sets, rng)
        canvas, box = embed_in_screenshot(board, rng)
        t0 = time.time()
        found = find_board(np.asarray(canvas))
        t += time.time() - t0
        sq = (box[2] - box[0]) / 8
        err = None if found is None else max(abs(p - q) for p, q in zip(found, box)) / sq
        if err is not None and err <= 0.1:  # within 10% of a square
            ok += 1
        else:
            worst.append((i, box, found, err))
    print(f"detected {ok}/{n}, {t / n * 1000:.0f} ms/image")
    for w in worst[:10]:
        print("  miss", w)


if __name__ == "__main__":
    main(*(int(a) for a in sys.argv[1:]))
