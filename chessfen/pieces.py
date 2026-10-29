"""Loading and rasterizing piece sets (SVG -> RGBA PIL images)."""
import io
import pathlib
import re

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
PIECES_DIR = ROOT / "data" / "pieces"
PIECE_CODES = [c + p for c in "wb" for p in "KQRBNP"]
RENDER_SIZE = 256

# resvg rejects absolute units like width="50mm"; the viewBox alone is enough
_SVG_SIZE_ATTR = re.compile(r'(<svg\b[^>]*?)\s(?:width|height)="[^"]*"')


def _render_svg(path, size):
    import resvg_py

    svg = pathlib.Path(path).read_text(encoding="utf-8")
    svg = _SVG_SIZE_ATTR.sub(r"\1", svg, count=1)
    svg = _SVG_SIZE_ATTR.sub(r"\1", svg, count=1)
    png = resvg_py.svg_to_bytes(svg_string=svg, width=size)
    img = Image.open(io.BytesIO(bytes(png))).convert("RGBA")
    if img.size != (size, size):  # non-square viewBox: pad to a square canvas
        canvas = Image.new("RGBA", (max(img.size),) * 2, (0, 0, 0, 0))
        canvas.paste(img, ((canvas.width - img.width) // 2, (canvas.height - img.height) // 2))
        img = canvas.resize((size, size), Image.LANCZOS)
    return img


def load_piece_sets(size=RENDER_SIZE, names=None):
    """Return {set_name: {"wK": RGBA image, ...}} for every complete set on disk."""
    sets = {}
    for d in sorted(PIECES_DIR.iterdir()):
        if not d.is_dir() or (names and d.name not in names):
            continue
        files = {code: d / f"{code}.svg" for code in PIECE_CODES}
        if not all(f.exists() for f in files.values()):
            continue
        try:
            sets[d.name] = {code: _render_svg(f, size) for code, f in files.items()}
        except Exception as e:  # broken SVG: skip the whole set
            print(f"skip piece set {d.name}: {e}")
    return sets


def contact_sheet(sets, cell=48):
    """Debug helper: one row per set, 12 pieces each."""
    sheet = Image.new("RGB", (cell * 12, cell * len(sets)), (200, 180, 150))
    for r, pieces in enumerate(sets.values()):
        for c, code in enumerate(PIECE_CODES):
            p = pieces[code].resize((cell, cell), Image.LANCZOS)
            sheet.paste(p, (c * cell, r * cell), p)
    return sheet
