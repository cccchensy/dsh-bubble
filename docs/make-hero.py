"""Render the README hero card for dsh-bubble.

Reads the bundled WAV, draws its waveform beside a rising cluster of bubbles,
and writes `docs/bubble-card.png`. Development-only: the shipped plugin never
runs this.

Run with a Python that has Pillow (the DSH bundled runtime does).
"""

from __future__ import annotations

import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
WAV = ROOT / "assets" / "bubble-chime.wav"
OUT = Path(__file__).resolve().parent / "bubble-card.png"

SCALE = 2
WIDTH, HEIGHT = 1280, 480

BACKGROUND_TOP = (10, 18, 32)
BACKGROUND_BOTTOM = (17, 36, 63)
TITLE = (235, 244, 255)
SUBTITLE = (146, 181, 222)
MUTED = (113, 145, 188)
WAVE_LOW = (62, 104, 198)
WAVE_HIGH = (168, 205, 255)
BUBBLE_LIGHT = (168, 205, 255, 235)
BUBBLE_MID = (94, 145, 236, 220)
BUBBLE_DARK = (52, 102, 210, 195)
RIM = (186, 216, 255, 210)

S = SCALE


def s(value: float) -> int:
    return int(round(value * S))


def load_font(name: str, size: float) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(Path("C:/Windows/Fonts") / name), s(size))


FONT_TITLE = load_font("msyhbd.ttc", 62)
FONT_SUB = load_font("msyh.ttc", 22)
FONT_SMALL = load_font("msyh.ttc", 18)
FONT_MONO = load_font("consola.ttf", 17)


def read_peaks(count: int) -> list[float]:
    with wave.open(str(WAV), "rb") as handle:
        frames = handle.getnframes()
        channels = handle.getnchannels()
        width = handle.getsampwidth()
        raw = handle.readframes(frames)
    assert channels == 1 and width == 2, "expected mono 16-bit PCM"
    samples = [
        int.from_bytes(raw[i : i + 2], "little", signed=True) / 32768.0
        for i in range(0, len(raw), 2)
    ]
    per_bucket = max(1, len(samples) // count)
    peaks: list[float] = []
    for index in range(count):
        chunk = samples[index * per_bucket : (index + 1) * per_bucket]
        peaks.append(max(abs(value) for value in chunk) if chunk else 0.0)
    top = max(peaks) or 1.0
    return [min(1.0, value / top) for value in peaks]


def lerp(start: tuple[int, int, int], end: tuple[int, int, int], t: float) -> tuple[int, int, int]:
    return tuple(int(round(a + (b - a) * t)) for a, b in zip(start, end))


def overlay() -> Image.Image:
    return Image.new("RGBA", (WIDTH * S, HEIGHT * S), (0, 0, 0, 0))


def draw_background(image: Image.Image, draw: ImageDraw.ImageDraw) -> None:
    for y in range(HEIGHT * S):
        t = y / (HEIGHT * S - 1)
        draw.line([(0, y), (WIDTH * S, y)], fill=lerp(BACKGROUND_TOP, BACKGROUND_BOTTOM, t))
    halo = overlay()
    ImageDraw.Draw(halo).ellipse([s(920), s(40), s(1280), s(430)], fill=(86, 134, 254, 34))
    halo = halo.filter(ImageFilter.GaussianBlur(s(44)))
    image.paste(halo, (0, 0), halo)


def draw_waveform(draw: ImageDraw.ImageDraw) -> None:
    peaks = read_peaks(196)
    left, right = s(82), s(930)
    baseline = s(342)
    max_height = s(82)
    step = (right - left) / len(peaks)
    bar_width = max(s(2), step * 0.42)
    for index, peak in enumerate(peaks):
        height = max(s(2), peak * max_height)
        x = left + index * step
        color = lerp(WAVE_LOW, WAVE_HIGH, min(1.0, peak**0.7))
        draw.rounded_rectangle(
            [x, baseline - height, x + bar_width, baseline + height],
            radius=bar_width / 2,
            fill=color,
        )
    draw.line([(s(70), baseline), (s(944), baseline)], fill=(58, 84, 126), width=s(1))


def draw_bubble(image: Image.Image, cx: float, cy: float, radius: float, tint: str) -> None:
    """Paint one soft bubble: tinted disc, lighter inner glow, rim and a highlight."""
    r = s(radius)
    x, y = s(cx), s(cy)
    layer = overlay()
    layer_draw = ImageDraw.Draw(layer)
    if tint == "light":
        base, inner = (94, 145, 236, 210), BUBBLE_LIGHT
    elif tint == "mid":
        base, inner = (70, 120, 220, 205), BUBBLE_MID
    else:
        base, inner = (52, 102, 210, 195), BUBBLE_DARK
    layer_draw.ellipse([x - r, y - r, x + r, y + r], fill=base)
    layer_draw.ellipse(
        [x - r * 0.78, y - r * 0.82, x + r * 0.66, y + r * 0.58],
        fill=inner,
    )
    layer_draw.ellipse(
        [x - r, y - r, x + r, y + r],
        outline=RIM,
        width=max(s(1), int(round(r * 0.055))),
    )
    image.paste(layer, (0, 0), layer)
    # Specular highlight, drawn crisply on top.
    highlight = overlay()
    hdraw = ImageDraw.Draw(highlight)
    hr = max(s(2), r * 0.20)
    hdraw.ellipse(
        [x - r * 0.52 - hr, y - r * 0.58 - hr, x - r * 0.52 + hr, y - r * 0.58 + hr],
        fill=(255, 255, 255, 205),
    )
    hdraw.ellipse(
        [x - r * 0.14 - hr * 0.5, y - r * 0.16 - hr * 0.5, x - r * 0.14 + hr * 0.5, y - r * 0.16 + hr * 0.5],
        fill=(255, 255, 255, 120),
    )
    image.paste(highlight, (0, 0), highlight)


def draw_bubbles(image: Image.Image) -> None:
    # A calm diagonal cluster above the waveform's right end: three readable
    # bubbles plus a drifting speck, all rising to the upper right.
    draw_bubble(image, 1088, 300, 62, "light")
    draw_bubble(image, 1164, 196, 36, "mid")
    draw_bubble(image, 1016, 132, 20, "small")
    draw_bubble(image, 1222, 92, 11, "small")
    # A few hairline ripples under the cluster, so it sits in water.
    ripples = overlay()
    rdraw = ImageDraw.Draw(ripples)
    for offset, alpha in ((0, 70), (16, 40)):
        box = [s(1014) - s(42), s(392 + offset), s(1014) + s(42), s(392 + offset) + s(16)]
        rdraw.arc(box, start=200, end=340, fill=(140, 182, 240, alpha), width=s(2))
    image.paste(ripples, (0, 0), ripples)


def draw_text(draw: ImageDraw.ImageDraw) -> None:
    draw.text((s(82), s(54)), "气泡提示音", font=FONT_TITLE, fill=TITLE)
    draw.text(
        (s(84), s(146)),
        "DSH 任务完成提示音  ·  Bubble Chime",
        font=FONT_SUB,
        fill=SUBTITLE,
    )
    draw.text((s(82), s(196)), "WAVEFORM · bubble-chime.wav", font=FONT_SMALL, fill=MUTED)
    draw.text(
        (s(82), s(440)),
        "1.05 s   ·   44.1 kHz   ·   16-bit mono   ·   peak −1.0 dBFS   ·   C5–E5–G5",
        font=FONT_MONO,
        fill=MUTED,
    )
    # Top-right plugin pill.
    pill = [s(1040), s(436), s(1216), s(470)]
    draw.rounded_rectangle(pill, radius=s(19), fill=(27, 47, 80), outline=(60, 92, 144), width=s(1))
    label = "DSH PLUGIN"
    box = draw.textbbox((0, 0), label, font=FONT_MONO)
    draw.text(
        (pill[0] + (pill[2] - pill[0] - (box[2] - box[0])) / 2, pill[1] + s(7)),
        label,
        font=FONT_MONO,
        fill=(168, 205, 255),
    )


def main() -> None:
    image = Image.new("RGB", (WIDTH * S, HEIGHT * S), BACKGROUND_TOP)
    draw = ImageDraw.Draw(image)
    draw_background(image, draw)
    draw_waveform(draw)
    draw_bubbles(image)
    draw_text(draw)
    image = image.resize((WIDTH, HEIGHT), Image.LANCZOS)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    image.save(OUT, optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
