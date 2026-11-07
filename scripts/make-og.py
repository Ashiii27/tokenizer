#!/usr/bin/env python3
"""
Render the social card (1200×630) in the site's own visual language.

The card is set in the *same* typefaces the site ships: the variable woff2
files in assets/fonts are instanced into static TTFs (Fraunces at a display
optical size, Space Grotesk, JetBrains Mono) so the card and the page share a
voice instead of looking like two different projects.

Requires Pillow + fonttools + brotli.  Run:  python3 scripts/make-og.py
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "og.png"
FONT_DIR = ROOT / "assets" / "fonts"
WORK = Path("/tmp/ogfonts")

W, H = 1200, 630

# ---- palette (mirrors styles/tokens.css) ---------------------------------
PAPER = (241, 236, 225)
PAPER_RAISED = (249, 245, 237)
PAPER_SUNK = (233, 227, 213)
INK = (22, 19, 15)
INK_2 = (91, 84, 73)
INK_3 = (111, 103, 89)
RULE = (213, 204, 184)
RULE_2 = (182, 171, 146)
SIGNAL = (192, 56, 15)
CHIPS = [(231, 216, 181), (206, 217, 198), (232, 201, 186), (204, 216, 228)]


def instance_fonts():
    """Variable woff2 → static TTF instances (cached in /tmp)."""
    from fontTools.ttLib import TTFont
    from fontTools.varLib.instancer import instantiateVariableFont

    WORK.mkdir(exist_ok=True)
    jobs = {
        "display": ("fraunces-latin-var.woff2", {"wght": 620, "opsz": 144}),
        "figures": ("fraunces-latin-var.woff2", {"wght": 620, "opsz": 26}),
        "serif": ("fraunces-latin-var.woff2", {"wght": 430, "opsz": 20}),
        "sans": ("space-grotesk-latin-var.woff2", {"wght": 500}),
        "mono": ("jetbrains-mono-latin-var.woff2", {"wght": 500}),
        "mono-bold": ("jetbrains-mono-latin-var.woff2", {"wght": 700}),
    }
    paths = {}
    for name, (source, location) in jobs.items():
        path = WORK / f"{name}.ttf"
        if not path.exists():
            font = TTFont(FONT_DIR / source)
            available = {axis.axisTag for axis in font["fvar"].axes}
            instantiateVariableFont(
                font, {k: v for k, v in location.items() if k in available}, updateFontNames=False
            ).save(path)
        paths[name] = path
    return paths


def font(path, size):
    return ImageFont.truetype(str(path), size)


def grain(canvas, amount=10):
    """A little paper tooth, so the flat fill doesn't look like a mockup."""
    import random

    random.seed(7)
    noise = Image.effect_noise((W, H), amount).convert("L")
    overlay = Image.merge("RGB", (noise, noise, noise))
    return Image.blend(canvas, Image.blend(canvas, overlay, 0.16), 0.5)


def diamond(draw, x, y, size, fill):
    """Fraunces has no ◆ — draw the bullet instead of shipping a tofu box."""
    draw.polygon(
        [(x, y), (x + size / 2, y - size / 2), (x + size, y), (x + size / 2, y + size / 2)],
        fill=fill,
    )


def arrow(draw, x, y, length, fill, weight=1):
    """…and no → either."""
    draw.line((x, y, x + length, y), fill=fill, width=weight)
    draw.line((x + length - 5, y - 4, x + length, y), fill=fill, width=weight)
    draw.line((x + length - 5, y + 4, x + length, y), fill=fill, width=weight)


def vertical_text(canvas, text, fnt, fill, x, y):
    """A rotated mono label — the kind of detail print layouts use in the margin."""
    probe = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    left, top, right, bottom = probe.textbbox((0, 0), text, font=fnt)
    plate = Image.new("RGBA", (right - left + 8, bottom - top + 8), (0, 0, 0, 0))
    ImageDraw.Draw(plate).text((4 - left, 4 - top), text, font=fnt, fill=fill)
    rotated = plate.rotate(90, expand=True)
    canvas.paste(rotated, (x, y), rotated)


def chip(draw, x, y, text, fill, fnt, pad=(10, 6)):
    left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
    width = right - left + pad[0] * 2
    height = bottom - top + pad[1] * 2
    draw.rectangle((x, y, x + width, y + height), fill=fill, outline=INK, width=1)
    draw.text((x + pad[0] - left, y + pad[1] - top), text, font=fnt, fill=INK)
    return width, height


def main():
    fonts = instance_fonts()

    f_display = font(fonts["display"], 84)
    f_serif = font(fonts["serif"], 26)
    f_sans = font(fonts["sans"], 21)
    f_mono = font(fonts["mono"], 15)
    f_mono_sm = font(fonts["mono"], 13)
    f_mono_b = font(fonts["mono-bold"], 15)
    f_chip = font(fonts["mono"], 17)
    f_fact = font(fonts["figures"], 40)

    canvas = Image.new("RGB", (W, H), PAPER)
    canvas = grain(canvas)
    draw = ImageDraw.Draw(canvas)

    left = 68

    # ---- masthead --------------------------------------------------------
    diamond(draw, left, 46, 9, SIGNAL)
    draw.text((left + 22, 51), "TOKENIZER", font=f_mono_b, fill=INK)
    draw.text((left + 118, 51), "—  A FIELD GUIDE TO WHAT A MODEL ACTUALLY READS",
              font=f_mono_sm, fill=INK_3)
    draw.line((left, 84, W - left, 84), fill=RULE, width=1)

    # ---- headline --------------------------------------------------------
    draw.text((left - 2, 112), "How LLMs", font=f_display, fill=INK)
    draw.text((left - 2, 196), "read", font=f_display, fill=INK)
    read_w = draw.textlength("read  ", font=f_display)
    draw.text((left + read_w - 6, 196), "text", font=f_display, fill=SIGNAL)

    subtitle = ["Text", "tokens", "integers", "vectors"]
    sx, sy = left, 306
    for index, word in enumerate(subtitle):
        draw.text((sx, sy), word, font=f_serif, fill=INK_2)
        sx += draw.textlength(word, font=f_serif) + 12
        if index < len(subtitle) - 1:
            arrow(draw, sx, sy + 17, 22, RULE_2, weight=2)
            sx += 34
    draw.text((sx, sy), "— with real models", font=f_serif, fill=INK_2)
    draw.text((left, 342), "running in your browser.", font=f_serif, fill=INK_2)

    # ---- pipeline strip --------------------------------------------------
    top = 412
    draw.line((left, top, W - left, top), fill=RULE_2, width=1)
    draw.text((left, top + 14), "TEXT", font=f_mono_sm, fill=INK_3)
    draw.text((left, top + 36), "\u201ctokens are numbers\u201d", font=f_mono, fill=INK)

    x = left + 215
    draw.text((x, top + 14), "TOKENS", font=f_mono_sm, fill=INK_3)
    cx = x
    for index, token in enumerate(["token", "s", "·are", "·numbers"]):
        w, _ = chip(draw, cx, top + 34, token, CHIPS[index % len(CHIPS)], f_chip, pad=(8, 5))
        cx += w + 5

    x = left + 590
    draw.text((x, top + 14), "IDS", font=f_mono_sm, fill=INK_3)
    widths = [3, 7, 2, 5, 9, 3, 6, 2, 8, 4, 3, 7]
    bx = x
    for width in widths:
        draw.rectangle((bx, top + 34, bx + width, top + 54), fill=INK_2)
        bx += width + 4
    draw.text((x, top + 60), "4 integers", font=f_mono_sm, fill=INK_3)

    x = left + 745
    draw.text((x, top + 14), "VECTOR", font=f_mono_sm, fill=INK_3)
    heights = [3, 7, 2, 9, 4, 8, 1, 6, 9, 3, 7, 2, 5, 8, 4, 6, 2, 7]
    for index, value in enumerate(heights):
        bx = x + 2 + index * 7
        draw.rectangle((bx, top + 54 - value * 3, bx + 4, top + 54), fill=INK_2)

    draw.text((x, top + 60), "384 numbers", font=f_mono_sm, fill=INK_3)

    # ---- footer ----------------------------------------------------------
    draw.line((left, 520, W - left, 520), fill=RULE, width=1)

    facts = [("50,257", "vocabulary"), ("384", "dimensions"), ("7", "languages")]
    fx = left
    for value, label in facts:
        draw.text((fx, 532), value, font=f_fact, fill=INK)
        draw.text((fx, 578), label, font=f_mono_sm, fill=INK_3)
        fx += 232

    draw.text((left + 700, 540), "GPT-2 · Llama 3 · Qwen2.5 · BERT · T5",
              font=f_mono_sm, fill=INK_3)
    draw.text((left + 700, 562), "all-MiniLM-L6-v2 · ONNX Runtime · WebGPU",
              font=f_mono_sm, fill=INK_3)

    draw.text((left + 700, 592), "ashiii27.github.io/tokenizer",
              font=f_mono_b, fill=SIGNAL)

    # margin note, set vertically like a print folio
    draw.line((W - 46, 108, W - 46, 508), fill=RULE, width=1)
    vertical_text(canvas, "NO. 02  ·  LIVE IN THE BROWSER", f_mono_sm, INK_3, W - 42, 108)

    # printer's corner ticks
    for cx, cy, dx, dy in ((0, 0, 1, 1), (W - 1, 0, -1, 1), (0, H - 1, 1, -1), (W - 1, H - 1, -1, -1)):
        draw.line((cx, cy, cx + dx * 16, cy), fill=INK_3, width=1)
        draw.line((cx, cy, cx, cy + dy * 16), fill=INK_3, width=1)

    canvas.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
