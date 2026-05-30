// LevelLoader — turns a LevelDefinition (the level JSON) into validated runtime
// data the scene can instantiate from. Pure data transform: no Phaser objects
// are created here, so it is unit-testable and the scene stays a thin assembler.
//
// Responsibilities:
//   • Validate the grid (dimensions match cols × rows; every char is known).
//   • Decode the compact char grid into a TileType[][] for TileMap.
//   • Convert every TILE coordinate to a world-pixel tile CENTER once, so the
//     scene never repeats the `col * TILE_SIZE + TILE_SIZE / 2` math.
//
// Phaser loads the JSON in PreloadScene (this.cache.json); GameScene pulls it
// out, passes it here, and builds the world from the returned ParsedLevel.

import { TILE_SIZE } from '@/entities/TileMap';
import { TileType } from '@/types/tile-types';
import { PropType } from '@/types/prop-types';
import {
  type LevelDefinition,
  type TileCoord,
  TILE_CHAR,
} from '@/types/level-types';

/** A world-space pixel position (tile center). */
export interface WorldPos {
  x: number;
  y: number;
}

/** A guard ready to instantiate: its patrol path already in world coords. */
export interface ParsedGuard {
  patrol: WorldPos[];
}

/** A prop ready to instantiate: world position + material class. */
export interface ParsedProp {
  pos: WorldPos;
  type: PropType;
}

/** The fully validated, world-space level the scene builds from. */
export interface ParsedLevel {
  key: string;
  name: string;
  cols: number;
  rows: number;
  /** Decoded tile grid (row-major) for TileMap to render + collide against. */
  layout: TileType[][];
  spawn: WorldPos;
  guards: ParsedGuard[];
  props: ParsedProp[];
  food: WorldPos[];
  exit: WorldPos;
}

/** Convert a tile coordinate to the world-pixel CENTER of that tile. */
function toWorldCenter(c: TileCoord): WorldPos {
  return {
    x: c.col * TILE_SIZE + TILE_SIZE / 2,
    y: c.row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/**
 * Parse + validate a raw level definition into world-space runtime data.
 * Throws on any structural error so a bad level fails at load, never silently
 * mid-render.
 */
export function parseLevel(def: LevelDefinition): ParsedLevel {
  // ── Grid dimension + character validation ───────────────────────────────────
  if (def.tiles.length !== def.rows) {
    throw new Error(
      `Level "${def.key}": tiles has ${def.tiles.length} rows, expected ${def.rows}`,
    );
  }

  const layout: TileType[][] = [];
  for (let row = 0; row < def.rows; row++) {
    const line = def.tiles[row]!;
    if (line.length !== def.cols) {
      throw new Error(
        `Level "${def.key}": row ${row} has ${line.length} cols, expected ${def.cols}`,
      );
    }
    const tileRow: TileType[] = [];
    for (let col = 0; col < def.cols; col++) {
      const ch = line[col]!;
      const tile = TILE_CHAR[ch];
      if (tile === undefined) {
        throw new Error(
          `Level "${def.key}": unknown tile char '${ch}' at row ${row}, col ${col}`,
        );
      }
      tileRow.push(tile);
    }
    layout.push(tileRow);
  }

  return {
    key: def.key,
    name: def.name,
    cols: def.cols,
    rows: def.rows,
    layout,
    spawn: toWorldCenter(def.spawn),
    guards: def.guards.map((g) => ({ patrol: g.patrol.map(toWorldCenter) })),
    props: def.props.map((p) => ({ pos: toWorldCenter(p.at), type: p.type })),
    food: def.food.map(toWorldCenter),
    exit: toWorldCenter(def.exit),
  };
}
