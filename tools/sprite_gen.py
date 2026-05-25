#!/usr/bin/env python3
"""
Whisker Protocol — Sprite Generator (Phase 0 → Phase 6)

Generates PNG sprite atlases for the game. All character + tile art is produced
by this script. No painted PNGs, no external image services, no AI tools.

Usage:
    python tools/sprite_gen.py --billu-candidates    # 3 hero variants for Anmoll to pick
    python tools/sprite_gen.py --all                  # regenerate every asset
    python tools/sprite_gen.py --billu                # just Billu sheet

Output: assets/sprites/*.png and public/sprites/*.png (mirrored for Phaser load).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets" / "sprites"
PUBLIC = ROOT / "public" / "sprites"
ASSETS.mkdir(parents=True, exist_ok=True)
PUBLIC.mkdir(parents=True, exist_ok=True)


# Locked v1 palette — every draw call must pull from here.
PALETTE = {
    # environment
    "wall_shadow": (0x3A, 0x24, 0x10),
    "wall_mid": (0x5A, 0x38, 0x20),
    "wall_hi": (0x8B, 0x5A, 0x2B),
    "floor_clay": (0xD4, 0x95, 0x6A),
    "floor_marble": (0xE8, 0xD5, 0xC0),
    "carpet_red": (0x8B, 0x3A, 0x22),
    "water": (0x3D, 0x6E, 0x8E),
    # Billu fur
    "outline": (0x1A, 0x1A, 0x1A),
    "fur_dark": (0x3D, 0x28, 0x18),
    "fur_mid": (0x6B, 0x44, 0x23),
    "fur_light": (0xA8, 0x74, 0x45),
    "belly_cream": (0xF5, 0xE6, 0xD3),
    "ear_pink": (0xFF, 0xB7, 0xB7),
    "eye_green": (0x22, 0xCC, 0x44),
    # uncle
    "kurta_blue": (0x1A, 0x3A, 0x8A),
    "kurta_yellow": (0xFF, 0xD2, 0x3F),
    "kurta_red": (0xE6, 0x39, 0x46),
    "kurta_orange": (0xF7, 0x7F, 0x00),
    "skin": (0xD4, 0xA5, 0x74),
    "hair": (0x2C, 0x18, 0x10),
    # accents
    "laddoo": (0xFF, 0xA5, 0x00),
    "laddoo_hi": (0xFF, 0xEB, 0x3B),
    "exit_green": (0x7C, 0xFC, 0x00),
    "cone_red": (0xFF, 0x30, 0x30),
    "ui_white": (0xFF, 0xFF, 0xFF),
    "ui_dark": (0x0A, 0x0A, 0x0A),
    "transparent": (0, 0, 0, 0),
}

TRANSPARENT = (0, 0, 0, 0)


def new_frame(w: int, h: int) -> Image.Image:
    """Create a transparent RGBA frame at native pixel size."""
    return Image.new("RGBA", (w, h), TRANSPARENT)


def px(img: Image.Image, x: int, y: int, color: str) -> None:
    """Set a single palette-validated pixel."""
    if color not in PALETTE:
        raise ValueError(f"Off-palette color: {color}")
    r, g, b = PALETTE[color]
    img.putpixel((x, y), (r, g, b, 255))


def rect(img: Image.Image, x0: int, y0: int, x1: int, y1: int, color: str) -> None:
    """Fill an inclusive rectangle in palette color."""
    if color not in PALETTE:
        raise ValueError(f"Off-palette color: {color}")
    r, g, b = PALETTE[color]
    draw = ImageDraw.Draw(img)
    draw.rectangle([x0, y0, x1, y1], fill=(r, g, b, 255))


def scale(img: Image.Image, factor: int) -> Image.Image:
    """Nearest-neighbor scale for preview rendering only."""
    return img.resize((img.width * factor, img.height * factor), Image.NEAREST)


# ---------------------------------------------------------------------------
# Billu — three candidate variants for Phase 0 vision lock
# ---------------------------------------------------------------------------

def draw_billu(variant: str) -> Image.Image:
    """
    Draw a 24×24 Billu idle frame in one of three candidate styles.
    variant: 'classic' | 'chonk' | 'sleek'
    """
    img = new_frame(24, 24)

    if variant == "classic":
        # Round head, balanced body — friendly mascot
        # Body (sits)
        rect(img, 6, 14, 17, 21, "fur_mid")
        rect(img, 7, 15, 16, 20, "fur_mid")
        # Belly patch
        rect(img, 9, 17, 14, 21, "belly_cream")
        # Legs (front paws)
        rect(img, 7, 21, 9, 22, "fur_dark")
        rect(img, 14, 21, 16, 22, "fur_dark")
        # Head
        rect(img, 7, 5, 16, 13, "fur_mid")
        rect(img, 6, 7, 17, 12, "fur_mid")
        rect(img, 8, 12, 15, 14, "fur_light")  # cheek highlight
        # Dark top of head
        rect(img, 7, 5, 16, 7, "fur_dark")
        # Ears
        rect(img, 6, 4, 8, 6, "fur_dark")
        rect(img, 15, 4, 17, 6, "fur_dark")
        px(img, 7, 5, "ear_pink")
        px(img, 16, 5, "ear_pink")
        # Eyes
        rect(img, 9, 9, 10, 10, "eye_green")
        rect(img, 13, 9, 14, 10, "eye_green")
        px(img, 9, 9, "outline")
        px(img, 13, 9, "outline")
        # Nose
        px(img, 11, 11, "ear_pink")
        px(img, 12, 11, "ear_pink")
        # Whiskers
        px(img, 5, 11, "outline")
        px(img, 4, 12, "outline")
        px(img, 18, 11, "outline")
        px(img, 19, 12, "outline")
        # Tail (curled up)
        rect(img, 17, 15, 19, 17, "fur_dark")
        rect(img, 19, 13, 20, 16, "fur_dark")
        # Outline pass — corners
        for (x, y) in [(6, 5), (17, 5), (6, 13), (17, 13), (5, 14), (18, 14),
                       (6, 22), (17, 22)]:
            px(img, x, y, "outline")

    elif variant == "chonk":
        # Wider body, smaller head — comedic stocky cat
        # Body (wider)
        rect(img, 4, 13, 19, 22, "fur_mid")
        rect(img, 5, 14, 18, 21, "fur_mid")
        # Belly patch larger
        rect(img, 8, 16, 15, 22, "belly_cream")
        # Paws
        rect(img, 5, 22, 7, 23, "fur_dark")
        rect(img, 16, 22, 18, 23, "fur_dark")
        # Head — smaller
        rect(img, 8, 6, 15, 12, "fur_mid")
        rect(img, 7, 7, 16, 11, "fur_mid")
        rect(img, 8, 6, 15, 7, "fur_dark")
        # Ears
        rect(img, 7, 5, 9, 6, "fur_dark")
        rect(img, 14, 5, 16, 6, "fur_dark")
        px(img, 8, 6, "ear_pink")
        px(img, 15, 6, "ear_pink")
        # Eyes (big, low for cute)
        rect(img, 9, 9, 10, 10, "eye_green")
        rect(img, 13, 9, 14, 10, "eye_green")
        # Nose + mouth dot
        px(img, 11, 10, "ear_pink")
        px(img, 12, 10, "ear_pink")
        # Whiskers
        px(img, 6, 10, "outline")
        px(img, 5, 11, "outline")
        px(img, 17, 10, "outline")
        px(img, 18, 11, "outline")
        # Tail
        rect(img, 19, 14, 21, 16, "fur_dark")
        rect(img, 20, 12, 21, 15, "fur_dark")
        # Outline
        for (x, y) in [(4, 13), (19, 13), (5, 23), (18, 23), (7, 6), (16, 6)]:
            px(img, x, y, "outline")

    elif variant == "sleek":
        # Tall slender alley cat — atmospheric, agile silhouette
        # Body (slimmer, taller)
        rect(img, 8, 10, 15, 22, "fur_dark")
        rect(img, 9, 11, 14, 21, "fur_mid")
        # Belly stripe
        rect(img, 10, 14, 13, 21, "belly_cream")
        # Front legs
        rect(img, 8, 22, 10, 23, "fur_dark")
        rect(img, 13, 22, 15, 23, "fur_dark")
        # Head (angular, narrow)
        rect(img, 8, 4, 15, 11, "fur_dark")
        rect(img, 9, 5, 14, 10, "fur_mid")
        # Tall ears (pointy)
        rect(img, 7, 2, 9, 4, "fur_dark")
        rect(img, 14, 2, 16, 4, "fur_dark")
        px(img, 8, 3, "ear_pink")
        px(img, 15, 3, "ear_pink")
        # Eyes (narrow, intense)
        px(img, 10, 7, "eye_green")
        px(img, 13, 7, "eye_green")
        # Nose
        px(img, 11, 9, "ear_pink")
        px(img, 12, 9, "ear_pink")
        # Whiskers
        px(img, 6, 9, "outline")
        px(img, 5, 10, "outline")
        px(img, 17, 9, "outline")
        px(img, 18, 10, "outline")
        # Long tail curling up
        rect(img, 15, 11, 17, 13, "fur_dark")
        rect(img, 17, 8, 18, 12, "fur_dark")
        rect(img, 18, 5, 19, 9, "fur_dark")
        # Outline
        for (x, y) in [(7, 4), (16, 4), (8, 23), (15, 23)]:
            px(img, x, y, "outline")
    else:
        raise ValueError(f"Unknown Billu variant: {variant}")

    return img


def write_billu_candidates() -> None:
    """Generate the three Billu candidates side-by-side + individual PNGs."""
    variants = ["classic", "chonk", "sleek"]
    frames = [draw_billu(v) for v in variants]

    # Side-by-side comparison sheet at 8× scale with labels area
    pad = 8
    scale_factor = 8
    cell_w = 24 * scale_factor + pad * 2
    sheet_w = cell_w * len(variants)
    sheet_h = 24 * scale_factor + pad * 4
    sheet = Image.new("RGBA", (sheet_w, sheet_h), PALETTE["ui_dark"] + (255,))
    for i, frame in enumerate(frames):
        scaled = scale(frame, scale_factor)
        sheet.paste(scaled, (i * cell_w + pad, pad), scaled)

    sheet_path = ASSETS / "billu_candidates.png"
    sheet.save(sheet_path)
    sheet.save(PUBLIC / "billu_candidates.png")
    print(f"Wrote {sheet_path} ({sheet.size[0]}×{sheet.size[1]})")

    # Native-resolution individuals (so Anmoll sees actual in-game pixels)
    for v, f in zip(variants, frames):
        p = ASSETS / f"billu_{v}.png"
        f.save(p)
        f.save(PUBLIC / f"billu_{v}.png")
        # Also a 4× preview
        scale(f, 4).save(ASSETS / f"billu_{v}_4x.png")
        print(f"  → {p.name} (24×24) + 4× preview")

    # Manifest for the picker
    manifest = {
        "type": "billu_candidates",
        "variants": variants,
        "frame_size": [24, 24],
        "palette_locked": True,
    }
    (ASSETS / "billu_candidates.json").write_text(json.dumps(manifest, indent=2))
    print(f"  → billu_candidates.json")


def main() -> None:
    parser = argparse.ArgumentParser(description="Whisker Protocol sprite generator")
    parser.add_argument("--billu-candidates", action="store_true",
                        help="Generate 3 Billu hero candidate variants (Phase 0)")
    parser.add_argument("--all", action="store_true",
                        help="Regenerate every asset")
    args = parser.parse_args()

    did_something = False
    if args.billu_candidates or args.all:
        write_billu_candidates()
        did_something = True

    if not did_something:
        parser.print_help()


if __name__ == "__main__":
    main()
