// GameScene — first playable environment: Chawl Kitchen
// Renders the full 20×15 tilemap via TileMap and sets camera bounds to map size.

import Phaser from 'phaser';
import { TileMap, MAP_COLS, MAP_ROWS, TILE_SIZE } from '@/entities/TileMap';
import { Player } from '@/entities/Player';

export class GameScene extends Phaser.Scene {
  private tileMap!: TileMap;
  private player!: Player;

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

    // Spawn Billu at tile (3,7) center — clear walkable area
    const startX = 3 * TILE_SIZE + TILE_SIZE / 2;
    const startY = 7 * TILE_SIZE + TILE_SIZE / 2;
    this.player = new Player(this, startX, startY, this.tileMap);
    this.add.existing(this.player as unknown as Phaser.GameObjects.GameObject);
  }

  update(_time: number, delta: number): void {
    this.player.update(delta);
  }

  getTileMap(): TileMap { return this.tileMap; }
}
