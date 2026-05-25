// GameScene — first playable environment: Chawl Kitchen
// Renders the full 20×15 tilemap via TileMap and sets camera bounds to map size.

import Phaser from 'phaser';
import { TileMap, MAP_COLS, MAP_ROWS, TILE_SIZE } from '@/entities/TileMap';
import { Player } from '@/entities/Player';
import { Guard } from '@/entities/Guard';
import { checkLineOfSight, DEFAULT_CONE_CONFIG } from '@/systems/detection';
import { renderDetectionDebug } from '@/systems/detection-renderer';

export class GameScene extends Phaser.Scene {
  private tileMap!: TileMap;
  private player!: Player;
  private guard!: Guard;
  private detectionDebugGfx!: Phaser.GameObjects.Graphics;

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
    this.add.existing(this.player);

    // Guard patrols a path through the kitchen — tile centers
    const guardWaypoints = [
      { x: 14 * TILE_SIZE + TILE_SIZE / 2, y:  3 * TILE_SIZE + TILE_SIZE / 2 },
      { x: 14 * TILE_SIZE + TILE_SIZE / 2, y: 10 * TILE_SIZE + TILE_SIZE / 2 },
      { x:  9 * TILE_SIZE + TILE_SIZE / 2, y: 10 * TILE_SIZE + TILE_SIZE / 2 },
      { x:  9 * TILE_SIZE + TILE_SIZE / 2, y:  3 * TILE_SIZE + TILE_SIZE / 2 },
    ];
    this.guard = new Guard(this, guardWaypoints[0].x, guardWaypoints[0].y, guardWaypoints);
    this.add.existing(this.guard);

    // Detection cone debug overlay — drawn above all entities
    this.detectionDebugGfx = this.add.graphics();
    this.detectionDebugGfx.setDepth(20);
  }

  update(_time: number, delta: number): void {
    this.player.update(delta);
    this.guard.update(delta);

    // ── Detection cone check ─────────────────────────────────────────────────
    const result = checkLineOfSight(
      this.guard.guardPosition,
      this.guard.facing,
      { x: this.player.x, y: this.player.y },
      this.tileMap,
      DEFAULT_CONE_CONFIG,
    );

    // Update guard timers and trigger state transitions
    this.guard.updateDetection(result, delta);

    // Redraw debug overlay
    this.detectionDebugGfx.clear();
    renderDetectionDebug(
      this.detectionDebugGfx,
      this.guard.guardPosition,
      this.guard.facing,
      result,
      DEFAULT_CONE_CONFIG,
    );
  }

  getTileMap(): TileMap { return this.tileMap; }
}
