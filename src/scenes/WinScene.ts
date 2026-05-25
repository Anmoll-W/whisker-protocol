// WinScene — celebratory overlay shown when player reaches the exit with the laddoo.
// Launched in parallel on top of a paused GameScene; never replaces it.
// Architecture mirrors GameOverScene exactly.

import Phaser from 'phaser';
import { getRNG } from '@/systems/rng';

const W = 640;
const H = 480;

const CONFETTI_COLORS = [0xff6622, 0xffd700, 0x22cc44, 0x4488ff, 0xff44aa];
const CONFETTI_COUNT = 15;

export class WinScene extends Phaser.Scene {
  constructor() {
    super({ key: 'WinScene' });
  }

  create(): void {
    // Pin to screen origin — not the game-world camera offset
    this.cameras.main.setScroll(0, 0);

    // ── Deep dark green overlay ───────────────────────────────────────────────
    const bg = this.add.graphics();
    bg.fillStyle(0x001a00, 0.85);
    bg.fillRect(0, 0, W, H);
    bg.setDepth(0);

    // ── Confetti — 15 colored 6×6px rectangles at seeded random positions ────
    const rng = getRNG();
    const confetti = this.add.graphics();
    confetti.setDepth(1);
    for (let i = 0; i < CONFETTI_COUNT; i++) {
      const cx = rng.between(0, W);
      const cy = rng.between(0, H);
      const color = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      confetti.fillStyle(color, 0.85);
      confetti.fillRect(cx, cy, 6, 6);
    }

    // ── Main text ─────────────────────────────────────────────────────────────
    const mainText = this.add.text(W / 2, H * 0.38, 'NIKAL GAYA!', {
      fontFamily: 'monospace',
      fontSize: '52px',
      fontStyle: 'bold',
      color: '#44ff88',
      shadow: {
        offsetX: 3,
        offsetY: 3,
        color: '#004400',
        blur: 4,
        fill: true,
      },
    });
    mainText.setOrigin(0.5, 0.5);
    mainText.setDepth(2);

    // ── Subtitle ──────────────────────────────────────────────────────────────
    const subText = this.add.text(W / 2, H * 0.49, 'Sab kuch le gaya...', {
      fontFamily: 'monospace',
      fontSize: '18px',
      fontStyle: 'italic',
      color: '#88ffaa',
    });
    subText.setOrigin(0.5, 0);
    subText.setDepth(2);

    // ── Score line ────────────────────────────────────────────────────────────
    const scoreLine = this.add.text(W / 2, H * 0.57, 'Laddoo mila! 🍬', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffd700',
    });
    scoreLine.setOrigin(0.5, 0);
    scoreLine.setDepth(2);

    // ── Play again button ─────────────────────────────────────────────────────
    const btnX = W / 2;
    const btnY = H * 0.72;
    const btnW = 280;
    const btnH = 48;

    const btnBg = this.add.graphics();
    btnBg.setDepth(2);

    const drawBtn = (hovered: boolean): void => {
      btnBg.clear();
      btnBg.fillStyle(hovered ? 0x004400 : 0x002200);
      btnBg.fillRoundedRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH, 8);
      btnBg.lineStyle(2, 0x44ff88);
      btnBg.strokeRoundedRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH, 8);
    };
    drawBtn(false);

    const btnText = this.add.text(btnX, btnY, 'EK AUR BAAR', {
      fontFamily: 'monospace',
      fontSize: '20px',
      fontStyle: 'bold',
      color: '#ffffff',
    });
    btnText.setOrigin(0.5, 0.5);
    btnText.setDepth(3);

    // Hit zone on top — interactive region over button area
    const hitZone = this.add.zone(btnX, btnY, btnW, btnH);
    hitZone.setInteractive({ useHandCursor: true });
    hitZone.setDepth(4);

    hitZone.on('pointerover', () => drawBtn(true));
    hitZone.on('pointerout', () => drawBtn(false));
    hitZone.on('pointerdown', () => this._restart());
  }

  private _restart(): void {
    this.scene.stop('WinScene');
    this.scene.stop('GameScene');
    this.scene.start('GameScene');
  }
}
