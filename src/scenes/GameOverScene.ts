// GameOverScene — overlay shown when the guard reaches ALERTED state.
// Launched in parallel on top of a paused GameScene; never replaces it.

import Phaser from 'phaser';
import { restartGame } from '@/systems/scene-transition';

const W = 640;
const H = 480;

export class GameOverScene extends Phaser.Scene {
  constructor() {
    super({ key: 'GameOverScene' });
  }

  create(): void {
    // Pin to screen origin — not the game-world camera offset
    this.cameras.main.setScroll(0, 0);

    // ── Dark warm overlay ────────────────────────────────────────────────────
    const bg = this.add.graphics();
    bg.fillStyle(0x1a0800, 0.85);
    bg.fillRect(0, 0, W, H);
    bg.setDepth(0);

    // ── Cat silhouette (Billu, defeated) ─────────────────────────────────────
    const cat = this.add.graphics();
    cat.fillStyle(0xff6622, 0.4);
    // Body — large circle
    cat.fillCircle(W / 2, 120, 40);
    // Head — medium circle
    cat.fillCircle(W / 2, 80, 22);
    // Tail — arc drawn as a wedge approximation using a filled circle offset
    cat.fillCircle(W / 2 + 50, 135, 12);
    cat.fillCircle(W / 2 + 62, 122, 9);
    cat.fillCircle(W / 2 + 68, 108, 7);
    cat.setDepth(1);

    // ── Main text ────────────────────────────────────────────────────────────
    const mainText = this.add.text(W / 2, H * 0.40, 'PAKAD LIYA!', {
      fontFamily: 'monospace',
      fontSize: '52px',
      fontStyle: 'bold',
      color: '#ff4422',
      shadow: {
        offsetX: 3,
        offsetY: 3,
        color: '#440000',
        blur: 4,
        fill: true,
      },
    });
    mainText.setOrigin(0.5, 0.5);
    mainText.setDepth(2);

    // ── Subtitle ─────────────────────────────────────────────────────────────
    const subText = this.add.text(W / 2, H * 0.50, 'Woh dekh liya...', {
      fontFamily: 'monospace',
      fontSize: '18px',
      fontStyle: 'italic',
      color: '#ff9966',
    });
    subText.setOrigin(0.5, 0);
    subText.setDepth(2);

    // ── Restart button ───────────────────────────────────────────────────────
    const btnX = W / 2;
    const btnY = H * 0.65;
    const btnW = 280;
    const btnH = 48;

    const btnBg = this.add.graphics();
    btnBg.setDepth(2);

    const drawBtn = (hovered: boolean): void => {
      btnBg.clear();
      btnBg.fillStyle(hovered ? 0x3d1a00 : 0x2a1200);
      btnBg.fillRoundedRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH, 8);
      btnBg.lineStyle(2, 0xff6622);
      btnBg.strokeRoundedRect(btnX - btnW / 2, btnY - btnH / 2, btnW, btnH, 8);
    };
    drawBtn(false);

    const btnText = this.add.text(btnX, btnY, 'PHIR KOSHISH KAR', {
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
    restartGame(this, 'GameOverScene');
  }
}
