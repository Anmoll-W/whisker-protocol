#!/usr/bin/env python3
"""
Whisker Protocol — Audio Generator
====================================
Synthesises all in-game SFX from first principles (numpy + scipy), then
encodes to OGG Vorbis via ffmpeg.  No audio assets are committed; this script
IS the audio pipeline.

**iOS / Web Audio note:**
  On iOS Safari, the AudioContext starts in the "suspended" state and CANNOT be
  resumed programmatically.  It requires a direct user gesture (tap / click) to
  call `audioContext.resume()`.  The runtime audio init in `src/systems/audio.ts`
  MUST hook the first tap (e.g. in the TitleScene pointer-down handler) before
  playing any sound.  Failing to do this causes silent audio on every iOS device.

Usage:
    python tools/audio_gen.py --smoke       # Generate one smoke-test SFX only
    python tools/audio_gen.py --all         # Generate all SFX in the catalog
    python tools/audio_gen.py --list        # Print the SFX catalog without generating

Output: public/audio/<sfx_name>.ogg

Dependencies (all in .venv):
    numpy · scipy · (pydub or ffmpeg on PATH)

Determinism contract:
    Every synthesiser call uses a fixed numpy seed derived from the SFX name
    (hashlib.md5 → int seed).  Re-running this script always produces
    byte-identical OGG files for the same SFX definition and ffmpeg version.
    Never use numpy.random without seeding from SFX_SEED.
"""

from __future__ import annotations

import argparse
import hashlib
import shutil
import struct
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
import scipy.io.wavfile as wavfile

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
PUBLIC_AUDIO = ROOT / "public" / "audio"
PUBLIC_AUDIO.mkdir(parents=True, exist_ok=True)

FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
SAMPLE_RATE = 44100

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_for(name: str) -> int:
    """Deterministic int seed from SFX name — ensures byte-identical output on reruns."""
    return int(hashlib.md5(name.encode()).hexdigest()[:8], 16)


def _normalize(signal: np.ndarray) -> np.ndarray:
    """Peak-normalise to ±1.0 float64."""
    peak = np.max(np.abs(signal))
    if peak < 1e-9:
        return signal
    return signal / peak


def _to_pcm16(signal: np.ndarray) -> np.ndarray:
    """Convert float64 ±1.0 → int16."""
    return np.clip(signal * 32767, -32768, 32767).astype(np.int16)


def _encode_ogg(wav_path: Path, ogg_path: Path, bitrate_kbps: int = 48) -> None:
    """
    Encode WAV → OGG Opus via ffmpeg (libopus encoder).

    Uses OGG container + libopus codec.  libvorbis is NOT available in the
    Homebrew ffmpeg build; libopus is, and produces smaller files with better
    quality at low bitrates.  OGG Opus is supported in all modern browsers
    including iOS Safari 11+ and all Android browsers.

    bitrate_kbps: target bitrate; 48 kbps is transparent for short mono SFX.
    """
    if not Path(FFMPEG).exists():
        raise RuntimeError(
            f"ffmpeg not found at {FFMPEG}. Install via: brew install ffmpeg"
        )
    result = subprocess.run(
        [
            FFMPEG,
            "-y",           # overwrite
            "-i", str(wav_path),
            "-c:a", "libopus",
            "-b:a", f"{bitrate_kbps}k",
            str(ogg_path),
        ],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed:\n{result.stderr.decode(errors='replace')}"
        )


def synthesise(name: str, fn: Callable[[np.random.Generator], np.ndarray]) -> Path:
    """
    Synthesise SFX, write WAV then OGG.

    Args:
        name: SFX name used for filename and seed derivation.
        fn:   Callable(rng) → float64 numpy array at SAMPLE_RATE.

    Returns:
        Path to the generated .ogg file.
    """
    rng = np.random.default_rng(_seed_for(name))
    signal = fn(rng)
    signal = _normalize(signal)
    pcm = _to_pcm16(signal)

    ogg_out = PUBLIC_AUDIO / f"{name}.ogg"

    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        wavfile.write(str(tmp_path), SAMPLE_RATE, pcm)
        _encode_ogg(tmp_path, ogg_out)
    finally:
        tmp_path.unlink(missing_ok=True)

    return ogg_out


# ---------------------------------------------------------------------------
# SFX synthesisers
# ---------------------------------------------------------------------------
SR = SAMPLE_RATE  # shorthand inside synthesisers


def _t(duration_s: float) -> np.ndarray:
    """Time vector for a given duration."""
    return np.linspace(0, duration_s, int(SR * duration_s), endpoint=False)


def sfx_footstep(rng: np.random.Generator) -> np.ndarray:
    """
    Soft footstep — low thud + brief broadband transient.
    Billu's paw on stone: subtle enough to feel stealthy.
    Duration: 0.08 s
    """
    dur = 0.08
    t = _t(dur)
    # Low thud ~80 Hz with fast exponential decay
    thud_freq = 80.0 + rng.uniform(-5.0, 5.0)
    thud = np.sin(2 * np.pi * thud_freq * t) * np.exp(-50 * t)
    # Broadband transient (noise burst)
    noise = rng.standard_normal(len(t)) * np.exp(-120 * t) * 0.3
    return thud + noise


def sfx_brass_clang(rng: np.random.Generator) -> np.ndarray:
    """
    Brass object hitting stone — rich inharmonic metallic clang.
    Guard-snapping sound for the hero knock moment.
    Duration: 0.7 s
    """
    dur = 0.7
    t = _t(dur)
    # Inharmonic partials typical of brass percussion
    partials = [
        (320.0, 1.00, 3.5),
        (570.0, 0.60, 5.0),
        (890.0, 0.35, 7.0),
        (1250.0, 0.20, 9.0),
        (1840.0, 0.10, 12.0),
    ]
    signal = np.zeros(len(t))
    for freq, amp, decay in partials:
        freq += rng.uniform(-2.0, 2.0)
        signal += amp * np.sin(2 * np.pi * freq * t) * np.exp(-decay * t)
    # Impact transient
    signal += rng.standard_normal(len(t)) * np.exp(-200 * t) * 0.4
    return signal


def sfx_clay_shatter(rng: np.random.Generator) -> np.ndarray:
    """
    Clay pot shattering — burst of high noise + falling fragments.
    Duration: 0.5 s
    """
    dur = 0.5
    t = _t(dur)
    # Initial burst (broadband noise, very sharp attack)
    burst = rng.standard_normal(len(t)) * np.exp(-30 * t)
    # Fragment tones — 3 random short pings decaying quickly
    frag = np.zeros(len(t))
    for _ in range(3):
        f = rng.uniform(900.0, 2400.0)
        start = rng.uniform(0.0, 0.1)
        mask = (t >= start).astype(float)
        frag += 0.25 * np.sin(2 * np.pi * f * t) * np.exp(-15 * (t - start)) * mask
    return burst + frag


def sfx_collect_chime(rng: np.random.Generator) -> np.ndarray:
    """
    Laddoo collect — bright ascending two-tone chime with shimmer.
    Short, rewarding, unmistakably positive.
    Duration: 0.4 s
    """
    dur = 0.4
    t = _t(dur)
    # Two pure tones a major third apart, slight detune for shimmer
    note1 = 880.0 + rng.uniform(-1.0, 1.0)
    note2 = 1108.0 + rng.uniform(-1.0, 1.0)
    env = np.exp(-8 * t)
    sig = (
        np.sin(2 * np.pi * note1 * t) * 0.6
        + np.sin(2 * np.pi * note2 * t) * 0.4
    )
    return sig * env


def sfx_caught_thud(rng: np.random.Generator) -> np.ndarray:
    """
    Guard catches Billu — heavy low thud + short punch noise.
    'Game over' feel without being harsh.
    Duration: 0.35 s
    """
    dur = 0.35
    t = _t(dur)
    # Deep body thud
    freq = 55.0 + rng.uniform(-3.0, 3.0)
    thud = np.sin(2 * np.pi * freq * t) * np.exp(-12 * t)
    # Punch transient
    noise = rng.standard_normal(len(t)) * np.exp(-80 * t) * 0.5
    # Sub-bass rumble
    rumble = np.sin(2 * np.pi * 30 * t) * np.exp(-6 * t) * 0.4
    return thud + noise + rumble


# ---------------------------------------------------------------------------
# SFX catalog — add all game SFX here for --all
# ---------------------------------------------------------------------------
@dataclass
class SFXEntry:
    name: str
    fn: Callable[[np.random.Generator], np.ndarray]
    description: str
    track: str = "B1"  # which impl-plan Track owns this SFX


CATALOG: list[SFXEntry] = [
    # A0.4 smoke-test SFX (5 representative shapes — measured for bundle math)
    SFXEntry("footstep", sfx_footstep, "Billu paw on stone", "A0.4/B1"),
    SFXEntry("brass_clang", sfx_brass_clang, "Brass prop hitting floor", "A0.4/B1"),
    SFXEntry("clay_shatter", sfx_clay_shatter, "Clay pot shattering", "A0.4/B1"),
    SFXEntry("collect_chime", sfx_collect_chime, "Laddoo collected", "A0.4/B1"),
    SFXEntry("caught_thud", sfx_caught_thud, "Guard catches Billu", "A0.4/B1"),
    # --- Track B1 SFX (stubs — implement synthesisers in Track B1 task) ---
    # SFXEntry("footstep_2", ..., "Paw variant 2"),
    # SFXEntry("footstep_3", ..., "Paw variant 3"),
    # SFXEntry("footstep_4", ..., "Paw variant 4"),
    # SFXEntry("bottle_roll", ..., "Bottle rolling on floor"),
    # SFXEntry("exit_open", ..., "Exit gate creak"),
    # SFXEntry("win_fanfare", ..., "Level complete"),
    # SFXEntry("guard_sting_alert", ..., "Guard spots Billu"),
    # SFXEntry("guard_sting_suspicious", ..., "Guard hears something"),
    # SFXEntry("ui_select", ..., "Menu selection"),
    # SFXEntry("ui_confirm", ..., "Menu confirm"),
]

SMOKE_SFX = "collect_chime"  # single SFX for --smoke


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _run_catalog(entries: list[SFXEntry], label: str) -> None:
    print(f"\n[audio_gen] Generating {len(entries)} SFX ({label})...")
    for entry in entries:
        path = synthesise(entry.name, entry.fn)
        size = path.stat().st_size
        print(f"  {entry.name:<20}  {size:>7} bytes  →  {path.relative_to(ROOT)}")
    print("[audio_gen] Done.\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Whisker Protocol audio pipeline — synthesises SFX to OGG."
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument(
        "--smoke",
        action="store_true",
        help="Generate one smoke-test SFX (collect_chime) to verify the pipeline end-to-end.",
    )
    group.add_argument(
        "--all",
        action="store_true",
        help="Generate all SFX in the catalog.",
    )
    group.add_argument(
        "--list",
        action="store_true",
        help="Print the SFX catalog without generating anything.",
    )
    args = parser.parse_args()

    if args.list:
        print("\nSFX catalog:")
        for e in CATALOG:
            print(f"  {e.name:<20}  {e.description}  (track: {e.track})")
        print()
        return

    if args.smoke:
        entry = next(e for e in CATALOG if e.name == SMOKE_SFX)
        _run_catalog([entry], "--smoke")
        return

    if args.all:
        _run_catalog(CATALOG, "--all")
        return


if __name__ == "__main__":
    main()
