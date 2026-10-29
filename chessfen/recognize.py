"""Image -> board box -> 64 squares -> pieces -> FEN."""
from dataclasses import dataclass, field

import numpy as np
import torch

from . import fen as fenlib
from .detect import find_board, split_squares
from .labels import CLASSES
from .model import TILE, load_model
from .pieces import ROOT

DEFAULT_MODEL = ROOT / "model" / "squarenet.pt"


@dataclass
class Result:
    fen: str
    box: tuple             # (x0, y0, x1, y1) of the board in the image
    board_found: bool      # False: no grid found, the whole image was used
    flipped: bool          # picture shown from Black's side
    grid: list             # 8x8 FEN letters, row 0 = rank 8
    confidence: np.ndarray  # 8x8, probability of the chosen class
    problems: list = field(default_factory=list)

    @property
    def doubtful(self):
        """Squares (like 'e4') the model was unsure about."""
        out = []
        for r in range(8):
            for c in range(8):
                if self.confidence[r, c] < 0.8:
                    out.append("abcdefgh"[c] + str(8 - r))
        return out


class Recognizer:
    def __init__(self, model_path=DEFAULT_MODEL, device=None):
        self.device = device or ("cuda" if torch.cuda.is_available() else "cpu")
        self.model = load_model(model_path, self.device)

    @torch.no_grad()
    def classify(self, tiles):
        """tiles: (64, TILE, TILE, 3) uint8 -> (labels (64,), confidence (64,))."""
        x = torch.from_numpy(np.ascontiguousarray(tiles)).permute(0, 3, 1, 2).to(self.device)
        logits = self.model(x) + self.model(torch.flip(x, dims=[3]))  # mirror test-time augmentation
        probs = torch.softmax(logits / 2, dim=1)
        conf, labels = probs.max(1)
        return labels.cpu().numpy(), conf.cpu().numpy()

    def recognize(self, img, turn="w", orientation="auto", box=None):
        """img: HxWx3 uint8 RGB. orientation: 'auto', 'white' (white at the bottom) or 'black'."""
        img = np.ascontiguousarray(img[..., :3])
        found = box or find_board(img)
        if found is None:
            h, w = img.shape[:2]
            box = (0, 0, w, h)
        else:
            box = found
        labels, conf = self.classify(split_squares(img, box, TILE))
        picture = [[CLASSES[labels[r * 8 + c]] for c in range(8)] for r in range(8)]
        conf = conf.reshape(8, 8)

        flipped = fenlib.guess_flipped(picture) if orientation == "auto" else orientation == "black"
        grid = fenlib.orient(picture, flipped)
        if flipped:
            conf = conf[::-1, ::-1]
        fen = fenlib.to_fen(grid, turn)
        return Result(fen=fen, box=tuple(int(round(v)) for v in box), board_found=found is not None,
                      flipped=flipped, grid=grid, confidence=conf, problems=fenlib.problems(fen))
