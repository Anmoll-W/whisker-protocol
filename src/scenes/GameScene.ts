// GameScene — the playable Level 2 vertical slice ("Pakad Liya!").
// Fully data-driven: everything (tiles, Billu, the guard + patrol, props, the
// laddoo, the exit) is instantiated from public/levels/level2.json via
// LevelLoader. Authoring a new level is JSON-only — no edits here.

import Phaser from 'phaser';
import { TileMap, TILE_SIZE } from '@/entities/TileMap';
import { Player } from '@/entities/Player';
import { Guard } from '@/entities/Guard';
import { FoodItem } from '@/entities/FoodItem';
import { ExitZone } from '@/entities/ExitZone';
import { Prop } from '@/entities/Prop';
import { parseLevel, type ParsedLevel } from '@/systems/LevelLoader';
import { type LevelDefinition } from '@/types/level-types';
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
  private foodItems: FoodItem[] = [];
  private exitZone!: ExitZone;
  private props: Prop[] = [];
  /** Count of laddoos still uncollected — exit unlocks at 0. */
  private foodRemaining = 0;
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
    // Reset per-run collections. Phaser reuses the scene INSTANCE across
    // restarts (restartGame → scene.start) and re-runs create() without
    // re-running class-field initializers, so we must clear these here or a
    // replay would double every prop / laddoo / active noise.
    this.foodItems = [];
    this.props = [];
    this.activeNoises = [];

    // ── Parse the level data (loaded as JSON in PreloadScene) ──────────────────
    const raw = this.cache.json.get('level2') as LevelDefinition;
    const level: ParsedLevel = parseLevel(raw);

    // Build + render the tilemap from the level's decoded grid.
    this.tileMap = new TileMap(this, level.layout);

    // Constrain camera to the map bounds so it never shows void.
    const mapWidth = level.cols * TILE_SIZE;
    const mapHeight = level.rows * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, mapWidth, mapHeight);

    // Spawn Billu at the level's spawn (world center already resolved).
    this.player = new Player(this, level.spawn.x, level.spawn.y, this.tileMap);
    this.add.existing(this.player);

    // Guard — the slice authors exactly one; instantiate with its patrol path.
    const guardSpec = level.guards[0]!;
    const start = guardSpec.patrol[0]!;
    this.guard = new Guard(this, start.x, start.y, guardSpec.patrol);
    this.add.existing(this.guard);

    // Laddoo(s) — exit unlocks once all are collected.
    for (const f of level.food) {
      const item = new FoodItem(this, f.x, f.y);
      this.add.existing(item);
      this.foodItems.push(item);
    }
    this.foodRemaining = this.foodItems.length;

    // Exit zone — locked until every laddoo is collected.
    this.exitZone = new ExitZone(this, level.exit.x, level.exit.y);
    this.add.existing(this.exitZone);

    // Knockable props (the lure). Batting one emits a wide noise that draws the
    // guard (the Cat Chaos hero verb, R1.2). At least one brass + one clay.
    for (const p of level.props) {
      const prop = new Prop(this, p.pos.x, p.pos.y, p.type);
      // When the prop emits its noise (at t≈500ms post-contact), register it as
      // an active event so the guard can hear it within its lifetime window.
      prop.onNoise = (event) => {
        this.activeNoises.push(makeActiveNoise(event));
      };
      this.add.existing(prop);
      this.props.push(prop);
    }

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
    for (const prop of this.props) prop.update(delta);

    // ── Bat the nearest in-range prop (Cat Chaos hero verb) ────────────────────
    // One knock per press: pick the closest un-knocked prop within bat range.
    if (Phaser.Input.Keyboard.JustDown(this.batKey)) {
      const range2 = GameScene.BAT_RANGE_PX * GameScene.BAT_RANGE_PX;
      let best: Prop | null = null;
      let bestDist2 = range2;
      for (const prop of this.props) {
        if (prop.knocked) continue;
        const dx = this.player.x - prop.x;
        const dy = this.player.y - prop.y;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestDist2) {
          bestDist2 = d2;
          best = prop;
        }
      }
      if (best !== null) {
        best.knock();
        this.player.playBat(); // show the strike pose on Billu (visible hero verb)
      }
    }

    // ── Food collection ───────────────────────────────────────────────────────
    // Collect any laddoo in range; the exit unlocks once the last one is taken.
    for (const item of this.foodItems) {
      if (item.collected) continue;
      const dx = this.player.x - item.x;
      const dy = this.player.y - item.y;
      if (dx * dx + dy * dy < 18 * 18) {
        item.collect();
        this.guard.playerCarryingFood = true;
        this.foodRemaining -= 1;
        if (this.foodRemaining <= 0) this.exitZone.unlock();
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
