"""Locate a 2D chessboard in a screenshot.

The boundaries between neighbouring squares of a digital board are long,
straight, equally spaced edges: 7 internal vertical lines that all span the
board's full height and 7 horizontal lines that span its full width. So the
vertical lines give the board's top/bottom and the horizontal lines give
its left/right; a candidate is accepted when enough lines sit on the 1/8 grid.
"""
import cv2
import numpy as np

MIN_BOARD = 64  # px, smallest board we try to find


def _edges(a, thresh):
    """Binary maps of strong horizontal and vertical color changes."""
    gx = np.zeros(a.shape[:2], np.float32)
    gy = np.zeros(a.shape[:2], np.float32)
    gx[:, 1:-1] = np.abs(a[:, 2:] - a[:, :-2]).max(axis=2)
    gy[1:-1, :] = np.abs(a[2:, :] - a[:-2, :]).max(axis=2)
    return (gx > thresh).astype(np.uint8), (gy > thresh).astype(np.uint8)


def _segments(binary, vertical, min_len, gap):
    """Long straight runs in a binary edge map -> list of (pos, start, end)."""
    if vertical:
        k_close, k_open = np.ones((gap, 1), np.uint8), np.ones((min_len, 1), np.uint8)
    else:
        k_close, k_open = np.ones((1, gap), np.uint8), np.ones((1, min_len), np.uint8)
    m = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k_close)
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, k_open)
    if vertical:
        m = m.T
    # runs per row; runs on neighbouring rows with the same ends form one line
    # (connected components would glue grid lines to nearby texture streaks)
    padded = np.pad(m, ((0, 0), (1, 1)))
    d = np.diff(padded.astype(np.int8), axis=1)
    rows_s, cols_s = np.nonzero(d == 1)
    _, cols_e = np.nonzero(d == -1)
    open_segs, done = [], []
    for r, a, b in zip(rows_s, cols_s, cols_e):
        for seg in open_segs:
            if seg[3] >= r - 1 and abs(seg[1] - a) <= gap and abs(seg[2] - b) <= gap:
                seg[0].append(r)
                seg[1], seg[2], seg[3] = min(seg[1], a), max(seg[2], b), r
                break
        else:
            open_segs.append([[r], a, b, r])
        if len(open_segs) > 64:
            done += [s for s in open_segs if s[3] < r - 1]
            open_segs = [s for s in open_segs if s[3] >= r - 1]
    return [(float(np.mean(rows)) + 0.5, int(a), int(b)) for rows, a, b, _ in done + open_segs]


def _extents(segs, tol):
    """Distinct (start, end) spans that at least two segments share."""
    out = []
    for _, a, b in sorted(segs, key=lambda s: s[1] - s[2]):
        if any(abs(a - a2) <= tol and abs(b - b2) <= tol for a2, b2 in out):
            continue
        support = sum(abs(a - s[1]) <= tol and abs(b - s[2]) <= tol for s in segs)
        if support >= 2:
            out.append((a, b))
    return out


def _union_len(intervals):
    total, cur_a, cur_b = 0, None, None
    for a, b in sorted(intervals):
        if cur_b is None or a > cur_b:
            total += 0 if cur_b is None else cur_b - cur_a
            cur_a, cur_b = a, b
        else:
            cur_b = max(cur_b, b)
    return total + (0 if cur_b is None else cur_b - cur_a)


def _lines(segs, start, end, lo, hi):
    """Positions of lines near [lo, hi] whose segments cover most of start..end."""
    span = end - start
    margin = 0.1 * (hi - lo)
    rel = sorted((p, max(a, start), min(b, end)) for p, a, b in segs
                 if a < end and b > start and lo - margin <= p <= hi + margin)
    lines, cluster = [], []
    for seg in rel + [(np.inf, 0, 0)]:
        if cluster and seg[0] - cluster[-1][0] > 2:
            weights = [b - a for _, a, b in cluster]
            if _union_len([(a, b) for _, a, b in cluster]) >= 0.6 * span:
                lines.append(np.average([p for p, _, _ in cluster], weights=weights))
            cluster = []
        cluster.append(seg)
    return lines


def _fit_grid(lines, lo, hi):
    """Find 9 equally spaced lines (k = 0..8) near the rough range [lo, hi].

    Returns (origin, end, hits) refined by least squares over matched lines."""
    step0 = (hi - lo) / 8
    tol = max(1.5, 0.06 * step0)
    ps = np.array(lines, np.float64)
    best_hits = []
    for step in step0 * np.linspace(0.94, 1.06, 25):
        for p in ps:
            for k in range(9):
                origin = p - k * step
                if abs(origin - lo) > 0.5 * step0:
                    continue
                ks = np.round((ps - origin) / step)
                ok = (np.abs(ps - origin - ks * step) <= tol) & (ks >= 0) & (ks <= 8)
                hits = {int(kk): pp for kk, pp in zip(ks[ok], ps[ok])}
                if len(hits) > len(best_hits):
                    best_hits = list(hits.items())
    if len(best_hits) < 2:
        return lo, hi, []
    step, origin = np.polyfit([k for k, _ in best_hits], [p for _, p in best_hits], 1)
    return origin, origin + 8 * step, best_hits


def _find(a, thresh):
    h, w = a.shape[:2]
    ex, ey = _edges(a, thresh)
    gap = max(3, min(h, w) // 150)
    v = _segments(ex, True, MIN_BOARD // 2, gap)
    hz = _segments(ey, False, MIN_BOARD // 2, gap)
    long_v = [s for s in v if s[2] - s[1] >= MIN_BOARD]
    long_h = [s for s in hz if s[2] - s[1] >= MIN_BOARD]
    best, best_score = None, 0
    for y1, y2 in _extents(long_v, 3):
        for x1, x2 in _extents(long_h, 3):
            side_v, side_h = y2 - y1, x2 - x1
            if abs(side_v - side_h) > 0.06 * max(side_v, side_h) + 4:
                continue
            fx1, fx2, cx = _fit_grid(_lines(v, y1, y2, x1, x2), x1, x2)
            fy1, fy2, cy = _fit_grid(_lines(hz, x1, x2, y1, y2), y1, y2)
            if len(cx) < 5 or len(cy) < 5:
                continue
            score = len(cx) + len(cy) + side_h / 1e5  # prefer bigger boards on ties
            if score > best_score:
                best, best_score = (fx1, fy1, fx2, fy2), score
    return best


def find_board(img):
    """img: HxWx3 uint8 RGB. Returns (x0, y0, x1, y1) or None."""
    h, w = img.shape[:2]
    scale = min(1.0, 1600 / max(h, w))
    small = cv2.resize(img, (round(w * scale), round(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else img
    a = cv2.GaussianBlur(small.astype(np.float32), (3, 3), 0)
    for thresh in (14, 7):
        box = _find(a, thresh)
        if box:
            return tuple(round(c / scale) for c in box)
    return None


def split_squares(img, box, tile=64):
    """Crop the board and cut it into 64 tiles (row-major, top-left first): (64, tile, tile, 3)."""
    x0, y0, x1, y1 = box
    h, w = img.shape[:2]
    pad = max(w, h)
    padded = cv2.copyMakeBorder(img, pad, pad, pad, pad, cv2.BORDER_REPLICATE)
    crop = padded[round(y0) + pad:round(y1) + pad, round(x0) + pad:round(x1) + pad]
    size = 8 * tile
    interp = cv2.INTER_AREA if crop.shape[0] > size else cv2.INTER_CUBIC
    board = cv2.resize(crop, (size, size), interpolation=interp)
    return board.reshape(8, tile, 8, tile, 3).transpose(0, 2, 1, 3, 4).reshape(64, tile, tile, 3)
