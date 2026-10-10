"""Generate the GatherSpace app icon, splash and store assets (Neon Night).

Brand (matches src/ThemeContext.tsx):
  - Background : #0D0B1A  (deep night purple)
  - Accent     : #FF3D8B  (hot pink)
  - Violet     : #7C5CFF  (secondary glow)
  - Lime       : #C6FF3D  (spark / highlight)
  - Ink        : #F5F3FF

Mark: a bold Unbounded "G" in hot pink with a soft glow, plus a lime "spark"
dot — the live-event pin.

Assets produced (next to this script):
  icon.png                1024x1024  launcher / store icon (no alpha, full bleed)
  adaptive-icon.png       1024x1024  Android adaptive foreground (transparent, safe-zone)
  splash-image.png        1024x1024  splash mark (transparent; app.json sets bg #0D0B1A)
  favicon.png              256x256   web favicon
  notification-icon.png    256x256   white silhouette for the Android status bar
  feature-graphic.png     1024x500   Play Store listing banner

Fonts are read from node_modules/@expo-google-fonts (run `npm install` first).

    python generate_assets.py
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

BG = (13, 11, 26)
PINK = (255, 61, 139)
VIOLET = (124, 92, 255)
LIME = (198, 255, 61)
INK = (245, 243, 255)
MUTED = (163, 157, 192)

HERE = Path(__file__).resolve().parent
FONTS = HERE.parents[1] / "node_modules" / "@expo-google-fonts"
DISPLAY = FONTS / "unbounded" / "800ExtraBold" / "Unbounded_800ExtraBold.ttf"
BODY = FONTS / "manrope" / "700Bold" / "Manrope_700Bold.ttf"


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def glow(size: tuple[int, int], center: tuple[float, float], radius: float, color, alpha: int, blur: float) -> Image.Image:
    """A blurred coloured disc on a transparent layer. The transparent pixels
    carry the same RGB so the blur doesn't drag in a dark fringe."""
    layer = Image.new("RGBA", size, color + (0,))
    d = ImageDraw.Draw(layer)
    cx, cy = center
    d.ellipse([cx - radius, cy - radius, cx + radius, cy + radius], fill=color + (alpha,))
    return layer.filter(ImageFilter.GaussianBlur(blur))


def night_background(w: int, h: int) -> Image.Image:
    """Dark base with the pink (top-right) and violet (bottom-left) glows."""
    img = Image.new("RGBA", (w, h), BG + (255,))
    s = max(w, h)
    img.alpha_composite(glow((w, h), (w * 0.95, h * 0.05), s * 0.45, PINK, 120, s * 0.16))
    img.alpha_composite(glow((w, h), (w * 0.05, h * 0.95), s * 0.5, VIOLET, 130, s * 0.18))
    return img


def g_mark(size: int, with_glow: bool = True, color=PINK, spark=LIME, scale: float = 1.0,
           center_y: float = 0.5) -> Image.Image:
    """The 'G' + spark mark on a transparent square of `size`. `scale`
    shrinks the mark within the canvas (so glows are never clipped) and
    `center_y` positions it vertically (fraction of the canvas)."""
    img = Image.new("RGBA", (size, size), color + (0,))
    unit = size * scale
    f = font(DISPLAY, int(unit * 0.62))
    tmp = ImageDraw.Draw(img)
    l, t, r, b = tmp.textbbox((0, 0), "G", font=f)
    gw, gh = r - l, b - t
    x = (size - gw) / 2 - l - unit * 0.02
    y = size * center_y - gh / 2 - t + unit * 0.02

    if with_glow:
        halo = Image.new("RGBA", (size, size), color + (0,))
        ImageDraw.Draw(halo).text((x, y), "G", font=f, fill=color + (210,))
        img.alpha_composite(halo.filter(ImageFilter.GaussianBlur(unit * 0.045)))

    ImageDraw.Draw(img).text((x, y), "G", font=f, fill=color + (255,))

    # Lime spark at the G's top-right shoulder.
    sr = unit * 0.085
    sx, sy = x + l + gw * 0.98, y + t + gh * 0.06
    if with_glow and spark is not None:
        img.alpha_composite(glow((size, size), (sx, sy), sr * 1.6, spark, 150, sr * 0.9))
    if spark is not None:
        ImageDraw.Draw(img).ellipse([sx - sr, sy - sr, sx + sr, sy + sr], fill=spark + (255,))
    return img


def make_icon():
    s = 1024
    img = night_background(s, s)
    img.alpha_composite(g_mark(s))
    img.convert("RGB").save(HERE / "icon.png", optimize=True)


def make_adaptive():
    # Android crops the outer third; keep the mark inside the 66% safe zone.
    s = 1024
    g_mark(s, scale=0.62).save(HERE / "adaptive-icon.png", optimize=True)


def make_splash():
    # Transparent square: mark + wordmark. app.json draws it at 220px wide
    # on a #0D0B1A background.
    s = 1024
    img = g_mark(s, scale=0.62, center_y=0.38)
    f = font(DISPLAY, int(s * 0.1))
    d = ImageDraw.Draw(img)
    text = "GatherSpace"
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    d.text(((s - (r - l)) / 2 - l, s * 0.74), text, font=f, fill=INK + (255,))
    img.save(HERE / "splash-image.png", optimize=True)


def make_favicon():
    s = 256
    img = night_background(s, s)
    img.alpha_composite(g_mark(s, with_glow=False))
    img.convert("RGB").save(HERE / "favicon.png", optimize=True)


def make_notification_icon():
    # Android status-bar icons must be a white silhouette on transparency.
    s = 256
    img = g_mark(s, with_glow=False, color=(255, 255, 255), spark=(255, 255, 255))
    img.save(HERE / "notification-icon.png", optimize=True)


def make_feature_graphic():
    w, h = 1024, 500
    img = night_background(w, h)
    mark = g_mark(300)
    img.alpha_composite(mark, (70, (h - 300) // 2))
    d = ImageDraw.Draw(img)
    d.text((400, 150), "GatherSpace", font=font(DISPLAY, 58), fill=INK)
    title = font(DISPLAY, 34)
    d.text((402, 245), "Find the ", font=title, fill=INK)
    vibe_x = 402 + d.textlength("Find the ", font=title)
    d.text((vibe_x, 245), "vibe.", font=title, fill=PINK)
    d.text((402, 292), "Book in seconds.", font=title, fill=INK)
    d.text((404, 356), "Concerts · comedy · workshops near you", font=font(BODY, 24), fill=MUTED)
    img.convert("RGB").save(HERE / "feature-graphic.png", optimize=True)


if __name__ == "__main__":
    make_icon()
    make_adaptive()
    make_splash()
    make_favicon()
    make_notification_icon()
    make_feature_graphic()
    print("Generated icon, adaptive-icon, splash-image, favicon, notification-icon, feature-graphic")
