// Tile type definitions for Whisker Protocol
// Noise multipliers: how loud footsteps are on each surface

export enum TileType {
  WALL = 'WALL',
  FLOOR_MARBLE = 'FLOOR_MARBLE',
  FLOOR_CARPET = 'FLOOR_CARPET',
  FLOOR_TILE = 'FLOOR_TILE',
  FLOOR_WATER = 'FLOOR_WATER',
  FURNITURE = 'FURNITURE',
}

/** Footstep noise multiplier per tile type. Impassable tiles have 0 (never stepped on). */
export const NOISE_MULTIPLIER: Record<TileType, number> = {
  [TileType.WALL]: 0,
  [TileType.FLOOR_MARBLE]: 1.5,
  [TileType.FLOOR_CARPET]: 0.3,
  [TileType.FLOOR_TILE]: 1.0,
  [TileType.FLOOR_WATER]: 2.0,
  [TileType.FURNITURE]: 0,
};

/** Whether a tile can be walked on */
export const PASSABLE: Record<TileType, boolean> = {
  [TileType.WALL]: false,
  [TileType.FLOOR_MARBLE]: true,
  [TileType.FLOOR_CARPET]: true,
  [TileType.FLOOR_TILE]: true,
  [TileType.FLOOR_WATER]: true,
  [TileType.FURNITURE]: false,
};
