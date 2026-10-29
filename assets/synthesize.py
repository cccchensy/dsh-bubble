#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""dsh-bubble: deterministic generator for the 气泡提示音 completion chime.

Pure numpy + the stdlib ``wave`` module. No samples are used or downloaded.
A fixed RNG seed and a WAV header without timestamps make the output
byte-for-byte reproducible: run this script twice and compare SHA-256.

Motif (~1.05 s, mono 44.1 kHz / 16-bit):
  1. round low "glub"   130 -> 78 Hz sine + 2nd harmonic, ~0.3 s decay
  2. quiet splash       700-2400 Hz band-passed noise, 65 ms
  3. two rising bubbles 480->760 and 620->980 Hz, 90 ms, 6 Hz vibrato
  4. liquid arpeggio    C5 -> E5 -> G5, 90 ms apart, sine + soft 2nd
  5. high sparkle      1046 -> 1568 Hz bubble, 70 ms, faint
Output: bubble-chime.wav, peak-normalised to -1.0 dBFS, 12 ms fade-in,
35 ms fade-out, DC-free.
"""

from __future__ import annotations

import hashlib
import wave
from pathlib import Path

import numpy as np

# --------------------------------------------------------------------------
# Global format / targets
# --------------------------------------------------------------------------
SR = 44100
DURATION = 1.05                 # seconds (hard range: 0.95 - 1.15)
N = int(round(SR * DURATION))
PEAK_DBFS = -1.0
FADE_IN = 0.012                 # >= 5 ms required
FADE_OUT = 0.035                # >= 25 ms required
SEED = 20261029
OUT_PATH = Path(__file__).resolve().parent / "bubble-chime.wav"

# Motif parameters
WUB_F0, WUB_F1, WUB_GLIDE, WUB_TAU, WUB_DUR = 130.0, 78.0, 0.20, 0.14, 0.50
SPLASH_LO, SPLASH_HI, SPLASH_DUR = 700.0, 2400.0, 0.065
BUB_DUR = 0.090
NOTE_DUR = 0.420


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def n_samples(seconds: float) -> int:
    return int(round(seconds * SR))


def smoothstep(x: np.ndarray) -> np.ndarray:
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def exp_env(duration: float, attack: float, tau: float, release: float) -> np.ndarray:
    """Click-free envelope: smooth attack, exponential decay, cosine release."""
    n = n_samples(duration)
    tt = np.arange(n) / SR
    env = (1.0 - np.exp(-tt / attack)) * np.exp(-tt / tau)
    nr = min(n, n_samples(release))
    env[n - nr:] *= 1.0 - smoothstep(np.linspace(0.0, 1.0, nr))
    return env


def tone_sweep(
    f0: float,
    f1: float,
    duration: float,
    curve: float = 1.0,
    vib_hz: float = 0.0,
    vib_ratio: float = 0.0,
    h2: float = 0.0,
    drift_ratio: float = 0.0,
) -> np.ndarray:
    """Sine with a smooth frequency glide, optional vibrato / drift / 2nd harmonic."""
    n = n_samples(duration)
    tt = np.arange(n) / SR
    u = tt / duration
    f = f0 + (f1 - f0) * u ** curve
    if vib_hz > 0.0:
        f = f * (1.0 + vib_ratio * np.sin(2.0 * np.pi * vib_hz * tt))
    if drift_ratio:
        f = f * (1.0 - drift_ratio * u)
    phase = 2.0 * np.pi * np.cumsum(f) / SR
    sig = np.sin(phase)
    if h2:
        sig = sig + h2 * np.sin(2.0 * phase)
    return sig


def bandpassed_noise(duration: float, lo: float, hi: float, edge: float = 300.0) -> np.ndarray:
    """Deterministic white noise, FFT band-passed to [lo, hi] with soft edges."""
    n = n_samples(duration)
    rng = np.random.default_rng(SEED)
    x = rng.standard_normal(n)
    freqs = np.fft.rfftfreq(n, d=1.0 / SR)
    spec = np.fft.rfft(x)
    mask = smoothstep((freqs - (lo - edge)) / edge) * smoothstep(((hi + edge) - freqs) / edge)
    y = np.fft.irfft(spec * mask, n=n)
    return y / (np.sqrt(np.mean(y * y)) + 1e-12)


def place(buf: np.ndarray, sig: np.ndarray, start: float, gain: float = 1.0) -> None:
    i = int(round(start * SR))
    end = min(len(buf), i + len(sig))
    if end > i:
        buf[i:end] += gain * sig[: end - i]


# --------------------------------------------------------------------------
# Synthesis
# --------------------------------------------------------------------------
def build_signal() -> np.ndarray:
    x = np.zeros(N)

    # 1) round low "glub": exponential pitch fall 130 -> 78 Hz, + 2nd harmonic.
    n = n_samples(WUB_DUR)
    tt = np.arange(n) / SR
    phase = 2.0 * np.pi * (
        WUB_F1 * tt + (WUB_F0 - WUB_F1) * WUB_GLIDE * (1.0 - np.exp(-tt / WUB_GLIDE))
    )
    wub_env = exp_env(WUB_DUR, attack=0.010, tau=WUB_TAU, release=0.10)
    wub_env *= 1.0 + 0.06 * np.sin(2.0 * np.pi * 5.0 * tt)   # slow belly wobble
    wub = (np.sin(phase) + 0.26 * np.sin(2.0 * phase)) * wub_env
    place(x, wub, 0.000, 1.00)

    # 2) quiet watery splash/whoosh (synthesised noise, 700-2400 Hz).
    splash_env = exp_env(SPLASH_DUR, attack=0.006, tau=0.020, release=0.012)
    place(x, bandpassed_noise(SPLASH_DUR, SPLASH_LO, SPLASH_HI) * splash_env, 0.018, 0.11)

    # 3) two rising "blub" bubbles.
    place(x, tone_sweep(480.0, 760.0, BUB_DUR, curve=1.8, vib_hz=6.0, vib_ratio=0.02, h2=0.14)
          * exp_env(BUB_DUR, attack=0.006, tau=0.040, release=0.025), 0.255, 0.42)
    place(x, tone_sweep(620.0, 980.0, BUB_DUR, curve=1.8, vib_hz=6.0, vib_ratio=0.02, h2=0.12)
          * exp_env(BUB_DUR, attack=0.006, tau=0.038, release=0.025), 0.340, 0.36)

    # 4) liquid three-note arpeggio: C5 -> E5 -> G5, 90 ms apart.
    notes = ((523.25, 0.440, 0.44), (659.25, 0.530, 0.48), (783.99, 0.620, 0.52))
    for freq, start, gain in notes:
        sig = tone_sweep(
            freq, freq * 1.0, NOTE_DUR,
            vib_hz=6.5, vib_ratio=2.0 ** (3.0 / 1200.0) - 1.0,  # +-3 cents
            h2=0.16, drift_ratio=0.0025,                          # tiny watery fall
        )
        place(x, sig * exp_env(NOTE_DUR, attack=0.008, tau=0.160, release=0.120), start, gain)

    # 5) final faint high sparkle bubble.
    sparkle = tone_sweep(1046.5, 1568.0, 0.070, curve=1.6)
    place(x, sparkle * exp_env(0.070, attack=0.004, tau=0.024, release=0.012), 0.858, 0.12)

    # DC-free, click-free boundaries, exact peak normalisation.
    x -= x.mean()
    fi = n_samples(FADE_IN)
    x[:fi] *= smoothstep(np.linspace(0.0, 1.0, fi))
    fo = n_samples(FADE_OUT)
    x[-fo:] *= 1.0 - smoothstep(np.linspace(0.0, 1.0, fo))
    x -= x.mean()
    x *= 10.0 ** (PEAK_DBFS / 20.0) / np.max(np.abs(x))
    return x


def to_int16(x: np.ndarray) -> np.ndarray:
    return np.rint(np.clip(x, -1.0, 1.0) * 32767.0).astype(np.int16)


def write_wav(pcm: np.ndarray, path: Path = OUT_PATH) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


def main() -> None:
    x = build_signal()
    pcm = to_int16(x)
    write_wav(pcm)
    raw = OUT_PATH.read_bytes()
    print(f"wrote {OUT_PATH}")
    print(f"frames={len(pcm)} duration={len(pcm)/SR:.4f}s bytes={len(raw)}")
    print(f"sha256={hashlib.sha256(raw).hexdigest()}")


if __name__ == "__main__":
    main()
