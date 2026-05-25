// GameScene — first playable environment: Chawl Kitchen
// Renders the full 20×15 tilemap via TileMap and sets camera bounds to map size.

import Phaser from 'phaser';
import { TileMap, MAP_COLS, MAP_ROWS, TILE_SIZE } from '@/entities/TileMap';
import { Player } from '@/entities/Player';
import { Guard } from '@/entities/Guard';
import { GuardState } from '@/types/guard-types';
import { checkLineOfSight, DEFAULT_CONE_CONFIG } from '@/systems/detection';
import { renderDetectionDebug, renderNoiseDebug } from '@/systems/detection-renderer';
import { computeNoise, canGuardHearNoise } from '@/systems/noise';

export class GameScene extends Phaser.Scene {
  private tileMap!: TileMap;
  private player!: Player;
  private guard!: Guard;
  private detectionDebugGfx!: Phaser.GameObjects.Graphics;
  private noiseDebugGfx!: Phaser.GameObjects.Graphics;

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

    // Noise radius debug overlay — between tiles and entities (depth 15)
    this.noiseDebugGfx = this.add.graphics();
    this.noiseDebugGfx.setDepth(15);

    // Detection cone debug overlay — drawn above all entities
    this.detectionDebugGfx = this.add.graphics();
    this.detectionDebugGfx.setDepth(20);

    // Listen for guard ALERTED event — launch GameOverScene overlay
    this.guard.on(Guard.EVENT_ALERTED, () => {
      if (this.scene.isActive('GameOverScene')) return; // belt-and-suspenders
      this.scene.pause();
      this.scene.launch('GameOverScene');
    });
  }

  update(_time: number, delta: number): void {
    this.player.update(delta);

    // ── Surface noise check ──────────────────────────────────────────────────
    const noiseEvent = computeNoise(this.player.x, this.player.y, this.player.noiseLevel);
    if (noiseEvent !== null) {
      const canHear = canGuardHearNoise(this.guard.guardPosition, noiseEvent);
      if (canHear && (this.guard.guardState === GuardState.PATROL || this.guard.guardState === GuardState.IDLE)) {
        this.guard.setGuardState(GuardState.SUSPICIOUS);
        this.guard.lastKnownPosition = { x: this.player.x, y: this.player.y };
      }
      // Guards already SUSPICIOUS, ALERTED, or SEARCHING are not downgraded by noise
    }

    // ── Detection cone check ─────────────────────────────────────────────────
    const result = checkLineOfSight(
      this.guard.guardPosition,
      this.guard.facing,
      { x: this.player.x, y: this.player.y },
      this.tileMap,
      DEFAULT_CONE_CONFIG,
    );

    // Detection determines state this frame
    this.guard.updateDetection(result, delta, { x: this.player.x, y: this.player.y });
    // Then move in the state just set
    this.guard.update(delta);

    // ── Noise radius debug overlay ───────────────────────────────────────────
    this.noiseDebugGfx.clear();
    renderNoiseDebug(
      this.noiseDebugGfx,
      this.player.x,
      this.player.y,
      this.player.noiseRadius,
    );

    // ── Detection cone debug overlay ─────────────────────────────────────────
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
