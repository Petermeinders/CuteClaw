"""One-off script to generate PWA icons from a plushie sprite. Not needed at runtime.

Run from the repo root:  python3 scripts/make_icons.py
"""
from PIL import Image, ImageDraw
import os

SRC = "assets/plush/rabbit.webp"
OUT_DIR = "assets/icons"

BG_TOP = (255, 209, 102)      # warm yellow
BG_MID = (255, 143, 178)      # bubblegum pink
BG_BOT = (126, 232, 250)      # candy cyan


def make_background(size):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        if t < 0.5:
            k = t / 0.5
            col = tuple(int(BG_TOP[i] + (BG_MID[i] - BG_TOP[i]) * k) for i in range(3))
        else:
            k = (t - 0.5) / 0.5
            col = tuple(int(BG_MID[i] + (BG_BOT[i] - BG_MID[i]) * k) for i in range(3))
        draw.line([(0, y), (size, y)], fill=col + (255,))
    # a few sparkles so the icon reads well at small sizes
    for i, (cx, cy, r) in enumerate(
        [(0.22, 0.24, 0.035), (0.78, 0.18, 0.025), (0.82, 0.72, 0.03), (0.16, 0.78, 0.02)]
    ):
        x, y, rr = cx * size, cy * size, r * size
        draw.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 255, 255, 210))
    return img


def make_icon(size, safe_ratio=0.74):
    bg = make_background(size)
    sprite = Image.open(SRC).convert("RGBA")
    target = int(size * safe_ratio)
    sprite.thumbnail((target, target), Image.LANCZOS)
    x = (size - sprite.width) // 2
    y = (size - sprite.height) // 2 - int(size * 0.02)
    bg.alpha_composite(sprite, (x, y))
    return bg


os.makedirs(OUT_DIR, exist_ok=True)

make_icon(192).save(f"{OUT_DIR}/icon-192.png")
make_icon(512).save(f"{OUT_DIR}/icon-512.png")
make_icon(512, safe_ratio=0.56).save(f"{OUT_DIR}/icon-maskable-512.png")
make_icon(192, safe_ratio=0.56).save(f"{OUT_DIR}/icon-maskable-192.png")
make_icon(180).save(f"{OUT_DIR}/apple-touch-icon.png")

fav = make_icon(64)
fav.save(f"{OUT_DIR}/favicon.ico", sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])

print("icons written to", OUT_DIR)
