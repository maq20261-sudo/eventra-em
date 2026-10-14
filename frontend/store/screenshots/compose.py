"""Compose the designed Play Store screenshots.

Each raw phone capture in `raw/` is placed in a glowing phone frame under a
headline on the Neon Night background. Headlines live in `screens.json`;
`*words*` are drawn in lime, `\n` breaks the line.

    python compose.py            # -> play/01.png ... (1080x1920)

Raw captures come from the phone over USB (demo data from
backend/seed_screenshots.py, never production):

    adb exec-out screencap -p > raw/01-discover.png
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "assets" / "images"))
from generate_assets import BODY, DISPLAY, INK, LIME, MUTED, PINK, font, night_background  # noqa: E402

W, H = 1080, 1920
PHONE_W = 820          # screen width inside the frame
PHONE_TOP = 470        # y of the frame's top edge
BEZEL = 12
RADIUS = 64
STATUS_BAR = 0.052     # fraction of the capture height cropped off the top


def rounded(img: Image.Image, radius: int) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, img.size[0] - 1, img.size[1] - 1], radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def draw_headline(img: Image.Image, text: str, y: int) -> int:
    """Centred multi-line headline; *marked* runs in lime. Returns the y below it."""
    d = ImageDraw.Draw(img)
    lines = text.split("\n")
    # Largest size (up to 74 px) at which every line fits inside the side margins.
    size = 74
    while size > 40 and max(d.textlength(l.replace("*", ""), font=font(DISPLAY, size)) for l in lines) > W - 2 * 90:
        size -= 2
    f = font(DISPLAY, size)
    line_h = round(size * 1.3)
    for line in lines:
        runs = [(part, i % 2 == 1) for i, part in enumerate(re.split(r"\*", line)) if part]
        width = sum(d.textlength(t, font=f) for t, _ in runs)
        x = (W - width) / 2
        for t, lime in runs:
            d.text((x, y), t, font=f, fill=LIME if lime else INK)
            x += d.textlength(t, font=f)
        y += line_h
    return y


def compose(item: dict, index: int, alt: bool) -> Image.Image:
    img = night_background(W, H)
    if alt:  # alternate the glow corners so neighbouring screenshots differ
        img = img.transpose(Image.FLIP_LEFT_RIGHT)

    y = draw_headline(img, item["headline"], 120)
    sub_f = font(BODY, 34)
    d = ImageDraw.Draw(img)
    d.text(((W - d.textlength(item["sub"], font=sub_f)) / 2, y + 14), item["sub"], font=sub_f, fill=MUTED)

    shot = Image.open(HERE / "raw" / item["raw"]).convert("RGB")
    # Drop the phone's status bar (clock, battery, notification icons).
    shot = shot.crop((0, round(shot.size[1] * STATUS_BAR), shot.size[0], shot.size[1]))
    shot = shot.resize((PHONE_W, round(shot.size[1] * PHONE_W / shot.size[0])), Image.LANCZOS)
    screen = rounded(shot, RADIUS - BEZEL)

    frame_w, frame_h = PHONE_W + 2 * BEZEL, screen.size[1] + 2 * BEZEL
    fx = (W - frame_w) // 2

    glow = Image.new("RGBA", (W, H), PINK + (0,))
    ImageDraw.Draw(glow).rounded_rectangle([fx, PHONE_TOP, fx + frame_w, PHONE_TOP + frame_h], radius=RADIUS, fill=PINK + (150,))
    img.alpha_composite(glow.filter(ImageFilter.GaussianBlur(46)))

    frame = Image.new("RGBA", (frame_w, frame_h), (0, 0, 0, 0))
    ImageDraw.Draw(frame).rounded_rectangle([0, 0, frame_w - 1, frame_h - 1], radius=RADIUS, fill=(46, 42, 74, 255))
    frame.alpha_composite(screen, (BEZEL, BEZEL))
    img.alpha_composite(frame, (fx, PHONE_TOP))  # bottom runs off the canvas on purpose
    return img.convert("RGB")


def main():
    items = json.loads((HERE / "screens.json").read_text(encoding="utf-8"))
    out_dir = HERE / "play"
    out_dir.mkdir(exist_ok=True)
    missing = [i["raw"] for i in items if not (HERE / "raw" / i["raw"]).exists()]
    if missing:
        print("Missing raw captures (skipped):", ", ".join(missing))
    for n, item in enumerate(items, 1):
        if item["raw"] in missing:
            continue
        compose(item, n, alt=n % 2 == 0).save(out_dir / f"{n:02d}.png", optimize=True)
        print(f"play/{n:02d}.png  <- raw/{item['raw']}")


if __name__ == "__main__":
    main()
