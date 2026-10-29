# Image → FEN

Recognizes a chess position in a screenshot (lichess, chess.com, diagrams from books and websites)
and gives you the FEN.

## Website

**https://flew96.github.io/img2fen/** — paste a screenshot (Ctrl+V), drop an image, or choose a file.
Works on phones too. Recognition runs right in the browser (ONNX Runtime Web); images are never
uploaded anywhere. The recognized position opens in an editor: drag pieces from the white and black
trays onto the board, move pieces between squares, or drag them off the board to remove them.
There are links to analysis on lichess and chess.com, and a PGN download (opens in En Croissant).

The site's code is in [docs/](docs/): `detect.js` and `fen.js` are ports of `chessfen/detect.py` and
`chessfen/fen.py`; the model is `docs/squarenet.onnx`. To check that the site and the Python version
give identical results, run `tools/make_web_tests.py`, then open `tools/web_test.html` through a local
server (`python -m http.server` in the project root).

## Windows app

A desktop window with the same recognition plus En Croissant integration (interface in Russian).

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv torch --index-url https://download.pytorch.org/whl/cu128
uv pip install --python .venv -r requirements.txt
.venv/Scripts/python tools/make_shortcut.py      # "Картинка в FEN" shortcut on the Desktop and in Start
```

Take a screenshot (Win+Shift+S) and open the app — the image in the clipboard is recognized right away;
after that, paste new screenshots with Ctrl+V. You can also start it with `.venv/Scripts/python gui.py`.

### En Croissant

The **En Croissant** button saves the position to `Documents\chess-positions\position_<date>.pgn`
and opens it in En Croissant in a new tab. The **"open in En Croissant right away"** checkbox does this
automatically after every recognition (if a board was found and the position is legal); the setting
is remembered. From the command line: `img2fen.py image.png --en-croissant`.

En Croissant can't hand a file to a window that is already open, so each position opens in a new
En Croissant window.

### Command line

```bash
.venv/Scripts/python img2fen.py screenshot.png
```

Without arguments the image is taken from the clipboard. Useful options:

| option | what it does |
|---|---|
| `--turn b` | Black to move (can't be seen in the image; default `w`) |
| `--orientation black` | Black at the bottom of the image (detected automatically by default) |
| `--debug out.png` | save the image with the detected grid and recognized pieces |
| `--box X0 Y0 X1 Y1` | set the board position by hand |
| `--fen-only`, `--json` | output format |

Castling rights are set when the king and rook stand on their starting squares; en passant is `-`.

## How it works

1. **Board detection** ([chessfen/detect.py](chessfen/detect.py)). The boundaries between squares are
   long, straight, equally spaced color edges. The vertical grid lines give the board's top and bottom,
   the horizontal ones give its left and right; the grid is then refined with least squares.
   The board is found even in a full-screen screenshot with UI around it.
2. **Slicing** into 64 squares of 64×64 px.
3. **Classification** of each square by a small CNN ([chessfen/model.py](chessfen/model.py)) into 13 classes
   (empty + 12 pieces).
4. **Orientation** from where the pawns and kings stand; **FEN** and legality checks via `python-chess`.

The network is trained on synthetic data only ([chessfen/synth.py](chessfen/synth.py)): 39 lichess piece
sets, random board colors and textures, last-move highlights, check, move dots, arrows, coordinates,
scaling, blur, and JPEG artifacts.

## Retraining

```bash
.venv/Scripts/python tools/download_pieces.py    # lichess piece sets -> data/pieces
.venv/Scripts/python train.py                    # ~15 min on an RTX 4090 -> model/squarenet.pt
```

To add a new piece style, put 12 SVGs (`wK.svg` … `bP.svg`) into `data/pieces/<name>/`.

Checks: `tools/eval_detect.py` (board detection on synthetic screenshots),
`tools/eval_real.py` (real lichess images from `tools/fetch_lichess_tests.py`).

After retraining, update the website's model:

```bash
.venv/Scripts/python -c "import torch; from chessfen.model import load_model; torch.onnx.export(load_model('model/squarenet.pt'), torch.zeros(64, 3, 64, 64), 'docs/squarenet.onnx', input_names=['tiles'], output_names=['logits'], dynamic_axes={'tiles': {0: 'n'}, 'logits': {0: 'n'}}, opset_version=17, dynamo=False)"
```

## Credits

Training piece sets come from [lichess](https://github.com/lichess-org/lila/tree/master/public/piece)
(each set has its own license; they are not included in this repository). The website's editor pieces
(`docs/pieces/`) and the icon are the cburnett set by Colin M.L. Burnett,
licensed [GPLv2+](https://www.gnu.org/licenses/gpl-2.0.txt).

## Limitations

- Made for 2D on-screen boards. Photos of a real board and 3D pieces are not supported.
- Whose turn it is, en passant, and move counters can't be read from an image — set them with options.
