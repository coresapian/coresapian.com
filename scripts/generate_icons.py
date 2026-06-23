#!/usr/bin/env python3
"""
Generate CoreSapian ⟁ (U+27C1) favicon/icon set.

Renders the actual ⟁ Unicode glyph using Apple Symbols font, in glowing
orange (#FF8C00) on near-black (#050200) background. The glow is achieved
via a blurred copy of the glyph composited underneath.

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
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

BG_COLOR = (5, 2, 0, 255)           # #050200 near-black
GLOW_COLOR = (255, 140, 0, 255)     # #FF8C00 glowing orange
MAIN_COLOR = (255, 140, 0, 255)     # #FF8C00
GLYPH = "\u27c1"                    # ⟁
FONT_PATH = "/System/Library/Fonts/Apple Symbols.ttf"

# Fallback fonts if Apple Symbols is unavailable
FALLBACK_FONTS = [
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/STIXGeneral.ttf",
]

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


def find_font():
    """Find a font file that supports U+27C1."""
    candidates = [FONT_PATH] + FALLBACK_FONTS
    for path in candidates:
        if os.path.exists(path):
            try:
                f = ImageFont.truetype(path, 64)
                mask = f.getmask(GLYPH)
                if mask.size[0] > 0 and mask.size[1] > 0:
                    return path
            except Exception:
                pass
    return None


def draw_icon(size: int, font_path: str) -> Image.Image:
    """
    Render the ⟁ glyph centered on the canvas with a glowing orange effect.

    The glow is a blurred copy of the glyph at half opacity, composited
    underneath the sharp glyph layer.
    """
    # Use high-res rendering then downscale for antialiasing on small sizes
    scale = max(1, 8 if size <= 16 else 4 if size <= 48 else 2 if size <= 128 else 1)
    hr_size = size * scale

    img = Image.new("RGBA", (hr_size, hr_size), BG_COLOR)

    # Font size: fill ~75% of the canvas (larger for better small-size visibility)
    font_size = int(hr_size * 0.75)
    font = ImageFont.truetype(font_path, font_size)

    cx, cy = hr_size / 2, hr_size / 2

    # --- Glow layer: render glyph, blur, composite ---
    glow_img = Image.new("RGBA", (hr_size, hr_size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_draw.text((cx, cy), GLYPH, font=font, fill=GLOW_COLOR, anchor="mm")
    blur_radius = max(2, int(hr_size * 0.03))
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    # Boost glow opacity
    glow_alpha = glow_img.split()[3].point(lambda a: min(255, int(a * 1.5)))
    glow_img.putalpha(glow_alpha)
    img = Image.alpha_composite(img, glow_img)

    # --- Sharp glyph on top (rendered twice for thickness at small sizes) ---
    draw = ImageDraw.Draw(img)
    draw.text((cx, cy), GLYPH, font=font, fill=MAIN_COLOR, anchor="mm")
    # Slight offset re-render to thicken strokes (helps at 16x16)
    if size <= 32:
        for dx, dy in [(1, 0), (0, 1), (-1, 0), (0, -1)]:
            draw.text((cx + dx * scale, cy + dy * scale), GLYPH,
                      font=font, fill=MAIN_COLOR, anchor="mm")

    # Downscale if needed
    if scale > 1:
        img = img.resize((size, size), Image.LANCZOS)

    return img


def main():
    font_path = find_font()
    if not font_path:
        print("ERROR: No font supporting U+27C1 found. Install Apple Symbols or Arial Unicode.")
        print("Falling back to system default — glyph may not render correctly.")
        font_path = ""

    if font_path:
        font_name = os.path.basename(font_path)
        print(f"Using font: {font_name}")

    os.makedirs(ICONS_DIR, exist_ok=True)

    for filename, size in PNG_SIZES:
        if font_path:
            img = draw_icon(size, font_path)
        else:
            img = draw_icon_fallback(size)
        path = os.path.join(ICONS_DIR, filename)
        img.save(path, "PNG")
        print(f"  ✓ {filename} ({size}x{size})")

    # Multi-resolution ICO
    ico_images = [draw_icon(s, font_path) for s in ICO_SIZES]
    ico_images[0].save(
        ICO_PATH,
        format="ICO",
        sizes=[(s, s) for s in ICO_SIZES],
        append_images=ico_images[1:],
    )
    print(f"  ✓ favicon.ico (16/32/48)")

    print(f"\nDone. {len(PNG_SIZES)} PNGs + 1 ICO generated.")


def draw_icon_fallback(size: int) -> Image.Image:
    """Fallback: draw the ⟁ shape geometrically if no font is available."""
    import math
    img = Image.new("RGBA", (size, size), BG_COLOR)
    draw = ImageDraw.Draw(img)
    cx = size / 2
    cy = size / 2
    outer_h = size * 0.60
    half_base = outer_h / math.sqrt(3)
    outer = [
        (cx, cy - outer_h / 2),
        (cx - half_base, cy + outer_h / 2),
        (cx + half_base, cy + outer_h / 2),
    ]
    # Glow
    if size >= 32:
        glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        gd = ImageDraw.Draw(glow)
        gh = outer_h * 1.1
        ghb = gh / math.sqrt(3)
        gp = [(cx, cy - gh / 2), (cx - ghb, cy + gh / 2), (cx + ghb, cy + gh / 2)]
        gd.polygon(gp, fill=(255, 140, 0, 100))
        glow = glow.filter(ImageFilter.GaussianBlur(radius=size * 0.05))
        img = Image.alpha_composite(img, glow)
        draw = ImageDraw.Draw(img)
    # Outer outline
    sw = max(2, int(size * 0.035))
    draw.polygon(outer, outline=MAIN_COLOR, width=sw)
    # Inner solid triangle
    inner_h = outer_h * 0.50
    inner_hb = inner_h / math.sqrt(3)
    inner = [
        (cx, cy - inner_h / 2),
        (cx - inner_hb, cy + inner_h / 2),
        (cx + inner_hb, cy + inner_h / 2),
    ]
    draw.polygon(inner, fill=MAIN_COLOR)
    return img


if __name__ == "__main__":
    main()
