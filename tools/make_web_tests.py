"""Reference results from the Python pipeline for checking the web version.

Writes data/webtest/*.png (synthetic screenshots) and data/webtest/expected.json
with the Python box and FEN for those and for data/real/*.png.
"""
import json
import pathlib
import random
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from chessfen.pieces import load_piece_sets  # noqa: E402
from chessfen.recognize import Recognizer  # noqa: E402
from chessfen.synth import embed_in_screenshot, random_board  # noqa: E402

OUT = ROOT / "data" / "webtest"


def main(n_synth=30):
    OUT.mkdir(parents=True, exist_ok=True)
    rec = Recognizer()
    sets = load_piece_sets()
    rng = random.Random(2024)
    files = []
    for i in range(n_synth):
        board, _ = random_board(sets, rng)
        canvas, _ = embed_in_screenshot(board, rng)
        path = OUT / f"synth_{i:02d}.png"
        canvas.save(path)
        files.append(path)
    manifest = json.loads((ROOT / "data" / "real" / "manifest.json").read_text())
    files += [ROOT / "data" / "real" / name for name in sorted(manifest)]

    expected = {}
    for path in files:
        img = np.asarray(Image.open(path).convert("RGB"))
        res = rec.recognize(img)
        expected[path.relative_to(ROOT).as_posix()] = {"box": list(res.box), "fen": res.fen}
    (OUT / "expected.json").write_text(json.dumps(expected, indent=1))
    print(len(expected), "reference results")


if __name__ == "__main__":
    main()
