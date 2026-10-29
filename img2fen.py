"""Recognize a chess position in an image and print the FEN.

Examples:
    python img2fen.py screenshot.png
    python img2fen.py                      # image from the clipboard
    python img2fen.py board.jpg --turn b --orientation black
    python img2fen.py board.jpg --debug found.png
"""
import argparse
import json
import sys

import numpy as np
from PIL import Image, ImageGrab

from chessfen import encroissant
from chessfen.fen import ascii_board
from chessfen.overlay import draw_result
from chessfen.recognize import DEFAULT_MODEL, Recognizer


def load_image(path):
    if path is None:
        clip = ImageGrab.grabclipboard()
        if isinstance(clip, list) and clip:  # files copied in Explorer
            clip = Image.open(clip[0])
        if not isinstance(clip, Image.Image):
            sys.exit("There is no image in the clipboard. Give a file path or copy a screenshot.")
        return clip.convert("RGB")
    return Image.open(path).convert("RGB")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Chess position from an image -> FEN")
    ap.add_argument("images", nargs="*", help="image files (without arguments: from the clipboard)")
    ap.add_argument("--turn", choices=["w", "b"], default="w", help="side to move (default: White)")
    ap.add_argument("--orientation", choices=["auto", "white", "black"], default="auto",
                    help="whose pieces are at the bottom of the image (default: detect automatically)")
    ap.add_argument("--box", type=int, nargs=4, metavar=("X0", "Y0", "X1", "Y1"),
                    help="set the board position by hand if detection got it wrong")
    ap.add_argument("--debug", metavar="PNG", help="save the image with the detected grid")
    ap.add_argument("--en-croissant", action="store_true", help="open the position in En Croissant")
    ap.add_argument("--json", action="store_true", help="JSON output")
    ap.add_argument("--fen-only", action="store_true", help="print only the FEN")
    ap.add_argument("--model", default=str(DEFAULT_MODEL))
    args = ap.parse_args()

    recognizer = Recognizer(args.model)
    out = []
    for path in args.images or [None]:
        img = load_image(path)
        res = recognizer.recognize(np.asarray(img), turn=args.turn, orientation=args.orientation, box=args.box)
        if args.debug:
            draw_result(img, res).save(args.debug)
        if args.en_croissant:
            exe = encroissant.find_exe()
            if exe is None:
                sys.exit("En Croissant not found (expected %LOCALAPPDATA%\\en-croissant\\en-croissant.exe).")
            encroissant.open_position(res.fen, exe)
        name = path or "clipboard"
        lichess = "https://lichess.org/analysis/" + res.fen.replace(" ", "_")
        if args.json:
            out.append({"image": name, "fen": res.fen, "box": res.box, "board_found": res.board_found,
                        "flipped": res.flipped, "doubtful_squares": res.doubtful,
                        "problems": res.problems, "lichess": lichess})
        elif args.fen_only:
            print(res.fen)
        else:
            if len(args.images) > 1:
                print(f"== {name}")
            print(res.fen)
            print()
            print(ascii_board(res.grid))
            print()
            if not res.board_found:
                print("! Board grid not found — the whole image is treated as the board.")
            if args.orientation == "auto":
                print("Orientation (auto, change with --orientation):",
                      "Black at the bottom" if res.flipped else "White at the bottom")
            if res.doubtful:
                print("Doubtful squares:", ", ".join(res.doubtful))
            for p in res.problems:
                print("! Illegal position:", p)
            print("Analysis:", lichess)
    if args.json:
        print(json.dumps(out if len(out) > 1 else out[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
