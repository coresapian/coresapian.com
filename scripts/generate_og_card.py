#!/usr/bin/env python3
"""Generate 1200x630 Open Graph social card with the ⟁ triangle logo."""
from PIL import Image, ImageDraw, ImageFilter
import os, math

BG = (5, 2, 0, 255)
AMBER = (255, 140, 0, 255)
AMBER_BRIGHT = (255, 179, 71, 255)

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(PROJECT_ROOT, "public", "og-card.png")

def draw_triangle(draw, cx, cy, h, color, fill=True, sw=0):
    hb = h / math.sqrt(3)
    pts = [(cx, cy - h/2), (cx - hb, cy + h/2), (cx + hb, cy + h/2)]
    if fill:
        draw.polygon(pts, fill=color)
    else:
        draw.polygon(pts, outline=color, width=max(1, sw))

def main():
    w, h = 1200, 630
    img = Image.new("RGBA", (w, h), BG)
    glow = Image.new("RGBA", (w, h), (0,0,0,0))
    gd = ImageDraw.Draw(glow)
    draw_triangle(gd, w//2, h//2, 300, (255, 140, 0, 80), fill=True)
    glow = glow.filter(ImageFilter.GaussianBlur(radius=40))
    img = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(img)
    draw_triangle(draw, w//2, h//2, 280, AMBER, fill=False, sw=10)
    draw_triangle(draw, w//2, h//2, 160, AMBER_BRIGHT, fill=True)
    img.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"Generated: {OUT} ({w}x{h})")

if __name__ == "__main__":
    main()
