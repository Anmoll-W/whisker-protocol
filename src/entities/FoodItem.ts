// FoodItem — Laddoo collectible entity
// A Phaser.GameObjects.Container drawing a golden Indian sweet.
// Player collects it by walking close; once collected it hides itself.

import Phaser from 'phaser';

export class FoodItem extends Phaser.GameObjects.Container {
  public collected: boolean = false;

  private gfx: Phaser.GameObjects.Graphics;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    super(scene, x, y);

    // Use make.graphics — avoids ghost render at world origin inside Containers.
    this.gfx = scene.make.graphics({});
    this.add(this.gfx);

    this.setDepth(5);
    this._draw();
  }

  /** Call when player overlaps this item. */
  collect(): void {
    this.collected = true;
    this.setVisible(false);
  }

  private _draw(): void {
    const g = this.gfx;
    g.clear();

    // Shadow — darker circle offset below/right to suggest ground shadow
    g.fillStyle(0x8b4a10, 1);
    g.fillCircle(2, 3, 8);

    // Base sphere — warm golden-orange laddoo body
    g.fillStyle(0xd4832a, 1);
    g.fillCircle(0, 0, 10);

    // Highlight spot — lighter, offset top-left for 3D roundness
    g.fillStyle(0xf0b060, 1);
    g.fillCircle(-3, -4, 4);

    // Subtle glow ring — draws attention without being garish
    g.lineStyle(2, 0xffe090, 0.5);
    g.strokeCircle(0, 0, 13);

    // Decorative dots — 4 tiny dots in a diamond pattern (sesame/sugar texture)
    g.fillStyle(0xf8d070, 1);
    g.fillRect(-1, -6, 2, 2);  // top
    g.fillRect(-1,  4, 2, 2);  // bottom
    g.fillRect(-6, -1, 2, 2);  // left
    g.fillRect( 4, -1, 2, 2);  // right
  }
}
