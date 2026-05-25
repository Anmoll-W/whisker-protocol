// Guard — Nosy Chawl Neighbor
// A Phaser.GameObjects.Container holding a Graphics child that draws the guard.
// Patrols between world-space waypoints, idles briefly at each stop.
// All rendering is programmatic — no external sprites.

import Phaser from 'phaser';
import { GuardState, DEFAULT_GUARD_CONFIG, type GuardConfig } from '@/types/guard-types';

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

  /** Track last drawn state + facing so we only redraw on change. */
  private lastDrawnState: GuardState | null = null;
  private lastDrawnFacing: 1 | -1 | null = null;

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

  // ── Public API (Task 4 will use these) ──────────────────────────────────────

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
      // Placeholder states — no behavior yet
      case GuardState.SUSPICIOUS:
      case GuardState.ALERTED:
      case GuardState.SEARCHING:
        break;
    }

    // Redraw only when state or facing changed
    if (this._state !== this.lastDrawnState || this.facingX !== this.lastDrawnFacing) {
      this.redraw();
    }
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
        // TODO(T5): add distinct visual — currently renders same as PATROL
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
