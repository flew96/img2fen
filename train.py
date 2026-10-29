"""Train the square classifier on synthetic boards.

    python train.py                     # full training -> model/squarenet.pt
    python train.py --holdout fantasy,pixel,cardinal --steps 3000
        # check generalization to piece sets never seen in training
"""
import argparse
import random
import time

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, IterableDataset

from chessfen.detect import split_squares
from chessfen.model import TILE, SquareNet
from chessfen.pieces import ROOT, load_piece_sets
from chessfen.synth import random_board

EXCLUDED_SETS = {"letter"}  # its pawn is a plain dot, same as a move hint


def board_to_tiles(img, labels, rng, jitter=0.012):
    """Slice a rendered board like inference does, with small grid misalignment."""
    a = np.asarray(img)
    h, w = a.shape[:2]
    j = lambda size: rng.uniform(-jitter, jitter) * size
    box = (j(w), j(h), w + j(w), h + j(h))
    tiles = split_squares(a, box, TILE)
    return tiles, labels.reshape(-1)


class BoardStream(IterableDataset):
    def __init__(self, set_names, seed):
        self.set_names, self.seed = set_names, seed

    def __iter__(self):
        info = torch.utils.data.get_worker_info()
        rng = random.Random(self.seed + (info.id if info else 0) * 1000003)
        sets = load_piece_sets(names=self.set_names)
        while True:
            img, labels = random_board(sets, rng)
            tiles, y = board_to_tiles(img, labels, rng)
            if rng.random() < 0.5:
                tiles = tiles[:, :, ::-1]  # mirrored pieces are still the same pieces
            if rng.random() < 0.08:
                tiles = np.repeat(tiles.mean(axis=3, keepdims=True), 3, axis=3).astype(np.uint8)
            yield torch.from_numpy(np.ascontiguousarray(tiles)).permute(0, 3, 1, 2), torch.from_numpy(y)


def make_eval_set(set_names, n_boards, seed):
    rng = random.Random(seed)
    sets = load_piece_sets(names=set_names)
    xs, ys = [], []
    for _ in range(n_boards):
        img, labels = random_board(sets, rng)
        tiles, y = board_to_tiles(img, labels, rng)
        xs.append(torch.from_numpy(tiles).permute(0, 3, 1, 2))
        ys.append(torch.from_numpy(y))
    return torch.stack(xs), torch.stack(ys)


@torch.no_grad()
def evaluate(model, x, y, device):
    model.eval()
    preds = []
    for i in range(0, len(x), 16):
        xb = x[i:i + 16].reshape(-1, 3, TILE, TILE).to(device)
        preds.append(model(xb).argmax(1).reshape(-1, 64).cpu())
    model.train()
    p = torch.cat(preds)
    return (p == y).float().mean().item(), (p == y).all(1).float().mean().item()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--steps", type=int, default=12000)
    ap.add_argument("--boards-per-batch", type=int, default=8)
    ap.add_argument("--workers", type=int, default=12)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--holdout", default="", help="comma-separated piece sets to keep out of training")
    ap.add_argument("--out", default=str(ROOT / "model" / "squarenet.pt"))
    args = ap.parse_args()

    all_sets = sorted(p.name for p in (ROOT / "data" / "pieces").iterdir() if p.is_dir())
    holdout = {s for s in args.holdout.split(",") if s}
    train_sets = [s for s in all_sets if s not in holdout and s not in EXCLUDED_SETS]
    print(f"training on {len(train_sets)} piece sets, holdout: {sorted(holdout) or '-'}")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SquareNet().to(device).to(memory_format=torch.channels_last)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, args.lr, total_steps=args.steps, pct_start=0.1)
    loss_fn = nn.CrossEntropyLoss(label_smoothing=0.05)

    val = make_eval_set(train_sets, 300, seed=12345)
    hold = make_eval_set(sorted(holdout), 300, seed=54321) if holdout else None

    loader = DataLoader(BoardStream(train_sets, seed=1), batch_size=args.boards_per_batch,
                        num_workers=args.workers, persistent_workers=True, prefetch_factor=4)
    t0 = time.time()
    model.train()
    for step, (x, y) in enumerate(loader, 1):
        x = x.reshape(-1, 3, TILE, TILE).to(device, non_blocking=True).contiguous(memory_format=torch.channels_last)
        y = y.reshape(-1).to(device, non_blocking=True)
        with torch.autocast(device_type=device, dtype=torch.bfloat16, enabled=device == "cuda"):
            loss = loss_fn(model(x), y)
        opt.zero_grad(set_to_none=True)
        loss.backward()
        opt.step()
        sched.step()
        if step % 500 == 0 or step == args.steps:
            msg = f"step {step:>6} loss {loss.item():.4f}"
            sq, brd = evaluate(model, *val, device)
            msg += f" | val squares {sq:.4%} boards {brd:.2%}"
            if hold:
                sq, brd = evaluate(model, *hold, device)
                msg += f" | holdout squares {sq:.4%} boards {brd:.2%}"
            print(msg + f" | {time.time() - t0:.0f}s", flush=True)
        if step >= args.steps:
            break

    out = __import__("pathlib").Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out)
    print("saved", out)


if __name__ == "__main__":
    main()
