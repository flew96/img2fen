"""Draw the detected grid and recognized pieces over the source image."""
from PIL import ImageDraw, ImageFont


def draw_result(img, res):
    img = img.convert("RGB").copy()
    d = ImageDraw.Draw(img)
    x0, y0, x1, y1 = res.box
    s_x, s_y = (x1 - x0) / 8, (y1 - y0) / 8
    width = max(1, round(s_x / 25))
    for k in range(9):
        d.line((x0 + k * s_x, y0, x0 + k * s_x, y1), fill=(255, 0, 255), width=width)
        d.line((x0, y0 + k * s_y, x1, y0 + k * s_y), fill=(255, 0, 255), width=width)
    try:
        font = ImageFont.truetype("arialbd.ttf", max(8, round(s_y * 0.3)))
    except OSError:
        font = ImageFont.load_default(max(8, round(s_y * 0.3)))
    for r in range(8):
        for c in range(8):
            pr, pc = (7 - r, 7 - c) if res.flipped else (r, c)
            ch = res.grid[r][c]
            doubtful = res.confidence[r, c] < 0.8
            if ch or doubtful:
                d.text((x0 + pc * s_x + width + 1, y0 + pr * s_y + width), ch or "?", font=font,
                       fill=(255, 0, 0) if doubtful else (0, 140, 255), stroke_width=2, stroke_fill=(255, 255, 255))
    return img
