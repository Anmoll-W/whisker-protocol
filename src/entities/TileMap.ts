// TileMap — programmatic tilemap builder for Whisker Protocol
// Generates a 20×15 Chawl Kitchen layout from a 2D array of TileType values.
// All rendering uses Phaser.GameObjects.Graphics (no external sprites).

import Phaser from 'phaser';
import { TileType, NOISE_MULTIPLIER, PASSABLE } from '@/types/tile-types';

export const TILE_SIZE = 32;
export const MAP_COLS = 20;
export const MAP_ROWS = 15;

export interface Tile {
  type: TileType;
  noiseMultiplier: number;
  passable: boolean;
  worldX: number;
  worldY: number;
}

// ---------------------------------------------------------------------------
// Chawl Kitchen layout — 20 cols × 15 rows
// W = WALL, F = FLOOR_TILE, M = FLOOR_MARBLE, C = FLOOR_CARPET,
// A = FLOOR_WATER, U = FURNITURE
// ---------------------------------------------------------------------------
// prettier-ignore
const LAYOUT: TileType[][] = [
  // row 0 — top wall
  [TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL],
  // row 1
  [TileType.WALL,TileType.FURNITURE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 2 — kitchen counters top-left (cols 1-3), cooking area center-right (cols 10-11)
  [TileType.WALL,TileType.FURNITURE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 3
  [TileType.WALL,TileType.FURNITURE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_MARBLE,TileType.FLOOR_MARBLE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 4 — end of top-left furniture cluster; water puddle at col 5
  [TileType.WALL,TileType.FURNITURE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_WATER,TileType.FLOOR_MARBLE,TileType.FLOOR_MARBLE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 5 — corridor between counters
  [TileType.WALL,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 6 — cooking area (cols 10-11 continues, second furniture block cols 13-14)
  [TileType.WALL,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 7
  [TileType.WALL,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 8 — transition to living area
  [TileType.WALL,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 9 — carpet area starts bottom-left (cols 1-5)
  [TileType.WALL,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 10
  [TileType.WALL,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 11
  [TileType.WALL,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 12
  [TileType.WALL,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_CARPET,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 13
  [TileType.WALL,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 14 — bottom wall
  [TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL,TileType.WALL],
];

// Render colour per tile type
const TILE_COLOR: Record<TileType, number> = {
  [TileType.WALL]: 0x2d2d2d,
  [TileType.FLOOR_MARBLE]: 0xc8c8c8,
  [TileType.FLOOR_CARPET]: 0x8b5e3c,
  [TileType.FLOOR_TILE]: 0xe8d5b0,
  [TileType.FLOOR_WATER]: 0x4a9eed,
  [TileType.FURNITURE]: 0x4a2f1a,
};

const TILE_ALPHA: Record<TileType, number> = {
  [TileType.WALL]: 1,
  [TileType.FLOOR_MARBLE]: 1,
  [TileType.FLOOR_CARPET]: 1,
  [TileType.FLOOR_TILE]: 1,
  [TileType.FLOOR_WATER]: 0.5,
  [TileType.FURNITURE]: 1,
};

export class TileMap {
  private tiles: Tile[][];
  private graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.tiles = this.buildTiles();
    this.graphics = scene.add.graphics();
    this.render();
  }

  private buildTiles(): Tile[][] {
    const result: Tile[][] = [];
    for (let row = 0; row < MAP_ROWS; row++) {
      result[row] = [];
      for (let col = 0; col < MAP_COLS; col++) {
        const type = LAYOUT[row]![col]!;
        result[row]![col] = {
          type,
          noiseMultiplier: NOISE_MULTIPLIER[type],
          passable: PASSABLE[type],
          worldX: col * TILE_SIZE,
          worldY: row * TILE_SIZE,
        };
      }
    }
    return result;
  }

  private render(): void {
    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const tile = this.tiles[row]![col]!;
        this.graphics.fillStyle(TILE_COLOR[tile.type], TILE_ALPHA[tile.type]);
        this.graphics.fillRect(tile.worldX, tile.worldY, TILE_SIZE, TILE_SIZE);
      }
    }
  }

  /** Returns the Tile at the given grid coordinates, or null if out of bounds. */
  getTileAt(col: number, row: number): Tile | null {
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return null;
    return this.tiles[row]![col] ?? null;
  }
}

/** Module-level helper — forward to the most recently created TileMap instance.
 *  Prefer calling getTileAt() directly on the TileMap instance when possible.
 */
export function getTileAt(
  map: TileMap,
  col: number,
  row: number
): Tile | null {
  return map.getTileAt(col, row);
}
