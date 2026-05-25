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
  // FLOOR_MARBLE: 4-6 vein line segments [[x1,y1,x2,y2], ...]
  veins?: Array<[number, number, number, number]>;
  // FLOOR_CARPET: stipple dot offsets [[dx, dy], ...]
  stippleDots?: Array<[number, number]>;
  // FLOOR_WATER: two waves, each with 3 Y offsets [y0, y1, y2]
  waveOffsets?: [number, number, number];
  waveOffsets2?: [number, number, number];
  // FLOOR_TILE: subtle R-channel tint offset (-10 to +10)
  tintOffset?: number;
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
          case TileType.FLOOR_TILE: {
            // Subtle per-tile R tint offset: -10 to +10
            detail.tintOffset = rng.between(-10, 10);
            break;
          }
          case TileType.FLOOR_MARBLE: {
            // 4-6 random diagonal veins across the tile (denser pattern)
            const veinCount = rng.between(4, 6);
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
            // 5-8 stipple dots
            const dotCount = rng.between(5, 8);
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
            // Two waves, each with 3 Y offsets (relative to tile)
            const q1 = Math.floor(TILE_SIZE / 3);
            const q2 = Math.floor((TILE_SIZE * 2) / 3);
            detail.waveOffsets = [
              q1 + rng.between(-3, 3),
              q1 + rng.between(-3, 3),
              q1 + rng.between(-3, 3),
            ];
            detail.waveOffsets2 = [
              q2 + rng.between(-3, 3),
              q2 + rng.between(-3, 3),
              q2 + rng.between(-3, 3),
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
          // WALL — warm dark brown (chawl walls, not gray)
          // ----------------------------------------------------------------
          case TileType.WALL: {
            // Base fill — warm dark brown
            g.fillStyle(0x3a2410, 1);
            g.fillRect(x, y, S, S);
            // Inner border
            g.lineStyle(2, 0x4a3018, 1);
            g.strokeRect(x + 1, y + 1, S - 2, S - 2);
            // Top edge highlight
            g.lineStyle(1, 0x5a3a20, 1);
            g.beginPath();
            g.moveTo(x, y);
            g.lineTo(x + S, y);
            g.strokePath();
            // Bottom shadow
            g.lineStyle(1, 0x1e1008, 1);
            g.beginPath();
            g.moveTo(x, y + S - 1);
            g.lineTo(x + S, y + S - 1);
            g.strokePath();
            break;
          }

          // ----------------------------------------------------------------
          // FLOOR_TILE — warm terracotta with subtle per-tile tint variation
          // ----------------------------------------------------------------
          case TileType.FLOOR_TILE: {
            // Compute per-tile tint: base R=0xD4, G=0x95, B=0x6A, shift R by tintOffset
            const tint = detail.tintOffset ?? 0;
            const r = Math.min(255, Math.max(0, 0xD4 + tint));
            // Pack back to hex
            const baseColor = (r << 16) | (0x95 << 8) | 0x6A;
            g.fillStyle(baseColor, 1);
            g.fillRect(x, y, S, S);
            // Grout lines — subtle alpha, not dominant
            g.lineStyle(1, 0xb87850, 0.3);
            g.strokeRect(x, y, S, S);
            // Corner accent dots
            g.fillStyle(0xc07848, 0.5);
            g.fillRect(x, y, 3, 3);
            g.fillRect(x + S - 3, y, 3, 3);
            g.fillRect(x, y + S - 3, 3, 3);
            g.fillRect(x + S - 3, y + S - 3, 3, 3);
            break;
          }

          // ----------------------------------------------------------------
          // FLOOR_MARBLE — warm cream/ivory with warm beige veins
          // ----------------------------------------------------------------
          case TileType.FLOOR_MARBLE: {
            // Base fill — cream/ivory (not cold blue-white)
            g.fillStyle(0xe8d5c0, 1);
            g.fillRect(x, y, S, S);
            // Warm beige veins (denser)
            if (detail.veins) {
              g.lineStyle(1, 0xc8b090, 1);
              for (const [x1, y1, x2, y2] of detail.veins) {
                g.beginPath();
                g.moveTo(x1, y1);
                g.lineTo(x2, y2);
                g.strokePath();
              }
            }
            // Top-left highlight dot
            g.fillStyle(0xf5ede0, 1);
            g.fillRect(x + 2, y + 2, 2, 2);
            break;
          }

          // ----------------------------------------------------------------
          // FLOOR_CARPET — deep red-brown with stipple and inner border
          // ----------------------------------------------------------------
          case TileType.FLOOR_CARPET: {
            // Base fill — deeper red-brown
            g.fillStyle(0x8b3a22, 1);
            g.fillRect(x, y, S, S);
            // Thin inner border pattern
            g.lineStyle(1, 0x6b2a12, 1);
            g.strokeRect(x + 2, y + 2, S - 4, S - 4);
            // Outer edge darker
            g.lineStyle(1, 0x5a2010, 0.6);
            g.strokeRect(x, y, S, S);
            // Stipple dots — visible contrast
            if (detail.stippleDots) {
              g.fillStyle(0xaa5533, 1);
              for (const [dx, dy] of detail.stippleDots) {
                g.fillRect(x + dx, y + dy, 1, 1);
              }
            }
            break;
          }

          // ----------------------------------------------------------------
          // FLOOR_WATER — slightly brighter blue with 2 wave lines
          // ----------------------------------------------------------------
          case TileType.FLOOR_WATER: {
            // Base fill
            g.fillStyle(0x2a85c0, 0.85);
            g.fillRect(x, y, S, S);
            // Wave 1
            if (detail.waveOffsets) {
              const [y0, y1, y2] = detail.waveOffsets;
              const segW = Math.floor(S / 3);
              g.lineStyle(1, 0x4aaae0, 0.7);
              g.beginPath();
              g.moveTo(x, y + y0);
              g.lineTo(x + segW, y + y1);
              g.lineTo(x + segW * 2, y + y2);
              g.lineTo(x + S, y + y0);
              g.strokePath();
            }
            // Wave 2
            if (detail.waveOffsets2) {
              const [y0, y1, y2] = detail.waveOffsets2;
              const segW = Math.floor(S / 3);
              g.lineStyle(1, 0x4aaae0, 0.5);
              g.beginPath();
              g.moveTo(x, y + y0);
              g.lineTo(x + segW, y + y1);
              g.lineTo(x + segW * 2, y + y2);
              g.lineTo(x + S, y + y0);
              g.strokePath();
            }
            // Specular dot near center
            g.fillStyle(0x90d0f0, 1);
            g.fillRect(x + Math.floor(S / 2) - 1, y + Math.floor(S / 2) - 1, 2, 2);
            break;
          }

          // ----------------------------------------------------------------
          // FURNITURE — warmer wood with top face + front face 3D crate look
          // ----------------------------------------------------------------
          case TileType.FURNITURE: {
            const topH = 6; // height of visible top face
            // Front face (main body below top face)
            g.fillStyle(0x5c3418, 1);
            g.fillRect(x, y + topH, S, S - topH);
            // Top face — lighter, angled look
            g.fillStyle(0x7a5030, 1);
            g.fillRect(x, y, S, topH);
            // Dividing line between top and front
            g.lineStyle(1, 0x3a1e08, 1);
            g.beginPath();
            g.moveTo(x, y + topH);
            g.lineTo(x + S, y + topH);
            g.strokePath();
            // Right face shadow strip
            g.fillStyle(0x3a1e08, 1);
            g.fillRect(x + S - 3, y + topH, 3, S - topH);
            // Left edge slight highlight
            g.lineStyle(1, 0x7a5030, 0.5);
            g.beginPath();
            g.moveTo(x, y + topH);
            g.lineTo(x, y + S);
            g.strokePath();
            // Ground shadow along bottom
            g.lineStyle(1, 0x1e0c04, 1);
            g.beginPath();
            g.moveTo(x, y + S - 1);
            g.lineTo(x + S, y + S - 1);
            g.strokePath();
            // Outer border
            g.lineStyle(1, 0x2a1008, 0.8);
            g.strokeRect(x, y, S, S);
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
