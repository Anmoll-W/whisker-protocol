// GameScene — first playable environment: Chawl Kitchen
// Renders the full 20×15 tilemap via TileMap and sets camera bounds to map size.

import Phaser from 'phaser';
import { TileMap, MAP_COLS, MAP_ROWS, TILE_SIZE } from '@/entities/TileMap';

export class GameScene extends Phaser.Scene {
  private tileMap!: TileMap;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    // Build and render the Chawl Kitchen tilemap
    this.tileMap = new TileMap(this);

    const mapWidth = MAP_COLS * TILE_SIZE;   // 640
    const mapHeight = MAP_ROWS * TILE_SIZE;  // 480

    // Constrain camera to the map bounds so it never shows void
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);
  }

  getTileMap(): TileMap { return this.tileMap; }
}
