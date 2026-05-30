#!/usr/bin/env python3
"""
Whisker Protocol — Chawl tile + scene-object atlas generator.

Emits the in-game environment art so Level 2 renders as the composed, lit,
depth-layered golden-hour chawl the reference frame proves out — NOT flat
programmatic rects. Every pixel is drawn by the SAME deterministic shading
engine (tools/shading.py) on the locked palette: NEAREST-only, 2-light model,
4x4 Bayer the only blend, AO as a placement rule. No painted PNGs, no AI tools.

What this produces (public/sprites/chawl_tiles.{png,json}):
  Tile cells (32x32, the in-game TILE_SIZE), one per TileType, each a richly
  shaded, tileable material:
    - wall          : plaster-over-brick terracotta, golden falloff + mottle
    - floor_tile    : warm clay flagstone with a beveled seam + troweled mottle
    - floor_marble  : cream marble with warm veins + corner key glint
    - floor_carpet  : deep red dhurrie with a woven border + stipple weave
    - floor_water   : a still puddle reflecting warm light (cool core, warm rim)
    - furniture     : a stacked wooden crate / counter block (top face + front)
    - jaali         : a perforated lattice screen panel (the cultural anchor)
  Scene objects (variable size, packed in the same sheet):
    - lota          : brass vessel (rim + handle) — the BRASS knockable prop
    - matka         : clay water pot — the CLAY knockable prop
    - laddoo        : the round golden collectible
    - exit_rug      : a woven welcome-mat marking the exit threshold

The sheet is a fixed grid; the JSON is Phaser TexturePacker JSON-Hash format so
the game loads it via this.load.atlas('chawl', 'chawl_tiles.png', '...json').
Deterministic: identical inputs -> identical bytes.

Run:
    .venv/bin/python tools/tiles.py --atlas     # write chawl_tiles.png + .json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Dict, List, Tuple

from PIL import Image

from sprite_gen import PALETTE, TRANSPARENT, new_frame, px, rect, scale  # noqa: F401
from shading import (
    assert_on_palette,
    bayer_pick,
    bayer_dither,
    step_darker,
    step_lighter,
    lit,
    shadow,
    ambient_occlusion,
    name_of,
    _RAMP_OF,
    _AMBIGUOUS,
    _draw_lota,
    _draw_matka,
    _draw_laddoo,
)

ROOT = Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public" / "sprites"
PUBLIC.mkdir(parents=True, exist_ok=True)

TILE = 32  # must equal TILE_SIZE in src/entities/TileMap.ts

_WALL_HI = lit("wall_mid", ramp="wall")        # wall_hi
_WALL_SHADOW = shadow("wall_mid", ramp="wall")  # wall_shadow


# ---------------------------------------------------------------------------
# Deterministic per-pixel mottle (reused from the reference wall logic)
# ---------------------------------------------------------------------------

def _mottle(x: int, y: int, density: int = 7) -> int:
    """Stable {-1, 0} blotch field, blocked 2x2 so it reads as soft patches."""
    bx, by = x // 2, y // 2
    h = (bx * 73856093) ^ (by * 19349663) ^ ((bx + by) * 83492791)
    h = (h >> 5) & 0x3F
    return -1 if h < density else 0


def _step_darker_ctx(img: Image.Image, x: int, y: int, steps: int = 1) -> None:
    """Step the pixel at (x,y) `steps` darker along its OWN ramp (context-aware)."""
    r, g, b, a = img.load()[x, y]
    if a == 0:
        return
    cur = name_of((r, g, b))
    if cur is None or cur not in _RAMP_OF:
        return
    if cur in _AMBIGUOUS:
        px(img, x, y, step_darker(cur, steps, ramp="wall"))
    else:
        px(img, x, y, step_darker(cur, steps))


def _step_lighter_ctx(img: Image.Image, x: int, y: int, steps: int = 1) -> None:
    r, g, b, a = img.load()[x, y]
    if a == 0:
        return
    cur = name_of((r, g, b))
    if cur is None or cur not in _RAMP_OF:
        return
    if cur in _AMBIGUOUS:
        px(img, x, y, step_lighter(cur, steps, ramp="wall"))
    else:
        px(img, x, y, step_lighter(cur, steps))


# ---------------------------------------------------------------------------
# Tile drawers — each fills a 32x32 cell at (0,0). Tileable + lit upper-left.
# ---------------------------------------------------------------------------

def tile_wall() -> Image.Image:
    """Plaster-over-brick chawl wall: a calm golden falloff + mottle + brick courses.

    Lit upper-left -> shadow lower-right across a gentle diagonal so a grid of
    these reads as one continuous troweled wall rather than repeating stamps. Two
    staggered brick courses near the base give the masonry read.
    """
    img = new_frame(TILE, TILE)
    for y in range(TILE):
        for x in range(TILE):
            d = x + y * 1.1
            if d < 16:
                base = "wall_hi"
            elif d < 34:
                base = bayer_pick(x, y, coverage=(34 - d) / 18.0,
                                  dark="wall_mid", light="wall_hi")
            elif d < 52:
                base = "wall_mid"
            else:
                base = bayer_pick(x, y, coverage=(64 - d) / 12.0,
                                  dark="wall_shadow", light="wall_mid")
            if _mottle(x, y) < 0:
                base = step_darker(base, 1, ramp="wall")
            px(img, x, y, base)
    # Two staggered brick courses low on the cell (masonry showing through render).
    for row, seam_y in enumerate((TILE - 11, TILE - 4)):
        offset = (row % 2) * 8
        for x in range(TILE):
            _step_darker_ctx(img, x, seam_y)
            if (x + offset) % 14 == 0:
                for jy in range(seam_y - 6, seam_y):
                    if 0 <= jy < TILE:
                        _step_darker_ctx(img, x, jy)
        lip_y = seam_y + 1
        if lip_y < TILE:
            for x in range(0, TILE, 2):
                _step_lighter_ctx(img, x, lip_y)
    assert_on_palette(img)
    return img


def tile_floor_clay() -> Image.Image:
    """Warm clay flagstone: a key-lit slab, troweled mottle, a beveled cross seam.

    The seam crosses near the lower-right so adjacent tiles knit into a flagged
    floor. The bevel = a lit lip above the dark groove (incised stone read). Base
    is `wall_hi` (the mid floor tone) so the Phaser light-pool can push it up to
    bright clay/marble in the lit area and down to shadow at the edges.
    """
    img = new_frame(TILE, TILE)
    for y in range(TILE):
        for x in range(TILE):
            base = "wall_hi"
            if _mottle(x, y, density=6) < 0:
                base = step_darker(base, 1, ramp="wall")
            px(img, x, y, base)
    # Incised flagstone seams: a vertical + horizontal groove with a lit lip.
    for sy in range(TILE):
        _step_darker_ctx(img, TILE - 4, sy)            # vertical groove
    for sx in range(TILE):
        _step_darker_ctx(img, sx, TILE - 4)            # horizontal groove
    for sy in range(TILE):
        _step_lighter_ctx(img, TILE - 5, sy)           # lit lip left of groove
    for sx in range(TILE):
        _step_lighter_ctx(img, sx, TILE - 5)
    assert_on_palette(img)
    return img


def tile_floor_marble() -> Image.Image:
    """Cream marble: bright ivory base, warm diagonal veins, upper-left key glint."""
    img = new_frame(TILE, TILE)
    rect(img, 0, 0, TILE - 1, TILE - 1, "floor_marble")
    # Warm veins — a few deterministic diagonals stepped one darker (floor_clay).
    veins = [(3, 0, 9, 31), (14, 2, 20, 30), (24, 0, 29, 28),
             (0, 8, 12, 16), (18, 20, 31, 27)]
    for (x0, y0, x1, y1) in veins:
        steps = max(abs(x1 - x0), abs(y1 - y0))
        for i in range(steps + 1):
            x = x0 + (x1 - x0) * i // steps
            y = y0 + (y1 - y0) * i // steps
            if 0 <= x < TILE and 0 <= y < TILE:
                px(img, x, y, "floor_clay")            # warm vein, one tone down
    # Upper-left key glint (sunlit corner).
    px(img, 2, 2, "ui_white")
    px(img, 3, 2, "floor_marble")
    # Lower-right AO so adjacent marble cells separate slightly.
    ambient_occlusion(img, (0, 0, TILE - 1, TILE - 1),
                      contact_edges=(False, True, True, False))
    assert_on_palette(img)
    return img


def tile_floor_carpet() -> Image.Image:
    """Deep red dhurrie rug: woven border, a centre medallion, stipple weave grain."""
    img = new_frame(TILE, TILE)
    rect(img, 0, 0, TILE - 1, TILE - 1, "carpet_red")
    # Darker woven border frame (two rings).
    for ring, tone_step in ((1, 1), (3, 0)):
        for x in range(ring, TILE - ring):
            _step_darker_ctx(img, x, ring)
            _step_darker_ctx(img, x, TILE - 1 - ring)
        for y in range(ring, TILE - ring):
            _step_darker_ctx(img, ring, y)
            _step_darker_ctx(img, TILE - 1 - ring, y)
    # A small lit medallion diamond in the centre (kurta_orange thread).
    cx, cy = TILE // 2, TILE // 2
    for dy in range(-4, 5):
        for dx in range(-4, 5):
            if abs(dx) + abs(dy) == 4:
                px(img, cx + dx, cy + dy, "kurta_orange")
            elif abs(dx) + abs(dy) < 4 and (dx + dy) % 2 == 0:
                px(img, cx + dx, cy + dy, "laddoo")
    # Deterministic stipple weave grain (lighter flecks) over the field.
    for y in range(0, TILE, 2):
        for x in range(0, TILE, 3):
            if _mottle(x + 1, y, density=10) < 0:
                _step_lighter_ctx(img, x, y)
    assert_on_palette(img)
    return img


def tile_floor_water() -> Image.Image:
    """A still puddle: cool water core with a warm-lit reflective rim + ripples.

    The puddle reads as wet — a darker cool centre (water), a warm clay edge
    where the floor shows through, and two horizontal ripple lines catching a
    ui_white glint. The contrast against the warm floor is exactly the 'water is
    LOUD, avoid it' read the noise system rewards.
    """
    img = new_frame(TILE, TILE)
    rect(img, 0, 0, TILE - 1, TILE - 1, "wall_hi")          # damp clay surround
    # Elliptical pool.
    cx, cy = TILE // 2, TILE // 2 + 1
    for y in range(TILE):
        for x in range(TILE):
            dx, dy = (x - cx) * 0.9, (y - cy) * 1.15
            r = (dx * dx + dy * dy) ** 0.5
            if r < 9:
                px(img, x, y, "water")                       # deep cool core
            elif r < 12:
                px(img, x, y, bayer_pick(x, y, coverage=(12 - r) / 3.0,
                                         dark="wall_mid", light="water"))
    # Two ripple lines + a warm reflected glint (golden-hour bounce).
    for rx in range(cx - 6, cx + 7):
        if name_of(img.load()[rx, cy - 3][:3]) == "water":
            px(img, rx, cy - 3, "wall_hi")                   # warm reflection band
    px(img, cx - 2, cy - 1, "ui_white")                      # specular glint
    px(img, cx + 3, cy + 2, "floor_clay")                    # warm bounce fleck
    assert_on_palette(img)
    return img


def tile_furniture() -> Image.Image:
    """A wooden crate / kitchen counter block: lit top face + shadowed front + AO.

    A solid 3D box read so cooking counters and stacked crates feel like real
    occluders, not flat blocks. Top face catches the key (wall_hi planks), the
    front face is mid wood with vertical plank seams, AO at the floor contact.
    """
    img = new_frame(TILE, TILE)
    top_h = 8
    # Front face — mid wood with vertical plank grain.
    rect(img, 0, top_h, TILE - 1, TILE - 1, "wall_mid")
    for x in range(0, TILE, 7):
        for y in range(top_h, TILE):
            _step_darker_ctx(img, x, y)                      # plank seam
    # Bayer shadow turn down the right third (the box turns away from the key).
    for y in range(top_h, TILE):
        for x in range(TILE - 9, TILE):
            px(img, x, y, bayer_pick(x, y, coverage=0.4,
                                     dark="wall_shadow", light="wall_mid"))
    # Lit top face (golden plank lid).
    rect(img, 0, 0, TILE - 1, top_h - 1, "wall_hi")
    for x in range(0, TILE, 7):
        for y in range(0, top_h):
            _step_lighter_ctx(img, x, y)                     # lit plank edge
    # Front edge of the lid catches the brightest key.
    for x in range(0, TILE, 2):
        px(img, x, 0, "floor_clay")
    # Seam line where top meets front (a crisp dark edge).
    for x in range(TILE):
        px(img, x, top_h, "wall_shadow")
    # AO at the floor contact (bottom row one deeper).
    ambient_occlusion(img, (0, TILE - 1, TILE - 1, TILE - 1),
                      contact_edges=(False, False, True, False))
    # Outline the box so it lifts off the floor.
    for x in range(TILE):
        px(img, x, 0, "floor_clay" if x % 2 == 0 else name_of(img.load()[x, 0][:3]) or "wall_hi")
    assert_on_palette(img)
    return img


def tile_jaali() -> Image.Image:
    """A perforated jaali (lattice screen) panel set into the wall — THE anchor.

    A carved frame (lit upper-left bevel, shadow lower-right) around a recessed
    dark reveal pierced by a diamond lattice of light holes glowing with the
    courtyard light pressing through. Tiles cleanly beside wall cells so a 2x2
    block of these reads as one big screen.
    """
    img = tile_wall()                                        # plaster surround
    x0, y0, x1, y1 = 2, 2, TILE - 3, TILE - 3
    # Carved frame.
    rect(img, x0, y0, x1, y1, "wall_mid")
    rect(img, x0, y0, x1, y0, _WALL_HI)                      # lit top chamfer
    rect(img, x0, y0, x0, y1, _WALL_HI)                      # lit left chamfer
    rect(img, x1, y0, x1, y1, _WALL_SHADOW)                 # shadow right
    rect(img, x0, y1, x1, y1, _WALL_SHADOW)                 # shadow bottom
    # Recessed reveal.
    rx0, ry0, rx1, ry1 = x0 + 2, y0 + 2, x1 - 2, y1 - 2
    rect(img, rx0, ry0, rx1, ry1, _WALL_SHADOW)
    # Diamond lattice of glowing holes.
    for y in range(ry0 + 1, ry1):
        for x in range(rx0 + 1, rx1):
            if (x + y) % 3 == 0 and (x - y) % 3 == 0:
                px(img, x, y, "floor_clay")                  # glowing pierced hole
                if x - 1 >= rx0 + 1:
                    px(img, x - 1, y, _WALL_HI)
                if y - 1 >= ry0 + 1:
                    px(img, x, y - 1, _WALL_HI)
    ambient_occlusion(img, (x0, y0, x1, y1), contact_edges=(False, True, True, False))
    assert_on_palette(img)
    return img


def tile_exit_rug() -> Image.Image:
    """A woven welcome-mat marking the exit threshold — warm, inviting, lit.

    A bright dhurrie in exit-warm tones (laddoo border, marble field) with a
    centre arrow-weave pointing up/out, so the exit reads as a doorway threshold,
    not just a coloured square. Distinct from the carpet tile (this is brighter +
    has the directional arrow).
    """
    img = new_frame(TILE, TILE)
    rect(img, 2, 2, TILE - 3, TILE - 3, "floor_clay")        # mat field
    rect(img, 2, 2, TILE - 3, 3, "laddoo_hi")                # lit top border
    rect(img, 2, 2, 3, TILE - 3, "laddoo_hi")                # lit left border
    rect(img, 2, TILE - 4, TILE - 3, TILE - 3, "laddoo")     # warm bottom border
    rect(img, TILE - 4, 2, TILE - 3, TILE - 3, "laddoo")     # warm right border
    # Centre threshold weave: a brighter inner panel.
    rect(img, 7, 7, TILE - 8, TILE - 8, "floor_marble")
    assert_on_palette(img)
    return img


# ---------------------------------------------------------------------------
# Scene objects — drawn into their own small frames, packed beside the tiles.
# ---------------------------------------------------------------------------

def obj_lota() -> Image.Image:
    """The brass lota (BRASS prop) on a transparent 16x16 frame."""
    img = new_frame(16, 16)
    _draw_lota(img, vx=3, vy=2)
    assert_on_palette(img)
    return img


def obj_matka() -> Image.Image:
    """The clay matka (CLAY prop) on a transparent 16x16 frame."""
    img = new_frame(16, 16)
    _draw_matka(img, cx=8, by=14)
    assert_on_palette(img)
    return img


def obj_laddoo() -> Image.Image:
    """The round golden laddoo collectible on a transparent 16x16 frame."""
    img = new_frame(16, 16)
    _draw_laddoo(img, cx=8, cy=7)
    assert_on_palette(img)
    return img


# ---------------------------------------------------------------------------
# Atlas packing — fixed grid, deterministic order
# ---------------------------------------------------------------------------

# (frame_key, drawer, w, h). Tiles are 32x32; objects 16x16.
ATLAS_ENTRIES: List[Tuple[str, callable, int, int]] = [
    ("wall", tile_wall, TILE, TILE),
    ("floor_tile", tile_floor_clay, TILE, TILE),
    ("floor_marble", tile_floor_marble, TILE, TILE),
    ("floor_carpet", tile_floor_carpet, TILE, TILE),
    ("floor_water", tile_floor_water, TILE, TILE),
    ("furniture", tile_furniture, TILE, TILE),
    ("jaali", tile_jaali, TILE, TILE),
    ("exit_rug", tile_exit_rug, TILE, TILE),
    ("lota", obj_lota, 16, 16),
    ("matka", obj_matka, 16, 16),
    ("laddoo", obj_laddoo, 16, 16),
]


def write_atlas() -> List[Path]:
    """Pack every tile + object into one 256x256 sheet + a Phaser atlas JSON.

    Layout: 8 columns of 32px = 256px wide. Tiles fill rows top-down; the 16px
    objects pack into a row below. Deterministic order -> byte-stable output.
    """
    sheet_w = 256
    sheet_h = 128
    sheet = Image.new("RGBA", (sheet_w, sheet_h), TRANSPARENT)
    frames_meta: Dict[str, dict] = {}

    # Row 0: the eight 32x32 tiles across the full width.
    x_cursor = 0
    y_cursor = 0
    for (key, drawer, w, h) in ATLAS_ENTRIES:
        if h == TILE:
            frame = drawer()
            assert_on_palette(frame)
            sheet.alpha_composite(frame, (x_cursor, y_cursor))
            frames_meta[key] = _frame_meta(x_cursor, y_cursor, w, h)
            x_cursor += TILE
    # Row 2 (y=64): the 16x16 objects.
    x_cursor = 0
    y_cursor = 64
    for (key, drawer, w, h) in ATLAS_ENTRIES:
        if h == 16:
            frame = drawer()
            assert_on_palette(frame)
            sheet.alpha_composite(frame, (x_cursor, y_cursor))
            frames_meta[key] = _frame_meta(x_cursor, y_cursor, w, h)
            x_cursor += 16

    manifest = {
        "frames": frames_meta,
        "meta": {
            "image": "chawl_tiles.png",
            "size": {"w": sheet_w, "h": sheet_h},
            "scale": "1",
            "app": "tiles.py",
            "palette": "whisker-v1",
        },
    }

    png_path = PUBLIC / "chawl_tiles.png"
    json_path = PUBLIC / "chawl_tiles.json"
    sheet.save(png_path)
    json_path.write_text(json.dumps(manifest, indent=2))
    # A 6x preview for eyeballing the material quality.
    scale(sheet, 6).save(PUBLIC / "chawl_tiles_6x.png")
    print(f"Wrote {png_path} ({sheet_w}x{sheet_h}, {len(frames_meta)} frames)")
    print(f"Wrote {json_path}")
    return [png_path, json_path]


def _frame_meta(x: int, y: int, w: int, h: int) -> dict:
    return {
        "frame": {"x": x, "y": y, "w": w, "h": h},
        "rotated": False,
        "trimmed": False,
        "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
        "sourceSize": {"w": w, "h": h},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description="Whisker Protocol — chawl tile atlas")
    ap.add_argument("--atlas", action="store_true",
                    help="Write chawl_tiles.png + chawl_tiles.json")
    args = ap.parse_args()
    if args.atlas:
        write_atlas()
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
