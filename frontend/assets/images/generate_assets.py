"""Generate the Play Store / iOS App Store asset kit for GatherSpace.

Brand:
  - Primary  : #059669  (emerald green)
  - Deep BG  : #04372D  (dark forest for splash)
  - Ink text : #FFFFFF

Assets produced (into /app/frontend/assets/images):
  1. icon.png                      1024×1024   Square launcher icon (Play Store + iOS store)
  2. adaptive-icon.png             1024×1024   Android adaptive icon foreground (kept as full brand icon for backward-compat)
  3. adaptive-icon-foreground.png  1024×1024   Foreground for Play Store (GS mark on transparent, safe-area respected)
  4. splash-image.png              1284×2778   Splash screen (dark bg + GS badge + wordmark)
  5. favicon.png                     256×256   Web favicon
  6. feature-graphic.png           1024×500    Play Store listing banner
  7. notification-icon.png          256×256    Silhouette-only white icon for status bar

All are deterministic — regenerable at any time.
"""
from __future__ import annotations
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ---- Brand tokens ----
BRAND        = (5, 150, 105)         # #059669
BRAND_DARK   = (4, 55, 45)           # #04372D
BRAND_LIGHT  = (16, 185, 129)        # #10B981 - highlight
INK          = (255, 255, 255)
INK_MUTED    = (209, 250, 229)       # subtle mint
BLACK_SHADOW = (0, 0, 0, 90)

FONT_BOLD    = "/usr/share/fonts/truetype/freefont/FreeSansBold.ttf"

OUT_DIR      = Path(__file__).parent
OUT_DIR.mkdir(parents=True, exist_ok=True)


def font(size: int, path: str = FONT_BOLD) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size=size)


def rounded_rect(size: int, radius_frac: float, fill) -> Image.Image:
    """Return an RGBA image with a rounded square filling the canvas."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d   = ImageDraw.Draw(img)
    r   = int(size * radius_frac)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=fill)
    return img


def draw_gs_letters(canvas: Image.Image, size: int, color=INK, scale: float = 0.52,
                    y_offset_ratio: float = 0.0):
    """Draw a centred, bold, kerned 'GS' onto `canvas`."""
    draw = ImageDraw.Draw(canvas)
    # We render 'G' and 'S' as separate glyphs so we can tighten the kerning.
    px = int(size * scale)
    f  = font(px)
    txt = "GS"
    # Measure with default kerning first
    bbox = draw.textbbox((0, 0), txt, font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1] + int(size * y_offset_ratio)
    # Subtle inner-shadow for depth
    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(shadow).text((x, y + int(size * 0.01)), txt, font=f,
                                fill=(0, 0, 0, 60))
    shadow = shadow.filter(ImageFilter.GaussianBlur(radius=int(size * 0.008)))
    canvas.alpha_composite(shadow)
    draw.text((x, y), txt, font=f, fill=color)


def gradient_square(size: int, top, bottom) -> Image.Image:
    """Vertical linear gradient from `top` to `bottom` colour."""
    base = Image.new("RGBA", (size, size), top + (255,))
    top_rgb = top
    bot_rgb = bottom
    grad = Image.new("RGBA", (1, size))
    for y in range(size):
        t = y / (size - 1)
        r = int(top_rgb[0] + (bot_rgb[0] - top_rgb[0]) * t)
        g = int(top_rgb[1] + (bot_rgb[1] - top_rgb[1]) * t)
        b = int(top_rgb[2] + (bot_rgb[2] - top_rgb[2]) * t)
        grad.putpixel((0, y), (r, g, b, 255))
    grad = grad.resize((size, size))
    return grad


def make_launcher_icon(size: int = 1024) -> Image.Image:
    """The main 1024x1024 launcher / store icon."""
    # Soft vertical gradient background inside a rounded square (iOS clips it,
    # Play Store clips it too if we use MaskableIcon; either way it looks good).
    grad = gradient_square(size, BRAND_LIGHT, BRAND)
    mask = rounded_rect(size, radius_frac=0.22, fill=(255, 255, 255, 255))
    # Apply rounded corners by using mask alpha
    icon = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    icon.paste(grad, (0, 0), mask.split()[3])

    # Subtle top highlight for a tasteful glossy feel
    highlight = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    hd = ImageDraw.Draw(highlight)
    hd.ellipse([-size * 0.4, -size * 0.7, size * 1.4, size * 0.5],
               fill=(255, 255, 255, 28))
    highlight = highlight.filter(ImageFilter.GaussianBlur(radius=size * 0.02))
    icon.alpha_composite(highlight)

    draw_gs_letters(icon, size, color=INK, scale=0.5)
    return icon


def make_adaptive_foreground(size: int = 1024) -> Image.Image:
    """Transparent adaptive foreground: brand-green disc + GS.
    Google requires the artwork stay inside the inner 66% safe-area."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Inner disc — the visible portion after Android masks it
    inner = int(size * 0.62)
    off = (size - inner) // 2
    # Solid brand-green disc (masks cleanly to any launcher shape)
    d.ellipse([off, off, off + inner, off + inner], fill=BRAND)
    # GS on top
    sub = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_gs_letters(sub, size, color=INK, scale=0.30)
    img.alpha_composite(sub)
    return img


def make_splash(w: int = 1284, h: int = 2778) -> Image.Image:
    """Portrait splash. Deep-forest bg + centred badge + wordmark."""
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    # Vertical gradient dark → slightly deeper
    grad = Image.new("RGBA", (1, h))
    top    = BRAND_DARK
    bottom = (2, 25, 20)
    for y in range(h):
        t = y / (h - 1)
        r = int(top[0] + (bottom[0] - top[0]) * t)
        g = int(top[1] + (bottom[1] - top[1]) * t)
        b = int(top[2] + (bottom[2] - top[2]) * t)
        grad.putpixel((0, y), (r, g, b, 255))
    grad = grad.resize((w, h))
    img.paste(grad)

    # Ambient green halo behind logo
    halo = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    cx, cy = w // 2, int(h * 0.45)
    for i, alpha in enumerate([12, 20, 32]):
        r = int(w * (0.32 - i * 0.06))
        hd.ellipse([cx - r, cy - r, cx + r, cy + r],
                   fill=(16, 185, 129, alpha))
    halo = halo.filter(ImageFilter.GaussianBlur(radius=90))
    img.alpha_composite(halo)

    # Central GS badge
    badge_size = int(w * 0.34)
    badge = rounded_rect(badge_size, 0.24, BRAND + (255,))
    draw_gs_letters(badge, badge_size, color=INK, scale=0.48)
    img.paste(badge,
              (cx - badge_size // 2, cy - badge_size // 2),
              badge.split()[3])

    # Wordmark below
    f = font(int(w * 0.075))
    wm = "GatherSpace"
    d = ImageDraw.Draw(img)
    bb = d.textbbox((0, 0), wm, font=f)
    tw = bb[2] - bb[0]
    d.text((cx - tw // 2, cy + badge_size // 2 + int(h * 0.03)),
           wm, font=f, fill=INK)

    # Tagline
    ft = font(int(w * 0.028))
    tagline = "Discover events worth remembering."
    bt = d.textbbox((0, 0), tagline, font=ft)
    tw2 = bt[2] - bt[0]
    d.text((cx - tw2 // 2, cy + badge_size // 2 + int(h * 0.1)),
           tagline, font=ft, fill=INK_MUTED)
    return img


def make_favicon(size: int = 256) -> Image.Image:
    return make_launcher_icon(size)


def make_feature_graphic() -> Image.Image:
    """Play Store listing banner: 1024×500."""
    w, h = 1024, 500
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    # Horizontal gradient
    grad = Image.new("RGBA", (w, 1))
    left  = (2, 40, 30)
    right = BRAND
    for x in range(w):
        t = x / (w - 1)
        r = int(left[0] + (right[0] - left[0]) * t)
        g = int(left[1] + (right[1] - left[1]) * t)
        b = int(left[2] + (right[2] - left[2]) * t)
        grad.putpixel((x, 0), (r, g, b, 255))
    grad = grad.resize((w, h))
    img.paste(grad)

    # Left badge
    badge_size = int(h * 0.62)
    badge = rounded_rect(badge_size, 0.22, INK + (255,))
    draw_gs_letters(badge, badge_size, color=BRAND, scale=0.50)
    img.paste(badge, (int(w * 0.07), (h - badge_size) // 2), badge.split()[3])

    # Right-side text
    d = ImageDraw.Draw(img)
    title_font = font(72)
    tag_font   = font(30)
    x0 = int(w * 0.07) + badge_size + int(w * 0.05)
    d.text((x0, int(h * 0.28)), "GatherSpace", font=title_font, fill=INK)
    d.text((x0, int(h * 0.28) + 90),
           "Discover · Book · Host events near you.",
           font=tag_font, fill=INK_MUTED)
    return img


def make_notification_icon(size: int = 256) -> Image.Image:
    """Android status-bar notification icon: SOLID WHITE silhouette on
    transparent background (Android tints it automatically). Any coloured
    pixel gets rendered as a white square by newer Androids, so keep it
    grayscale."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    inner = int(size * 0.72)
    off = (size - inner) // 2
    # Rounded square silhouette
    d.rounded_rectangle([off, off, off + inner, off + inner],
                        radius=int(inner * 0.22), fill=(255, 255, 255, 255))
    # Cut out the GS letters as transparent
    letters = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_gs_letters(letters, size, color=(0, 0, 0, 0), scale=0.35)
    # We need the letters to punch through — regenerate on a mask
    mask = Image.new("L", (size, size), 0)
    md = ImageDraw.Draw(mask)
    f = font(int(size * 0.35))
    bbox = md.textbbox((0, 0), "GS", font=f)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = (size - tw) // 2 - bbox[0]
    ty = (size - th) // 2 - bbox[1]
    md.text((tx, ty), "GS", font=f, fill=255)
    # Punch: set alpha to 0 wherever mask > 0
    r, g, b, a = img.split()
    a = Image.eval(a, lambda v: v)
    a_arr = a.load()
    m_arr = mask.load()
    for y in range(size):
        for x in range(size):
            if m_arr[x, y] > 0:
                a_arr[x, y] = 0
    img.putalpha(a)
    return img


def save(img: Image.Image, name: str):
    p = OUT_DIR / name
    img.save(p, "PNG", optimize=True)
    print(f"  ✓ {name:34s} {img.size[0]:>4}×{img.size[1]:<4}  {p.stat().st_size/1024:>6.1f} KB")


def main():
    print("Generating Play Store asset kit for GatherSpace …")
    print(f"→ Output: {OUT_DIR}\n")

    save(make_launcher_icon(1024),        "icon.png")
    save(make_adaptive_foreground(1024),  "adaptive-icon.png")
    save(make_splash(1284, 2778),         "splash-image.png")
    save(make_favicon(256),               "favicon.png")
    save(make_feature_graphic(),          "feature-graphic.png")
    save(make_notification_icon(256),     "notification-icon.png")

    print("\n✔ Asset kit ready.")


if __name__ == "__main__":
    main()
