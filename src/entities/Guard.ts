// Guard — Nosy Chawl Neighbor
// A Phaser.GameObjects.Container holding a Graphics child that draws the guard.
// Patrols between world-space waypoints, idles briefly at each stop.
// All rendering is programmatic — no external sprites.
//
// All STATE and TIMER logic lives in the framework-free GuardBrain (@/systems/
// guard-brain). This entity is a thin view + movement wrapper: it feeds detection
// results into the brain, reads the brain's state + escalation modifiers back, and
// handles only Phaser-side concerns (movement, facing, rendering, the ALERTED event).

import Phaser from 'phaser';
import {
  GuardState,
  DEFAULT_GUARD_CONFIG,
  type GuardConfig,
} from '@/types/guard-types';
import { DEFAULT_CONE_CONFIG } from '@/systems/detection';
import { type DetectionResult } from '@/systems/detection';
import { GuardBrain } from '@/systems/guard-brain';
import { normalizeHeading, headingAngle } from '@/systems/heading';

/** Base search speed (px/s) — faster than normal patrol; scaled by escalation. */
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

  /** The pure decision core — owns state, timers, escalation. */
  private brain: GuardBrain;

  /**
   * Sprite-mirroring flag ONLY (left/right). Quantized to 1|-1 to drive
   * g.scaleX. It is deliberately NOT used to aim the detection cone — that would
   * collapse a vertical heading to a 45° diagonal. Derived from headingX.
   */
  private facingX: 1 | -1 = 1;

  /**
   * True facing as a UNIT vector. This is what aims the detection cone (via
   * facingAngle). Always normalized when set; defaults to facing right.
   */
  private headingX: number = 1;
  private headingY: number = 0;

  private idleTimer: number = 0;

  /** Waypoint index saved when leaving PATROL — restored on the clean return. */
  private savedWaypointIndex: number = 0;

  /** Time (ms) accumulator for "look around" pivot while SEARCHING. */
  private searchPivotTimer: number = 0;

  /** Track last drawn state + facing so we only redraw on change. */
  private lastDrawnState: GuardState | null = null;
  private lastDrawnFacing: 1 | -1 | null = null;
  private lastDrawnHeadingX: number = NaN;
  private lastDrawnHeadingY: number = NaN;

  /**
   * Set from GameScene when T8 (food carry mechanic) lands.
   * Increases effective detection range by 20% while true.
   */
  public playerCarryingFood: boolean = false;

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

    this.brain = new GuardBrain();
    // The brain fires this exactly once per alert cycle.
    this.brain.onAlerted = () => this.emit(Guard.EVENT_ALERTED, this);

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

  /**
   * Facing direction as radians: 0=right, π/2=down, π=left, -π/2=up.
   * Derived from the TRUE unit heading — never from the quantized facingX.
   */
  get facingAngle(): number {
    return headingAngle(this.headingX, this.headingY);
  }

  get guardState(): GuardState {
    return this.brain.state;
  }

  /** Current escalation level [0..2] — exposed for HUD / tail-as-HUD juice. */
  get escalationLevel(): number {
    return this.brain.escalationLevel;
  }

  /**
   * Effective main-cone half-angle (degrees), widened by escalation memory.
   * GameScene passes this into checkLineOfSight() each frame.
   */
  get effectiveConeHalfAngle(): number {
    return DEFAULT_CONE_CONFIG.halfAngle * this.brain.coneHalfAngleMult;
  }

  get effectiveConePeripheralHalfAngle(): number {
    return DEFAULT_CONE_CONFIG.peripheralHalfAngle * this.brain.coneHalfAngleMult;
  }

  /**
   * Last known player world position — proxied from the brain so existing
   * callers / tests that read it on the Guard keep working.
   */
  get lastKnownPosition(): { x: number; y: number } | null {
    return this.brain.lastKnownPosition;
  }

  /**
   * Triggered by GameScene when the guard hears a noise event.
   * Delegated to the brain, which handles the single-knock lure (PATROL →
   * SUSPICIOUS) AND escalation memory (a 2nd/3rd noise while already
   * investigating ramps the guard up). Save the patrol waypoint on the
   * PATROL/IDLE → SUSPICIOUS edge so the clean return resumes the route.
   */
  hearNoise(pos: { x: number; y: number }): void {
    const before = this.brain.state;
    if (before === GuardState.PATROL || before === GuardState.IDLE) {
      this.savedWaypointIndex = this.waypointIndex;
      // Face toward the noise so the investigation reads correctly.
      this.faceToward(pos.x, pos.y);
    }
    this.brain.hearNoise(pos);
  }

  // ── Public update — called by GameScene.update() each frame ─────────────────

  /**
   * Feed the latest detection result into the brain, then move according to the
   * resulting state. GameScene calls this once per frame (it replaces the old
   * split updateDetection()/update() pair).
   *
   * @param result    Latest cone result from checkLineOfSight()
   * @param delta     Frame delta in milliseconds
   * @param playerPos Current world position of Billu
   */
  tick(
    result: DetectionResult,
    delta: number,
    playerPos: { x: number; y: number },
  ): void {
    const prevState = this.brain.state;

    // Food-carry modifier: widen effective main-cone RANGE (angle handled by the
    // cone config GameScene already passes in). Recompute main-cone hit here.
    const effectiveMainRange = this.playerCarryingFood
      ? DEFAULT_CONE_CONFIG.range * 1.2
      : DEFAULT_CONE_CONFIG.range;
    const inMainOverride =
      result.inMainCone ||
      (result.distancePx <= effectiveMainRange &&
        Math.abs(result.angleFromFacing) <= this.effectiveConeHalfAngle &&
        !result.blockedByWall);

    this.brain.updateDetection(result, delta, playerPos, inMainOverride);

    // On the PATROL/IDLE → SUSPICIOUS edge caused by a SIGHTING (not a noise),
    // save the waypoint + face the player so the resume is clean.
    if (
      (prevState === GuardState.PATROL || prevState === GuardState.IDLE) &&
      this.brain.state === GuardState.SUSPICIOUS
    ) {
      this.savedWaypointIndex = this.waypointIndex;
      this.faceToward(playerPos.x, playerPos.y);
    }

    // Move according to the (just-updated) state.
    const dt = delta / 1000;
    switch (this.brain.state) {
      case GuardState.PATROL:
        this.tickPatrol(dt);
        break;
      case GuardState.IDLE:
        this.tickIdle(delta);
        break;
      case GuardState.SUSPICIOUS:
        // The single-knock lure: walk toward the noise. On arrival (Billu not
        // seen) the brain flips SUSPICIOUS → SEARCHING and the look-around begins.
        this.tickSuspicious(dt);
        break;
      case GuardState.ALERTED:
        // Hold position — facing already set toward the threat.
        break;
      case GuardState.SEARCHING:
        this.tickSearching(delta, dt);
        break;
    }

    // Redraw when state OR facing changed — facingX (mirror) OR heading (cone
    // aim, for future directional poses). Compare heading components, not the
    // quantized facingX alone, so a vertical re-aim still triggers a redraw.
    if (
      this.brain.state !== this.lastDrawnState ||
      this.facingX !== this.lastDrawnFacing ||
      this.headingX !== this.lastDrawnHeadingX ||
      this.headingY !== this.lastDrawnHeadingY
    ) {
      this.redraw();
    }
  }

  // ── Movement ticks ────────────────────────────────────────────────────────────

  /**
   * Point the guard at a world position. Normalizes (dx,dy) so the cone aims at
   * the true direction; falls back to the current heading for a zero vector.
   */
  private faceToward(wx: number, wy: number): void {
    this.setHeading(wx - this.x, wy - this.y);
  }

  /**
   * Set the true unit heading (cone aim) from a raw direction vector and derive
   * the sprite-mirroring facingX from it. A (near) zero vector keeps the current
   * heading. Single source of truth for facing — every tick that turns the guard
   * routes through here so the cone and the sprite never disagree.
   */
  private setHeading(dx: number, dy: number): void {
    const h = normalizeHeading(dx, dy);
    if (h === null) return;
    this.headingX = h.x;
    this.headingY = h.y;
    this.facingX = h.x >= 0 ? 1 : -1;
  }

  private tickPatrol(dt: number): void {
    if (this.waypoints.length === 0) return;

    const target = this.waypoints[this.waypointIndex];
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= this.cfg.waypointReachThreshold) {
      this.x = target.x;
      this.y = target.y;
      this.idleTimer = this.cfg.idleDuration;
      this.brain.forceState(GuardState.IDLE);
      return;
    }

    const nx = dx / dist;
    const ny = dy / dist;
    this.x += nx * this.cfg.patrolSpeed * dt;
    this.y += ny * this.cfg.patrolSpeed * dt;

    this.setHeading(nx, ny);
  }

  private tickIdle(delta: number): void {
    this.idleTimer -= delta;
    if (this.idleTimer <= 0) {
      this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
      this.brain.forceState(GuardState.PATROL);
    }
  }

  /**
   * Walk toward `target` at the escalation-scaled search speed, aiming the
   * heading along the path. Returns true once within SEARCH_REACH_THRESHOLD.
   * Shared by SUSPICIOUS (approach the noise) and SEARCHING (walk to the spot).
   */
  private walkToward(target: { x: number; y: number }, dt: number): boolean {
    const dx = target.x - this.x;
    const dy = target.y - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist <= SEARCH_REACH_THRESHOLD) return true;

    const nx = dx / dist;
    const ny = dy / dist;
    const speed = SEARCH_SPEED * this.brain.searchSpeedMult;
    this.x += nx * speed * dt;
    this.y += ny * speed * dt;
    this.setHeading(nx, ny);
    return false;
  }

  /**
   * SUSPICIOUS = approach the noise (the single-knock lure). Walk toward
   * lastKnownPosition; on arrival with Billu unseen, hand off to the brain which
   * flips SUSPICIOUS → SEARCHING. A sighting mid-approach is handled by the brain
   * in updateDetection() (→ ALERTED) before this ever runs.
   */
  private tickSuspicious(dt: number): void {
    const lastKnown = this.brain.lastKnownPosition;
    // No target to investigate (shouldn't happen via the lure path) — let the
    // brain's cooldown run its course; nothing to walk to.
    if (lastKnown === null) return;

    if (this.walkToward(lastKnown, dt)) {
      // Arrived at the noise, Billu not in sight → begin the look-around search.
      this.brain.reachedInvestigation();
      this.searchPivotTimer = 0;
    }
  }

  // delta: raw ms (timers); dt: seconds (movement). Search speed scales with escalation.
  private tickSearching(delta: number, dt: number): void {
    const lastKnown = this.brain.lastKnownPosition;
    if (lastKnown === null) {
      this.waypointIndex = this.savedWaypointIndex;
      this.brain.forceState(GuardState.PATROL);
      return;
    }

    if (!this.brain.searchReached) {
      if (this.walkToward(lastKnown, dt)) {
        this.brain.markSearchReached();
        this.searchPivotTimer = 0;
      }
    } else {
      // At the position — "look around" by pivoting. The countdown + the
      // SEARCHING → PATROL revert are owned by the brain; when it flips back to
      // PATROL we restore the patrol route.
      this.searchPivotTimer += delta;
      if (this.searchPivotTimer >= SEARCH_PIVOT_INTERVAL) {
        this.searchPivotTimer -= SEARCH_PIVOT_INTERVAL;
        // Flip the horizontal heading to "look around" the spot.
        this.setHeading(-this.facingX, 0);
      }
    }

    if (this.brain.state === GuardState.PATROL) {
      // Brain timed out the search — resume the saved patrol route.
      this.waypointIndex = this.savedWaypointIndex;
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────
  private redraw(): void {
    this.lastDrawnState = this.brain.state;
    this.lastDrawnFacing = this.facingX;
    this.lastDrawnHeadingX = this.headingX;
    this.lastDrawnHeadingY = this.headingY;

    const g = this.gfx;
    g.clear();

    // Mirror the entire Graphics object when facing left.
    g.scaleX = this.facingX;

    switch (this.brain.state) {
      case GuardState.PATROL:
      case GuardState.IDLE:
        this.drawNormal(g, 0x1a3a8a);
        break;
      case GuardState.SUSPICIOUS:
        this.drawSuspicious(g);
        break;
      case GuardState.ALERTED:
        this.drawAlerted(g);
        break;
      case GuardState.SEARCHING:
        this.drawNormal(g, 0xaa4400);
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
  private drawNormal(g: Phaser.GameObjects.Graphics, bodyColor: number = 0x1a3a8a): void {
    // ── Ground shadow ──
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(0, 20, 30, 8);

    // ── Legs — two dark trouser legs ──
    g.fillStyle(0x1a2a50, 1);
    g.fillRoundedRect(-10, 14, 9, 18, 3);   // left leg
    g.fillRoundedRect(2,   14, 9, 18, 3);   // right leg

    // ── Kurta body — outline then fill ──
    g.fillStyle(0x102870, 1);
    g.fillRoundedRect(-14, -12, 30, 30, 4);  // dark outline
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-13, -11, 28, 28, 3);  // fill

    // ── Kurta V-collar ──
    g.fillStyle(0xffffff, 0.6);
    g.fillTriangle(0, -11, -4, -3, 4, -3);

    // ── Kurta button strip (center seam) ──
    g.fillStyle(0x102870, 1);
    g.fillRect(-1, -8, 2, 20);

    // ── Arms ──
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-16, -8, 6, 20, 3);   // left arm
    g.fillRoundedRect(12,  -8, 6, 20, 3);   // right arm

    // ── Hands ──
    g.fillStyle(0xc8926a, 1);
    g.fillCircle(-13, 13, 5);  // left hand
    g.fillCircle(15,  13, 5);  // right hand

    // ── Head — outline then skin fill ──
    g.fillStyle(0x331100, 1);
    g.fillCircle(0, -26, 13);  // dark outline ring
    g.fillStyle(0xc8926a, 1);
    g.fillCircle(0, -26, 12);  // skin

    // ── Hair — dark cap on top of head ──
    g.fillStyle(0x1a1008, 1);
    g.fillEllipse(0, -36, 22, 10);

    // ── Ears ──
    g.fillStyle(0xa87050, 1);
    g.fillCircle(-13, -26, 4);  // left ear
    g.fillCircle(13,  -26, 4);  // right ear

    // ── Eyes with highlight ──
    g.fillStyle(0x1a1a1a, 1);
    g.fillCircle(-5, -27, 3);   // left eye
    g.fillCircle(5,  -27, 3);   // right eye
    g.fillStyle(0xffffff, 1);
    g.fillCircle(-4, -28, 1);   // left eye highlight
    g.fillCircle(6,  -28, 1);   // right eye highlight

    // ── Mustache ──
    g.fillStyle(0x1a1008, 1);
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
    const color = 0xf5c842;
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
    this.drawNormal(g, 0xaa2222);

    // Double exclamation marks above head
    g.fillStyle(0xff4400, 1);
    g.fillRect(6,  -50, 3, 10);  // "!" mark 1 body
    g.fillRect(6,  -38, 3, 3);   // "!" mark 1 dot
    g.fillRect(12, -50, 3, 10);  // "!" mark 2 body
    g.fillRect(12, -38, 3, 3);   // "!" mark 2 dot
  }
}
