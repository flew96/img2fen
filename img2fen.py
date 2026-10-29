"""Распознать шахматную позицию на картинке и вывести FEN.

Примеры:
    python img2fen.py screenshot.png
    python img2fen.py                      # картинка из буфера обмена
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
            sys.exit("В буфере обмена нет картинки. Укажите путь к файлу или скопируйте скриншот.")
        return clip.convert("RGB")
    return Image.open(path).convert("RGB")


def main():
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description="Шахматная позиция с картинки -> FEN")
    ap.add_argument("images", nargs="*", help="файлы картинок (без аргументов — из буфера обмена)")
    ap.add_argument("--turn", choices=["w", "b"], default="w", help="чей ход (по умолчанию белых)")
    ap.add_argument("--orientation", choices=["auto", "white", "black"], default="auto",
                    help="чьи фигуры внизу картинки (по умолчанию — определить автоматически)")
    ap.add_argument("--box", type=int, nargs=4, metavar=("X0", "Y0", "X1", "Y1"),
                    help="задать положение доски вручную, если автоопределение ошиблось")
    ap.add_argument("--debug", metavar="PNG", help="сохранить картинку с найденной сеткой")
    ap.add_argument("--en-croissant", action="store_true", help="открыть позицию в En Croissant")
    ap.add_argument("--json", action="store_true", help="вывод в JSON")
    ap.add_argument("--fen-only", action="store_true", help="печатать только FEN")
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
                sys.exit("En Croissant не найден (ожидался %LOCALAPPDATA%\\en-croissant\\en-croissant.exe).")
            encroissant.open_position(res.fen, exe)
        name = path or "буфер обмена"
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
                print("! Сетка доски не найдена — вся картинка считается доской.")
            if args.orientation == "auto":
                print("Ориентация (авто, поменять: --orientation):",
                      "чёрные внизу" if res.flipped else "белые внизу")
            if res.doubtful:
                print("Сомнительные поля:", ", ".join(res.doubtful))
            for p in res.problems:
                print("! Позиция некорректна:", p)
            print("Анализ:", lichess)
    if args.json:
        print(json.dumps(out if len(out) > 1 else out[0], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
