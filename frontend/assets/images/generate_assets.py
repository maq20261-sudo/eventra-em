"""Generate the GatherSpace app icon, splash and store assets (Neon Night).

Brand (matches src/ThemeContext.tsx):
  - Background : #0D0B1A  (deep night purple)
  - Accent     : #FF3D8B  (hot pink)  -> gradient through magenta to violet
  - Violet     : #7C5CFF  (secondary glow)
  - Lime       : #C6FF3D  (spark / highlight)
  - Ink        : #F5F3FF

Mark ("G-ticket"): a gradient "G" whose crossbar is a ticket stub (notches +
perforation), with three lime spark lines. The lockup puts the mark above the
stacked "Gather / Space" wordmark (Unbounded ExtraBold).

Assets produced (next to this script):
  icon.png                    1024x1024  launcher / store icon (lockup, no alpha, full bleed)
  adaptive-icon.png           1024x1024  Android adaptive foreground (lockup inside the safe circle)
  adaptive-icon-background.png 1024x1024 Android adaptive background (night glow)
  splash-image.png            1024x1024  splash lockup (transparent, fits Android 12+ circle crop)
  favicon.png                  256x256   web favicon (mark only — text is unreadable that small)
  notification-icon.png        256x256   white mark silhouette for the Android status bar
  feature-graphic.png         1024x500   Play Store listing banner

Fonts are read from node_modules/@expo-google-fonts (run `npm install` first).

    python generate_assets.py
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

BG = (13, 11, 26)
PINK = (255, 61, 139)
MAGENTA = (214, 40, 255)
VIOLET = (124, 92, 255)
LIME = (198, 255, 61)
INK = (245, 243, 255)
MUTED = (163, 157, 192)

SS = 3  # supersampling factor for smooth edges

HERE = Path(__file__).resolve().parent
FONTS = HERE.parents[1] / "node_modules" / "@expo-google-fonts"
DISPLAY = FONTS / "unbounded" / "800ExtraBold" / "Unbounded_800ExtraBold.ttf"
BODY = FONTS / "manrope" / "700Bold" / "Manrope_700Bold.ttf"


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


# ---------------------------------------------------------------- helpers

def gradient(w: int, h: int, angle: float = 60) -> Image.Image:
    """Pink -> magenta -> violet linear gradient (built small, then upscaled)."""
    sw = sh = 128
    small = Image.new("RGB", (sw, sh))
    px = small.load()
    a = math.radians(angle)
    dx, dy = math.cos(a), math.sin(a)
    span = abs(w * dx) + abs(h * dy)
    for y in range(sh):
        for x in range(sw):
            t = min(1.0, max(0.0, ((x / sw) * w * dx + (y / sh) * h * dy) / span))
            c1, c2, u = (PINK, MAGENTA, t * 2) if t < 0.5 else (MAGENTA, VIOLET, (t - 0.5) * 2)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * u) for i in range(3))
    return small.resize((w, h), Image.BICUBIC)


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
    img.alpha_composite(glow((w, h), (w * 0.95, h * 0.05), s * 0.45, PINK, 110, s * 0.18))
    img.alpha_composite(glow((w, h), (w * 0.05, h * 0.95), s * 0.5, VIOLET, 130, s * 0.18))
    return img


def neon(layer: Image.Image, strength: float = 0.5, blur: float = 0.035) -> Image.Image:
    """Soft pink glow behind a layer's opaque pixels."""
    halo = Image.new("RGBA", layer.size, PINK + (0,))
    halo.putalpha(layer.getchannel("A").point(lambda v: int(v * strength)))
    return Image.alpha_composite(halo.filter(ImageFilter.GaussianBlur(layer.size[0] * blur)), layer)


def trim(layer: Image.Image) -> Image.Image:
    """Crop a transparent layer to its visible pixels."""
    return layer.crop(layer.getchannel("A").point(lambda v: 255 if v > 8 else 0).getbbox())


def fit(base: Image.Image, layer: Image.Image, frac: float) -> Image.Image:
    """Centre `layer` (trimmed) on `base`, scaled so its longer side is `frac` of the base."""
    layer = trim(layer)
    n = base.size[0]
    k = n * frac / max(layer.size)
    layer = layer.resize((round(layer.size[0] * k), round(layer.size[1] * k)), Image.LANCZOS)
    base.alpha_composite(layer, ((base.size[0] - layer.size[0]) // 2, (base.size[1] - layer.size[1]) // 2))
    return base


def fit_in_circle(size: int, layer: Image.Image, radius_frac: float) -> Image.Image:
    """Transparent square with `layer` centred and scaled so every visible
    pixel lies inside a centred circle of radius `radius_frac * size`
    (Android adaptive-icon safe zone / Android 12 splash crop)."""
    layer = trim(layer)
    alpha = layer.getchannel("A").point(lambda v: 255 if v > 40 else 0)
    w, h = layer.size
    pts = alpha.load()
    far = 0.0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if pts[x, y]:
                far = max(far, math.hypot(x - w / 2, y - h / 2))
    k = radius_frac * size / far
    layer = layer.resize((round(w * k), round(h * k)), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.alpha_composite(layer, ((size - layer.size[0]) // 2, (size - layer.size[1]) // 2))
    return out


# ---------------------------------------------------------------- the mark

def mark_masks(size: int, sparks: bool = True):
    """Masks at size*SS: (G ring + ticket, ticket perforation, spark lines)."""
    S = size * SS
    shape = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(shape)
    cx, cy, R, r = S * 0.40, S * 0.52, S * 0.30, S * 0.175

    # G ring, open at the top right, with a rounded top terminal.
    d.pieslice([cx - R, cy - R, cx + R, cy + R], start=18, end=318, fill=255)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=0)
    a = math.radians(318)
    mid, half = (R + r) / 2, (R - r) / 2
    tx, ty = cx + mid * math.cos(a), cy + mid * math.sin(a)
    d.ellipse([tx - half, ty - half, tx + half, ty + half], fill=255)

    # Ticket stub = the G's crossbar, tilted up to the right.
    tw, th, pad = S * 0.36, S * 0.15, 20
    ticket = Image.new("L", (int(tw) + 2 * pad, int(th) + 2 * pad), 0)
    td = ImageDraw.Draw(ticket)
    td.rounded_rectangle([pad, pad, pad + tw, pad + th], radius=th * 0.16, fill=255)
    nr = th * 0.17
    for x in (pad, pad + tw):
        td.ellipse([x - nr, pad + th / 2 - nr, x + nr, pad + th / 2 + nr], fill=0)
    perf = Image.new("L", ticket.size, 0)
    pd = ImageDraw.Draw(perf)
    px, n = pad + tw * 0.66, 5
    gap = th * 0.72 / n
    for i in range(n):
        y0 = pad + th * 0.14 + i * gap
        pd.rounded_rectangle([px - th * 0.035, y0, px + th * 0.035, y0 + gap * 0.55], radius=th * 0.03, fill=255)
    ticket = ticket.rotate(16, expand=True, resample=Image.BICUBIC)
    perf = perf.rotate(16, expand=True, resample=Image.BICUBIC)
    ox, oy = int(cx - S * 0.01), int(cy - ticket.size[1] / 2 + S * 0.005)

    # Cut a thin gap in the ring around the ticket so it reads as its own piece.
    gap_mask = ticket.filter(ImageFilter.GaussianBlur(S * 0.008)).point(lambda v: 255 if v > 6 else 0)
    full = Image.new("L", (S, S), 0)
    full.paste(gap_mask, (ox, oy))
    shape = ImageChops.subtract(shape, full)
    full = Image.new("L", (S, S), 0)
    full.paste(ticket, (ox, oy))
    shape = ImageChops.lighter(shape, full)
    perforation = Image.new("L", (S, S), 0)
    perforation.paste(perf, (ox, oy))

    spark = Image.new("L", (S, S), 0)
    if sparks:
        sd = ImageDraw.Draw(spark)
        bx, by, w = cx + S * 0.33, cy - S * 0.085, int(S * 0.022)
        for ang, l0, l1 in ((-80, 0.075, 0.13), (-42, 0.075, 0.14), (-5, 0.075, 0.13)):
            a = math.radians(ang)
            p0 = (bx + S * l0 * math.cos(a), by + S * l0 * math.sin(a))
            p1 = (bx + S * l1 * math.cos(a), by + S * l1 * math.sin(a))
            sd.line([p0, p1], fill=255, width=w)
            for ex, ey in (p0, p1):
                sd.ellipse([ex - w / 2, ey - w / 2, ex + w / 2, ey + w / 2], fill=255)
    return shape, perforation, spark


def g_ticket(size: int, glow_on: bool = True, mono=None, sparks: bool = True) -> Image.Image:
    """The G-ticket mark on a transparent square. `mono` = single flat colour
    (used for the notification silhouette)."""
    shape, perforation, spark = mark_masks(size, sparks)
    S = size * SS
    fill = gradient(S, S) if mono is None else Image.new("RGB", (S, S), mono)
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    layer.paste(fill, (0, 0), shape)
    if mono is None:  # soft highlight on the top of the ring
        hl = Image.new("L", (S, S), 0)
        ImageDraw.Draw(hl).ellipse([S * 0.05, -S * 0.45, S * 0.95, S * 0.45], fill=35)
        hl = ImageChops.multiply(hl.filter(ImageFilter.GaussianBlur(S * 0.05)), shape)
        layer = Image.composite(Image.new("RGBA", (S, S), (255, 255, 255, 255)), layer, hl)
    layer.putalpha(ImageChops.subtract(layer.getchannel("A"), perforation))
    if sparks:
        lime = Image.new("RGBA", (S, S), (LIME if mono is None else mono) + (255,))
        lime.putalpha(spark)
        layer = Image.alpha_composite(layer, lime)
    layer = layer.resize((size, size), Image.LANCZOS)
    return neon(layer, 0.55, 0.04) if glow_on else layer


def wordmark(size: int) -> Image.Image:
    """Stacked "Gather" (ink) / "Space" (gradient) on a transparent square."""
    S = size * SS
    f = font(DISPLAY, int(S * 0.15))
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    for text, y, colour in (("Gather", 0.40, INK), ("Space", 0.57, None)):
        mask = Image.new("L", (S, S), 0)
        d = ImageDraw.Draw(mask)
        l, t, r, b = d.textbbox((0, 0), "Gather", font=f)  # same cap height for both lines
        tl, _, tr, _ = d.textbbox((0, 0), text, font=f)
        d.text(((S - (tr - tl)) / 2 - tl, S * y - t), text, font=f, fill=255)
        fill = Image.new("RGB", (S, S), colour) if colour else gradient(S, S, angle=0)
        out.paste(fill, (0, 0), mask)
    return out.resize((size, size), Image.LANCZOS)


def lockup(size: int = 1024) -> Image.Image:
    """Mark above the stacked wordmark (design "H")."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    mark = trim(g_ticket(size))
    k = size * 0.40 / mark.size[0]
    mark = mark.resize((int(mark.size[0] * k), int(mark.size[1] * k)), Image.LANCZOS)
    out.alpha_composite(mark, ((size - mark.size[0]) // 2 + int(size * 0.02), int(size * 0.02)))
    words = trim(wordmark(size))
    out.alpha_composite(words, ((size - words.size[0]) // 2, int(size * 0.02) + mark.size[1] + int(size * 0.035)))
    return neon(out, 0.25, 0.02)


# ---------------------------------------------------------------- assets

def make_icon(lk: Image.Image):
    img = fit(night_background(1024, 1024), lk, 0.80)
    img.convert("RGB").save(HERE / "icon.png", optimize=True)


def make_adaptive(lk: Image.Image):
    # Launchers mask the outer part; the safe zone is a centred circle of
    # 66/108 of the canvas. Keep every pixel inside it.
    fit_in_circle(1024, lk, 0.30).save(HERE / "adaptive-icon.png", optimize=True)
    night_background(1024, 1024).convert("RGB").save(HERE / "adaptive-icon-background.png", optimize=True)


def make_splash(lk: Image.Image):
    # Android 12+ shows the splash image inside a circle of 2/3 of its box;
    # fit the lockup in that circle so nothing is cropped. app.json sets the
    # #0D0B1A background and the on-screen width.
    fit_in_circle(1024, lk, 0.31).save(HERE / "splash-image.png", optimize=True)


def make_favicon():
    img = fit(night_background(256, 256), g_ticket(256, glow_on=False), 0.80)
    img.convert("RGB").save(HERE / "favicon.png", optimize=True)


def make_notification_icon():
    # Android status-bar icons must be a white silhouette on transparency.
    img = fit(Image.new("RGBA", (256, 256), (0, 0, 0, 0)),
              g_ticket(256, glow_on=False, mono=(255, 255, 255), sparks=False), 0.86)
    img.save(HERE / "notification-icon.png", optimize=True)


def make_feature_graphic(lk: Image.Image):
    w, h = 1024, 500
    img = night_background(w, h)
    side = Image.new("RGBA", (420, 420), (0, 0, 0, 0))
    img.alpha_composite(fit(side, lk, 0.92), (40, (h - 420) // 2))
    d = ImageDraw.Draw(img)
    title = font(DISPLAY, 40)
    d.text((500, 150), "Find the ", font=title, fill=INK)
    d.text((500 + d.textlength("Find the ", font=title), 150), "vibe.", font=title, fill=PINK)
    d.text((500, 205), "Book in seconds.", font=title, fill=INK)
    d.text((502, 290), "Concerts · comedy · workshops", font=font(BODY, 26), fill=MUTED)
    d.text((502, 326), "happening near you", font=font(BODY, 26), fill=MUTED)
    img.convert("RGB").save(HERE / "feature-graphic.png", optimize=True)


if __name__ == "__main__":
    lk = lockup()
    make_icon(lk)
    make_adaptive(lk)
    make_splash(lk)
    make_favicon()
    make_notification_icon()
    make_feature_graphic(lk)
    print("Generated icon, adaptive-icon(+background), splash-image, favicon, notification-icon, feature-graphic")
