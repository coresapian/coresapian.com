#!/usr/bin/env python3
"""
Generate CoreSapian ⟁ (U+27C1) favicon/icon set.

Renders the ⟁ glyph — an outer outline triangle with a smaller solid triangle
inside — in glowing orange (#FF8C00) on near-black (#050200) background.
The design matches the loading screen's loader__symbol element.

Outputs:
  - public/icons/android-chrome-512x512.png
  - public/icons/android-chrome-192x192.png
  - public/icons/apple-touch-icon.png (180)
  - public/icons/favicon-128x128.png
  - public/icons/favicon-96x96.png
  - public/icons/favicon-48x48.png
  - public/icons/favicon-32x32.png
  - public/icons/favicon-16x16.png
  - public/icons/mstile-150x150.png
  - public/favicon.ico (16/32/48 multi-res)
"""
from PIL import Image, ImageDraw, ImageFilter
import math
import os

BG_COLOR = (5, 2, 0, 255)           # #050200 near-black
TRIANGLE_COLOR = (255, 140, 0, 255)  # #FF8C00 glowing orange
GLOW_COLOR = (255, 140, 0, 80)       # subtle outer glow
STROKE_WIDTH_RATIO = 0.035           # outline thickness relative to canvas size

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS_DIR = os.path.join(PROJECT_ROOT, "public", "icons")
ICO_PATH = os.path.join(PROJECT_ROOT, "public", "favicon.ico")

PNG_SIZES = [
    ("android-chrome-512x512.png", 512),
    ("android-chrome-192x192.png", 192),
    ("apple-touch-icon.png", 180),
    ("favicon-128x128.png", 128),
    ("favicon-96x96.png", 96),
    ("favicon-48x48.png", 48),
    ("favicon-32x32.png", 32),
    ("favicon-16x16.png", 16),
    ("mstile-150x150.png", 150),
]

ICO_SIZES = [16, 32, 48]


def equilateral_points(cx, cy, height, pointing_up=True):
    """Return 3 vertices of an equilateral triangle centered at (cx, cy) with given height."""
    half_base = height * (1.0 / math.sqrt(3))  # half side length for equilateral
    if pointing_up:
        return [
            (cx, cy - height / 2),           # apex top
            (cx - half_base, cy + height / 2),  # bottom-left
            (cx + half_base, cy + height / 2),  # bottom-right
        ]
    else:
        return [
            (cx, cy + height / 2),           # apex bottom
            (cx - half_base, cy - height / 2),  # top-left
            (cx + half_base, cy - height / 2),  # top-right
        ]


def draw_icon(size: int) -> Image.Image:
    """
    Draw ⟁ (U+27C1): outer outline triangle + inner solid triangle, glowing orange on black.

    The inner triangle is ~55% the size of the outer, centered, filled solid.
    The outer triangle is drawn as a thick stroke outline.
    """
    img = Image.new("RGBA", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)

    cx = size / 2
    cy = size / 2
    outer_height = size * 0.60  # outer triangle takes 60% of canvas height

    # --- Glow layer (blurred triangle behind everything) ---
    if size >= 32:
        glow_height = size * 0.68
        glow_pts = equilateral_points(cx, cy, glow_height, pointing_up=True)
        glow_img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        glow_draw = ImageDraw.Draw(glow_img)
        glow_draw.polygon(glow_pts, fill=GLOW_COLOR)
        glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=size * 0.05))
        img = Image.alpha_composite(img, glow_img)
        draw = ImageDraw.Draw(img)

    # --- Outer triangle (outline / stroke) ---
    outer_pts = equilateral_points(cx, cy, outer_height, pointing_up=True)
    stroke_w = max(2, int(size * STROKE_WIDTH_RATIO))
    draw.polygon(outer_pts, outline=TRIANGLE_COLOR, width=stroke_w)

    # --- Inner triangle (solid filled, smaller, centered) ---
    inner_height = outer_height * 0.50
    inner_pts = equilateral_points(cx, cy, inner_height, pointing_up=True)
    draw.polygon(inner_pts, fill=TRIANGLE_COLOR)

    return img


def main():
    os.makedirs(ICONS_DIR, exist_ok=True)

    # Generate PNGs
    for filename, size in PNG_SIZES:
        img = draw_icon(size)
        path = os.path.join(ICONS_DIR, filename)
        img.save(path, "PNG")
        print(f"  ✓ {filename} ({size}x{size})")

    # Generate multi-resolution ICO
    ico_images = [draw_icon(s) for s in ICO_SIZES]
    ico_images[0].save(
        ICO_PATH,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=ico_images[1:],
    )
    print(f"  ✓ favicon.ico (16/32/48)")

    print(f"\nDone. {len(PNG_SIZES)} PNGs + 1 ICO generated.")


if __name__ == "__main__":
    main()
