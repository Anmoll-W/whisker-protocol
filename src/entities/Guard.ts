// Guard — Nosy Chawl Neighbor
// A Phaser.GameObjects.Container holding a Graphics child that draws the guard.
// Patrols between world-space waypoints, idles briefly at each stop.
// All rendering is programmatic — no external sprites.

import Phaser from 'phaser';
import {
  GuardState,
  DEFAULT_GUARD_CONFIG,
  type GuardConfig,
  SUSPICIOUS_TO_ALERTED_MS,
  SUSPICIOUS_COOLDOWN_MS,
  SEARCH_DURATION_MS,
} from '@/types/guard-types';
import { DEFAULT_CONE_CONFIG } from '@/systems/detection';
import { type DetectionResult } from '@/systems/detection';

/** Search speed (px/s) — faster than normal patrol */
const SEARCH_SPEED = 72;

/** Distance threshold (px) to consider lastKnownPosition reached during SEARCHING */
const SEARCH_REACH_THRESHOLD = 8;

/** Milliseconds between facing-direction pivots during SEARCHING "look around" */
const SEARCH_PIVOT_INTERVAL = 2000;

interface Waypoint {
  x: number;
  y: number;
}

export class Guard extends Phaser.GameObjects.Container {
  private gfx: Phaser.GameObjects.Graphics;
  private cfg: GuardConfig;
  private waypoints: Waypoint[];
  private waypointIndex: number = 1;
  private _state: GuardState = GuardState.PATROL;
  private facingX: 1 | -1 = 1;
  private facingY: number = 0;
  private idleTimer: number = 0;

  /** Detection time accumulators (milliseconds). */
  private _mainConeTime: number = 0;
  private _peripheralTime: number = 0;

  /** Time (ms) the player has been continuously OUT of all cones (for SUSPICIOUS cooldown). */
  private _cooldownTimer: number = 0;

  /** Waypoint index saved when entering SUSPICIOUS — restored on PATROL revert. */
  private savedWaypointIndex: number = 0;

  /** Last known player world position — set whenever player is in main cone. */
  public lastKnownPosition: { x: number; y: number } | null = null;

  /**
   * Set from GameScene when T8 (food carry mechanic) lands.
   * Increases effective detection range by 20% while true.
   */
  public playerCarryingFood: boolean = false;

  /** Time (ms) spent searching after reaching lastKnownPosition. */
  private searchTimer: number = 0;

  /** Time (ms) accumulator for "look around" pivot while SEARCHING. */
  private searchPivotTimer: number = 0;

  /** Whether the guard has reached lastKnownPosition during SEARCHING. */
  private searchReached: boolean = false;

  /** Track last drawn state + facing so we only redraw on change. */
  private lastDrawnState: GuardState | null = null;
  private lastDrawnFacing: 1 | -1 | null = null;

  /** Track whether EVENT_ALERTED has already fired for the current alert cycle. */
  private _alertedEventFired: boolean = false;

  /** Event key emitted when the guard enters ALERTED state. */
  static readonly EVENT_ALERTED = 'guard:alerted';

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    waypoints: Waypoint[],
    cfg: GuardConfig = DEFAULT_GUARD_CONFIG,
  ) {
    super(scene, x, y);

    this.cfg = cfg;
    this.waypoints = waypoints;

    // Use make.graphics (not add.graphics) — avoids ghost render at world origin.
    this.gfx = scene.make.graphics({});
    this.add(this.gfx);

    this.setDepth(10);
    this.redraw();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  get guardPosition(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }

  get facing(): 1 | -1 {
    return this.facingX;
  }

  /** Facing direction as radians: 0=right, π/2=down, π=left, -π/2=up */
  get facingAngle(): number {
    return Math.atan2(this.facingY, this.facingX);
  }

  get guardState(): GuardState {
    return this._state;
  }

  setGuardState(s: GuardState): void {
    if (this._state !== s) {
      this._state = s;
      this.redraw();
    }
  }

  /**
   * Triggered by GameScene when the guard hears a noise event.
   * Resets stale cone timers before entering SUSPICIOUS so accumulated
   * _mainConeTime from a previous cycle cannot prematurely trigger ALERTED.
   * Only acts when the guard is currently PATROL or IDLE.
   */
  hearNoise(pos: { x: number; y: number }): void {
    if (this._state !== GuardState.PATROL && this._state !== GuardState.IDLE) return;
    this._mainConeTime = 0;
    this.savedWaypointIndex = this.waypointIndex;
    this.lastKnownPosition = { x: pos.x, y: pos.y };
    this.setGuardState(GuardState.SUSPICIOUS);
  }

  /** Milliseconds the player has been continuously in the main cone with clear LOS. */
  get mainConeTime(): number {
    return this._mainConeTime;
  }

  /** Milliseconds the player has been continuously in the peripheral zone with clear LOS. */
  get peripheralTime(): number {
    return this._peripheralTime;
  }

  /**
   * Full alert state machine.
   * Called by GameScene each frame after checkLineOfSight().
   *
   * State flow:
   *   PATROL/IDLE → SUSPICIOUS → ALERTED → SEARCHING → PATROL
   *
   * @param result  Latest detection cone result from checkLineOfSight()
   * @param delta   Frame delta in milliseconds
   * @param playerPos  Current world position of the player
   */
  updateDetection(
    result: DetectionResult,
    delta: number,
    playerPos: { x: number; y: number },
  ): void {
    // ── Food-carry modifier: expand effective main cone range ─────────────────
    const effectiveMainRange = this.playerCarryingFood
      ? DEFAULT_CONE_CONFIG.range * 1.2
      : DEFAULT_CONE_CONFIG.range;

    // Re-evaluate inMainCone using effective range (result.inMainCone already
    // accounts for angle + LOS, but was computed with base range — extend here).
    const inMain =
      result.inMainCone ||
      (result.distancePx <= effectiveMainRange &&
        Math.abs(result.angleFromFacing) <= DEFAULT_CONE_CONFIG.halfAngle &&
        !result.blockedByWall);

    // ── Player is in main cone ────────────────────────────────────────────────
    if (inMain) {
      // Store last known position whenever we see the player
      this.lastKnownPosition = { x: playerPos.x, y: playerPos.y };

      this._mainConeTime += delta;
      this._peripheralTime = 0;
      this._cooldownTimer = 0;

      const cur = this._state;

      // Transition: PATROL / IDLE / SUSPICIOUS → SUSPICIOUS (stop moving, face player)
      if (
        cur === GuardState.PATROL ||
        cur === GuardState.IDLE ||
        cur === GuardState.SUSPICIOUS
      ) {
        if (cur === GuardState.PATROL || cur === GuardState.IDLE) {
          // Save waypoint so we can resume after the alert clears
          this.savedWaypointIndex = this.waypointIndex;
          // Face toward player
          this.facingX = playerPos.x >= this.x ? 1 : -1;
        }
        this.setGuardState(GuardState.SUSPICIOUS);
      }

      // Transition: SUSPICIOUS → ALERTED (dwell time exceeded)
      if (
        this._state === GuardState.SUSPICIOUS &&
        this._mainConeTime >= SUSPICIOUS_TO_ALERTED_MS
      ) {
        this._enterAlerted();
        return; // no further transitions this frame
      }

      // Transition: SEARCHING → ALERTED (re-spotted while searching)
      if (this._state === GuardState.SEARCHING) {
        this._enterAlerted();
        return;
      }

      // ALERTED: player still in LOS — guard stays alerted, no progression
      // Cap mainConeTime to prevent unbounded accumulation
      this._mainConeTime = Math.min(this._mainConeTime, SUSPICIOUS_TO_ALERTED_MS);
      return;
    }

    // ── Player is NOT in main cone ────────────────────────────────────────────

    if (result.inPeripheral) {
      this._peripheralTime += delta;
      // Peripheral detection does not drive SUSPICIOUS → don't reset mainConeTime
    } else {
      // Fully out of all cones
      this._peripheralTime = 0;
    }

    // SUSPICIOUS cooldown
    if (this._state === GuardState.SUSPICIOUS) {
      this._cooldownTimer += delta;
      if (this._cooldownTimer >= SUSPICIOUS_COOLDOWN_MS) {
        // Cool down complete — revert to PATROL
        this._mainConeTime = 0;
        this._cooldownTimer = 0;
        this.waypointIndex = this.savedWaypointIndex;
        this.setGuardState(GuardState.PATROL);
      }
      return;
    }

    // ALERTED → SEARCHING (player left LOS)
    if (this._state === GuardState.ALERTED) {
      this._enterSearching();
      return;
    }

    // PATROL / IDLE — player out of cones, nothing to do
    if (
      this._state === GuardState.PATROL ||
      this._state === GuardState.IDLE
    ) {
      this._mainConeTime = 0;
      this._peripheralTime = 0;
    }

    // SEARCHING is handled in update() / tickSearching()
  }

  // ── Public update — called by GameScene.update() each frame ─────────────────
  update(delta: number): void {
    const dt = delta / 1000; // ms → seconds

    switch (this._state) {
      case GuardState.PATROL:
        this.tickPatrol(dt);
        break;
      case GuardState.IDLE:
        this.tickIdle(delta);
        break;
      case GuardState.SUSPICIOUS:
        // Guard stops and faces player — already handled in updateDetection
        break;
      case GuardState.ALERTED:
        // Guard freezes in place — no movement
        break;
      case GuardState.SEARCHING:
        this.tickSearching(delta, dt);
        break;
    }

    // Redraw only when state or facing changed
    if (this._state !== this.lastDrawnState || this.facingX !== this.lastDrawnFacing) {
      this.redraw();
    }
  }

  // ── Private state entry helpers ──────────────────────────────────────────────

  private _enterAlerted(): void {
    this._mainConeTime = SUSPICIOUS_TO_ALERTED_MS; // clamp — don't let it go negative on reentry
    this.setGuardState(GuardState.ALERTED);
    if (!this._alertedEventFired) {
      this._alertedEventFired = true;
      this.emit(Guard.EVENT_ALERTED, this);
    }
  }

  private _enterSearching(): void {
    this.searchTimer = 0;
    this.searchPivotTimer = 0;
    this.searchReached = false;
    this._mainConeTime = 0;
    this._cooldownTimer = 0;
    this._alertedEventFired = false;
    this.setGuardState(GuardState.SEARCHING);
  }

  // ── Patrol tick ──────────────────────────────────────────────────────────────
  private tickPatrol(dt: number): void {
    if (this.waypoints.length === 0) return;

    const target = this.waypoints[this.waypointIndex];
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= this.cfg.waypointReachThreshold) {
      // Snap to waypoint, start idling
      this.x = target.x;
      this.y = target.y;
      this.idleTimer = this.cfg.idleDuration;
      this._state = GuardState.IDLE;
      return;
    }

    // Normalise direction and move
    const nx = dx / dist;
    const ny = dy / dist;
    this.x += nx * this.cfg.patrolSpeed * dt;
    this.y += ny * this.cfg.patrolSpeed * dt;

    // Update facing — track both axes for 4-way cone direction
    if (Math.abs(nx) > 0.001 || Math.abs(ny) > 0.001) {
      this.facingX = nx >= 0 ? 1 : -1;
      this.facingY = ny;
    }
  }

  // ── Idle tick ────────────────────────────────────────────────────────────────
  private tickIdle(delta: number): void {
    this.idleTimer -= delta;
    if (this.idleTimer <= 0) {
      // Advance to next waypoint (looping)
      this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
      this._state = GuardState.PATROL;
    }
  }

  // ── Searching tick ───────────────────────────────────────────────────────────
  // delta: raw ms (for timer accumulation); dt: seconds (= delta/1000, for movement math)
  private tickSearching(delta: number, dt: number): void {
    if (this.lastKnownPosition === null) {
      // No last known position — give up immediately
      this.waypointIndex = this.savedWaypointIndex;
      this.setGuardState(GuardState.PATROL);
      return;
    }

    if (!this.searchReached) {
      // Move toward last known position
      const dx = this.lastKnownPosition.x - this.x;
      const dy = this.lastKnownPosition.y - this.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist <= SEARCH_REACH_THRESHOLD) {
        // Arrived — start the countdown
        this.searchReached = true;
        this.searchTimer = 0;
        this.searchPivotTimer = 0;
      } else {
        const nx = dx / dist;
        const ny = dy / dist;
        this.x += nx * SEARCH_SPEED * dt;
        this.y += ny * SEARCH_SPEED * dt;

        // Update facing — track both axes for 4-way cone direction
        if (Math.abs(nx) > 0.001 || Math.abs(ny) > 0.001) {
          this.facingX = nx >= 0 ? 1 : -1;
          this.facingY = ny;
        }
      }
    } else {
      // At last known position — countdown and pivot
      this.searchTimer += delta;
      this.searchPivotTimer += delta;

      // Pivot "look around" every SEARCH_PIVOT_INTERVAL ms
      if (this.searchPivotTimer >= SEARCH_PIVOT_INTERVAL) {
        this.searchPivotTimer -= SEARCH_PIVOT_INTERVAL;
        this.facingX = this.facingX === 1 ? -1 : 1;
      }

      // Search expired — revert to PATROL
      if (this.searchTimer >= SEARCH_DURATION_MS) {
        this.waypointIndex = this.savedWaypointIndex;
        this._mainConeTime = 0;
        this._cooldownTimer = 0;
        this.setGuardState(GuardState.PATROL);
      }
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────
  private redraw(): void {
    this.lastDrawnState = this._state;
    this.lastDrawnFacing = this.facingX;

    const g = this.gfx;
    g.clear();

    // Mirror the entire Graphics object when facing left.
    // All draw calls use right-facing constants; scaleX mirrors around origin.
    g.scaleX = this.facingX;

    switch (this._state) {
      case GuardState.PATROL:
      case GuardState.IDLE:
        this.drawNormal(g, 0x1A3A8A);
        break;
      case GuardState.SUSPICIOUS:
        this.drawSuspicious(g);
        break;
      case GuardState.ALERTED:
        this.drawAlerted(g);
        break;
      case GuardState.SEARCHING:
        this.drawNormal(g, 0xAA4400);
        break;
    }
  }

  /**
   * Core draw routine — Chawl Uncle in kurta.
   * Size: ~28px wide, ~44px tall (including head). Origin at container center.
   * All coordinates are right-facing; g.scaleX handles left-facing mirroring.
   *
   * @param g         Graphics object to draw into
   * @param bodyColor Kurta fill color (parameterized for state-based tinting)
   */
  private drawNormal(g: Phaser.GameObjects.Graphics, bodyColor: number = 0x1A3A8A): void {
    // ── Ground shadow ──
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(0, 20, 30, 8);

    // ── Legs — two dark trouser legs ──
    g.fillStyle(0x1A2A50, 1);
    g.fillRoundedRect(-10, 14, 9, 18, 3);   // left leg
    g.fillRoundedRect(2,   14, 9, 18, 3);   // right leg

    // ── Kurta body — outline then fill ──
    g.fillStyle(0x102870, 1);
    g.fillRoundedRect(-14, -12, 30, 30, 4);  // dark outline
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-13, -11, 28, 28, 3);  // fill

    // ── Kurta V-collar ──
    g.fillStyle(0xFFFFFF, 0.6);
    g.fillTriangle(0, -11, -4, -3, 4, -3);

    // ── Kurta button strip (center seam) ──
    g.fillStyle(0x102870, 1);
    g.fillRect(-1, -8, 2, 20);

    // ── Arms ──
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-16, -8, 6, 20, 3);   // left arm
    g.fillRoundedRect(12,  -8, 6, 20, 3);   // right arm

    // ── Hands ──
    g.fillStyle(0xC8926A, 1);
    g.fillCircle(-13, 13, 5);  // left hand
    g.fillCircle(15,  13, 5);  // right hand

    // ── Head — outline then skin fill ──
    g.fillStyle(0x331100, 1);
    g.fillCircle(0, -26, 13);  // dark outline ring
    g.fillStyle(0xC8926A, 1);
    g.fillCircle(0, -26, 12);  // skin

    // ── Hair — dark cap on top of head ──
    g.fillStyle(0x1A1008, 1);
    g.fillEllipse(0, -36, 22, 10);

    // ── Ears ──
    g.fillStyle(0xA87050, 1);
    g.fillCircle(-13, -26, 4);  // left ear
    g.fillCircle(13,  -26, 4);  // right ear

    // ── Eyes with highlight ──
    g.fillStyle(0x1A1A1A, 1);
    g.fillCircle(-5, -27, 3);   // left eye
    g.fillCircle(5,  -27, 3);   // right eye
    g.fillStyle(0xFFFFFF, 1);
    g.fillCircle(-4, -28, 1);   // left eye highlight
    g.fillCircle(6,  -28, 1);   // right eye highlight

    // ── Mustache ──
    g.fillStyle(0x1A1008, 1);
    g.fillEllipse(-4, -22, 8, 3);  // left half
    g.fillEllipse(4,  -22, 8, 3);  // right half
  }

  /**
   * SUSPICIOUS state — yellow-tinted kurta + '?' above head.
   * All coordinates right-facing; scaleX handles mirroring.
   */
  private drawSuspicious(g: Phaser.GameObjects.Graphics): void {
    this.drawNormal(g, 0x998800);

    // '?' marker above head — built from filled rects
    const color = 0xF5C842;
    g.fillStyle(color, 1);
    // Top arc of '?': two horizontal bars + right vertical + curve-down
    g.fillRect(-3, -54, 8, 3);   // top bar
    g.fillRect(5,  -54, 3, 6);   // right drop
    g.fillRect(-1, -48, 6, 3);   // mid-curve connector
    g.fillRect(-1, -45, 3, 5);   // stem
    // Dot
    g.fillRect(-1, -37, 3, 3);
  }

  /**
   * ALERTED state — red kurta + double '!' above head.
   * All coordinates right-facing; scaleX handles mirroring.
   */
  private drawAlerted(g: Phaser.GameObjects.Graphics): void {
    this.drawNormal(g, 0xAA2222);

    // Double exclamation marks above head
    g.fillStyle(0xFF4400, 1);
    g.fillRect(6,  -50, 3, 10);  // "!" mark 1 body
    g.fillRect(6,  -38, 3, 3);   // "!" mark 1 dot
    g.fillRect(12, -50, 3, 10);  // "!" mark 2 body
    g.fillRect(12, -38, 3, 3);   // "!" mark 2 dot
  }
}
