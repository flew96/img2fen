"""Synthetic chessboard screenshots for training and testing.

Every board gets a random theme, piece set, size, highlights, move hints,
arrows, coordinate labels and compression artifacts, so the classifier
learns to ignore everything except the piece itself.
"""
import colorsys
import io
import random

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

from .labels import EMPTY, PIECE_TO_LABEL

# (light, dark) square colors of popular sites/themes
PALETTES = [
    ((240, 217, 181), (181, 136, 99)),   # lichess brown
    ((222, 227, 230), (140, 162, 173)),  # lichess blue
    ((255, 255, 221), (134, 166, 102)),  # lichess green
    ((238, 238, 210), (118, 150, 86)),   # chess.com green
    ((237, 214, 176), (184, 135, 98)),   # chess.com brown
    ((234, 233, 210), (75, 115, 153)),   # chess.com blue
    ((220, 220, 220), (171, 171, 171)),  # grey
    ((240, 241, 240), (196, 216, 228)),  # ice
    ((159, 144, 176), (125, 74, 141)),   # purple
    ((232, 235, 239), (125, 135, 150)),  # slate
    ((255, 206, 158), (209, 139, 71)),   # classic orange
    ((235, 236, 208), (115, 149, 82)),   # tournament
    ((247, 193, 193), (227, 124, 124)),  # pink
    ((200, 200, 200), (90, 90, 90)),     # dark grey
]

HIGHLIGHTS = [
    (155, 199, 0, 105),   # lichess last move
    (255, 255, 51, 128),  # chess.com last move
    (20, 85, 30, 128),    # lichess selected
    (100, 150, 255, 100),
    (235, 97, 80, 200),   # chess.com right-click red
    (255, 170, 0, 140),
]

ARROW_COLORS = [(21, 120, 27), (136, 32, 32), (0, 48, 136), (230, 143, 0), (255, 170, 0)]

_FONT_CACHE = {}


def _font(size):
    if size not in _FONT_CACHE:
        font = None
        for name in ("arialbd.ttf", "arial.ttf", "segoeui.ttf", "DejaVuSans-Bold.ttf"):
            try:
                font = ImageFont.truetype(name, size)
                break
            except OSError:
                continue
        _FONT_CACHE[size] = font or ImageFont.load_default(size)
    return _FONT_CACHE[size]


def _random_palette(rng):
    if rng.random() < 0.7:
        light, dark = rng.choice(PALETTES)
    else:
        h = rng.random()
        s = rng.uniform(0.0, 0.6)
        lv, dv = rng.uniform(0.75, 1.0), rng.uniform(0.3, 0.7)
        light = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(h, s * 0.4, lv))
        dark = tuple(int(c * 255) for c in colorsys.hsv_to_rgb(h + rng.uniform(-0.05, 0.05), s, dv))
    jitter = lambda c: tuple(int(np.clip(v + rng.randint(-12, 12), 0, 255)) for v in c)
    return jitter(light), jitter(dark)


def _texture(size, rng):
    """Low-frequency noise (wood/marble-like) in [-1, 1]."""
    small = np.random.default_rng(rng.randrange(1 << 30)).normal(size=(rng.randint(4, 32),) * 2)
    img = Image.fromarray(((small - small.min()) / (np.ptp(small) + 1e-6) * 255).astype(np.uint8))
    if rng.random() < 0.5:  # stretched grain
        img = img.resize((img.width, max(2, img.height // 6)))
    noise = np.asarray(img.resize((size, size), Image.BICUBIC), dtype=np.float32) / 127.5 - 1
    return noise


def random_position(rng):
    """8x8 list of piece codes ('wK', ...) or None, row 0 = top of the image."""
    density = rng.uniform(0.05, 0.7)
    grid = [[None] * 8 for _ in range(8)]
    codes = [c + p for c in "wb" for p in "KQRBNP"]
    weights = [1, 1, 2, 2, 2, 4] * 2
    for r in range(8):
        for c in range(8):
            if rng.random() < density:
                grid[r][c] = rng.choices(codes, weights)[0]
    return grid


def render_board(pieces, grid, rng, square=None):
    """Draw one board. Returns (RGB PIL image, labels 8x8 numpy)."""
    s = square or rng.randint(22, 110)
    size = 8 * s
    light, dark = _random_palette(rng)

    base = np.zeros((size, size, 3), np.float32)
    for r in range(8):
        for c in range(8):
            base[r * s:(r + 1) * s, c * s:(c + 1) * s] = light if (r + c) % 2 == 0 else dark
    if rng.random() < 0.3:
        base += _texture(size, rng)[..., None] * rng.uniform(5, 30)
    board = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8)).convert("RGBA")

    overlay = Image.new("RGBA", board.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    sq = lambda r, c: (c * s, r * s, (c + 1) * s - 1, (r + 1) * s - 1)
    cells = [(r, c) for r in range(8) for c in range(8)]

    # last move / selection highlights
    for _ in range(rng.choice([0, 1, 2, 2, 2, 3, 4])):
        od.rectangle(sq(*rng.choice(cells)), fill=rng.choice(HIGHLIGHTS))
    # check glow on a king
    kings = [(r, c) for r, c in cells if grid[r][c] in ("wK", "bK")]
    if kings and rng.random() < 0.1:
        r, c = rng.choice(kings)
        for i in range(10, 0, -1):
            pad = s * (1 - i / 10) / 2
            od.ellipse((c * s + pad, r * s + pad, (c + 1) * s - pad, (r + 1) * s - pad),
                       fill=(255, 0, 0, int(25 * (10 - i) / 10)))
    board = Image.alpha_composite(board, overlay)

    # coordinate labels drawn by lichess / chess.com inside edge squares
    if rng.random() < 0.6:
        d = ImageDraw.Draw(board)
        font = _font(max(6, int(s * rng.uniform(0.14, 0.26))))
        files, ranks = "abcdefgh", "87654321"
        if rng.random() < 0.5:
            files, ranks = files[::-1], ranks[::-1]
        m = max(1, s // 20)
        for c in range(8):
            col = dark if (7 + c) % 2 == 0 else light
            d.text(((c + 1) * s - m, 8 * s - m), files[c], fill=col, font=font, anchor="rd")
        for r in range(8):
            col = dark if r % 2 == 0 else light
            d.text((m, r * s + m), ranks[r], fill=col, font=font, anchor="lt")

    # pieces
    for r, c in cells:
        code = grid[r][c]
        if code is None:
            continue
        k = rng.uniform(0.78, 1.0)
        p = int(s * k)
        pw = min(s, int(p * rng.uniform(0.9, 1.1)))  # slight aspect change for style variety
        img = pieces[code].resize((pw, p), Image.LANCZOS)
        dx = int((s - pw) / 2 + rng.uniform(-0.04, 0.04) * s)
        dy = int((s - p) / 2 + rng.uniform(-0.04, 0.04) * s)
        if rng.random() < 0.05:  # shadow, like 3D-ish themes
            shadow = Image.new("RGBA", img.size, (0, 0, 0, 0))
            shadow.putalpha(img.getchannel("A").point(lambda a: a // 3))
            board.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(s / 30)),
                                  (c * s + dx + s // 25, r * s + dy + s // 25))
        board.alpha_composite(img, (c * s + dx, r * s + dy))

    # legal move hints and arrows drawn above pieces
    overlay = Image.new("RGBA", board.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    if rng.random() < 0.3:
        color = rng.choice([(20, 85, 30, 128), (0, 0, 0, 36), (0, 0, 0, 60)])
        for r, c in rng.sample(cells, rng.randint(1, 10)):
            if grid[r][c] is None:
                rad = s * rng.uniform(0.1, 0.2)
                cx, cy = (c + 0.5) * s, (r + 0.5) * s
                od.ellipse((cx - rad, cy - rad, cx + rad, cy + rad), fill=color)
            else:
                od.ellipse((c * s + 1, r * s + 1, (c + 1) * s - 2, (r + 1) * s - 2),
                           outline=color, width=max(2, s // 12))
    for _ in range(rng.choice([0] * 8 + [1, 1, 2, 3])):
        (r1, c1), (r2, c2) = rng.sample(cells, 2)
        color = rng.choice(ARROW_COLORS) + (rng.randint(110, 200),)
        x1, y1, x2, y2 = (c1 + 0.5) * s, (r1 + 0.5) * s, (c2 + 0.5) * s, (r2 + 0.5) * s
        v = np.array([x2 - x1, y2 - y1]) / (np.hypot(x2 - x1, y2 - y1) + 1e-6)
        n = np.array([-v[1], v[0]])
        head = s * 0.4
        tip = np.array([x2, y2]) - v * s * 0.2
        neck = tip - v * head
        od.line((x1, y1, *neck), fill=color, width=int(s * rng.uniform(0.12, 0.22)))
        od.polygon([tuple(tip), tuple(neck + n * head * 0.6), tuple(neck - n * head * 0.6)], fill=color)
    board = Image.alpha_composite(board, overlay).convert("RGB")

    labels = np.array([[PIECE_TO_LABEL[g] if g else EMPTY for g in row] for row in grid], np.int64)
    return board, labels


def degrade(img, rng):
    """Screenshot / messenger artifacts: rescale, blur, color shift, JPEG."""
    if rng.random() < 0.4:
        k = rng.uniform(0.5, 1.5)
        w, h = img.size
        img = img.resize((max(16, int(w * k)), max(16, int(h * k))),
                         rng.choice([Image.BILINEAR, Image.BICUBIC, Image.LANCZOS, Image.NEAREST]))
    if rng.random() < 0.2:
        img = img.filter(ImageFilter.GaussianBlur(rng.uniform(0.3, 1.2)))
    if rng.random() < 0.4:
        a = np.asarray(img, np.float32)
        a = a * rng.uniform(0.8, 1.15) + rng.uniform(-20, 20)
        a += np.array([rng.uniform(-10, 10) for _ in range(3)], np.float32)
        img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
    if rng.random() < 0.5:
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=rng.randint(30, 95))
        img = Image.open(io.BytesIO(buf.getvalue())).convert("RGB")
    return img


def random_board(pieces_sets, rng, set_name=None, flip=False):
    """Random degraded board. Returns (image, labels 8x8 as seen in the image)."""
    pieces = pieces_sets[set_name or rng.choice(sorted(pieces_sets))]
    grid = random_position(rng)
    img, labels = render_board(pieces, grid, rng)
    return degrade(img, rng), labels


def embed_in_screenshot(board, rng):
    """Put a board on a fake UI canvas. Returns (canvas, (x0, y0, x1, y1) of the board)."""
    bw, bh = board.size
    W = bw + rng.randint(0, 900)
    H = bh + rng.randint(0, 500)
    bg = tuple(rng.randint(0, 255) for _ in range(3)) if rng.random() < 0.5 else (
        (22, 21, 18) if rng.random() < 0.5 else (48, 46, 43))
    canvas = Image.new("RGB", (W, H), bg)
    d = ImageDraw.Draw(canvas)
    # random panels, text and buttons
    for _ in range(rng.randint(0, 12)):
        x, y = rng.randint(0, W), rng.randint(0, H)
        w, h = rng.randint(20, 400), rng.randint(10, 200)
        d.rectangle((x, y, x + w, y + h), fill=tuple(rng.randint(0, 255) for _ in range(3)))
    for _ in range(rng.randint(0, 30)):
        d.text((rng.randint(0, W), rng.randint(0, H)), "Nf3 e5 1-0 Player 1500",
               fill=tuple(rng.randint(0, 255) for _ in range(3)), font=_font(rng.randint(10, 24)))
    x0, y0 = rng.randint(0, W - bw), rng.randint(0, H - bh)
    if rng.random() < 0.3:  # frame around the board
        m = rng.randint(2, 25)
        d.rectangle((x0 - m, y0 - m, x0 + bw + m, y0 + bh + m), fill=tuple(rng.randint(0, 120) for _ in range(3)))
    canvas.paste(board, (x0, y0))
    return canvas, (x0, y0, x0 + bw, y0 + bh)
