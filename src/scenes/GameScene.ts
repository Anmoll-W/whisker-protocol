// GameScene — first playable environment: Chawl Kitchen
// Renders the full 20×15 tilemap via TileMap and sets camera bounds to map size.

import Phaser from 'phaser';
import { TileMap, MAP_COLS, MAP_ROWS, TILE_SIZE } from '@/entities/TileMap';
import { Player } from '@/entities/Player';
import { Guard } from '@/entities/Guard';
import { FoodItem } from '@/entities/FoodItem';
import { ExitZone } from '@/entities/ExitZone';
import { Prop } from '@/entities/Prop';
import { PropType } from '@/types/prop-types';
import { checkLineOfSight, DEFAULT_CONE_CONFIG } from '@/systems/detection';
import { renderDetectionDebug, renderNoiseDebug } from '@/systems/detection-renderer';
import {
  computeNoise,
  canGuardHearNoise,
  makeActiveNoise,
  tickActiveNoises,
  type ActiveNoiseEvent,
} from '@/systems/noise';
import { transitionTo } from '@/systems/scene-transition';

export class GameScene extends Phaser.Scene {
  private readonly DEBUG_OVERLAYS = false;

  private tileMap!: TileMap;
  private player!: Player;
  private guard!: Guard;
  private foodItem!: FoodItem;
  private exitZone!: ExitZone;
  private prop!: Prop;
  private batKey!: Phaser.Input.Keyboard.Key;
  private detectionDebugGfx!: Phaser.GameObjects.Graphics;
  private noiseDebugGfx!: Phaser.GameObjects.Graphics;

  /** Discrete noise events (knocked props) still audible this frame. */
  private activeNoises: ActiveNoiseEvent[] = [];

  /** Pixels — how close Billu must be to a prop to bat it. */
  private static readonly BAT_RANGE_PX = 40;

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

    // Laddoo food item at tile (7,7) center
    this.foodItem = new FoodItem(this, 7 * TILE_SIZE + TILE_SIZE / 2, 7 * TILE_SIZE + TILE_SIZE / 2);
    this.add.existing(this.foodItem);

    // Exit zone at tile (17,12) center — locked until food collected
    this.exitZone = new ExitZone(this, 17 * TILE_SIZE + TILE_SIZE / 2, 12 * TILE_SIZE + TILE_SIZE / 2);
    this.add.existing(this.exitZone);

    // Knockable prop — a brass vessel on a ledge near Billu's start. Batting it
    // emits a wide noise that lures the guard (the Cat Chaos hero verb, R1.2).
    this.prop = new Prop(
      this,
      5 * TILE_SIZE + TILE_SIZE / 2,
      9 * TILE_SIZE + TILE_SIZE / 2,
      PropType.BRASS,
    );
    // When the prop emits its noise (at t≈500ms post-contact), register it as an
    // active event so the guard can hear it within its lifetime window.
    this.prop.onNoise = (event) => {
      this.activeNoises.push(makeActiveNoise(event));
    };
    this.add.existing(this.prop);

    // Bat input — B key. (Touch bat button is a later track.)
    this.batKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.B);

    // Noise radius debug overlay — between tiles and entities (depth 15)
    this.noiseDebugGfx = this.add.graphics();
    this.noiseDebugGfx.setDepth(15);
    this.noiseDebugGfx.setVisible(this.DEBUG_OVERLAYS);

    // Detection cone debug overlay — drawn above all entities
    this.detectionDebugGfx = this.add.graphics();
    this.detectionDebugGfx.setDepth(20);
    this.detectionDebugGfx.setVisible(this.DEBUG_OVERLAYS);

    // Listen for guard ALERTED event — launch GameOverScene overlay.
    // Routes through transitionTo() to prevent the WinScene/GameOverScene race.
    this.guard.on(Guard.EVENT_ALERTED, () => {
      transitionTo(this, 'GameOverScene');
    });
  }

  update(_time: number, delta: number): void {
    this.player.update(delta);
    this.prop.update(delta);

    // ── Bat the prop (Cat Chaos hero verb) ─────────────────────────────────────
    if (Phaser.Input.Keyboard.JustDown(this.batKey) && !this.prop.knocked) {
      const dx = this.player.x - this.prop.x;
      const dy = this.player.y - this.prop.y;
      if (dx * dx + dy * dy <= GameScene.BAT_RANGE_PX * GameScene.BAT_RANGE_PX) {
        this.prop.knock();
      }
    }

    // ── Food collection ───────────────────────────────────────────────────────
    if (!this.foodItem.collected) {
      const dx = this.player.x - this.foodItem.x;
      const dy = this.player.y - this.foodItem.y;
      if (dx * dx + dy * dy < 18 * 18) {
        this.foodItem.collect();
        this.exitZone.unlock();
        this.guard.playerCarryingFood = true;
      }
    }

    // ── Win check ─────────────────────────────────────────────────────────────
    if (this.exitZone.isUnlocked) {
      const dx = this.player.x - this.exitZone.x;
      const dy = this.player.y - this.exitZone.y;
      if (dx * dx + dy * dy < 24 * 24) {
        // Routes through transitionTo() — no-ops if GameOverScene already locked
        // the transition on the same frame (WinScene/GameOverScene race fix).
        transitionTo(this, 'WinScene');
      }
    }

    // ── Surface (footstep) noise check ─────────────────────────────────────────
    // Continuous noise from Billu moving. hearNoise() delegates to the guard's
    // brain: PATROL/IDLE → SUSPICIOUS, or escalate if already investigating.
    const footstepNoise = computeNoise(this.player.x, this.player.y, this.player.noiseLevel);
    if (footstepNoise !== null && canGuardHearNoise(this.guard.guardPosition, footstepNoise)) {
      this.guard.hearNoise({ x: this.player.x, y: this.player.y });
    }

    // ── Prop (discrete) noise events ───────────────────────────────────────────
    // Age out expired events, then let the guard hear any still-active one whose
    // radius intersects his position. This is the knock → hear → investigate path.
    this.activeNoises = tickActiveNoises(this.activeNoises, delta);
    for (const active of this.activeNoises) {
      if (canGuardHearNoise(this.guard.guardPosition, active.event)) {
        this.guard.hearNoise({ x: active.event.sourceX, y: active.event.sourceY });
      }
    }

    // ── Detection cone check ─────────────────────────────────────────────────
    // 4-way cone: pass the guard's facingAngle (radians), not facingX. The cone
    // half-angles widen with escalation memory.
    const coneConfig = {
      ...DEFAULT_CONE_CONFIG,
      halfAngle: this.guard.effectiveConeHalfAngle,
      peripheralHalfAngle: this.guard.effectiveConePeripheralHalfAngle,
    };
    const result = checkLineOfSight(
      this.guard.guardPosition,
      this.guard.facingAngle,
      { x: this.player.x, y: this.player.y },
      this.tileMap,
      coneConfig,
    );

    // Feed detection into the guard (brain transitions + movement in one call).
    this.guard.tick(result, delta, { x: this.player.x, y: this.player.y });

    // ── Noise radius debug overlay ───────────────────────────────────────────
    if (this.DEBUG_OVERLAYS) {
      this.noiseDebugGfx.clear();
      renderNoiseDebug(
        this.noiseDebugGfx,
        this.player.x,
        this.player.y,
        this.player.noiseRadius,
      );
    }

    // ── Detection cone debug overlay ─────────────────────────────────────────
    // Reflect the escalation-widened cone (coneConfig) and the food-carry range
    // expansion. Uses facingAngle (radians) for the 4-way cone.
    if (this.DEBUG_OVERLAYS) {
      const effectiveConeConfig = this.guard.playerCarryingFood
        ? { ...coneConfig, range: coneConfig.range * 1.2 }
        : coneConfig;
      this.detectionDebugGfx.clear();
      renderDetectionDebug(
        this.detectionDebugGfx,
        this.guard.guardPosition,
        this.guard.facingAngle,
        result,
        effectiveConeConfig,
      );
    }
  }

  getTileMap(): TileMap { return this.tileMap; }
}
