#!/usr/bin/env python3
"""
Whisker Protocol — Shading Engine (A0.3 sub-spec implementation)

The single calibration module every future sprite shades against. NEAREST-only:
no anti-aliasing, no blur, no alpha gradients. Dithering (a fixed 4x4 Bayer
matrix) is the ONLY tonal blend allowed. All output is deterministic — identical
inputs produce identical bytes, which the SHA regression test in this file
protects.

Primitives provided:
  - BAYER_4X4            : the exact ordered-dither matrix (defined explicitly).
  - bayer_dither()       : pick tone A or tone B per pixel from the matrix.
  - lit() / shadow()     : 2-light model — derive lit / shadow tone on-palette.
  - step_darker/lighter(): move exactly one palette tone along a tone ramp.
  - ambient_occlusion()  : AO as a pixel-placement RULE on a drawn shape.
  - assert_on_palette()  : palette guard — hard-fail on any off-palette pixel.
  - FRAME_BUDGET         : documented per-state animation frame cap.
  - render_reference_frame() + verify_reference_sha(): the golden-SHA test.

Run:
    .venv/bin/python tools/shading.py --render   # (re)write the reference PNG
    .venv/bin/python tools/shading.py --verify   # assert SHA matches golden
    .venv/bin/python tools/shading.py --print-golden  # print current SHA
"""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from PIL import Image

# Reuse the single source of truth for the palette + base helpers.
from sprite_gen import PALETTE, TRANSPARENT, new_frame, px, rect, scale  # noqa: F401

ROOT = Path(__file__).resolve().parent.parent
REF_DIR = Path(__file__).resolve().parent / "reference"
PUBLIC = ROOT / "public" / "sprites"
REF_DIR.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)

RGB = Tuple[int, int, int]


# ---------------------------------------------------------------------------
# Palette guard — reverse lookup + whole-frame validator
# ---------------------------------------------------------------------------

# RGB tuple -> palette name. Built once from the locked PALETTE. "transparent"
# is excluded (it is a 4-tuple sentinel, never a drawn opaque colour).
_RGB_TO_NAME: Dict[RGB, str] = {
    rgb: name for name, rgb in PALETTE.items() if len(rgb) == 3
}


def name_of(rgb: RGB) -> Optional[str]:
    """Return the palette name for an opaque RGB triple, or None if off-palette."""
    return _RGB_TO_NAME.get(tuple(rgb[:3]))


def assert_on_palette(img: Image.Image) -> Image.Image:
    """Palette guard: hard-fail if ANY opaque pixel is not one of the 24 colours.

    Fully-transparent pixels (alpha 0) are allowed — they are the frame
    background. Any pixel with alpha > 0 must match a palette RGB exactly.
    """
    rgba = img.convert("RGBA")
    w, h = rgba.size
    px_data = rgba.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px_data[x, y]
            if a == 0:
                continue
            if a != 255:
                raise ValueError(
                    f"Palette guard: partial alpha {a} at ({x},{y}) — "
                    "NEAREST-only, no alpha gradients allowed."
                )
            if (r, g, b) not in _RGB_TO_NAME:
                raise ValueError(
                    f"Palette guard: off-palette pixel #{r:02X}{g:02X}{b:02X} "
                    f"at ({x},{y}). Only the 24 locked colours are permitted."
                )
    return img


# ---------------------------------------------------------------------------
# Tone ramps — the on-palette ladders the 2-light model and AO walk
# ---------------------------------------------------------------------------

# Each ramp is ordered DARK -> LIGHT. "One tone darker" = previous entry;
# "one tone lighter" = next entry. The 2-light model and AO rule never invent
# colours — they only step along these ladders, so every result is on-palette.
TONE_RAMPS: List[List[str]] = [
    # Warm chawl terracotta wall (the locked 3-tone terracotta).
    ["wall_shadow", "wall_mid", "wall_hi", "floor_clay"],
    # Billu fur.
    ["outline", "fur_dark", "fur_mid", "fur_light", "belly_cream"],
    # Laddoo / brass-warm accent ladder.
    ["wall_mid", "laddoo", "laddoo_hi"],
    # Guard skin ladder (hair -> skin highlight via clay).
    ["hair", "skin", "floor_clay"],
]

# name -> (ramp_index, position). Built once; lets step_* run in O(1).
_RAMP_OF: Dict[str, Tuple[int, int]] = {}
for _ri, _ramp in enumerate(TONE_RAMPS):
    for _pi, _name in enumerate(_ramp):
        # First ramp a colour appears in wins (terracotta + fur are disjoint).
        _RAMP_OF.setdefault(_name, (_ri, _pi))


def step_darker(tone: str, steps: int = 1) -> str:
    """Return the tone exactly `steps` darker along its ramp (clamped at the end)."""
    if tone not in _RAMP_OF:
        raise ValueError(f"Tone '{tone}' is not on any ramp; cannot shade it.")
    ri, pi = _RAMP_OF[tone]
    ramp = TONE_RAMPS[ri]
    return ramp[max(0, pi - steps)]


def step_lighter(tone: str, steps: int = 1) -> str:
    """Return the tone exactly `steps` lighter along its ramp (clamped at the top)."""
    if tone not in _RAMP_OF:
        raise ValueError(f"Tone '{tone}' is not on any ramp; cannot shade it.")
    ri, pi = _RAMP_OF[tone]
    ramp = TONE_RAMPS[ri]
    return ramp[min(len(ramp) - 1, pi + steps)]


# ---------------------------------------------------------------------------
# 2-light model — key upper-left (warm golden), fill lower-right (cool/dim)
# ---------------------------------------------------------------------------

def lit(tone: str) -> str:
    """Key-light tone: one step LIGHTER along the ramp (clamped). Upper-left faces."""
    return step_lighter(tone, 1)


def shadow(tone: str) -> str:
    """Fill/shadow tone: one step DARKER along the ramp (clamped). Lower-right faces."""
    return step_darker(tone, 1)


# ---------------------------------------------------------------------------
# Bayer 4x4 ordered dither — the only tonal blend permitted
# ---------------------------------------------------------------------------

# Exact 4x4 Bayer matrix (van Dr Bruijn ordering). Values 0..15. A pixel takes
# the LIGHT tone when (threshold/16) < coverage, else the DARK tone — giving a
# stable, tileable checker that reads as a gradient at game scale.
BAYER_4X4: List[List[int]] = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
]


def bayer_pick(x: int, y: int, coverage: float, dark: str, light: str) -> str:
    """Return `light` or `dark` for pixel (x,y) at a given light `coverage` (0..1).

    coverage = fraction of pixels that should take the LIGHT tone. The Bayer
    threshold makes the choice spatially stable and deterministic.
    """
    threshold = (BAYER_4X4[y % 4][x % 4] + 0.5) / 16.0
    return light if coverage > threshold else dark


def bayer_dither(
    img: Image.Image,
    x0: int,
    y0: int,
    x1: int,
    y1: int,
    dark: str,
    light: str,
    coverage: float = 0.5,
) -> None:
    """Fill an inclusive rect with a Bayer dither blend of two ON-PALETTE tones.

    This is the ONLY blending mechanism in the engine. Both `dark` and `light`
    are palette names, so every emitted pixel is on-palette by construction.
    """
    if dark not in PALETTE or light not in PALETTE:
        raise ValueError(f"bayer_dither needs palette tones: {dark!r}, {light!r}")
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            px(img, x, y, bayer_pick(x, y, coverage, dark, light))


# ---------------------------------------------------------------------------
# Ambient occlusion as a PIXEL-PLACEMENT RULE (not a post-process blur)
# ---------------------------------------------------------------------------

def ambient_occlusion(
    img: Image.Image,
    region: Tuple[int, int, int, int],
    contact_edges: Tuple[bool, bool, bool, bool] = (False, False, True, False),
) -> None:
    """Darken contact/concave edges by EXACTLY ONE palette tone — a rule, not a blur.

    `region` is the inclusive bbox (x0,y0,x1,y1) of an already-drawn shape.
    `contact_edges` flags which sides sit against another surface, ordered
    (top, right, bottom, left). For each flagged edge, the single row/column of
    pixels on that edge is stepped one tone darker along its ramp. Off-ramp or
    transparent pixels are left untouched. No new colours are introduced.
    """
    x0, y0, x1, y1 = region
    top, right, bottom, left = contact_edges
    rgba = img.convert("RGBA")
    img.paste(rgba)  # ensure RGBA mode for putpixel reads
    px_data = img.load()

    def darken_at(x: int, y: int) -> None:
        if not (x0 <= x <= x1 and y0 <= y <= y1):
            return
        r, g, b, a = px_data[x, y]
        if a == 0:
            return
        cur = name_of((r, g, b))
        if cur is None or cur not in _RAMP_OF:
            return  # leave outline/off-ramp pixels alone — AO never invents colour
        px(img, x, y, step_darker(cur, 1))

    if top:
        for x in range(x0, x1 + 1):
            darken_at(x, y0)
    if bottom:
        for x in range(x0, x1 + 1):
            darken_at(x, y1)
    if left:
        for y in range(y0, y1 + 1):
            darken_at(x0, y)
    if right:
        for y in range(y0, y1 + 1):
            darken_at(x1, y)


# ---------------------------------------------------------------------------
# Animation frame budget — keep sheets small (Billu's ~9 states)
# ---------------------------------------------------------------------------

# Documented per-state frame cap. Sheets that exceed a cap are rejected in
# review. Total caps the master Billu sheet so the atlas stays well under the
# bundle budget (CLAUDE.md: target <8MB whole game).
FRAME_BUDGET: Dict[str, int] = {
    "idle": 2,        # breathing
    "walk": 4,        # 8 fps loop
    "creep": 4,       # low-stillness stalk
    "bat": 3,         # the hero verb — wind-up / strike / recover
    "pounce": 3,      # anticipation / extend / land (squash)
    "squeeze": 2,     # gap-squeeze through a gap
    "hide": 2,        # enter / settled in a hidey-hole
    "startle": 2,     # startle reflex pop
    "caught": 2,      # "PAKAD LIYA!" reaction
}
FRAME_BUDGET_TOTAL = sum(FRAME_BUDGET.values())  # 24 frames master sheet cap


def assert_within_budget(state: str, frame_count: int) -> None:
    """Hard-fail if a state's frame sheet exceeds its documented cap."""
    if state not in FRAME_BUDGET:
        raise ValueError(f"Unknown animation state '{state}'.")
    cap = FRAME_BUDGET[state]
    if frame_count > cap:
        raise ValueError(
            f"Frame budget exceeded: state '{state}' has {frame_count} frames, "
            f"cap is {cap}."
        )


# ---------------------------------------------------------------------------
# Golden-hour chawl reference frame — the visual contract
# ---------------------------------------------------------------------------

# Base canvas. Small on purpose; upscaled NEAREST for preview.
REF_W, REF_H = 48, 32
GOLDEN_SHA = "c2dbbfe3e0faf91e7f291b4450ab325643040c4056e90f709ecb52c91ebedf4d"


def _draw_billu_small(img: Image.Image, ox: int, oy: int) -> None:
    """Adapt the existing 'classic' Billu (sprite_gen) as a shaded sitting cat.

    Kept compact for the 48x32 stage. Uses the 2-light model: upper-left key on
    the head/back, AO at the floor contact line.
    """
    # Body (sitting): wider at base, key-lit on the upper-left shoulder.
    rect(img, ox + 3, oy + 7, ox + 11, oy + 13, "fur_mid")
    rect(img, ox + 3, oy + 6, ox + 6, oy + 9, lit("fur_mid"))    # key-lit shoulder
    rect(img, ox + 9, oy + 9, ox + 11, oy + 13, "fur_dark")      # fill-side body shadow
    rect(img, ox + 5, oy + 9, ox + 9, oy + 13, "belly_cream")    # belly patch
    # Tail curling up the fill side.
    rect(img, ox + 11, oy + 8, ox + 12, oy + 11, "fur_dark")
    px(img, ox + 12, oy + 7, "fur_dark")
    # Head: rounded — clip the top corners, dark crown, lit forehead.
    rect(img, ox + 4, oy + 1, ox + 10, oy + 6, "fur_mid")
    img.putpixel((ox + 4, oy + 1), TRANSPARENT)                 # round corners
    img.putpixel((ox + 10, oy + 1), TRANSPARENT)
    rect(img, ox + 5, oy + 1, ox + 9, oy + 1, "fur_dark")        # dark crown
    rect(img, ox + 5, oy + 2, ox + 7, oy + 3, lit("fur_mid"))    # forehead key light
    px(img, ox + 9, oy + 5, "fur_dark")                          # fill-side cheek shadow
    # Ears (key-lit left ear, shadowed right ear).
    px(img, ox + 4, oy + 0, lit("fur_mid"))
    px(img, ox + 10, oy + 0, "fur_dark")
    px(img, ox + 4, oy + 1, "ear_pink")
    px(img, ox + 10, oy + 1, "ear_pink")
    # Eyes — Billu's signature green, set 1px apart for a focused read.
    px(img, ox + 6, oy + 3, "eye_green")
    px(img, ox + 8, oy + 3, "eye_green")
    px(img, ox + 6, oy + 4, "outline")                          # pupil glint base
    px(img, ox + 8, oy + 4, "outline")
    # Nose + muzzle.
    px(img, ox + 7, oy + 4, "ear_pink")
    # Paws on the floor.
    px(img, ox + 4, oy + 13, "fur_dark")
    px(img, ox + 7, oy + 13, "fur_dark")
    px(img, ox + 10, oy + 13, "fur_dark")
    # AO where the cat meets the floor (contact shadow, one tone darker).
    ambient_occlusion(img, (ox + 3, oy + 7, ox + 11, oy + 13),
                      contact_edges=(False, False, True, False))


def _diagonal_falloff_wall(img: Image.Image, x1: int, y1: int) -> None:
    """Paint the wall as a key-lit (upper-left) -> shadow (lower-right) gradient.

    Three terracotta tones plus two Bayer transition bands placed at the actual
    light boundaries (not a floating patch). The boundary runs on the diagonal
    d = x + y so the falloff reads as directional golden-hour light, not a seam.
    Each pixel's band is chosen by its diagonal distance, giving:
        bright wall_hi  |  hi<->mid dither  |  wall_mid  |  mid<->shadow dither  |  wall_shadow
    """
    # Diagonal thresholds, tuned for a 48-wide wall: light pools upper-left.
    lit_tone = lit("wall_mid")     # wall_hi
    mid_tone = "wall_mid"
    dark_tone = shadow("wall_mid")  # wall_shadow
    for y in range(0, y1 + 1):
        for x in range(0, x1 + 1):
            d = x + y * 1.3  # weight y so light reads as coming from above-left
            if d < 26:
                px(img, x, y, lit_tone)
            elif d < 34:
                bayer = bayer_pick(x, y, coverage=(34 - d) / 8.0,
                                   dark=mid_tone, light=lit_tone)
                px(img, x, y, bayer)
            elif d < 50:
                px(img, x, y, mid_tone)
            elif d < 58:
                bayer = bayer_pick(x, y, coverage=(58 - d) / 8.0,
                                   dark=dark_tone, light=mid_tone)
                px(img, x, y, bayer)
            else:
                px(img, x, y, dark_tone)


def render_reference_frame() -> Image.Image:
    """Render the golden-hour chawl reference frame at base resolution.

    Scene: terracotta wall (3-tone, diagonal golden-hour falloff key-lit
    upper-left, dithered at the true light boundaries), a clay floor band, a
    brass vessel on a stone ledge, and Billu sitting beside it. This frame is
    the visual contract for A0.3.
    """
    img = new_frame(REF_W, REF_H)
    floor_y = 24  # horizon between wall and floor

    # --- Wall: 3-tone terracotta, diagonal golden-hour falloff -------------
    _diagonal_falloff_wall(img, REF_W - 1, floor_y - 1)

    # --- Floor: warm sunbaked clay, AO at the wall/floor join --------------
    rect(img, 0, floor_y, REF_W - 1, REF_H - 1, "floor_clay")
    # Far floor row near the wall sits slightly darker (less light reaches it);
    # dither it from clay toward wall_hi so the join reads as receding ground.
    bayer_dither(img, 0, floor_y, REF_W - 1, floor_y + 1,
                 dark="wall_hi", light="floor_clay", coverage=0.55)
    # Tile seam every 8px keeps the floor from reading as a flat slab.
    for sx in range(7, REF_W, 8):
        for sy in range(floor_y + 2, REF_H):
            px(img, sx, sy, "wall_hi")
    # Contact shadow where the floor meets the wall base (one tone darker).
    ambient_occlusion(img, (0, floor_y, REF_W - 1, floor_y),
                      contact_edges=(True, False, False, False))

    # --- Stone ledge (mid-right) -------------------------------------------
    ledge_x0, ledge_y0, ledge_x1, ledge_y1 = 30, 17, 44, 19
    rect(img, ledge_x0, ledge_y0, ledge_x1, ledge_y1, "wall_hi")
    rect(img, ledge_x0, ledge_y0, ledge_x1, ledge_y0, lit("wall_hi"))  # lit top
    # AO under the ledge lip (contact with shadowed wall).
    ambient_occlusion(img, (ledge_x0, ledge_y1, ledge_x1, ledge_y1),
                      contact_edges=(False, False, True, False))

    # --- Brass vessel (lota) on the ledge ----------------------------------
    # Warm brass rendered on the laddoo accent ramp (laddoo/laddoo_hi).
    vx = 36
    rect(img, vx, 12, vx + 4, 16, "laddoo")             # body
    rect(img, vx + 1, 16, vx + 3, 16, "laddoo")         # rounded base
    rect(img, vx, 12, vx + 1, 14, "laddoo_hi")          # key highlight upper-left
    px(img, vx + 4, 15, shadow("laddoo"))               # fill-side shadow (wall_mid)
    rect(img, vx + 1, 11, vx + 3, 11, "laddoo_hi")      # rim
    px(img, vx, 11, "outline")
    px(img, vx + 4, 11, "outline")
    # AO where the vessel sits on the ledge.
    ambient_occlusion(img, (vx, 16, vx + 4, 16),
                      contact_edges=(False, False, True, False))

    # --- Billu sitting on the floor, left of the ledge ---------------------
    _draw_billu_small(img, ox=6, oy=10)

    # Palette guard: any off-palette pixel anywhere is a hard fail.
    assert_on_palette(img)
    return img


def write_reference(scale_factor: int = 6) -> Tuple[Path, Path, str]:
    """Render, validate, save base + NEAREST-upscaled preview, return paths + SHA."""
    img = render_reference_frame()
    base_path = REF_DIR / "golden-hour-chawl.png"
    preview_path = REF_DIR / f"golden-hour-chawl_{scale_factor}x.png"
    public_path = PUBLIC / "golden-hour-chawl.png"

    img.save(base_path)
    img.save(public_path)
    scale(img, scale_factor).save(preview_path)

    sha = sha256_of(base_path)
    print(f"Wrote {base_path} ({img.width}x{img.height})  SHA256={sha}")
    print(f"Wrote {preview_path} ({img.width * scale_factor}x{img.height * scale_factor}, NEAREST)")
    print(f"Mirrored {public_path}")
    return base_path, preview_path, sha


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verify_reference_sha() -> bool:
    """Regression test: render in-memory, hash the PNG bytes, compare to golden.

    Returns True on match, raises AssertionError on mismatch. Renders to a fresh
    temp file so the check is independent of any on-disk artifact.
    """
    img = render_reference_frame()
    tmp = REF_DIR / ".golden-hour-chawl.verify.png"
    img.save(tmp)
    try:
        actual = sha256_of(tmp)
    finally:
        tmp.unlink(missing_ok=True)
    assert actual == GOLDEN_SHA, (
        f"Reference frame SHA changed!\n  expected {GOLDEN_SHA}\n  actual   {actual}\n"
        "If this change is intentional, update GOLDEN_SHA in tools/shading.py."
    )
    print(f"Reference SHA OK: {actual}")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="Whisker Protocol shading engine")
    ap.add_argument("--render", action="store_true",
                    help="Render + save the golden-hour reference frame")
    ap.add_argument("--verify", action="store_true",
                    help="Assert the reference frame SHA matches the golden value")
    ap.add_argument("--print-golden", action="store_true",
                    help="Print the current reference frame SHA (for updating GOLDEN_SHA)")
    args = ap.parse_args()

    if args.print_golden:
        img = render_reference_frame()
        tmp = REF_DIR / ".golden-hour-chawl.print.png"
        img.save(tmp)
        print(sha256_of(tmp))
        tmp.unlink(missing_ok=True)
        return
    if args.render:
        write_reference()
    if args.verify:
        verify_reference_sha()
    if not (args.render or args.verify):
        ap.print_help()


if __name__ == "__main__":
    main()
