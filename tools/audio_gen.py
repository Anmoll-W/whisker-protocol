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
# Track B1 — New SFX synthesisers
# ---------------------------------------------------------------------------

# --- Footstep surface variants ---

def sfx_footstep_clay(rng: np.random.Generator) -> np.ndarray:
    """
    Paw on sun-baked clay tile — warm dull thud, slight grit.
    Slightly softer low-frequency than the generic stone footstep.
    Duration: 0.09 s
    """
    dur = 0.09
    t = _t(dur)
    # Warm thud — lower fundamental, clay absorbs mid-highs
    thud_freq = 65.0 + rng.uniform(-4.0, 4.0)
    thud = np.sin(2 * np.pi * thud_freq * t) * np.exp(-45 * t)
    # Light grit — band-limited noise, faster decay than stone
    noise = rng.standard_normal(len(t)) * np.exp(-180 * t) * 0.18
    # Slight mid ping from clay hardness
    mid_freq = 520.0 + rng.uniform(-30.0, 30.0)
    ping = np.sin(2 * np.pi * mid_freq * t) * np.exp(-90 * t) * 0.06
    return thud + noise + ping


def sfx_footstep_marble(rng: np.random.Generator) -> np.ndarray:
    """
    Paw on polished marble — bright click + ring, harder surface.
    More high-frequency content, resonant partial.
    Duration: 0.10 s
    """
    dur = 0.10
    t = _t(dur)
    # Sharp click — higher fundamental, hard surface
    click_freq = 120.0 + rng.uniform(-8.0, 8.0)
    click = np.sin(2 * np.pi * click_freq * t) * np.exp(-70 * t)
    # Bright ring — marble resonance
    ring_freq = 1800.0 + rng.uniform(-80.0, 80.0)
    ring = np.sin(2 * np.pi * ring_freq * t) * np.exp(-25 * t) * 0.20
    # Sharp impact transient
    noise = rng.standard_normal(len(t)) * np.exp(-300 * t) * 0.25
    return click + ring + noise


def sfx_footstep_carpet(rng: np.random.Generator) -> np.ndarray:
    """
    Paw on carpet — near-silent soft pad, almost no resonance.
    Barely audible: feels stealthy, rewards the player.
    Duration: 0.06 s
    """
    dur = 0.06
    t = _t(dur)
    # Very soft thud, heavily damped
    thud_freq = 55.0 + rng.uniform(-3.0, 3.0)
    thud = np.sin(2 * np.pi * thud_freq * t) * np.exp(-90 * t) * 0.35
    # Muffled fibre brush — extremely quiet noise
    noise = rng.standard_normal(len(t)) * np.exp(-200 * t) * 0.06
    return thud + noise


def sfx_footstep_water(rng: np.random.Generator) -> np.ndarray:
    """
    Paw splashing in shallow water — liquid slap + brief high splash.
    Duration: 0.18 s
    """
    dur = 0.18
    t = _t(dur)
    # Low slap — water mass impact
    slap_freq = 90.0 + rng.uniform(-6.0, 6.0)
    slap = np.sin(2 * np.pi * slap_freq * t) * np.exp(-30 * t) * 0.7
    # High-frequency splash — water droplets, bright noise burst
    splash = rng.standard_normal(len(t)) * np.exp(-60 * t) * 0.55
    # Subtle ripple tail — very low amplitude mid noise
    ripple = rng.standard_normal(len(t)) * np.exp(-12 * t) * 0.08
    return slap + splash + ripple


# --- Prop knocks ---

def sfx_bottle_roll(rng: np.random.Generator) -> np.ndarray:
    """
    Glass bottle rolling on stone floor — ~2 s moving-emitter scrape.
    Models a bottle rolling away after a knock: initial impact →
    sustained scrape + periodic glass-on-stone taps → slow decay as
    it loses momentum.  Amplitude modulated to simulate distance.
    Duration: 2.0 s
    """
    dur = 2.0
    t = _t(dur)
    n = len(t)

    # Rolling speed envelope: fast start, decelerates exponentially
    speed_env = np.exp(-1.8 * t)  # normalised 1→0

    # Periodic taps: glass touching tile edges as it spins.
    # Tap rate tracks speed_env (faster roll = more taps per second).
    # Use a deterministic phase accumulator.
    base_tap_hz = 12.0   # taps/sec at full speed
    tap_phase = np.cumsum(base_tap_hz * speed_env) / SR
    # Square-wave-ish tap trigger: peaks every cycle
    tap_trigger = np.clip(np.sin(2 * np.pi * tap_phase) * 8.0, 0.0, 1.0) ** 4

    # Each tap: short glass ring (~1200 Hz, glassy partial)
    glass_freq = 1220.0 + rng.uniform(-30.0, 30.0)
    # Ring decays within ~0.04 s per tap — approximated via fast exp modulated by trigger
    ring = np.sin(2 * np.pi * glass_freq * t) * tap_trigger * speed_env * 0.55

    # Continuous scrape: band-limited noise shaped by speed
    scrape_noise = rng.standard_normal(n)
    # Low-pass approximation: running mean over 80 samples (≈ 550 Hz cutoff at 44.1 kHz)
    window = 80
    kernel = np.ones(window) / window
    scrape_lp = np.convolve(scrape_noise, kernel, mode="same")
    scrape = scrape_lp * speed_env * 0.30

    # Initial impact transient (first ~0.05 s)
    impact = rng.standard_normal(n) * np.exp(-150 * t) * 0.7

    # Amplitude modulation: slight panning wobble to suggest rolling distance
    wobble = 0.85 + 0.15 * np.sin(2 * np.pi * 3.5 * t)

    return (impact + ring + scrape) * wobble


# --- Guard alert stings (NON-VERBAL / STYLISED — zero human voice) ---

def sfx_guard_suspicious(rng: np.random.Generator) -> np.ndarray:
    """
    Guard hears something — "?" sting.
    NON-VERBAL: ascending question-mark contour via square-wave tones,
    no human voice, no speech phoneme.  Conveys uncertainty/curiosity
    through pitch rise + minor pentatonic shape.  On-brand chiptune.
    Duration: 0.45 s
    """
    dur = 0.45
    t = _t(dur)
    n = len(t)

    # Three-note ascending figure: Bhairavi minor pentatonic feel
    # D4 → F4 → G4  (293 → 349 → 392 Hz)
    notes = [293.0, 349.0, 392.0]
    note_dur = dur / len(notes)
    note_samples = int(SR * note_dur)

    signal = np.zeros(n)
    for i, freq in enumerate(notes):
        start = i * note_samples
        end = min(start + note_samples, n)
        seg_len = end - start
        seg_t = np.arange(seg_len) / SR
        # Square wave: 50% duty — chiptune character
        sq = np.sign(np.sin(2 * np.pi * freq * seg_t))
        # Per-note envelope: short attack, hold, slight release
        env = np.minimum(seg_t / 0.005, 1.0) * np.exp(-2.0 * seg_t)
        signal[start:end] += sq * env * 0.45

    # Soft noise shimmer underneath — adds texture without harshness
    shimmer = rng.standard_normal(n) * np.exp(-6.0 * t) * 0.07
    return signal + shimmer


def sfx_guard_alerted(rng: np.random.Generator) -> np.ndarray:
    """
    Guard spots Billu — "!" sting.
    NON-VERBAL: sharp staccato burst + descending minor-third drop.
    Two elements: (1) loud impact chord; (2) fast descending two-tone.
    No speech, no VO.  Universally readable as "danger/spotted".
    Duration: 0.55 s
    """
    dur = 0.55
    t = _t(dur)
    n = len(t)

    # Element 1: impact chord (first 0.08 s) — three inharmonic square tones
    chord_freqs = [220.0, 277.0, 330.0]  # A3, C#4, E4 — minor chord
    chord_dur = 0.08
    chord_n = int(SR * chord_dur)
    chord_t = np.arange(chord_n) / SR
    chord_sig = np.zeros(chord_n)
    for f in chord_freqs:
        sq = np.sign(np.sin(2 * np.pi * f * chord_t))
        env = np.exp(-25.0 * chord_t)
        chord_sig += sq * env * (0.33)
    signal = np.zeros(n)
    signal[:chord_n] = chord_sig

    # Element 2: descending two-tone (0.10 s → 0.45 s) — E5 → C5
    drop_freqs = [659.0, 523.0]
    drop_note_dur = 0.175
    drop_note_n = int(SR * drop_note_dur)
    for i, freq in enumerate(drop_freqs):
        start = int(SR * 0.10) + i * drop_note_n
        end = min(start + drop_note_n, n)
        seg_len = end - start
        seg_t = np.arange(seg_len) / SR
        sq = np.sign(np.sin(2 * np.pi * freq * seg_t))
        env = np.minimum(seg_t / 0.004, 1.0) * np.exp(-8.0 * seg_t)
        signal[start:end] += sq * env * 0.55

    # Noise burst at impact
    signal[:int(SR * 0.04)] += rng.standard_normal(int(SR * 0.04)) * 0.35 * np.exp(
        -150 * np.arange(int(SR * 0.04)) / SR
    )
    return signal


def sfx_guard_searching(rng: np.random.Generator) -> np.ndarray:
    """
    Guard is searching — ambient tension loop (~1.2 s).
    NON-VERBAL: slow triangle-wave pulse (low drone) + sparse noise ticks.
    Suggests caution / guard scanning.  No voice, no text phoneme.
    Duration: 1.2 s
    """
    dur = 1.2
    t = _t(dur)
    n = len(t)

    # Triangle wave drone — 110 Hz (A2), slow AM to suggest breathing/scanning
    tri_freq = 110.0 + rng.uniform(-2.0, 2.0)
    # Triangle wave: 2/π * arcsin(sin(2πft))
    tri = (2.0 / np.pi) * np.arcsin(np.sin(2 * np.pi * tri_freq * t))
    # Slow amplitude modulation at ~1.8 Hz
    am = 0.55 + 0.45 * np.sin(2 * np.pi * 1.8 * t)
    # Fade in + tail-off
    fade = np.minimum(t / 0.15, 1.0) * np.minimum((dur - t) / 0.2, 1.0)
    drone = tri * am * fade * 0.35

    # Sparse ticks — 4 deterministic positions, short noise pops
    tick_times = [0.20, 0.55, 0.80, 1.10]
    ticks = np.zeros(n)
    for tt in tick_times:
        idx = int(tt * SR)
        tick_len = int(0.018 * SR)
        end_idx = min(idx + tick_len, n)
        seg_len = end_idx - idx
        seg_t = np.arange(seg_len) / SR
        # Short band-limited click
        ticks[idx:end_idx] += rng.standard_normal(seg_len) * np.exp(-200 * seg_t) * 0.22

    return drone + ticks


# --- Outcomes ---

def sfx_exit_fanfare(rng: np.random.Generator) -> np.ndarray:
    """
    Exit gate open / level cleared — ascending triad fanfare.
    Bhairavi-tinged: D4 → F4 → A4 → D5 (minor triad + octave).
    Warm square + triangle blend; short staccato, positive + punchy.
    Duration: 0.8 s
    """
    dur = 0.8
    t = _t(dur)
    n = len(t)

    # Ascending four-note phrase: D4 F4 A4 D5
    notes = [293.0, 349.0, 440.0, 587.0]
    note_dur = 0.16
    note_n = int(SR * note_dur)

    signal = np.zeros(n)
    for i, freq in enumerate(notes):
        start = i * note_n
        end = min(start + note_n, n)
        seg_len = end - start
        seg_t = np.arange(seg_len) / SR
        # Square wave lead
        sq = np.sign(np.sin(2 * np.pi * freq * seg_t)) * 0.45
        # Triangle counter at octave below — warmth
        tri = (2.0 / np.pi) * np.arcsin(np.clip(np.sin(2 * np.pi * (freq / 2) * seg_t), -1.0, 1.0)) * 0.20
        # Note envelope: fast attack, hold, tiny release
        env = np.minimum(seg_t / 0.006, 1.0) * np.exp(-3.0 * seg_t)
        signal[start:end] += (sq + tri) * env

    # Shimmer tail: triangle at D5, slow decay
    tail_freq = 587.0
    tri_tail = (2.0 / np.pi) * np.arcsin(np.clip(np.sin(2 * np.pi * tail_freq * t), -1.0, 1.0))
    tail_env = np.exp(-4.5 * t) * 0.12
    signal += tri_tail * tail_env

    # Noise burst at note attacks (perceptual brightness)
    burst_env = np.zeros(n)
    for i in range(len(notes)):
        idx = i * note_n
        end_idx = min(idx + int(0.012 * SR), n)
        burst_env[idx:end_idx] = 1.0
    signal += rng.standard_normal(n) * burst_env * 0.10

    return signal


def sfx_win_jingle(rng: np.random.Generator) -> np.ndarray:
    """
    Level complete / win — full chiptune jingle.
    Longer ascending run ending on a triumphant chord cluster.
    Bhairavi-pentatonic: D4 F4 A4 D5 F5 — minor joyful character.
    Duration: 1.5 s
    """
    dur = 1.5
    t = _t(dur)
    n = len(t)

    # Run: D4 F4 G4 A4 C5 D5 — minor pentatonic ascent
    run_notes = [293.0, 349.0, 392.0, 440.0, 523.0, 587.0]
    run_note_dur = 0.12
    run_note_n = int(SR * run_note_dur)

    signal = np.zeros(n)
    for i, freq in enumerate(run_notes):
        start = i * run_note_n
        end = min(start + run_note_n, n)
        seg_len = end - start
        seg_t = np.arange(seg_len) / SR
        sq = np.sign(np.sin(2 * np.pi * freq * seg_t)) * 0.40
        tri = (2.0 / np.pi) * np.arcsin(np.clip(np.sin(2 * np.pi * freq * 2 * seg_t), -1.0, 1.0)) * 0.12
        env = np.minimum(seg_t / 0.005, 1.0) * np.exp(-5.0 * seg_t)
        signal[start:end] += (sq + tri) * env

    # Final chord cluster (D4 + A4 + D5) held for remainder
    chord_start = len(run_notes) * run_note_n
    chord_freqs_fin = [293.0, 440.0, 587.0]
    if chord_start < n:
        chord_t_arr = np.arange(n - chord_start) / SR
        chord_fade = np.minimum(chord_t_arr / 0.02, 1.0) * np.exp(-2.5 * chord_t_arr)
        for f in chord_freqs_fin:
            sq = np.sign(np.sin(2 * np.pi * f * chord_t_arr)) * 0.25
            tri = (2.0 / np.pi) * np.arcsin(np.clip(np.sin(2 * np.pi * f * chord_t_arr), -1.0, 1.0)) * 0.12
            signal[chord_start:] += (sq + tri) * chord_fade

    # Sparkle: high triangle shimmer at D6
    sparkle_freq = 1174.0
    sparkle = (2.0 / np.pi) * np.arcsin(np.clip(np.sin(2 * np.pi * sparkle_freq * t), -1.0, 1.0))
    sparkle_env = np.exp(-3.0 * t) * 0.08
    signal += sparkle * sparkle_env

    return signal


# --- UI blips ---

def sfx_ui_select(rng: np.random.Generator) -> np.ndarray:
    """
    Menu selection cursor move — short bright blip.
    Square wave at G5 (784 Hz), tiny duration. On-brand chiptune.
    Duration: 0.07 s
    """
    dur = 0.07
    t = _t(dur)
    freq = 784.0 + rng.uniform(-2.0, 2.0)
    sq = np.sign(np.sin(2 * np.pi * freq * t))
    env = np.minimum(t / 0.004, 1.0) * np.exp(-18.0 * t)
    return sq * env * 0.50


def sfx_ui_confirm(rng: np.random.Generator) -> np.ndarray:
    """
    Menu confirm / action accepted — two-tone ascending blip.
    G5 → C6 (784 → 1047 Hz), square wave. Positive, snappy.
    Duration: 0.12 s
    """
    dur = 0.12
    t = _t(dur)
    n = len(t)
    half = n // 2

    signal = np.zeros(n)
    # First note: G5
    seg1 = np.arange(half) / SR
    sq1 = np.sign(np.sin(2 * np.pi * 784.0 * seg1))
    env1 = np.minimum(seg1 / 0.003, 1.0) * np.exp(-20.0 * seg1)
    signal[:half] = sq1 * env1 * 0.50

    # Second note: C6 (higher, affirming)
    seg2 = np.arange(n - half) / SR
    sq2 = np.sign(np.sin(2 * np.pi * 1047.0 * seg2))
    env2 = np.minimum(seg2 / 0.003, 1.0) * np.exp(-18.0 * seg2)
    signal[half:] = sq2 * env2 * 0.55

    return signal


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
    # --- A0.4 smoke-test SFX (5 baseline shapes) ---
    SFXEntry("footstep",           sfx_footstep,          "Billu paw on stone (generic baseline)", "A0.4/B1"),
    SFXEntry("brass_clang",        sfx_brass_clang,        "Brass prop hitting stone floor",        "A0.4/B1"),
    SFXEntry("clay_shatter",       sfx_clay_shatter,       "Clay pot shattering",                   "A0.4/B1"),
    SFXEntry("collect_chime",      sfx_collect_chime,      "Laddoo collected",                      "A0.4/B1"),
    SFXEntry("caught_thud",        sfx_caught_thud,        "Guard catches Billu — game over",       "A0.4/B1"),

    # --- Track B1 — Footstep surface variants ---
    SFXEntry("footstep_clay",      sfx_footstep_clay,      "Paw on sun-baked clay tile",            "B1"),
    SFXEntry("footstep_marble",    sfx_footstep_marble,    "Paw on polished marble — bright click", "B1"),
    SFXEntry("footstep_carpet",    sfx_footstep_carpet,    "Paw on carpet — near-silent pad",       "B1"),
    SFXEntry("footstep_water",     sfx_footstep_water,     "Paw in shallow water — splash",         "B1"),

    # --- Track B1 — Prop knocks ---
    SFXEntry("bottle_roll",        sfx_bottle_roll,        "Glass bottle rolling on floor (~2 s)",  "B1"),

    # --- Track B1 — Guard alert stings (NON-VERBAL / STYLISED — zero VO) ---
    SFXEntry("guard_suspicious",   sfx_guard_suspicious,   "Guard hears something — '?' sting (wordless square-wave figure)", "B1"),
    SFXEntry("guard_alerted",      sfx_guard_alerted,      "Guard spots Billu — '!' sting (impact chord + drop, no voice)",   "B1"),
    SFXEntry("guard_searching",    sfx_guard_searching,    "Guard scanning — ambient tension loop (triangle drone + ticks)",   "B1"),

    # --- Track B1 — Outcomes ---
    SFXEntry("exit_fanfare",       sfx_exit_fanfare,       "Exit gate / level cleared — ascending triad fanfare",            "B1"),
    SFXEntry("win_jingle",         sfx_win_jingle,         "Level complete / win — full chiptune jingle",                    "B1"),

    # --- Track B1 — UI ---
    SFXEntry("ui_select",          sfx_ui_select,          "Menu cursor move — short bright blip",                           "B1"),
    SFXEntry("ui_confirm",         sfx_ui_confirm,         "Menu confirm — two-tone ascending blip",                         "B1"),
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
