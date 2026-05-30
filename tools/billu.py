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


def _eyes_and_face(img: Image.Image, ox: int, oy: int, *, alert: bool = False) -> None:
    """The face: signature saturated green eyes, pink nose, fine muzzle.

    `alert=True` widens the eyes (one extra lit-green pixel each) and lifts the
    pupils — the universal 'Billu has noticed something' read that pairs with the
    alerted/puffed tail. Kept identical across poses otherwise so Billu's
    expression is recognisably HIM.
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
    # Pupils + a single ui_white catch-light (life in the eye).
    px(img, ox + 8, oy + 6, "outline")
    px(img, ox + 12, oy + 6, "outline")
    px(img, ox + 7, oy + 5, "ui_white")
    px(img, ox + 11, oy + 5, "ui_white")
    # Pink nose + muzzle.
    px(img, ox + 9, oy + 8, "ear_pink")
    px(img, ox + 10, oy + 8, "ear_pink")
    px(img, ox + 9, oy + 9, "fur_dark")
    px(img, ox + 10, oy + 9, "fur_dark")


def _head(img: Image.Image, ox: int, oy: int, *, alert: bool = False) -> None:
    """Rounded oversized head (cute-anime read), key-lit upper-left.

    Dark crown (fur_dark, the top-of-head shadow), a fur_light forehead/cheek on
    the upper-left key side, a Bayer flank turn down the right cheek to fur_dark,
    and lit/shadowed ears with pink inners. Corners rounded by clearing pixels.
    """
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
    # Ears: lit left, shadowed right, pink inners.
    rect(img, ox + 4, oy - 1, ox + 6, oy + 1, "fur_light")
    rect(img, ox + 13, oy - 1, ox + 15, oy + 1, "fur_dark")
    px(img, ox + 5, oy, "ear_pink")
    px(img, ox + 14, oy, "ear_pink")
    _eyes_and_face(img, ox, oy, alert=alert)


def _body(img: Image.Image, ox: int, oy: int, *, squash: int = 0, loaf: bool = False) -> None:
    """Seated teardrop body with a cream chest blaze, key-lit upper-left.

    `squash` (0 or 1) lowers the shoulder line 1px for the breathing/loaf read
    (snap, never ease). `loaf=True` tucks the paws under and widens the base so
    Billu reads as a compact loaf. Fur: mid core, fur_light lit shoulder, a Bayer
    turn to fur_dark on the lower-right hip, belly_cream chest.
    """
    top = oy + 12 + squash
    # Core teardrop.
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
    if loaf:
        rect(img, ox + 6, oy + 20, ox + 13, oy + 21, "belly_cream")  # tucked loaf paws
    else:
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
              ox: int = 0, oy: int = 1) -> Image.Image:
    """Compose one Billu frame from the parts and finish it (outline + AO)."""
    img = new_frame(FRAME, FRAME)
    _tail(img, ox, oy, tail_mood)                # tail first (body overlaps its root)
    _body(img, ox, oy, squash=squash, loaf=loaf)
    _head(img, ox, oy, alert=alert)
    _outline_silhouette(img)
    # Floor-contact AO under the seated base (one tone darker along the fur ramp).
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


def _pose_prebat() -> Image.Image:
    return _assemble(squash=0, loaf=False, tail_mood="flick", alert=True)


def _pose_bat() -> Image.Image:
    # bat strike: a raised lit paw thrown to the upper-right + alert face.
    img = _assemble(squash=0, loaf=False, tail_mood="flick", alert=True)
    # Extend a striking front leg + paw up-and-right — the hero verb made visible.
    # A lit cream foreleg thrust out from the chest with a rounded paw at the tip,
    # outlined so it reads as a deliberate swat, not a stray pixel run.
    leg = [(13, 19), (14, 18), (15, 17), (16, 16), (17, 15)]   # foreleg
    for (dx, dy) in leg:
        px(img, dx, dy, "belly_cream")
        px(img, dx + 1, dy, "fur_light")                       # lit upper edge
    # rounded paw pad at the tip.
    rect(img, 17, 14, 19, 15, "belly_cream")
    px(img, 19, 14, "fur_light")
    px(img, 18, 13, "fur_mid")                                 # toe shadow
    # re-outline the thrown paw so it crisply separates from the wall behind.
    for (dx, dy) in [(12, 19), (13, 18), (14, 17), (15, 16), (16, 15),
                     (17, 13), (20, 14), (20, 15), (19, 16), (18, 16)]:
        px(img, dx, dy, "outline")
    assert_on_palette(img)
    return img


POSES: Dict[str, Callable[[], Image.Image]] = {
    "sit": _pose_sit,
    "idle_a": _pose_idle_a,
    "idle_b": _pose_idle_b,
    "loaf": _pose_loaf,
    "prebat": _pose_prebat,
    "bat": _pose_bat,
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


def write_billu_sheets(factor: int = 6) -> List[Path]:
    """Write the pose sheet, tail-state sheet, and native individuals."""
    # Frame-budget sanity: poses must fit the documented caps.
    assert_within_budget("idle", 2)            # idle_a + idle_b
    assert_within_budget("bat", 3)             # prebat / bat / (recover folds in)

    out: List[Path] = []

    pose_order = ["idle_a", "idle_b", "loaf", "prebat", "bat"]
    pose_sheet = _grid_sheet([draw_pose(p) for p in pose_order], factor)
    p1 = PUBLIC / "billu_poses_6x.png"
    pose_sheet.save(p1)
    out.append(p1)

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
    args = ap.parse_args()
    if args.sheets:
        write_billu_sheets()
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
