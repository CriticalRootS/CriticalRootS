"""Deterministic falling glyphs + GREETINGS animation in a looping WebP.

Requirements: pip install pillow
Run: python greetings_rain.py

All positions are computed from time t. No frame-to-frame randomness.
"""
from dataclasses import dataclass
from pathlib import Path
import math
import random

from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ===== Change these to customize the animation =====
W, H = 500, 300
FPS = 36
DURATION = 12.0
BG_GLYPH_SIZE = 18           # Background glyphs, larger than the source's
WORD_GLYPH_SIZE = 72         # GREETINGS occupies around half the canvas width
RAIN_COUNT = 125
RAIN_CYCLES = (2, 3)        # Each particle makes 2 or 3 loops per animation
BACKGROUND = (250, 250, 249, 255)
WORD = "GREETINGS"
LANDING_Y = 200
FIRST_DROP_IN = 1.0
LETTER_STAGGER = 0.55
ARRIVAL_DURATION = 1.6
FIRST_LET_GO = 8.15
RELEASE_STAGGER = 0.28
EXIT_DURATION = 0.95
SEED = 173

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "greetings_rain.webp"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
MONO_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf"
# Windows default alternative for this example; replace with a preferred .ttf if needed.
FONT_CANDIDATES = [
    MONO,
    "C:/Windows/Fonts/consola.ttf",
    "C:/Windows/Fonts/lucon.ttf",
    "DejaVuSansMono.ttf",
]
BOLD_CANDIDATES = [
    MONO_BOLD,
    "C:/Windows/Fonts/consolab.ttf",
    "DejaVuSansMono-Bold.ttf",
]


def find_font(candidates, size):
    for candidate in candidates:
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    raise RuntimeError("Monospace font not found. Adjust FONT_CANDIDATES to your .ttf font.")


font_bg = find_font(FONT_CANDIDATES, BG_GLYPH_SIZE)
font_word = find_font(BOLD_CANDIDATES, WORD_GLYPH_SIZE)


@dataclass(frozen=True)
class RainGlyph:
    char: str
    x: float
    phase_y: float
    cycles: int
    opacity: int
    color: tuple[int, int, int]


rng = random.Random(SEED)
CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?@#$%&*+-_=:/\\;()[]{}<>"
MARGIN = 55               # Offscreen space hides each particle's wrap-around
PERIOD_Y = H + MARGIN * 2
rain = [
    RainGlyph(
        char=rng.choice(CHARS),
        x=rng.uniform(3, W - BG_GLYPH_SIZE - 3),
        phase_y=rng.uniform(0, PERIOD_Y),
        cycles=rng.choice(RAIN_CYCLES),
        opacity=rng.randint(50, 190),
        color=(18, 30, 23) if rng.random() < .22 else (18, 18, 18),
    )
    for _ in range(RAIN_COUNT)
]

ADVANCE = font_word.getlength("M")
WORD_WIDTH = ADVANCE * len(WORD)
LEFT = (W - WORD_WIDTH) / 2


def smoothstep(u):
    """Cubic interpolation: smooth start and finish."""
    u = max(0.0, min(1.0, u))
    return u * u * (3 - 2 * u)


def rain_position(glyph, t):
    """Periodic y(t); at t=0 and t=DURATION background positions match."""
    speed = glyph.cycles * PERIOD_Y / DURATION
    return ((glyph.phase_y + speed * t) % PERIOD_Y) - MARGIN


def word_position(index, t):
    """Return None before arrival or after full departure; otherwise y position."""
    appear = FIRST_DROP_IN + index * LETTER_STAGGER
    land = appear + ARRIVAL_DURATION
    release = FIRST_LET_GO + index * RELEASE_STAGGER
    exit_end = release + EXIT_DURATION
    if t < appear or t >= exit_end:
        return None
    if t < land:
        progress = smoothstep((t - appear) / ARRIVAL_DURATION)
        return -WORD_GLYPH_SIZE - 10 + (LANDING_Y + WORD_GLYPH_SIZE + 10) * progress
    if t < release:
        return float(LANDING_Y)
    progress = ((t - release) / EXIT_DURATION) ** 1.9
    return LANDING_Y + (H + WORD_GLYPH_SIZE - LANDING_Y + 10) * progress


def render_frame(t):
    base = Image.new("RGBA", (W, H), BACKGROUND)
    trails = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    glyphs = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    dt = ImageDraw.Draw(trails)
    dg = ImageDraw.Draw(glyphs)

    # Character rain: deterministic positions and stable identities.
    for item in rain:
        y = rain_position(item, t)
        x = int(item.x)
        color = item.color
        # A subtle trail *above* each descending character.
        for j in range(1, 5):
            yy = y - j * 6
            if -BG_GLYPH_SIZE < yy < H:
                dt.text((x, int(yy)), item.char,
                        font=font_bg, fill=(*color, int(item.opacity * (0.18 - j * 0.03))), anchor="lt")
        if -BG_GLYPH_SIZE < y < H:
            dg.text((x, int(y)), item.char, font=font_bg,
                    fill=(*color, item.opacity), anchor="lt")

    base = Image.alpha_composite(base, trails.filter(ImageFilter.GaussianBlur(1.4)))
    base = Image.alpha_composite(base, glyphs)

    # The 9 important letters are separate entities, with a landing lock.
    target_trails = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    letter_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    tt = ImageDraw.Draw(target_trails)
    ll = ImageDraw.Draw(letter_layer)
    for i, char in enumerate(WORD):
        y = word_position(i, t)
        if y is None:
            continue
        x = int(LEFT + ADVANCE * i)
        appear = FIRST_DROP_IN + i * LETTER_STAGGER
        land = appear + ARRIVAL_DURATION
        release = FIRST_LET_GO + i * RELEASE_STAGGER
        moving = (appear <= t < land) or (t >= release)
        if moving:
            for step in range(1, 5):
                old_y = word_position(i, max(0, t - step * .04))
                if old_y is not None and old_y < y:
                    tt.text((x, int(old_y)), char, font=font_word,
                            fill=(15, 20, 17, max(12, 65 - step * 11)), anchor="lt")
        ll.text((x, int(y)), char, font=font_word,
                fill=(10, 15, 12, 245), anchor="lt")

    base = Image.alpha_composite(base, target_trails.filter(ImageFilter.GaussianBlur(1.1)))
    base = Image.alpha_composite(base, letter_layer)
    return base.convert("RGB")


def main():
    nframes = round(FPS * DURATION)
    frames = [render_frame(i / FPS) for i in range(nframes)]
    frames[0].save(
        OUTPUT,
        format="WEBP", save_all=True, append_images=frames[1:],
        duration=round(1000 / FPS), loop=0, quality=82, method=4,
    )
    print(f"Created {OUTPUT} ({len(frames)} frames, {FPS} FPS, seamless loop)")


if __name__ == "__main__":
    main()
