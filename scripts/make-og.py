#!/usr/bin/env python3
"""
Render the Open Graph / social card (1200×630) for the explainer.

Regenerate with:  python3 scripts/make-og.py
Requires Pillow and the DejaVu fonts (both standard on most Linux images).
Only ASCII is drawn: DejaVu has no Devanagari or CJK coverage, and a card full
of tofu boxes would be worse than none.
"""

from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
OUT = Path(__file__).resolve().parent.parent / "assets" / "og.png"

FONT_DIR = "/usr/share/fonts/truetype/dejavu"
SANS = f"{FONT_DIR}/DejaVuSans.ttf"
SANS_BOLD = f"{FONT_DIR}/DejaVuSans-Bold.ttf"
MONO = f"{FONT_DIR}/DejaVuSansMono.ttf"
MONO_BOLD = f"{FONT_DIR}/DejaVuSansMono-Bold.ttf"

BG = (8, 11, 17)
SURFACE = (14, 20, 29)
BORDER = (29, 39, 52)
TEXT = (232, 238, 245)
MUTED = (147, 162, 179)
FAINT = (100, 116, 139)
ACCENT = (88, 166, 255)
ACCENT_DEEP = (31, 111, 235)
CHIP_INK = (10, 14, 20)
PALETTE = [
    (121, 192, 255),
    (255, 171, 112),
    (140, 233, 154),
    (208, 191, 255),
    (255, 212, 59),
    (102, 217, 232),
]


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(path, size)


def glow(canvas: Image.Image) -> None:
    """Soft blue halo behind the title, like the page background."""
    layer = Image.new("RGB", (W, H), (0, 0, 0))
    ImageDraw.Draw(layer).ellipse((-260, -560, 1460, 210), fill=(11, 33, 66))
    layer = layer.filter(ImageFilter.GaussianBlur(110))
    base = ImageChops.add(canvas.convert("RGB"), layer)
    canvas.paste(base.convert("RGBA"))


def chip(draw: ImageDraw.ImageDraw, x: int, y: int, text: str, fill, fnt) -> int:
    """A rounded token chip; returns the width used."""
    pad_x, pad_y = 14, 9
    left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
    width = right - left + pad_x * 2
    height = bottom - top + pad_y * 2 + 4
    draw.rounded_rectangle((x, y, x + width, y + height), radius=9, fill=fill)
    draw.text((x + pad_x - left, y + pad_y - top + 1), text, font=fnt, fill=CHIP_INK)
    return width


def main() -> None:
    canvas = Image.new("RGBA", (W, H), (*BG, 255))
    glow(canvas)
    draw = ImageDraw.Draw(canvas)

    left = 76

    # top label
    draw.text((left, 74), "TRANSFORMERS.JS  ·  ONNX RUNTIME  ·  NO SERVER",
              font=font(MONO, 19), fill=FAINT)

    # title — shrunk until it clears the corner card
    title = "How LLMs read text"
    size = 74
    while draw.textlength(title, font=font(SANS_BOLD, size)) > 800 and size > 40:
        size -= 2
    draw.text((left, 116), title, font=font(SANS_BOLD, size), fill=TEXT)
    draw.text((left, 214), "Tokenization and vector embeddings,",
              font=font(SANS, 33), fill=MUTED)
    draw.text((left, 258), "running live in your browser.",
              font=font(SANS, 33), fill=MUTED)

    # token chips
    tokens = ["The", " quick", " brown", " fox", " jumps", " over", " the", " lazy", " dog"]
    x, y = left, 348
    for index, token in enumerate(tokens):
        width = chip(draw, x, y, token, PALETTE[index % len(PALETTE)], font(MONO, 25))
        x += width + 7

    # the ids those chips become
    draw.text((left, 416), "ids", font=font(MONO, 16), fill=ACCENT_DEEP)
    draw.text((left + 42, 416),
              "464  ·  2266  ·  7586  ·  21831  ·  23  ·  2058  ·  1169  ·  ...",
              font=font(MONO, 17), fill=FAINT)

    # divider
    draw.line((left, 466, W - 76, 466), fill=BORDER, width=1)

    # three stat blocks
    stats = [
        ("5", "tokenizers", "GPT-2 · Llama 3 · Qwen · BERT · T5"),
        ("384", "dimensions", "all-MiniLM-L6-v2 sentence vectors"),
        ("7", "languages", "and the token cost of each one"),
    ]
    x = left
    for value, label, sub in stats:
        draw.text((x, 494), value, font=font(MONO_BOLD, 34), fill=ACCENT)
        width = draw.textlength(value, font=font(MONO_BOLD, 34))
        draw.text((x + width + 9, 507), label, font=font(SANS_BOLD, 19), fill=TEXT)
        draw.text((x, 546), sub, font=font(SANS, 15), fill=FAINT)
        x += 372

    # corner accent card: dimension bars, echoing the embedding chart
    bx, by = 905, 96
    draw.rounded_rectangle((bx, by, bx + 219, by + 118), radius=14, fill=SURFACE,
                           outline=BORDER, width=1)
    draw.text((bx + 16, by + 13), "384-dim vector", font=font(MONO, 15), fill=MUTED)
    peaks = [0.9, -0.55, 0.7, 0.35, -0.8, 0.5, -0.3, 0.95, 0.2, -0.6, 0.45]
    base_y = by + 72
    for index, peak in enumerate(peaks):
        px = bx + 18 + index * 17
        bar = int(abs(peak) * 33)
        colour = (46, 160, 67) if peak >= 0 else (218, 54, 51)
        if peak >= 0:
            draw.rounded_rectangle((px, base_y - bar, px + 11, base_y), radius=3, fill=colour)
        else:
            draw.rounded_rectangle((px, base_y, px + 11, base_y + bar), radius=3, fill=colour)
    draw.line((bx + 14, base_y + 1, bx + 205, base_y + 1), fill=BORDER, width=1)

    # footer url
    draw.text((left, 594), "ashiii27.github.io/tokenizer", font=font(MONO_BOLD, 20), fill=ACCENT_DEEP)

    canvas.convert("RGB").save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
