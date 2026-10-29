"""Check recognition on downloaded real renders (data/real/manifest.json)."""
import argparse
import json
import pathlib
import sys

import numpy as np
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from chessfen.recognize import DEFAULT_MODEL, Recognizer  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    args = ap.parse_args()
    rec = Recognizer(args.model)
    manifest = json.loads((ROOT / "data" / "real" / "manifest.json").read_text())
    ok_pos = ok_orient = ok_squares = 0
    for name, want in sorted(manifest.items()):
        img = np.asarray(Image.open(ROOT / "data" / "real" / name).convert("RGB"))
        # orientation is checked separately, so compare placements in the right orientation
        res = rec.recognize(img, orientation="black" if want["flipped"] else "white")
        auto = rec.recognize(img)
        got = res.fen.split()[0]
        same = sum(a == b for a, b in zip(_expand(got), _expand(want["fen"])))
        ok_squares += same
        ok_pos += got == want["fen"]
        ok_orient += auto.flipped == want["flipped"]
        flag = "ok " if got == want["fen"] else "ERR"
        print(f"{flag} {name:45s} squares {same}/64 orient {'ok' if auto.flipped == want['flipped'] else 'WRONG'}"
              + ("" if got == want["fen"] else f"\n      got  {got}\n      want {want['fen']}"))
    n = len(manifest)
    print(f"\npositions {ok_pos}/{n}, squares {ok_squares}/{64 * n}, orientation {ok_orient}/{n}")


def _expand(placement):
    return "".join("." * int(ch) if ch.isdigit() else ch for ch in placement.replace("/", ""))


if __name__ == "__main__":
    main()
