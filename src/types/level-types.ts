// level-types.ts — Data model for a Whisker Protocol level (the JSON contract).
//
// A level is pure data: LevelLoader (@/systems/LevelLoader) turns this into the
// runtime scene (tilemap, Billu, guard + patrol, props, laddoo, exit). Authoring
// a new level is JSON-only — no scene code changes. This file is the single
// source of truth for that JSON shape.
//
// Coordinate conventions:
//   • Tile grid is row-major: `tiles[row][col]`, each cell a single TileType
//     character key (see TILE_CHAR below). Dimensions must match cols × rows.
//   • Entity positions are given in TILE coordinates {col, row}. LevelLoader
//     converts them to world-pixel tile CENTERS so callers never do the math.

import { TileType } from '@/types/tile-types';
import { PropType } from '@/types/prop-types';

/** A position on the tile grid (column, row) — converted to a world center by the loader. */
export interface TileCoord {
  col: number;
  row: number;
}

/** One knockable prop placed on the map. */
export interface PropSpec {
  /** Tile cell the prop rests on (its ledge). */
  at: TileCoord;
  /** Material class — drives noise radius/duration + whether it shatters. */
  type: PropType;
}

/** One patrolling guard with an ordered waypoint loop. */
export interface GuardSpec {
  /** Patrol waypoints in tile coords, walked in order then looped. */
  patrol: TileCoord[];
}

/** Single-character keys used inside the `tiles` rows. Compact + human-authorable. */
export const TILE_CHAR: Record<string, TileType> = {
  W: TileType.WALL,
  F: TileType.FLOOR_TILE,
  M: TileType.FLOOR_MARBLE,
  C: TileType.FLOOR_CARPET,
  A: TileType.FLOOR_WATER,
  U: TileType.FURNITURE,
};

/**
 * The full level definition — the shape of every `public/levels/*.json` file.
 *
 * `cols`/`rows` are asserted against the `tiles` grid by LevelLoader so a
 * malformed map fails loudly at load, not mid-render.
 */
export interface LevelDefinition {
  /** Stable key used by the save store for star grades (e.g. "pakad-liya"). */
  key: string;
  /** Display name for HUD / level select (player-facing). */
  name: string;
  /** Grid width in tiles. */
  cols: number;
  /** Grid height in tiles. */
  rows: number;
  /** Row-major grid; each row is a string of TILE_CHAR keys, length === cols. */
  tiles: string[];
  /** Where Billu starts. */
  spawn: TileCoord;
  /** Guards on this level (the slice authors exactly one). */
  guards: GuardSpec[];
  /** Knockable props (the lure). */
  props: PropSpec[];
  /** Laddoo collectible(s) — all must be collected to unlock the exit. */
  food: TileCoord[];
  /** The exit gate — reached after collecting the food to win. */
  exit: TileCoord;
}
