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
  - FRAME_BUDGET         : documented per-state animation frame cap, enforced by
                           assert_within_budget() (exercised by --selftest).
  - render_reference_frame() + verify_reference_sha(): the golden pixel-SHA test.

The golden SHA hashes the decoded RGBA PIXELS (+ dimensions), not the encoded
PNG bytes, so the regression test is portable across Pillow/zlib versions.

Run:
    .venv/bin/python tools/shading.py --render       # (re)write the reference PNG
    .venv/bin/python tools/shading.py --verify       # assert pixel-SHA matches golden
    .venv/bin/python tools/shading.py --print-golden  # print current pixel-SHA
    .venv/bin/python tools/shading.py --selftest      # exercise the guard rails
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
    """Palette guard: hard-fail if ANY opaque pixel is not one of the 26 colours.

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
                    f"at ({x},{y}). Only the 26 locked colours are permitted."
                )
    return img


# ---------------------------------------------------------------------------
# Tone ramps — the on-palette ladders the 2-light model and AO walk
# ---------------------------------------------------------------------------

# Each ramp is ordered DARK -> LIGHT. "One tone darker" = previous entry;
# "one tone lighter" = next entry. The 2-light model and AO rule never invent
# colours — they only step along these ladders, so every result is on-palette.
#
# Some colours legitimately sit on TWO ramps (they are a shared boundary tone):
#   - floor_clay  : lightest tone of BOTH the wall ramp AND the guard-skin ramp.
#   - wall_mid    : darkest tone of BOTH the wall ramp AND the brass/laddoo ramp.
# Stepping such a colour is AMBIGUOUS — `shadow("floor_clay")` could mean
# "darker wall" (wall_hi) or "darker skin" (skin). The engine refuses to guess:
# callers MUST pass an explicit `ramp=` when shading an ambiguous colour.
TONE_RAMPS: Dict[str, List[str]] = {
    # Warm chawl terracotta wall (the locked 3-tone terracotta + clay).
    "wall": ["wall_shadow", "wall_mid", "wall_hi", "floor_clay"],
    # Billu fur.
    "fur": ["outline", "fur_dark", "fur_mid", "fur_light", "belly_cream"],
    # Laddoo / brass-warm accent ladder.
    "brass": ["wall_mid", "laddoo", "laddoo_hi"],
    # Guard skin ladder (hair -> skin highlight via clay).
    "skin": ["hair", "skin", "floor_clay"],
}

# name -> list of (ramp_key, position). A colour on >1 ramp has >1 entry, which
# is what makes it ambiguous. Built once; lets step_* run in O(1).
_RAMP_OF: Dict[str, List[Tuple[str, int]]] = {}
for _rk, _ramp in TONE_RAMPS.items():
    for _pi, _name in enumerate(_ramp):
        _RAMP_OF.setdefault(_name, []).append((_rk, _pi))

# Colours that appear on more than one ramp — shading them needs an explicit
# `ramp=`. Computed at module load so a NEW accidental overlap surfaces loudly
# instead of silently resolving to whichever ramp happened to be defined first.
_AMBIGUOUS: Dict[str, List[str]] = {
    name: [rk for rk, _ in entries]
    for name, entries in _RAMP_OF.items()
    if len(entries) > 1
}

# The only multi-ramp colours we have deliberately designed in. If this set
# ever changes, a ramp edit introduced (or removed) a shared boundary tone and
# the author must reconcile it consciously — fail at import, not at draw time.
_EXPECTED_AMBIGUOUS: Dict[str, frozenset] = {
    "floor_clay": frozenset({"wall", "skin"}),
    "wall_mid": frozenset({"wall", "brass"}),
}
assert {n: frozenset(rs) for n, rs in _AMBIGUOUS.items()} == _EXPECTED_AMBIGUOUS, (
    "Tone-ramp ambiguity changed! A colour now appears on a different set of "
    "ramps than the engine was designed for.\n"
    f"  found:    { {n: sorted(rs) for n, rs in _AMBIGUOUS.items()} }\n"
    f"  expected: { {n: sorted(rs) for n, rs in _EXPECTED_AMBIGUOUS.items()} }\n"
    "Reconcile TONE_RAMPS and _EXPECTED_AMBIGUOUS deliberately — no silent "
    "first-ramp-wins routing."
)


def _resolve_ramp(tone: str, ramp: Optional[str]) -> Tuple[str, int]:
    """Resolve (ramp_key, position) for a tone, demanding disambiguation when needed."""
    entries = _RAMP_OF.get(tone)
    if not entries:
        raise ValueError(f"Tone '{tone}' is not on any ramp; cannot shade it.")
    if ramp is not None:
        for rk, pi in entries:
            if rk == ramp:
                return rk, pi
        raise ValueError(
            f"Tone '{tone}' is not on ramp '{ramp}'. "
            f"It lives on: {[rk for rk, _ in entries]}."
        )
    if len(entries) > 1:
        raise ValueError(
            f"Tone '{tone}' is ambiguous — it appears on ramps "
            f"{[rk for rk, _ in entries]}. Pass an explicit ramp=, e.g. "
            f"shadow('{tone}', ramp='{entries[0][0]}')."
        )
    return entries[0]


def step_darker(tone: str, steps: int = 1, ramp: Optional[str] = None) -> str:
    """Return the tone exactly `steps` darker along its ramp (clamped at the end).

    `ramp` disambiguates colours that sit on more than one ramp (e.g. floor_clay,
    wall_mid). Omit it for unambiguous tones.
    """
    rk, pi = _resolve_ramp(tone, ramp)
    return TONE_RAMPS[rk][max(0, pi - steps)]


def step_lighter(tone: str, steps: int = 1, ramp: Optional[str] = None) -> str:
    """Return the tone exactly `steps` lighter along its ramp (clamped at the top).

    `ramp` disambiguates colours that sit on more than one ramp. Omit otherwise.
    """
    rk, pi = _resolve_ramp(tone, ramp)
    return TONE_RAMPS[rk][min(len(TONE_RAMPS[rk]) - 1, pi + steps)]


# ---------------------------------------------------------------------------
# 2-light model — key upper-left (warm golden), fill lower-right (cool/dim)
# ---------------------------------------------------------------------------

def lit(tone: str, ramp: Optional[str] = None) -> str:
    """Key-light tone: one step LIGHTER along the ramp (clamped). Upper-left faces.

    `ramp` disambiguates multi-ramp colours; omit for unambiguous tones.
    """
    return step_lighter(tone, 1, ramp=ramp)


def shadow(tone: str, ramp: Optional[str] = None) -> str:
    """Fill/shadow tone: one step DARKER along the ramp (clamped). Lower-right faces.

    `ramp` disambiguates multi-ramp colours; omit for unambiguous tones.
    """
    return step_darker(tone, 1, ramp=ramp)


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
    for tone in (dark, light):
        if tone not in PALETTE or len(PALETTE[tone]) != 3:
            raise ValueError(
                f"bayer_dither needs opaque palette tones (3-tuple RGB): "
                f"{dark!r}, {light!r} — got {tone!r}."
            )
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
        if cur in _AMBIGUOUS:
            return  # ambiguous tone: AO won't guess which ramp to step down
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
    """Hard-fail if a state's frame sheet exceeds its documented cap.

    Manual-use guard: call it from any sheet-writing path before saving an
    animation atlas (e.g. the Billu sheet path in sprite_gen.py once those
    states exist). Exercised today by `selftest()` so it is not dead code.
    """
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

# Base canvas. Small on purpose; upscaled NEAREST for preview. Grown 48x32 ->
# 96x64 (r2) to carry a jaali grill, a directional light pool, and two distinct
# props without crowding — the art contract Anmoll gates on.
REF_W, REF_H = 96, 64
GOLDEN_SHA = "045bd70bad68053d99ff30adc8d6059e9a5bdee64bda11189365719ff8d66e29"

# Wall ramp tones, pre-resolved with explicit ramps so no ambiguous step leaks.
_WALL_HI = lit("wall_mid", ramp="wall")      # wall_hi
_WALL_SHADOW = shadow("wall_mid", ramp="wall")  # wall_shadow


def _diagonal_falloff_wall(img: Image.Image, x1: int, y1: int) -> None:
    """Paint the wall as a key-lit (upper-left) -> shadow (lower-right) gradient.

    Three terracotta tones plus two Bayer transition bands placed at the actual
    light boundaries (not a floating patch). The boundary runs on a diagonal so
    the falloff reads as directional golden-hour light, not a seam. The bands,
    scaled for a 96-wide wall, give:
        bright wall_hi | hi<->mid dither | wall_mid | mid<->shadow dither | wall_shadow
    """
    lit_tone, mid_tone, dark_tone = _WALL_HI, "wall_mid", _WALL_SHADOW
    for y in range(0, y1 + 1):
        for x in range(0, x1 + 1):
            d = x + y * 1.3  # weight y so light reads as coming from above-left
            if d < 40:
                px(img, x, y, lit_tone)
            elif d < 52:
                px(img, x, y, bayer_pick(x, y, coverage=(52 - d) / 12.0,
                                         dark=mid_tone, light=lit_tone))
            elif d < 84:
                px(img, x, y, mid_tone)
            elif d < 96:
                px(img, x, y, bayer_pick(x, y, coverage=(96 - d) / 12.0,
                                         dark=dark_tone, light=mid_tone))
            else:
                px(img, x, y, dark_tone)


def _draw_jaali(img: Image.Image, x0: int, y0: int, x1: int, y1: int) -> None:
    """Carve a perforated jaali (lattice screen) into the back wall.

    THE cultural signifier: a recessed wall_shadow panel pierced by a regular
    diamond grid of light holes. The holes glow wall_hi (warm light pressing
    through from an implied courtyard); a key-lit upper/left bevel and an AO
    lower/right edge give the screen depth. Pure on-palette wall tones.
    """
    rect(img, x0, y0, x1, y1, _WALL_SHADOW)                # recessed dark panel
    # Frame: a lit upper/left bevel and a dark inner border so the screen reads
    # as set into the wall.
    rect(img, x0, y0, x1, y0 + 1, _WALL_HI)                # lit top lip (key light)
    rect(img, x0, y0, x0 + 1, y1, _WALL_HI)                # lit left jamb
    rect(img, x1 - 1, y0, x1, y1, "wall_mid")              # shadow right jamb
    rect(img, x0, y1 - 1, x1, y1, "wall_mid")              # shadow bottom lip
    # Diamond lattice: pierced holes on a regular rotated grid. A hole wherever
    # both (x+y) and (x-y) are multiples of 3 -> a clean diamond array. The holes
    # glow floor_clay (brightest wall tone = courtyard light pressing through);
    # the bars between them stay wall_shadow. This is the unmistakable jaali read.
    ix0, iy0, ix1, iy1 = x0 + 2, y0 + 2, x1 - 2, y1 - 2
    for y in range(iy0, iy1 + 1):
        for x in range(ix0, ix1 + 1):
            if (x + y) % 3 == 0 and (x - y) % 3 == 0:
                px(img, x, y, "floor_clay")                # bright pierced hole
                if x + 1 <= ix1:
                    px(img, x + 1, y, _WALL_HI)            # 1px warm bloom right
                if y + 1 <= iy1:
                    px(img, x, y + 1, _WALL_HI)            # 1px warm bloom down
    # AO down the lower + right outer edge (screen sits proud of the wall).
    ambient_occlusion(img, (x0, y0, x1, y1), contact_edges=(False, True, True, False))


def _draw_light_pool(img: Image.Image, floor_y: int) -> None:
    """Lay a directional golden-hour pool on the floor from an off-screen window.

    The key light enters upper-left, so the brightest clay sits lower-left and
    falls to deeper shadow toward the lower-right. Distance from the light's
    floor anchor drives a two-step ramp (floor_clay core -> wall_hi -> wall_mid)
    blended with Bayer at each boundary, so the floor reads as a lit pool with a
    real edge, not a flat slab.
    """
    cx, cy = 22, floor_y + 6   # implied window pool anchor, lower-left of centre
    for y in range(floor_y, REF_H):
        for x in range(0, REF_W):
            # Elliptical distance: stretch x so the pool rakes across the floor.
            dx, dy = (x - cx) * 0.70, (y - cy) * 1.15
            r = (dx * dx + dy * dy) ** 0.5
            if r < 9:
                # Hottest sunlit centre: marble-cream highlight dithered into clay.
                px(img, x, y, bayer_pick(x, y, coverage=(9 - r) / 9.0,
                                         dark="floor_clay", light="floor_marble"))
            elif r < 18:
                px(img, x, y, "floor_clay")                       # bright pool body
            elif r < 24:
                px(img, x, y, bayer_pick(x, y, coverage=(24 - r) / 6.0,
                                         dark="wall_hi", light="floor_clay"))
            elif r < 34:
                px(img, x, y, "wall_hi")                          # mid floor
            elif r < 40:
                px(img, x, y, bayer_pick(x, y, coverage=(40 - r) / 6.0,
                                         dark="wall_mid", light="wall_hi"))
            else:
                px(img, x, y, "wall_mid")                         # floor in shadow


def _draw_billu(img: Image.Image, ox: int, oy: int) -> None:
    """Billu sitting, 2-light shaded. ~20x22 — readable hero at 96x64 scale.

    Key light upper-left (lit fur on the left shoulder/forehead/ear), fill shadow
    lower-right. Signature saturated-green eyes. The tail is tucked tight against
    the right hip as a clear curl, not a detached blob.
    """
    # --- Body (sitting teardrop): mid fur core ----------------------------
    rect(img, ox + 4, oy + 12, ox + 16, oy + 21, "fur_mid")
    rect(img, ox + 5, oy + 10, ox + 15, oy + 12, "fur_mid")        # shoulders rise
    # Key-lit upper-left flank; fill-shadowed lower-right flank.
    rect(img, ox + 4, oy + 10, ox + 8, oy + 16, "fur_light")       # lit shoulder
    rect(img, ox + 13, oy + 15, ox + 16, oy + 21, "fur_dark")      # shadow hip
    # Cream belly/chest patch.
    rect(img, ox + 7, oy + 15, ox + 12, oy + 21, "belly_cream")
    px(img, ox + 7, oy + 15, "fur_mid")                            # soften patch corners
    px(img, ox + 12, oy + 15, "fur_mid")

    # --- Tail: tight curl hugging the right hip (no detached blob) ---------
    rect(img, ox + 15, oy + 18, ox + 17, oy + 21, "fur_dark")
    rect(img, ox + 16, oy + 14, ox + 17, oy + 18, "fur_dark")
    px(img, ox + 16, oy + 13, "fur_mid")                           # lit tail tip curl
    px(img, ox + 15, oy + 18, "fur_mid")                           # connect to hip

    # --- Head: rounded, dark crown, lit forehead --------------------------
    rect(img, ox + 5, oy + 2, ox + 14, oy + 10, "fur_mid")
    for (cx, cy) in [(ox + 5, oy + 2), (ox + 14, oy + 2),
                     (ox + 5, oy + 9), (ox + 14, oy + 9)]:
        img.putpixel((cx, cy), TRANSPARENT)                        # round the corners
    rect(img, ox + 6, oy + 2, ox + 13, oy + 3, "fur_dark")         # dark crown
    rect(img, ox + 6, oy + 4, ox + 9, oy + 6, "fur_light")         # forehead key light
    rect(img, ox + 12, oy + 7, ox + 14, oy + 9, "fur_dark")        # fill-side cheek

    # --- Ears (lit left, shadowed right) ----------------------------------
    rect(img, ox + 5, oy + 0, ox + 7, oy + 2, "fur_light")
    rect(img, ox + 12, oy + 0, ox + 14, oy + 2, "fur_dark")
    px(img, ox + 6, oy + 1, "ear_pink")
    px(img, ox + 13, oy + 1, "ear_pink")

    # --- Face: signature green eyes, nose ---------------------------------
    rect(img, ox + 7, oy + 5, ox + 8, oy + 6, "eye_green")
    rect(img, ox + 11, oy + 5, ox + 12, oy + 6, "eye_green")
    px(img, ox + 7, oy + 6, "outline")                             # pupils
    px(img, ox + 11, oy + 6, "outline")
    px(img, ox + 9, oy + 7, "ear_pink")                            # nose
    px(img, ox + 10, oy + 7, "ear_pink")
    px(img, ox + 9, oy + 8, "fur_dark")                            # muzzle line

    # --- Front paws on the floor ------------------------------------------
    rect(img, ox + 5, oy + 20, ox + 7, oy + 21, "belly_cream")
    rect(img, ox + 10, oy + 20, ox + 12, oy + 21, "belly_cream")

    # AO at the floor contact line (one tone darker along each fur ramp pixel).
    ambient_occlusion(img, (ox + 4, oy + 12, ox + 16, oy + 21),
                      contact_edges=(False, False, True, False))


def _draw_laddoo(img: Image.Image, cx: int, cy: int) -> None:
    """A round laddoo (the collectible). Unmistakably spherical, orange.

    A filled disc (radius 5) drawn by a circle test — a genuine round silhouette,
    not a box. Upper-left laddoo_hi specular, lower-right laddoo->wall_mid
    terminator, granular speckle for the laddoo texture, floor contact shadow.
    """
    radius = 5
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx * dx + dy * dy > radius * radius:
                continue                                            # outside the disc
            # Directional shade: upper-left lit, lower-right falls to shadow.
            t = dx + dy  # negative = toward key light (upper-left)
            if t <= -4:
                tone = "laddoo_hi"                                  # specular core
            elif t >= 5:
                tone = shadow("laddoo")                             # terminator (wall_mid)
            else:
                tone = "laddoo"
            px(img, cx + dx, cy + dy, tone)
    px(img, cx - 2, cy - 2, "ui_white")                            # tiny specular glint
    # Granular speckle (reads as the laddoo's nutty texture), on-disc only.
    for (dx, dy) in [(1, -1), (-1, 2), (2, 1), (0, 3)]:
        if dx * dx + dy * dy <= radius * radius:
            px(img, cx + dx, cy + dy, "laddoo_hi")
    # Contact shadow on the floor under it.
    for dx in (-2, -1, 0, 1, 2):
        px(img, cx + dx, cy + radius + 1, "wall_mid")


def _draw_lota(img: Image.Image, vx: int, vy: int) -> None:
    """A brass lota (vessel) on the ledge — the knockable Cat-Chaos prop.

    Cylindrical body with a clearly flared RIM on top and a small side HANDLE,
    so its silhouette can never be confused with the round laddoo. Brass tones
    walk the laddoo/brass ramp (laddoo body, laddoo_hi key light, wall_mid fill).
    """
    # Body: a tall-ish cylinder (taller than wide -> vessel, not ball).
    rect(img, vx, vy + 2, vx + 6, vy + 9, "laddoo")
    img.putpixel((vx, vy + 2), TRANSPARENT)                        # round shoulders
    img.putpixel((vx + 6, vy + 2), TRANSPARENT)
    rect(img, vx + 1, vy + 10, vx + 5, vy + 10, "laddoo")          # tucked base
    # Flared rim (wider than the body) — the defining vessel feature.
    rect(img, vx - 1, vy, vx + 7, vy, "laddoo_hi")
    rect(img, vx - 1, vy + 1, vx + 7, vy + 1, "laddoo")
    px(img, vx - 1, vy, "outline")                                 # rim ends
    px(img, vx + 7, vy, "outline")
    # Key highlight up the upper-left of the body.
    rect(img, vx, vy + 3, vx + 1, vy + 7, "laddoo_hi")
    # Fill-side shadow down the right of the body.
    rect(img, vx + 5, vy + 4, vx + 6, vy + 9, shadow("laddoo"))    # wall_mid
    # Side handle (right) — a small loop, unmistakable vessel cue.
    px(img, vx + 7, vy + 4, "laddoo")
    px(img, vx + 8, vy + 5, "laddoo")
    px(img, vx + 7, vy + 6, "laddoo")
    # AO where the lota sits on the ledge.
    ambient_occlusion(img, (vx, vy + 10, vx + 5, vy + 10),
                      contact_edges=(False, False, True, False))


def _draw_laundry(img: Image.Image, y: int) -> None:
    """A hanging laundry line silhouette across the upper wall — chawl texture.

    A thin outline cord with two cloth panels draped over it (one lit edge, one
    shadowed). Reads as the ubiquitous chawl washing-line without crowding.
    """
    rect(img, 40, y, REF_W - 1, y, "outline")                      # the cord
    # Cloth panel A (kurta_yellow — a warm sari/dhoti), lit left edge.
    rect(img, 50, y + 1, 56, y + 8, "kurta_yellow")
    rect(img, 50, y + 1, 50, y + 8, "laddoo_hi")                   # lit left fold
    rect(img, 56, y + 4, 56, y + 8, "laddoo")                      # shadowed right fold
    # Cloth panel B (carpet_red — a cloth), offset right.
    rect(img, 62, y + 1, 67, y + 6, "carpet_red")
    px(img, 67, y + 5, "wall_shadow")                              # shadowed hem corner


def render_reference_frame() -> Image.Image:
    """Render the golden-hour chawl reference frame at base resolution (96x64).

    Scene, lit by a fixed upper-left golden-hour key: a 3-tone terracotta wall
    carrying a perforated JAALI grill (the cultural anchor) and a laundry line;
    a clay floor with a directional LIGHT POOL raking in from an off-screen
    window and falling to shadow; a stone ledge holding a brass LOTA (rim +
    handle — the knockable prop); a round LADDOO collectible on the floor; and
    Billu sitting between them, signature green eyes, tail tucked. This frame is
    the visual contract for A0.3 — the 4-point art test gates on it.
    """
    img = new_frame(REF_W, REF_H)
    floor_y = 44  # horizon between wall and floor

    # --- Wall: 3-tone terracotta, diagonal golden-hour falloff -------------
    _diagonal_falloff_wall(img, REF_W - 1, floor_y - 1)

    # --- Jaali grill: upper-left-of-centre, the cultural signifier ---------
    _draw_jaali(img, 30, 6, 54, 34)

    # --- Laundry line across the upper-right wall ---------------------------
    _draw_laundry(img, 4)

    # --- Floor: directional golden-hour light pool -------------------------
    _draw_light_pool(img, floor_y)
    # Tile seams every 12px keep the floor from reading as a flat slab.
    for sx in range(11, REF_W, 12):
        for sy in range(floor_y + 2, REF_H):
            px(img, sx, sy, _WALL_SHADOW)
    # Contact shadow where the floor meets the wall base (one tone darker).
    ambient_occlusion(img, (0, floor_y, REF_W - 1, floor_y),
                      contact_edges=(True, False, False, False))

    # --- Stone ledge (mid-right) -------------------------------------------
    ledge_x0, ledge_y0, ledge_x1, ledge_y1 = 62, 30, 90, 34
    rect(img, ledge_x0, ledge_y0, ledge_x1, ledge_y1, "wall_hi")
    rect(img, ledge_x0, ledge_y0, ledge_x1, ledge_y0, _WALL_HI)       # lit top
    rect(img, ledge_x1, ledge_y0, ledge_x1, ledge_y1, "wall_mid")     # shadow right face
    # AO under the ledge lip (contact with shadowed wall).
    ambient_occlusion(img, (ledge_x0, ledge_y1, ledge_x1, ledge_y1),
                      contact_edges=(False, False, True, False))

    # --- Brass lota on the ledge -------------------------------------------
    _draw_lota(img, vx=74, vy=20)

    # --- Billu sitting on the floor, left of centre ------------------------
    _draw_billu(img, ox=20, oy=24)

    # --- Laddoo collectible on the floor, right of Billu, in the pool edge --
    _draw_laddoo(img, cx=54, cy=52)

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

    sha = pixel_sha(img)
    print(f"Wrote {base_path} ({img.width}x{img.height})  pixel-SHA256={sha}")
    print(f"Wrote {preview_path} ({img.width * scale_factor}x{img.height * scale_factor}, NEAREST)")
    print(f"Mirrored {public_path}")
    return base_path, preview_path, sha


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def pixel_sha(img: Image.Image) -> str:
    """SHA256 of the raw RGBA pixels + dimensions — NOT the encoded PNG bytes.

    PNG file bytes vary with zlib/Pillow version and compress_level, which made
    the old file-hash a non-portable regression guard. Hashing the decoded RGBA
    buffer plus the WxH dimensions pins the actual visual content and is stable
    across machines and Pillow versions.
    """
    rgba = img.convert("RGBA")
    h = hashlib.sha256()
    h.update(f"{rgba.width}x{rgba.height}:".encode("ascii"))
    h.update(rgba.tobytes())
    return h.hexdigest()


def verify_reference_sha() -> bool:
    """Regression test: render in-memory, hash the PIXELS, compare to golden.

    Returns True on match, raises AssertionError on mismatch. Hashes the decoded
    RGBA pixel buffer (portable across Pillow/zlib versions), never the PNG file.
    """
    actual = pixel_sha(render_reference_frame())
    assert actual == GOLDEN_SHA, (
        f"Reference frame SHA changed!\n  expected {GOLDEN_SHA}\n  actual   {actual}\n"
        "If this change is intentional, update GOLDEN_SHA in tools/shading.py."
    )
    print(f"Reference pixel-SHA OK: {actual}")
    return True


# ---------------------------------------------------------------------------
# Engine self-test — exercises the invariants that have no other caller
# ---------------------------------------------------------------------------

def selftest() -> bool:
    """Exercise the guard rails that the reference render alone does not hit.

    Covers: (1) the frame-budget assertion in both directions, (2) the
    multi-ramp ambiguity guard refusing to shade without an explicit `ramp=`,
    and (3) that an explicit `ramp=` routes to the correct ladder. Run via
    `--selftest`; cheap enough to keep in CI alongside `--verify`.
    """
    # (1) Frame budget: within cap passes, over cap and unknown state raise.
    assert_within_budget("bat", FRAME_BUDGET["bat"])  # exactly at cap: OK
    assert_within_budget("idle", 1)                    # under cap: OK
    for bad in (("bat", FRAME_BUDGET["bat"] + 1), ("does_not_exist", 1)):
        try:
            assert_within_budget(*bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"assert_within_budget should have rejected {bad!r}")

    # (2) Ambiguous tones refuse to shade without an explicit ramp.
    for tone in _AMBIGUOUS:
        for fn in (shadow, lit):
            try:
                fn(tone)  # no ramp= → must raise
            except ValueError:
                pass
            else:
                raise AssertionError(
                    f"{fn.__name__}({tone!r}) should have raised (ambiguous tone)."
                )

    # (3) Explicit ramp routes correctly: floor_clay shadows differ per ramp.
    assert shadow("floor_clay", ramp="wall") == "wall_hi"
    assert shadow("floor_clay", ramp="skin") == "skin"
    assert shadow("wall_mid", ramp="wall") == "wall_shadow"
    assert shadow("wall_mid", ramp="brass") == "wall_mid"  # clamped at ramp floor

    # Unambiguous tones still work with no ramp= (backward compatible).
    assert lit("fur_mid") == "fur_light"
    assert shadow("fur_mid") == "fur_dark"

    print("Self-test OK: frame budget + ramp-ambiguity guards + ramp routing.")
    return True


def main() -> None:
    ap = argparse.ArgumentParser(description="Whisker Protocol shading engine")
    ap.add_argument("--render", action="store_true",
                    help="Render + save the golden-hour reference frame")
    ap.add_argument("--verify", action="store_true",
                    help="Assert the reference frame SHA matches the golden value")
    ap.add_argument("--print-golden", action="store_true",
                    help="Print the current reference frame pixel-SHA (for updating GOLDEN_SHA)")
    ap.add_argument("--selftest", action="store_true",
                    help="Exercise the frame-budget + ramp-ambiguity guard rails")
    args = ap.parse_args()

    if args.print_golden:
        print(pixel_sha(render_reference_frame()))
        return
    if args.selftest:
        selftest()
    if args.render:
        write_reference()
    if args.verify:
        verify_reference_sha()
    if not (args.render or args.verify or args.selftest):
        ap.print_help()


if __name__ == "__main__":
    main()
