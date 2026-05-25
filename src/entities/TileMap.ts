// TileMap — programmatic tilemap builder for Whisker Protocol
// Generates a 20×15 Chawl Kitchen layout from a 2D array of TileType values.
// All rendering uses Phaser.GameObjects.Graphics (no external sprites).

import Phaser from 'phaser';
import { TileType, NOISE_MULTIPLIER, PASSABLE } from '@/types/tile-types';
import { getRNG } from '@/systems/rng';

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

/** Per-tile detail data generated once via seeded RNG; stored here so render() is deterministic. */
interface TileDetail {
  // FLOOR_MARBLE: 2-3 vein line segments [[x1,y1,x2,y2], ...]
  veins?: Array<[number, number, number, number]>;
  // FLOOR_CARPET: stipple dot offsets [[dx, dy], ...]
  stippleDots?: Array<[number, number]>;
  // FLOOR_WATER: wavy highlight Y offsets [y0, y1, y2] (3 segments)
  waveOffsets?: [number, number, number];
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
  [TileType.WALL,TileType.FURNITURE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 2 — kitchen counters top-left (cols 1-3)
  [TileType.WALL,TileType.FURNITURE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 3
  [TileType.WALL,TileType.FURNITURE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_MARBLE,TileType.FLOOR_MARBLE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 4 — end of top-left furniture cluster; water puddle at col 5
  [TileType.WALL,TileType.FURNITURE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_WATER,TileType.FLOOR_MARBLE,TileType.FLOOR_MARBLE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 5 — cooking area center-right (cols 10-11)
  [TileType.WALL,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 6 — cooking area center-right (cols 10-11)
  [TileType.WALL,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
  // row 7 — cooking area center-right (cols 10-11)
  [TileType.WALL,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FURNITURE,TileType.FURNITURE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.FLOOR_TILE,TileType.WALL],
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

export class TileMap {
  private tiles: Tile[][];
  private tileDetails: TileDetail[][];
  private graphics: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene) {
    this.tiles = this.buildTiles();
    this.tileDetails = this.generateTileDetails();
    this.graphics = scene.add.graphics();
    this.render();
  }

  private buildTiles(): Tile[][] {
    if (LAYOUT.length !== MAP_ROWS || LAYOUT.some(r => r.length !== MAP_COLS))
      throw new Error(`LAYOUT must be ${MAP_ROWS} rows × ${MAP_COLS} cols`);

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

  /** Pre-roll all RNG values for tile details. Called once; results stored for deterministic render. */
  private generateTileDetails(): TileDetail[][] {
    const rng = getRNG();
    const details: TileDetail[][] = [];

    for (let row = 0; row < MAP_ROWS; row++) {
      details[row] = [];
      for (let col = 0; col < MAP_COLS; col++) {
        const tile = this.tiles[row]![col]!;
        const wx = tile.worldX;
        const wy = tile.worldY;
        const detail: TileDetail = {};

        switch (tile.type) {
          case TileType.FLOOR_MARBLE: {
            // 2-3 random diagonal veins across the tile
            const veinCount = rng.between(2, 3);
            detail.veins = [];
            for (let v = 0; v < veinCount; v++) {
              // start near top or left edge, end near bottom or right edge
              const startX = wx + rng.between(2, TILE_SIZE - 2);
              const startY = wy + rng.between(0, 6);
              const endX = wx + rng.between(2, TILE_SIZE - 2);
              const endY = wy + rng.between(TILE_SIZE - 6, TILE_SIZE);
              detail.veins.push([startX, startY, endX, endY]);
            }
            break;
          }
          case TileType.FLOOR_CARPET: {
            // 4-6 stipple dots
            const dotCount = rng.between(4, 6);
            detail.stippleDots = [];
            for (let d = 0; d < dotCount; d++) {
              detail.stippleDots.push([
                rng.between(2, TILE_SIZE - 2),
                rng.between(2, TILE_SIZE - 2),
              ]);
            }
            break;
          }
          case TileType.FLOOR_WATER: {
            // 3 Y offsets for the wave segments (relative to tile center)
            const midY = TILE_SIZE / 2;
            detail.waveOffsets = [
              midY + rng.between(-3, 3),
              midY + rng.between(-3, 3),
              midY + rng.between(-3, 3),
            ];
            break;
          }
          default:
            break;
        }

        details[row]![col] = detail;
      }
    }
    return details;
  }

  private render(): void {
    const g = this.graphics;

    for (let row = 0; row < MAP_ROWS; row++) {
      for (let col = 0; col < MAP_COLS; col++) {
        const tile = this.tiles[row]![col]!;
        const detail = this.tileDetails[row]![col]!;
        const x = tile.worldX;
        const y = tile.worldY;
        const S = TILE_SIZE;

        switch (tile.type) {
          // ----------------------------------------------------------------
          // WALL — dark charcoal with inner border and top highlight
          // ----------------------------------------------------------------
          case TileType.WALL: {
            // Base fill
            g.fillStyle(0x1a1a1a, 1);
            g.fillRect(x, y, S, S);
            // Inner lighter border (2px inset)
            g.lineStyle(2, 0x2a2a2a, 1);
            g.strokeRect(x + 1, y + 1, S - 2, S - 2);
            // Top edge highlight
            g.lineStyle(1, 0x333333, 1);
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + S, y);
            g.strokePath();
            break;
          }

          // ----------------------------------------------------------------
          // FLOOR_TILE — warm terracotta-cream with grout lines
          // ----------------------------------------------------------------
          case TileType.FLOOR_TILE: {
            // Base fill
            g.fillStyle(0xd4b896, 1);
            g.fillRect(x, y, S, S);
            // Grout lines at tile edges
            g.lineStyle(1, 0xb89878, 1);
            g.strokeRect(x, y, S, S);
            // Corner shadows (4×4px at each corner)
            g.fillStyle(0xc4a886, 1);
            g.fillRect(x, y, 4, 4);
            g.fillRect(x + S - 4, y, 4, 4);
            g.fillRect(x, y + S - 4, 4, 4);
            g.fillRect(x + S - 4, y + S - 4, 4, 4);
            break;
          }

          // ----------------------------------------------------------------
          // FLOOR_MARBLE — cool white with seeded diagonal veins
          // ----------------------------------------------------------------
          case TileType.FLOOR_MARBLE: {
            // Base fill
            g.fillStyle(0xdde8ee, 1);
            g.fillRect(x, y, S, S);
            // Veins
            if (detail.veins) {
              g.lineStyle(1, 0xb8ccd8, 1);
              for (const [x1, y1, x2, y2] of detail.veins) {
                g.beginPath();
                g.moveTo(x1, y1);
                g.lineTo(x2, y2);
                g.strokePath();
              }
            }
            // Top-left highlight dot
            g.fillStyle(0xf0f5f8, 1);
            g.fillRect(x + 2, y + 2, 2, 2);
            break;
          }

          // ----------------------------------------------------------------
          // FLOOR_CARPET — deep rust with stipple and inset border
          // ----------------------------------------------------------------
          case TileType.FLOOR_CARPET: {
            // Base fill
            g.fillStyle(0x7a4a28, 1);
            g.fillRect(x, y, S, S);
            // Inset border
            g.lineStyle(1, 0x5a3018, 1);
            g.strokeRect(x + 1, y + 1, S - 2, S - 2);
            // Stipple dots
            if (detail.stippleDots) {
              g.fillStyle(0x9a6a48, 1);
              for (const [dx, dy] of detail.stippleDots) {
                g.fillRect(x + dx, y + dy, 1, 1);
              }
            }
            break;
          }

          // ----------------------------------------------------------------
          // FLOOR_WATER — deep blue with wavy highlight and specular dot
          // ----------------------------------------------------------------
          case TileType.FLOOR_WATER: {
            // Base fill at 0.85 alpha
            g.fillStyle(0x1e6fa8, 0.85);
            g.fillRect(x, y, S, S);
            // Wavy highlight — 3 short segments at slightly different Y offsets
            if (detail.waveOffsets) {
              const [y0, y1, y2] = detail.waveOffsets;
              const segW = Math.floor(S / 3);
              g.lineStyle(1, 0x4a9eed, 0.6);
              g.beginPath();
              g.moveTo(x, y + y0);
              g.lineTo(x + segW, y + y1);
              g.lineTo(x + segW * 2, y + y2);
              g.lineTo(x + S, y + y0);
              g.strokePath();
            }
            // Specular dot near center
            g.fillStyle(0xa8d8f8, 1);
            g.fillRect(x + Math.floor(S / 2) - 1, y + Math.floor(S / 2) - 1, 2, 2);
            break;
          }

          // ----------------------------------------------------------------
          // FURNITURE — very dark brown with 3D box illusion
          // ----------------------------------------------------------------
          case TileType.FURNITURE: {
            // Base fill
            g.fillStyle(0x3d2010, 1);
            g.fillRect(x, y, S, S);
            // Top face highlight strip (counter surface)
            g.fillStyle(0x5a3018, 1);
            g.fillRect(x, y, S, 3);
            // Right face shadow strip
            g.fillStyle(0x2a1508, 1);
            g.fillRect(x + S - 2, y + 3, 2, S - 3);
            // Ground shadow along bottom
            g.lineStyle(1, 0x1a0a04, 1);
            g.beginPath();
            g.moveTo(x, y + S - 1);
            g.lineTo(x + S, y + S - 1);
            g.strokePath();
            break;
          }
        }
      }
    }
  }

  /** Returns the Tile at the given grid coordinates, or null if out of bounds. */
  getTileAt(col: number, row: number): Tile | null {
    if (row < 0 || row >= MAP_ROWS || col < 0 || col >= MAP_COLS) return null;
    return this.tiles[row]![col] ?? null;
  }

  /** Convert world-space pixel coordinates to tile grid coordinates. */
  worldToTile(worldX: number, worldY: number): { col: number; row: number } {
    return {
      col: Math.floor(worldX / TILE_SIZE),
      row: Math.floor(worldY / TILE_SIZE),
    };
  }
}
