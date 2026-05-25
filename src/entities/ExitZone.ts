// ExitZone — locked/unlocked exit target for the player.
// Locked: dim gray dashed border + padlock icon.
// Unlocked: glowing gold border + arrow + "NIKAL!" text + pulsing tween.

import Phaser from 'phaser';

const ZONE_SIZE = 40;
const HALF = ZONE_SIZE / 2;

export class ExitZone extends Phaser.GameObjects.Container {
  public isUnlocked: boolean = false;

  private gfx: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text | null = null;
  private pulseTween: Phaser.Tweens.Tween | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);

    this.gfx = scene.make.graphics({});
    this.add(this.gfx);

    this.setDepth(5);
    this._drawLocked();
  }

  /** Switches to UNLOCKED state and starts breathing glow tween. */
  unlock(): void {
    if (this.isUnlocked) return;
    this.isUnlocked = true;

    // Remove locked label if present
    if (this.label) {
      this.label.destroy();
      this.label = null;
    }

    this._drawUnlocked();

    // "NIKAL!" text floating above
    this.label = this.scene.add.text(this.x, this.y - HALF - 14, 'NIKAL!', {
      fontFamily: 'monospace',
      fontSize: '14px',
      fontStyle: 'bold',
      color: '#ffd700',
    });
    this.label.setOrigin(0.5, 1);
    this.label.setDepth(6);

    // Breathing glow — pulsing alpha on this Container
    this.pulseTween = this.scene.tweens.add({
      targets: this,
      alpha: { from: 0.7, to: 1.0 },
      duration: 600,
      yoyo: true,
      repeat: -1,
    });
  }

  private _drawLocked(): void {
    const g = this.gfx;
    g.clear();

    // Overall dim appearance
    this.setAlpha(0.6);

    // Dashed border — 4 short line segments simulating a dashed rectangle
    g.lineStyle(2, 0x666666, 0.5);
    const dash = 8;
    const gap = 4;
    // Top edge
    for (let i = -HALF; i < HALF; i += dash + gap) {
      g.beginPath();
      g.moveTo(i, -HALF);
      g.lineTo(Math.min(i + dash, HALF), -HALF);
      g.strokePath();
    }
    // Bottom edge
    for (let i = -HALF; i < HALF; i += dash + gap) {
      g.beginPath();
      g.moveTo(i, HALF);
      g.lineTo(Math.min(i + dash, HALF), HALF);
      g.strokePath();
    }
    // Left edge
    for (let i = -HALF; i < HALF; i += dash + gap) {
      g.beginPath();
      g.moveTo(-HALF, i);
      g.lineTo(-HALF, Math.min(i + dash, HALF));
      g.strokePath();
    }
    // Right edge
    for (let i = -HALF; i < HALF; i += dash + gap) {
      g.beginPath();
      g.moveTo(HALF, i);
      g.lineTo(HALF, Math.min(i + dash, HALF));
      g.strokePath();
    }

    // Padlock body — small rounded rect
    g.fillStyle(0x888888, 1);
    g.fillRoundedRect(-6, -2, 12, 10, 2);

    // Padlock arch — arc on top of body
    g.lineStyle(3, 0x666666, 1);
    g.beginPath();
    g.arc(0, -2, 5, Math.PI, 2 * Math.PI, false);
    g.strokePath();
  }

  private _drawUnlocked(): void {
    const g = this.gfx;
    g.clear();

    this.setAlpha(1.0);

    // Glowing gold border
    g.lineStyle(3, 0xffd700, 0.9);
    g.strokeRect(-HALF, -HALF, ZONE_SIZE, ZONE_SIZE);

    // Upward chevron arrow in center — two lines meeting at top point
    g.lineStyle(3, 0xffd700, 1);
    g.beginPath();
    g.moveTo(-8, 6);
    g.lineTo(0, -6);
    g.lineTo(8, 6);
    g.strokePath();
  }

  /** Clean up label and tween when scene restarts. */
  destroy(fromScene?: boolean): void {
    if (this.pulseTween) {
      this.pulseTween.stop();
      this.pulseTween = null;
    }
    if (this.label) {
      this.label.destroy();
      this.label = null;
    }
    super.destroy(fromScene);
  }
}
