#!/usr/bin/env python3
"""
Whisker Protocol — Billu hero sprite module (A0.3 polish pass)

The single source of truth for the hero cat's pixels. Every Billu frame in the
game (and the one in the golden-hour reference scene) is drawn here, shaded with
the SAME deterministic engine the rest of the pipeline calibrates against
(tools/shading.py): NEAREST-only, 2-light model on the locked palette, 4x4 Bayer
the only tonal blend, AO as a placement rule. No painted PNGs, no AI tools.

What this module fixes vs the prior Billu candidates / scene cat:
  - The tail is INTEGRATED into the body silhouette as a continuous taper that
    sweeps up from the hip — never a detached blob. Its SHAPE encodes mood, so
    the tail doubles as the tail-as-HUD vocabulary.
  - Fur is shaded with the real 2-light model + a Bayer flank turn, a full 1px
    outline for depth, the signature saturated green eyes, and a 1px squash for
    personality (loaf/idle breathing).
  - Distinct, readable key poses within FRAME_BUDGET.

Public API:
  - draw_pose(name) -> 24x24 RGBA frame (palette-guarded).
  - draw_tail_state(name) -> 24x24 RGBA frame: a neutral seated Billu wearing one
    of the four tail-mood silhouettes (the HUD vocabulary).
  - POSES / TAIL_STATES: the canonical name lists.
  - write_billu_sheets(): writes the preview PNGs (native + 6x) to public/sprites.

Run:
    .venv/bin/python tools/billu.py --sheets       # write pose + tail-state sheets
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Callable, Dict, List

from PIL import Image

from sprite_gen import PALETTE, TRANSPARENT, new_frame, px, rect, scale  # noqa: F401
from shading import (
    assert_on_palette,
    bayer_pick,
    ambient_occlusion,
    assert_within_budget,
)

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "sprites"
PUBLIC.mkdir(parents=True, exist_ok=True)

FRAME = 24  # Billu's locked sprite frame (art-direction.md)


# ---------------------------------------------------------------------------
# Silhouette + outline helpers — build Billu as one connected shape
# ---------------------------------------------------------------------------

def _outline_silhouette(img: Image.Image) -> None:
    """Trace a 1px `outline` ring around every opaque cluster — depth + read.

    For each opaque pixel, any 4-neighbour that is transparent becomes outline.
    Run AFTER all fur fill so the whole cat (body + integrated tail + head + ears)
    reads as one crisp silhouette against the floor. Outline is off-ramp, so AO
    and the palette guard leave it alone.
    """
    w, h = img.size
    src = img.load()
    edges = []
    for y in range(h):
        for x in range(w):
            if src[x, y][3] == 0:
                continue
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] == 0:
                    edges.append((nx, ny))
    for (x, y) in edges:
        px(img, x, y, "outline")


def _eyes_and_face(img: Image.Image, ox: int, oy: int, *, alert: bool = False,
                   track: int = 0) -> None:
    """The face: signature saturated green eyes, pink nose, fine muzzle.

    `alert=True` widens the eyes (one extra lit-green pixel each) and lifts the
    pupils — the universal 'Billu has noticed something' read that pairs with the
    alerted/puffed tail. Kept identical across poses otherwise so Billu's
    expression is recognisably HIM.

    `track` shifts the PUPILS only, eyes-following-the-prop for the watch beat:
    +1 = down-right (prop fell to Billu's right). The iris stays put; only the
    dark pupil + catch-light move, so it reads as a glance, not a head turn.
    """
    # Eye sockets (slight dark recess so the green pops).
    rect(img, ox + 7, oy + 5, ox + 9, oy + 7, "fur_dark")
    rect(img, ox + 11, oy + 5, ox + 13, oy + 7, "fur_dark")
    # Saturated green irises.
    rect(img, ox + 7, oy + 5, ox + 8, oy + 6, "eye_green")
    rect(img, ox + 11, oy + 5, ox + 12, oy + 6, "eye_green")
    if alert:
        px(img, ox + 9, oy + 5, "eye_green")
        px(img, ox + 13, oy + 5, "eye_green")
    # Pupils + a single ui_white catch-light (life in the eye). `track` slides
    # the pupil to the down-right corner of the iris when watching a falling prop.
    pdx, pdy = (1, 1) if track > 0 else (0, 0)
    px(img, ox + 8 + pdx, oy + 6 + pdy - (1 if track else 0), "outline")
    px(img, ox + 12 + pdx, oy + 6 + pdy - (1 if track else 0), "outline")
    px(img, ox + 7, oy + 5, "ui_white")
    px(img, ox + 11, oy + 5, "ui_white")
    # Pink nose + muzzle.
    px(img, ox + 9, oy + 8, "ear_pink")
    px(img, ox + 10, oy + 8, "ear_pink")
    px(img, ox + 9, oy + 9, "fur_dark")
    px(img, ox + 10, oy + 9, "fur_dark")


def _head(img: Image.Image, ox: int, oy: int, *, alert: bool = False,
          dx: int = 0, dy: int = 0, ears_forward: bool = False,
          track: int = 0) -> None:
    """Rounded oversized head (cute-anime read), key-lit upper-left.

    Dark crown (fur_dark, the top-of-head shadow), a fur_light forehead/cheek on
    the upper-left key side, a Bayer flank turn down the right cheek to fur_dark,
    and lit/shadowed ears with pink inners. Corners rounded by clearing pixels.

    `dx`/`dy` shift the whole head — used by creep (head pushed low + forward) and
    the bat wind-up (head tips toward the prop). `ears_forward=True` pins the ears
    flat-forward over the brow (the predatory / committed read) instead of upright.
    """
    ox, oy = ox + dx, oy + dy
    rect(img, ox + 5, oy + 1, ox + 14, oy + 10, "fur_mid")
    for (cx, cy) in [(ox + 5, oy + 1), (ox + 14, oy + 1),
                     (ox + 5, oy + 10), (ox + 14, oy + 10)]:
        img.putpixel((cx, cy), TRANSPARENT)                  # round the corners
    rect(img, ox + 6, oy + 1, ox + 13, oy + 2, "fur_dark")   # dark crown
    rect(img, ox + 5, oy + 3, ox + 8, oy + 6, "fur_light")   # forehead key light
    # Bayer flank turn down the shadow-side cheek (mid -> dark).
    for y in range(oy + 4, oy + 10):
        for x in range(ox + 11, ox + 14):
            px(img, x, y, bayer_pick(x, y, coverage=0.4,
                                     dark="fur_dark", light="fur_mid"))
    if ears_forward:
        # Ears swept forward + low over the brow — predator focus / commitment.
        rect(img, ox + 5, oy + 1, ox + 7, oy + 2, "fur_light")   # lit left ear forward
        rect(img, ox + 12, oy + 1, ox + 14, oy + 2, "fur_dark")  # shadow right ear forward
        px(img, ox + 6, oy + 2, "ear_pink")
        px(img, ox + 13, oy + 2, "ear_pink")
    else:
        # Ears: lit left, shadowed right, pink inners, upright.
        rect(img, ox + 4, oy - 1, ox + 6, oy + 1, "fur_light")
        rect(img, ox + 13, oy - 1, ox + 15, oy + 1, "fur_dark")
        px(img, ox + 5, oy, "ear_pink")
        px(img, ox + 14, oy, "ear_pink")
    _eyes_and_face(img, ox, oy, alert=alert, track=track)


def _body(img: Image.Image, ox: int, oy: int, *, squash: int = 0,
          loaf: bool = False, creep: bool = False) -> None:
    """Billu's torso, drawn in one of three distinct silhouettes (key-lit upper-left).

    The STANCE drives the silhouette so each pose reads at a glance:
      - default (idle): tall seated teardrop — shoulders rise, narrow base.
      - `loaf=True`    : a compact low brick — shoulders flattened, base widened
                         to the full frame, paws tucked as a single cream bar. No
                         neck gap (the head sits straight down onto it).
      - `creep=True`   : a long low predatory crouch — the torso stretches
                         horizontally and drops, belly skimming the floor, with a
                         lit haunch at the rear-right. Unmistakably a stalking cat.

    `squash` (0 or 1) lowers the shoulder line 1px for the breathing read on idle.
    Fur: mid core, fur_light lit shoulder, a Bayer turn to fur_dark on the
    shadow-side hip, belly_cream chest/belly.
    """
    if creep:
        # Long low stalk: a horizontal slab from the floor up only ~6px, stretched
        # wide so the silhouette is clearly longer-than-tall (the opposite of idle).
        base = oy + 21
        rect(img, ox + 2, base - 5, ox + 18, base, "fur_mid")        # long low torso
        rect(img, ox + 2, base - 6, ox + 16, base - 5, "fur_mid")    # rounded back line
        # Lit shoulder/back along the upper-left edge (key grazes the spine).
        rect(img, ox + 2, base - 6, ox + 9, base - 5, "fur_light")
        rect(img, ox + 2, base - 5, ox + 4, base - 2, "fur_light")
        # Lit haunch lump at the rear-right (the coiled back leg) — reads as power.
        rect(img, ox + 15, base - 6, ox + 18, base - 2, "fur_mid")
        px(img, ox + 15, base - 6, "fur_light")
        # Bayer flank turn down the shadow-side belly (mid -> dark).
        for y in range(base - 3, base + 1):
            for x in range(ox + 11, ox + 18):
                px(img, x, y, bayer_pick(x, y, coverage=0.3,
                                         dark="fur_dark", light="fur_mid"))
        # Low cream belly skimming the floor.
        rect(img, ox + 6, base - 2, ox + 13, base, "belly_cream")
        # Stretched-forward front paws reaching low-left (the stalk lead).
        rect(img, ox + 2, base, ox + 4, base, "belly_cream")
        rect(img, ox + 7, base, ox + 9, base, "belly_cream")
        return

    top = oy + 12 + squash
    if loaf:
        # Compact brick: flatten the shoulder rise and widen the base full-frame.
        rect(img, ox + 3, top + 1, ox + 17, oy + 21, "fur_mid")      # wide low body
        rect(img, ox + 4, top, ox + 16, top + 1, "fur_mid")          # gently domed top
        rect(img, ox + 3, top + 1, ox + 8, top + 5, "fur_light")     # lit left flank
        for y in range(top + 3, oy + 22):
            for x in range(ox + 12, ox + 18):
                px(img, x, y, bayer_pick(x, y, coverage=0.3,
                                         dark="fur_dark", light="fur_mid"))
        rect(img, ox + 7, top + 3, ox + 12, oy + 21, "belly_cream")  # cream chest
        px(img, ox + 7, top + 3, "fur_mid")
        px(img, ox + 12, top + 3, "fur_mid")
        rect(img, ox + 5, oy + 20, ox + 14, oy + 21, "belly_cream")  # tucked loaf paws (one bar)
        return

    # Default seated teardrop.
    rect(img, ox + 4, top, ox + 16, oy + 21, "fur_mid")
    rect(img, ox + 5, top - 2, ox + 15, top, "fur_mid")          # shoulders rise
    # Lit upper-left shoulder (key).
    rect(img, ox + 4, top - 1, ox + 8, top + 5, "fur_light")
    # Bayer flank turn on the lower-right hip (mid -> dark).
    for y in range(top + 2, oy + 22):
        for x in range(ox + 12, ox + 17):
            px(img, x, y, bayer_pick(x, y, coverage=0.35,
                                     dark="fur_dark", light="fur_mid"))
    # Cream chest blaze.
    rect(img, ox + 7, top + 2, ox + 12, oy + 21, "belly_cream")
    px(img, ox + 7, top + 2, "fur_mid")                          # soften patch corners
    px(img, ox + 12, top + 2, "fur_mid")
    # Front paws.
    rect(img, ox + 5, oy + 20, ox + 7, oy + 21, "belly_cream")
    rect(img, ox + 10, oy + 20, ox + 12, oy + 21, "belly_cream")


# ---------------------------------------------------------------------------
# The tail — drawn as a connected taper FROM the hip. Shape == mood (the HUD).
# ---------------------------------------------------------------------------

def _tail(img: Image.Image, ox: int, oy: int, mood: str) -> None:
    """Draw the tail as a continuous taper rooted in the lower-right hip.

    Every mood starts at the same root pixel (ox+15, oy+19) flush against the
    body so the tail is part of the silhouette, then traces a path of segments —
    no detached blob is possible. The PATH encodes the mood (the tail-as-HUD):

      idle    : a relaxed S that curls back up beside the hip (calm).
      puffed  : a thick bristled arc raised high + bushed out (alert/fear).
      flick   : a tense hook snapping forward over the back (pre-bat wind-up).
      safe    : a tall vertical 'question-mark' high above the body (all-clear).

    Each segment is lit on its upper-left (fur_mid) and shadowed lower-right
    (fur_dark) so the tail turns with the same key light as the body.
    """
    root_x, root_y = ox + 16, oy + 19

    def seg(x: int, y: int, lit: bool = False, puff: bool = False) -> None:
        # a 2px-thick tail segment: lit face + shadowed underside/outer edge so
        # the tail turns with the key light and stands clear of the body.
        if not (0 <= x < FRAME and 0 <= y < FRAME):
            return
        px(img, x, y, "fur_light" if lit else "fur_mid")
        if x + 1 < FRAME:
            px(img, x + 1, y, "fur_dark")                    # shadowed outer edge (right)
        if puff:
            if x + 2 < FRAME:
                px(img, x + 2, y, "fur_dark")                # bristled outer edge
            if y + 1 < FRAME:
                px(img, x, y + 1, "fur_mid")                 # extra thickness (bushy)

    # Anchor: weld the tail base into the hip so there is no seam.
    px(img, root_x - 1, root_y, "fur_mid")
    px(img, root_x - 1, root_y - 1, "fur_mid")

    if mood == "idle":
        # relaxed S sweeping out to the right then curling back up — calm.
        path = [(17, 18), (18, 16), (19, 14), (19, 12), (18, 11), (17, 11)]
        lit_idx = {3, 4, 5}
        for i, (dx, dy) in enumerate(path):
            seg(ox + dx, oy + dy, lit=i in lit_idx)
    elif mood == "puffed":
        # raised straight up + FAT + bristled — unmistakable fear/alert from
        # across the screen. A 3-4px-wide bottlebrush, the opposite of the thin
        # safe tail. Drawn as a filled bushy column with spiked outer bristles.
        spine = [(18, 17), (18, 14), (18, 11), (18, 8), (18, 5), (18, 3)]
        for i, (dx, dy) in enumerate(spine):
            lit = i >= 2
            # 3px-wide core column (lit centre, shadow sides).
            px(img, ox + dx - 1, oy + dy, "fur_mid")
            px(img, ox + dx, oy + dy, "fur_light" if lit else "fur_mid")
            px(img, ox + dx + 1, oy + dy, "fur_dark")
            # fill the gaps between spine points so the column is solid.
            if i + 1 < len(spine):
                ny = oy + spine[i + 1][1]
                for yy in range(ny + 1, oy + dy):
                    px(img, ox + dx - 1, yy, "fur_mid")
                    px(img, ox + dx, yy, "fur_light" if lit else "fur_mid")
                    px(img, ox + dx + 1, yy, "fur_dark")
        # spiked bristle tufts jutting out both sides (the bottlebrush read).
        for (dx, dy) in [(20, 9), (20, 6), (16, 7), (16, 4), (20, 12), (16, 11),
                         (19, 4), (17, 2)]:
            if 0 <= ox + dx < FRAME and 0 <= oy + dy < FRAME:
                px(img, ox + dx, oy + dy, "fur_dark")
    elif mood == "flick":
        # tense S that whips UP then snaps FORWARD over the back — pre-bat
        # wind-up. The forward-pointing hooked tip is the signature read.
        path = [(17, 18), (18, 16), (19, 14), (19, 12), (18, 11)]
        lit_idx = {2, 3, 4}
        for i, (dx, dy) in enumerate(path):
            seg(ox + dx, oy + dy, lit=i in lit_idx)
        # the whip-tip hooks forward (leftward) over the back — tension.
        for (dx, dy, tone) in [(17, 10, "fur_mid"), (16, 10, "fur_light"),
                               (15, 10, "fur_light"), (14, 11, "fur_mid")]:
            px(img, ox + dx, oy + dy, tone)
        px(img, ox + 14, oy + 12, "fur_dark")                # underside of the hook
    elif mood == "low":
        # tail held LOW + straight out behind, skimming the floor — the stalk
        # counterbalance. Reads as tension held flat, the opposite of the high
        # safe tail. A near-horizontal taper trailing off the rear haunch.
        path = [(17, 19), (19, 19), (20, 18), (21, 18), (22, 17)]
        lit_idx = {0, 1, 2}
        for i, (dx, dy) in enumerate(path):
            seg(ox + dx, oy + dy, lit=i in lit_idx)
        px(img, ox + 22, oy + 16, "fur_mid")                 # tip flicks up 1px (live)
    elif mood == "safe":
        # a tall, THIN, elegant 'question-mark' high above — all-clear. Kept 1px
        # (no bushy doubling) so it never reads as the puffed alarm tail.
        thin = [(17, 18), (17, 16), (18, 14), (18, 12), (18, 10),
                (18, 8), (17, 6), (16, 5), (15, 5)]
        lit_idx = {3, 4, 5, 6}
        for i, (dx, dy) in enumerate(thin):
            px(img, ox + dx, oy + dy, "fur_light" if i in lit_idx else "fur_mid")
            if ox + dx + 1 < FRAME:
                px(img, ox + dx + 1, oy + dy, "fur_dark")    # 1px shadow edge only
        px(img, ox + 15, oy + 6, "fur_dark")                 # inner curl of the hook
    else:
        raise ValueError(f"Unknown tail mood: {mood!r}")


# ---------------------------------------------------------------------------
# Poses — each composes head + body + a tail mood, then outlines + AO.
# ---------------------------------------------------------------------------

def _assemble(*, squash: int, loaf: bool, tail_mood: str, alert: bool,
              creep: bool = False, head_dx: int = 0, head_dy: int = 0,
              ears_forward: bool = False, track: int = 0,
              ox: int = 0, oy: int = 1) -> Image.Image:
    """Compose one Billu frame from the parts and finish it (outline + AO)."""
    img = new_frame(FRAME, FRAME)
    _tail(img, ox, oy, tail_mood)                # tail first (body overlaps its root)
    _body(img, ox, oy, squash=squash, loaf=loaf, creep=creep)
    _head(img, ox, oy, alert=alert, dx=head_dx, dy=head_dy,
          ears_forward=ears_forward, track=track)
    _outline_silhouette(img)
    # Floor-contact AO under the base (one tone darker along the fur ramp). The
    # creep stance sits lower + longer, so its contact band is wider and shallower.
    if creep:
        ambient_occlusion(img, (ox + 2, oy + 19, ox + 18, oy + 21),
                          contact_edges=(False, False, True, False))
    else:
        ambient_occlusion(img, (ox + 4, oy + 12, ox + 16, oy + 21),
                          contact_edges=(False, False, True, False))
    assert_on_palette(img)
    return img


# Pose registry. Each maps to a finished 24x24 frame. 'sit' is the scene canon.
def _pose_sit() -> Image.Image:
    return _assemble(squash=0, loaf=False, tail_mood="idle", alert=False)


def _pose_idle_a() -> Image.Image:
    return _assemble(squash=0, loaf=False, tail_mood="idle", alert=False)


def _pose_idle_b() -> Image.Image:
    # breathing exhale: 1px squash + tail tip drifts (read as a living idle).
    return _assemble(squash=1, loaf=False, tail_mood="idle", alert=False)


def _pose_loaf() -> Image.Image:
    return _assemble(squash=1, loaf=True, tail_mood="idle", alert=False)


def _pose_creep() -> Image.Image:
    # creep / sneak: long low predatory crouch, head pushed forward + low, ears
    # swept flat, tail held low and straight behind. A completely different
    # silhouette from the upright idle — stretched horizontal, belly to floor.
    return _assemble(squash=0, loaf=False, tail_mood="low", alert=True,
                     creep=True, head_dx=-2, head_dy=4, ears_forward=True)


# --- The bat hero verb — a 3-frame sequence (FRAME_BUDGET["bat"] == 3) --------
# Each frame is built to the locked choreography (whisker-protocol-bat-choreography):
# wind-up (coil/anticipation) -> strike (the contact frame) -> watch (eye-track
# the fallen prop). The runtime cycles these at the documented 60fps timings;
# here we author the three KEY frames the cycle holds on.

def _pose_bat_windup() -> Image.Image:
    """Anticipation peak (choreography frames 3-7): Billu COILS to strike.

    Weight shifts back + down (micro-crouch squash), the head tips toward the
    prop with ears swept forward (commitment), pupils dilated alert, and the tail
    whips up into the forward 'flick' hook (R4.1 'tail flicks before a bat'). The
    striking paw is drawn cocked back against the chest — loaded, not yet thrown.
    A viewer reads 'about to happen' before the strike lands.
    """
    img = _assemble(squash=1, loaf=False, tail_mood="flick", alert=True,
                    head_dx=-1, head_dy=1, ears_forward=True)
    # Cocked paw: pulled in against the chest, low — the loaded spring.
    rect(img, 10, 18, 12, 19, "belly_cream")
    px(img, 10, 18, "fur_light")                               # lit upper edge
    px(img, 9, 19, "outline")                                  # crisp inner edge
    px(img, 12, 20, "outline")
    assert_on_palette(img)
    return img


def _strike_body(img: Image.Image, ox: int, oy: int) -> None:
    """A committed LUNGING torso for the strike — silhouette leans into the blow.

    Unlike the seated teardrop, this body is a forward-and-up parallelogram: the
    haunches stay planted low-left, the spine ramps up to a raised driving
    shoulder on the upper-right, and the chest thrusts toward the strike. The
    shape itself says 'thrown forward', so the strike reads even with the paw
    masked. Key-lit upper-left, Bayer shadow turn on the lower-right flank.
    """
    base = oy + 21
    # Planted rear haunch, low-left (the anchor the lunge pivots on).
    rect(img, ox + 3, base - 6, ox + 9, base, "fur_mid")
    rect(img, ox + 3, base - 6, ox + 6, base - 1, "fur_light")   # lit rear flank
    # Spine ramps UP to a raised driving shoulder on the right (the lunge line).
    rect(img, ox + 8, base - 8, ox + 14, base, "fur_mid")
    rect(img, ox + 12, base - 10, ox + 16, base - 3, "fur_mid")  # raised shoulder mass
    rect(img, ox + 12, base - 10, ox + 14, base - 6, "fur_light")  # lit driving shoulder
    # Bayer shadow turn on the lower-right flank (mid -> dark) — the body turns.
    for y in range(base - 4, base + 1):
        for x in range(ox + 13, ox + 17):
            px(img, x, y, bayer_pick(x, y, coverage=0.3,
                                     dark="fur_dark", light="fur_mid"))
    # Cream chest thrust forward under the raised shoulder.
    rect(img, ox + 7, base - 5, ox + 12, base, "belly_cream")
    px(img, ox + 7, base - 5, "fur_mid")
    # Planted rear paw + a braced front paw (weight forward).
    rect(img, ox + 4, base, ox + 6, base, "belly_cream")
    rect(img, ox + 9, base, ox + 11, base, "belly_cream")


def _pose_bat_strike() -> Image.Image:
    """THE contact frame (choreography frame 8): the takedown made visible.

    Billu LUNGES — a forward-leaning torso (custom `_strike_body`, not the seated
    teardrop) drives a fully-extended foreleg up-and-right to the contact point.
    The head leads after the paw with ears pinned forward; the tail snaps back as
    counterbalance. The foreleg is a long clean lit diagonal ending in a rounded
    paw, with a 1px MOTION-SMEAR streak trailing the tip (the impact). Seen alone,
    this frame should land as a powerful, intentional swat — the hero verb.
    """
    img = new_frame(FRAME, FRAME)
    ox, oy = 0, 1
    # Tail snaps back-and-up as counterbalance to the forward lunge (flick hook).
    _tail(img, ox, oy, "flick")
    _strike_body(img, ox, oy)
    # Head leads the strike: driven down-and-right, ears forward, alert eyes.
    _head(img, ox, oy, alert=True, dx=1, dy=2, ears_forward=True)
    # The striking foreleg: a long clean diagonal from the thrust chest out to
    # full reach, up-and-right. Cream underside, fur_light lit top edge. Drawn
    # LAST so it sits cleanly over the shoulder shadow, never tangled in it.
    leg = [(12, 18), (13, 17), (14, 16), (15, 15), (16, 14), (17, 13)]
    for (dx, dy) in leg:
        px(img, dx, dy, "belly_cream")
        px(img, dx, dy - 1, "fur_light")                       # lit upper edge of the leg
    # Rounded paw pad at full extension (the part that hit the prop) — a clean
    # solid cream knuckle so the contact point reads crisply, not as noise.
    rect(img, 17, 12, 19, 13, "belly_cream")
    px(img, 18, 11, "belly_cream")                             # toe knuckle
    px(img, 19, 12, "fur_light")                               # lit paw edge
    # Motion smear: a clean 2px streak trailing the paw tip = the impact streak.
    px(img, 20, 12, "fur_light")
    px(img, 21, 12, "fur_mid")
    _outline_silhouette(img)
    # AO under the planted lunge base (lower + wider than a seated cat).
    ambient_occlusion(img, (ox + 3, oy + 20, ox + 14, oy + 21),
                      contact_edges=(False, False, True, False))
    assert_on_palette(img)
    return img


def _pose_bat_watch() -> Image.Image:
    """'Billu watches it fall' (choreography Phase 4): the smug recovery beat.

    The strike has landed; Billu settles back upright and EYE-TRACKS the prop
    down-right (pupils slid into the corner of the iris), tail rising toward the
    high 'safe' read, ear nearest the prop tipped forward (interest). The paw is
    lowered back to a relaxed rest. Reads as a cat calmly observing the chaos he
    just caused — the delight punctuation, not a game-state signal.
    """
    img = _assemble(squash=0, loaf=False, tail_mood="safe", alert=False,
                    head_dx=1, ears_forward=False, track=1)
    # Lowered resting paw forward-right (just set down after the swat).
    rect(img, 12, 20, 14, 21, "belly_cream")
    px(img, 12, 20, "fur_light")
    px(img, 14, 21, "outline")
    px(img, 11, 21, "outline")
    assert_on_palette(img)
    return img


POSES: Dict[str, Callable[[], Image.Image]] = {
    "sit": _pose_sit,
    "idle_a": _pose_idle_a,
    "idle_b": _pose_idle_b,
    "loaf": _pose_loaf,
    "creep": _pose_creep,
    "bat_windup": _pose_bat_windup,
    "bat_strike": _pose_bat_strike,
    "bat_watch": _pose_bat_watch,
}

# The four tail-mood states = the tail-as-HUD vocabulary. Each is a neutral
# seated Billu (alert only when the mood implies it) wearing one tail silhouette.
TAIL_STATES: Dict[str, dict] = {
    "idle_mid":   {"mood": "idle",   "alert": False},   # calm, mid-height S
    "alerted":    {"mood": "puffed", "alert": True},    # puffed + bristled (danger)
    "prebat":     {"mood": "flick",  "alert": True},    # forward hook (winding up)
    "safe_high":  {"mood": "safe",   "alert": False},   # tall question-mark (all-clear)
}


def draw_pose(name: str) -> Image.Image:
    """Return a finished 24x24 Billu frame for a named pose."""
    if name not in POSES:
        raise ValueError(f"Unknown Billu pose {name!r}. Have: {sorted(POSES)}")
    return POSES[name]()


def draw_tail_state(name: str) -> Image.Image:
    """Return a finished 24x24 Billu frame wearing a named tail-mood silhouette."""
    if name not in TAIL_STATES:
        raise ValueError(f"Unknown tail state {name!r}. Have: {sorted(TAIL_STATES)}")
    cfg = TAIL_STATES[name]
    return _assemble(squash=0, loaf=False, tail_mood=cfg["mood"], alert=cfg["alert"])


# ---------------------------------------------------------------------------
# Preview sheets
# ---------------------------------------------------------------------------

def _grid_sheet(frames: List[Image.Image], factor: int, pad: int = 8) -> Image.Image:
    cell = FRAME * factor
    sheet = Image.new("RGBA", (len(frames) * (cell + pad) + pad, cell + pad * 2),
                      PALETTE["ui_dark"] + (255,))
    for i, f in enumerate(frames):
        s = scale(f, factor)
        sheet.alpha_composite(s, (pad + i * (cell + pad), pad))
    return sheet


# ---------------------------------------------------------------------------
# Phaser-loadable atlas — one PNG sheet + one JSON manifest (frame-key schema)
# ---------------------------------------------------------------------------
#
# The game renders Billu from this atlas (NOT the 6x preview sheets, which are
# review-only). Frame keys follow the A0.2 contract in src/types/atlas-types.ts:
#   <entity>_<state>_<facing>_<frame>  e.g. billu_idle_down_0, billu_bat_down_1
#
# All poses are authored in a single canonical facing ("down" token = the
# authored 3-quarter view). The runtime mirrors horizontally (Phaser scaleX) for
# left/right, so only one facing is packed — this keeps the sheet tiny.
#
# Frames packed into a single horizontal strip at native 24x24, deterministic
# order. The JSON is Phaser's TexturePacker JSON-Hash format, which Phaser loads
# via this.load.atlas('billu', 'billu.png', 'billu.json').

# Canonical frame map: atlas frame key -> Billu pose name. Order is fixed so the
# packed sheet is byte-stable across runs.
ATLAS_FRAMES: List[tuple[str, str]] = [
    ("billu_idle_down_0", "sit"),         # resting / standing idle
    ("billu_idle_down_1", "idle_b"),      # breathing exhale frame
    ("billu_creep_down_0", "creep"),      # crouch / stalk
    ("billu_bat_down_0", "bat_windup"),   # the hero verb — wind-up
    ("billu_bat_down_1", "bat_strike"),   # the hero verb — contact
    ("billu_bat_down_2", "bat_watch"),    # the hero verb — recover/watch
]


def write_billu_atlas() -> List[Path]:
    """Write the Phaser-loadable Billu atlas: billu.png + billu.json.

    Packs the canonical game poses into one horizontal 24x24 strip and emits a
    Phaser texture-atlas JSON keyed by the A0.2 frame-key schema. Deterministic:
    same input poses -> identical bytes. Mirrored to public/sprites/.
    """
    # Budget sanity — idle (2) + bat (3) caps from shading.FRAME_BUDGET.
    assert_within_budget("idle", 2)
    assert_within_budget("bat", 3)
    assert_within_budget("creep", 1)

    count = len(ATLAS_FRAMES)
    sheet = Image.new("RGBA", (FRAME * count, FRAME), TRANSPARENT)
    frames_meta: Dict[str, dict] = {}

    for i, (key, pose) in enumerate(ATLAS_FRAMES):
        frame = draw_pose(pose)
        assert_on_palette(frame)
        x = i * FRAME
        sheet.alpha_composite(frame, (x, 0))
        frames_meta[key] = {
            "frame": {"x": x, "y": 0, "w": FRAME, "h": FRAME},
            "rotated": False,
            "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": FRAME, "h": FRAME},
            "sourceSize": {"w": FRAME, "h": FRAME},
        }

    manifest = {
        "frames": frames_meta,
        "meta": {
            "image": "billu.png",
            "size": {"w": FRAME * count, "h": FRAME},
            "scale": "1",
            "app": "billu.py",
            "palette": "whisker-v1",
        },
    }

    png_path = PUBLIC / "billu.png"
    json_path = PUBLIC / "billu.json"
    sheet.save(png_path)
    json_path.write_text(json.dumps(manifest, indent=2))
    print(f"Wrote {png_path} ({sheet.size[0]}x{sheet.size[1]}, {count} frames)")
    print(f"Wrote {json_path}")
    return [png_path, json_path]


def write_billu_sheets(factor: int = 6) -> List[Path]:
    """Write the pose sheet, bat-sequence sheet, tail-state sheet, and natives."""
    # Frame-budget sanity: poses must fit the documented caps.
    assert_within_budget("idle", 2)            # idle_a + idle_b
    assert_within_budget("bat", 3)             # windup / strike / watch

    out: List[Path] = []

    # The four distinct silhouettes — idle (upright), loaf (compact), creep
    # (stretched low), bat (the strike). Distinct at a glance is the bar.
    pose_order = ["idle_a", "loaf", "creep", "bat_strike"]
    pose_sheet = _grid_sheet([draw_pose(p) for p in pose_order], factor)
    p1 = PUBLIC / "billu_poses_6x.png"
    pose_sheet.save(p1)
    out.append(p1)

    # The bat hero verb as its 3-frame sequence: wind-up -> strike -> watch.
    bat_order = ["bat_windup", "bat_strike", "bat_watch"]
    bat_sheet = _grid_sheet([draw_pose(p) for p in bat_order], factor)
    pbat = PUBLIC / "billu_bat_sequence_6x.png"
    bat_sheet.save(pbat)
    out.append(pbat)

    tail_order = ["idle_mid", "alerted", "prebat", "safe_high"]
    tail_sheet = _grid_sheet([draw_tail_state(t) for t in tail_order], factor)
    p2 = PUBLIC / "billu_tail_states_6x.png"
    tail_sheet.save(p2)
    out.append(p2)

    # Native-resolution hero (the 'sit' canon) for in-game reference.
    sit = draw_pose("sit")
    p3 = PUBLIC / "billu_hero.png"
    sit.save(p3)
    out.append(p3)
    scale(sit, factor).save(PUBLIC / "billu_hero_6x.png")
    out.append(PUBLIC / "billu_hero_6x.png")

    for p in out:
        print(f"Wrote {p}")
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Whisker Protocol — Billu hero module")
    ap.add_argument("--sheets", action="store_true",
                    help="Write Billu pose + tail-state preview sheets")
    ap.add_argument("--atlas", action="store_true",
                    help="Write the Phaser-loadable Billu atlas (billu.png + billu.json)")
    args = ap.parse_args()
    did = False
    if args.atlas:
        write_billu_atlas()
        did = True
    if args.sheets:
        write_billu_sheets()
        did = True
    if not did:
        ap.print_help()


if __name__ == "__main__":
    main()
