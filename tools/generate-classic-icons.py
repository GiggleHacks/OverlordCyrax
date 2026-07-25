#!/usr/bin/env python3
"""Generate Win98-style toolbar icons for the Classic Explorer.

Draws 16x16 pixel-art icons on a grid and scales them x2 to 32x32
(nearest-neighbor) so they match the existing authentic icon set in
Overlord-Server/public/assets/filebrowser-classic/icons/.

Usage:  python tools/generate-classic-icons.py
"""
import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS_DIR = ROOT / "Overlord-Server" / "public" / "assets" / "filebrowser-classic" / "icons"

W = H = 16
SCALE = 2

TRANSPARENT = (0, 0, 0, 0)
BLACK = (0, 0, 0, 255)
NAVY = (0, 0, 168, 255)
BLUE_HI = (84, 172, 252, 255)
WHITE = (255, 255, 255, 255)
OFFWHITE = (248, 248, 248, 255)
FOLDER_Y = (255, 255, 153, 255)   # #FFFF99 — sampled from folder.png
FOLDER_S = (255, 204, 153, 255)   # #FFCC99
GREEN = (0, 128, 0, 255)
GREEN_HI = (0, 200, 0, 255)
SILVER = (192, 192, 192, 255)
GRAY = (128, 128, 128, 255)
DARK = (64, 64, 64, 255)
SPARK = (255, 255, 0, 255)


def canvas():
    img = Image.new("RGBA", (W, H), TRANSPARENT)
    return img, img.load()


def save(img, name):
    out = img.resize((W * SCALE, H * SCALE), Image.NEAREST)
    out.save(ICONS_DIR / name)
    print(f"wrote {name}")


def outline(px, mask, color=BLACK):
    """Add a 1px outline around mask pixels (only onto transparent pixels)."""
    border = set()
    for (x, y) in mask:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in mask and 0 <= n[0] < W and 0 <= n[1] < H:
                border.add(n)
    for (x, y) in border:
        if px[x, y][3] == 0:
            px[x, y] = color
    return border


def fill(px, mask, color):
    for (x, y) in mask:
        if 0 <= x < W and 0 <= y < H:
            px[x, y] = color


def top_highlight(px, mask, color):
    """Highlight the top inner edge of a filled mask (Win98 3D look)."""
    for (x, y) in mask:
        if not (0 <= x < W and 0 <= y < H):
            continue
        if (x, y - 1) not in mask and px[x, y][3] != 0:
            px[x, y] = color


def rect(x0, y0, x1, y1):
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


# ── shape helpers ────────────────────────────────────────────────────────────

def arrow_h(direction):
    """Horizontal arrow mask. Head at x=1 (left) / x=14 (right), tail 7 long."""
    m = set()
    for y in range(3, 14):
        xl = 1 + (abs(8 - y) * 6) // 5
        for x in range(xl, 8):
            m.add((x, y))
    m |= rect(7, 6, 13, 10)
    if direction == "right":
        m = {(15 - x, y) for (x, y) in m}
    return m


def draw_arrow_h(px, direction, color=NAVY, hi=BLUE_HI):
    m = arrow_h(direction)
    fill(px, m, color)
    top_highlight(px, m, hi)
    outline(px, m)


def arrow_v_mask(cx, y_apex, y_base, half_base, tail_y0, tail_y1, tail_half, pointing):
    """Vertical arrow mask. pointing='up' apex at top; 'down' apex at bottom."""
    m = set()
    if pointing == "up":
        span = max(1, y_base - y_apex)
        for y in range(y_apex, y_base + 1):
            half = ((y - y_apex) * half_base) // span
            for x in range(cx - half, cx + half + 1):
                m.add((x, y))
        m |= rect(cx - tail_half, y_base + 1, cx + tail_half, tail_y1)
    else:
        span = max(1, y_apex - y_base)
        for y in range(y_base, y_apex + 1):
            half = ((y_apex - y) * half_base) // span
            for x in range(cx - half, cx + half + 1):
                m.add((x, y))
        m |= rect(cx - tail_half, tail_y0, cx + tail_half, y_base - 1)
    return m


def draw_folder(px, x0, y0, w, h, tab_w=5):
    """Classic yellow folder. (x0,y0) = top-left of tab; body starts y0+2."""
    tab_top = y0
    body_top = y0 + 2
    x1 = x0 + w - 1
    y1 = body_top + h - 1
    # outline
    for x in range(x0, x0 + tab_w):
        px[x, tab_top] = BLACK                      # tab top
    px[x0 + tab_w, tab_top + 1] = BLACK             # tab right corner
    for x in range(x0 + tab_w, x1 + 1):
        px[x, body_top] = BLACK                     # body top
    for y in range(body_top, y1 + 1):
        px[x1, y] = BLACK                           # right
    for x in range(x0, x1 + 1):
        px[x, y1] = BLACK                           # bottom
    for y in range(tab_top, y1 + 1):
        px[x0, y] = BLACK                           # left
    # fill
    for x in range(x0 + 1, x0 + tab_w):
        px[x, tab_top + 1] = FOLDER_Y               # tab inner
    for y in range(body_top + 1, y1):
        for x in range(x0 + 1, x1):
            px[x, y] = FOLDER_Y
    for x in range(x0 + 1, x1):
        px[x, body_top + 1] = OFFWHITE              # top highlight
        px[x, y1 - 1] = FOLDER_S                    # bottom shade
    return rect(x0, tab_top, x1, y1)


def draw_tray(px, x0, x1, y0, y1, slot_cx, slot_half):
    """Open tray/box with a dark slot on top."""
    m = rect(x0, y0, x1, y1)
    # border
    for x in range(x0, x1 + 1):
        px[x, y0] = BLACK
        px[x, y1] = BLACK
    for y in range(y0, y1 + 1):
        px[x0, y] = BLACK
        px[x1, y] = BLACK
    # inner fill
    for y in range(y0 + 1, y1):
        for x in range(x0 + 1, x1):
            px[x, y] = SILVER
    for x in range(x0 + 1, x1):
        px[x, y0 + 1] = WHITE                       # top highlight
        px[x, y1 - 1] = GRAY                        # bottom shade
    # dark slot in the top edge
    for x in range(slot_cx - slot_half, slot_cx + slot_half + 1):
        px[x, y0] = DARK
    return m


def sparkle_mask(cx, cy):
    return {
        (cx, cy - 2),
        (cx - 1, cy - 1), (cx, cy - 1), (cx + 1, cy - 1),
        (cx - 2, cy), (cx - 1, cy), (cx, cy), (cx + 1, cy), (cx + 2, cy),
        (cx - 1, cy + 1), (cx, cy + 1), (cx + 1, cy + 1),
        (cx, cy + 2),
    }


# ── icons ────────────────────────────────────────────────────────────────────

def icon_back():
    img, px = canvas()
    draw_arrow_h(px, "left")
    save(img, "back.png")


def icon_forward():
    img, px = canvas()
    draw_arrow_h(px, "right")
    save(img, "forward.png")


def icon_up():
    img, px = canvas()
    draw_folder(px, 1, 6, 11, 7)
    m = arrow_v_mask(cx=13, y_apex=1, y_base=5, half_base=2, tail_y0=None, tail_y1=10, tail_half=1, pointing="up")
    fill(px, m, NAVY)
    top_highlight(px, m, BLUE_HI)
    outline(px, m)
    save(img, "up.png")


def icon_newfolder():
    img, px = canvas()
    folder = draw_folder(px, 1, 6, 11, 7)
    star = sparkle_mask(12, 4)
    fill(px, star, SPARK)
    # outline star, but don't paint over the folder
    border = set()
    for (x, y) in star:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            n = (x + dx, y + dy)
            if n not in star and 0 <= n[0] < W and 0 <= n[1] < H:
                border.add(n)
    for (x, y) in border:
        if px[x, y][3] == 0:
            px[x, y] = BLACK
    save(img, "newfolder.png")


def icon_refresh():
    img, px = canvas()
    m = set()
    # top arrow → right (clean opposing-arrows glyph)
    m |= rect(3, 4, 11, 5)
    for y in range(2, 7):
        xr = 13 - abs(4 - y)
        for x in range(xr, 14):
            m.add((x, y))
    # bottom arrow → left
    m |= rect(4, 10, 12, 11)
    for y in range(9, 14):
        xl = 2 + abs(11 - y)
        for x in range(2, xl + 1):
            m.add((x, y))
    fill(px, m, GREEN)
    top_highlight(px, m, GREEN_HI)
    outline(px, m)
    save(img, "refresh.png")


def icon_upload():
    img, px = canvas()
    draw_tray(px, 2, 14, 10, 15, slot_cx=8, slot_half=3)
    m = arrow_v_mask(cx=8, y_apex=1, y_base=7, half_base=3, tail_y0=None, tail_y1=10, tail_half=1, pointing="up")
    fill(px, m, NAVY)
    top_highlight(px, m, BLUE_HI)
    outline(px, m)
    save(img, "upload.png")


def icon_download():
    img, px = canvas()
    draw_tray(px, 2, 14, 10, 15, slot_cx=8, slot_half=3)
    m = arrow_v_mask(cx=8, y_apex=11, y_base=5, half_base=3, tail_y0=1, tail_y1=None, tail_half=1, pointing="down")
    fill(px, m, NAVY)
    top_highlight(px, m, BLUE_HI)
    outline(px, m)
    save(img, "download.png")


def icon_details():
    img, px = canvas()
    # page
    for x in range(2, 14):
        px[x, 1] = BLACK
        px[x, 14] = BLACK
    for y in range(1, 15):
        px[2, y] = BLACK
        px[13, y] = BLACK
    for y in range(2, 14):
        for x in range(3, 13):
            px[x, y] = WHITE
    # list rows: 2x2 bullets + gray lines
    for r in (3, 6, 9, 12):
        for x in (4, 5):
            for y in (r, r + 1):
                px[x, y] = BLACK
        for x in range(7, 13):
            px[x, r] = GRAY
            px[x, r + 1] = GRAY
    save(img, "details.png")


def icon_thumbnails():
    img, px = canvas()
    for (cx0, cy0) in ((2, 2), (9, 2), (2, 9), (9, 9)):
        for x in range(cx0, cx0 + 5):
            px[x, cy0] = BLACK
            px[x, cy0 + 4] = BLACK
        for y in range(cy0, cy0 + 5):
            px[cx0, y] = BLACK
            px[cx0 + 4, y] = BLACK
        # 3x3 raised face
        px[cx0 + 1, cy0 + 1] = WHITE
        px[cx0 + 2, cy0 + 1] = WHITE
        px[cx0 + 1, cy0 + 2] = WHITE
        px[cx0 + 2, cy0 + 2] = SILVER
        px[cx0 + 3, cy0 + 1] = GRAY
        px[cx0 + 3, cy0 + 2] = GRAY
        px[cx0 + 1, cy0 + 3] = GRAY
        px[cx0 + 2, cy0 + 3] = GRAY
        px[cx0 + 3, cy0 + 3] = GRAY
    save(img, "thumbnails.png")


if __name__ == "__main__":
    icon_back()
    icon_forward()
    icon_up()
    icon_newfolder()
    icon_refresh()
    icon_upload()
    icon_download()
    icon_details()
    icon_thumbnails()
    print("done ->", ICONS_DIR)
