// Prop — a knockable Cat Chaos object (R1.1 / R1.2). THE hero verb's target.
//
// Lifecycle (single knock; cascade R1.4 is OUT of scope in this slice):
//   IDLE ──knock()──▶ FALLING ──(after fall)──▶ noise emitted at t≈500ms ──▶ SETTLED
//
// The noise event {radius, duration, position} is emitted at t≈500ms post-contact
// — the fairness buffer from whisker-protocol-bat-choreography.md (sound "travels
// through the chawl"). Emitting at impact would let guards react before the player
// hears the crash, which reads as unfair. The Prop reports its emitted event to
// GameScene via the onNoise callback, which registers it in the active-noise list.
//
// All rendering is programmatic — no external sprites.

import Phaser from 'phaser';
import { PropType, PROP_CLASS, NOISE_EMIT_DELAY_MS } from '@/types/prop-types';
import { type NoiseEvent } from '@/systems/noise';

enum PropPhase {
  IDLE = 'IDLE',
  FALLING = 'FALLING',
  SETTLED = 'SETTLED',
}

/** ms from contact to the prop reaching the floor (the visible fall). */
const FALL_DURATION_MS = 250;

/** Pixels the prop drops from its ledge to the floor. */
const FALL_DISTANCE_PX = 28;

export class Prop extends Phaser.GameObjects.Container {
  public readonly propType: PropType;

  private gfx: Phaser.GameObjects.Graphics;
  private phase: PropPhase = PropPhase.IDLE;

  /** ms elapsed since knock() was called (contact = t=0). */
  private elapsed = 0;

  /** Original resting Y (top of the fall). */
  private readonly baseY: number;

  /** Whether the single noise event has been emitted yet. */
  private noiseEmitted = false;

  /**
   * Called once when the prop emits its noise event (at t≈500ms post-contact).
   * GameScene wires this to register the event in the active-noise registry.
   */
  public onNoise: ((event: NoiseEvent) => void) | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, propType: PropType) {
    super(scene, x, y);
    this.propType = propType;
    this.baseY = y;

    this.gfx = scene.make.graphics({});
    this.add(this.gfx);
    this.setDepth(6);
    this.draw();
  }

  /** True once the prop has been knocked (no longer battable). */
  get knocked(): boolean {
    return this.phase !== PropPhase.IDLE;
  }

  /**
   * Bat the prop. Single-knock only: a no-op if already knocked. Starts the fall;
   * the noise event fires later in update() at t≈500ms.
   */
  knock(): void {
    if (this.phase !== PropPhase.IDLE) return;
    this.phase = PropPhase.FALLING;
    this.elapsed = 0;
  }

  /** Advance the fall + noise timeline. Call from GameScene.update() each frame. */
  update(delta: number): void {
    // Destroyed (consumed) props leave the update loop — guard against a stray
    // post-destroy tick from a caller still holding the reference.
    if (!this.active) return;
    if (this.phase === PropPhase.IDLE) return;

    this.elapsed += delta;

    // ── Visible fall (0 .. FALL_DURATION_MS) ──
    if (this.phase === PropPhase.FALLING) {
      const t = Math.min(this.elapsed / FALL_DURATION_MS, 1);
      // Ease-in (gravity-like) drop.
      this.y = this.baseY + FALL_DISTANCE_PX * t * t;
      if (t >= 1) {
        this.phase = PropPhase.SETTLED;
        this.draw(); // settled pose (e.g. shatter for clay)
      }
    }

    // ── Noise emission at the fairness buffer (t≈500ms), once ──
    if (!this.noiseEmitted && this.elapsed >= NOISE_EMIT_DELAY_MS) {
      this.noiseEmitted = true;
      const spec = PROP_CLASS[this.propType];
      // Capture the emit position BEFORE any destroy so the noise fires from the
      // settled spot even when the prop is consumed on the same frame.
      const event: NoiseEvent = {
        sourceX: this.x,
        sourceY: this.y,
        radius: spec.noiseRadiusPx,
        duration: spec.noiseDurationMs,
        intensity: 1,
      };
      this.onNoise?.(event);

      if (spec.consumedOnContact) {
        // Clay shatters — REMOVE it from the scene once it has done its job (made
        // the noise). destroy() takes it out of the update loop and frees its
        // Graphics; setVisible(false) alone would leave it ticking forever.
        this.destroy();
        return;
      }
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────────
  private draw(): void {
    const g = this.gfx;
    g.clear();
    const spec = PROP_CLASS[this.propType];

    // Ground shadow.
    g.fillStyle(0x000000, 0.2);
    g.fillEllipse(0, 12, 18, 5);

    if (this.phase === PropPhase.SETTLED && spec.consumedOnContact) {
      // Shattered remains — a few shards.
      g.fillStyle(spec.color, 1);
      g.fillTriangle(-6, 8, -2, 2, 0, 9);
      g.fillTriangle(2, 9, 6, 3, 8, 10);
      g.fillTriangle(-1, 6, 3, 1, 4, 7);
      return;
    }

    // Body — a simple vessel/bottle silhouette tinted by class.
    g.fillStyle(0x000000, 0.35);
    g.fillRoundedRect(-9, -11, 18, 24, 4); // outline
    g.fillStyle(spec.color, 1);
    g.fillRoundedRect(-8, -10, 16, 22, 3);

    // Neck / lip detail.
    g.fillStyle(spec.color, 1);
    g.fillRect(-4, -15, 8, 6);

    // Highlight for roundness.
    g.fillStyle(0xffffff, 0.25);
    g.fillEllipse(-3, -4, 5, 9);
  }
}
