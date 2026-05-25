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

    // Update facing from horizontal movement
    if (nx > 0) this.facingX = 1;
    else if (nx < 0) this.facingX = -1;
    // If purely vertical movement, hold last facing
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

        if (nx > 0) this.facingX = 1;
        else if (nx < 0) this.facingX = -1;
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
        this.drawNormal(g);
        break;
      case GuardState.SUSPICIOUS:
        this.drawSuspicious(g);
        break;
      case GuardState.ALERTED:
        this.drawAlerted(g);
        break;
      case GuardState.SEARCHING:
        // SEARCHING renders same as PATROL for now — distinct visual is a stretch goal
        this.drawNormal(g);
        break;
    }
  }

  /**
   * PATROL / IDLE state — nosy chawl neighbor in dark blue kurta.
   * All coordinates are right-facing; scaleX handles left-facing mirroring.
   * @param bodyColor Optional override for the body and arm color (default 0x2244aa — dark blue)
   */
  private drawNormal(g: Phaser.GameObjects.Graphics, bodyColor: number = 0x2244aa): void {
    // ── Legs ── two dark navy rects below body, side by side
    g.fillStyle(0x1a3070, 1);
    const legW = 3; const legH = 8;
    g.fillRect(-4, 7, legW, legH);   // left leg
    g.fillRect(1,  7, legW, legH);   // right leg

    // ── Feet ── two small dark dots below legs
    g.fillStyle(0x1a0a04, 1);
    g.fillRect(-4, 7 + legH, 3, 2);  // left foot
    g.fillRect(1,  7 + legH, 3, 2);  // right foot

    // ── Body ── kurta-like rounded rect 10×14, centered (color parameterized)
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-5, -7, 10, 14, 2);

    // ── Arms ── two rects angled slightly out from body sides (color parameterized)
    g.fillStyle(bodyColor, 1);
    g.fillRect(-8, -5, 3, 7);   // left arm (angled out to the left)
    g.fillRect(5,  -4, 3, 7);   // right arm (angled out to the right)

    // ── Head ── light brown circle, 9px diameter (4.5px radius), above body
    g.fillStyle(0xc8956c, 1);
    g.fillCircle(0, -12, 4);

    // ── Hair ── small dark semicircle on top of head
    g.fillStyle(0x1a0a04, 1);
    // Draw as a half-circle arc fill: fillTriangle approximation for a semicircle cap
    // Use fillRect + fillCircle overlap trick: a rect covering the top half is cropped by
    // the head circle, so instead draw a smaller filled circle at the very top.
    g.fillCircle(0, -16, 3);

    // ── Eyes ── two 2×2px dark dots on the head
    g.fillStyle(0x1a1a1a, 1);
    g.fillRect(-2, -13, 2, 2);  // left eye
    g.fillRect(1,  -13, 2, 2);  // right eye
  }

  /**
   * SUSPICIOUS state — same as normal + yellow '?' above head.
   * All coordinates right-facing; scaleX handles mirroring.
   */
  private drawSuspicious(g: Phaser.GameObjects.Graphics): void {
    this.drawNormal(g);
    // Yellow question mark drawn as simple lines above head
    this.drawQuestionMark(g, 0, -24, 0xf5c842);
  }

  /**
   * ALERTED state — red-tinted body + '!' above head.
   * All coordinates right-facing; scaleX handles mirroring.
   */
  private drawAlerted(g: Phaser.GameObjects.Graphics): void {
    this.drawNormal(g, 0xaa2222);
    // ── Exclamation mark above head ──
    this.drawExclamationMark(g, 0, -24, 0xff4444);
  }

  /** Draw a '?' using line segments. cx/cy = center of the symbol. */
  private drawQuestionMark(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    color: number,
  ): void {
    g.lineStyle(2, color, 1);
    // Top arc of '?' — two short lines forming an arc approximation
    g.beginPath();
    g.moveTo(cx - 2, cy - 3);
    g.lineTo(cx + 2, cy - 3);
    g.lineTo(cx + 2, cy);
    g.lineTo(cx,     cy + 1);
    g.strokePath();
    // Dot below stem
    g.fillStyle(color, 1);
    g.fillRect(cx - 1, cy + 3, 2, 2);
  }

  /** Draw an '!' using line segments. cx/cy = center of the symbol. */
  private drawExclamationMark(
    g: Phaser.GameObjects.Graphics,
    cx: number,
    cy: number,
    color: number,
  ): void {
    g.lineStyle(2, color, 1);
    // Vertical stem
    g.beginPath();
    g.moveTo(cx, cy - 4);
    g.lineTo(cx, cy + 1);
    g.strokePath();
    // Dot
    g.fillStyle(color, 1);
    g.fillRect(cx - 1, cy + 3, 2, 2);
  }
}
