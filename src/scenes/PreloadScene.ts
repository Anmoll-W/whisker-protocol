import Phaser from 'phaser';

// Stub — wired up in Week 2 when Tiled maps + sprites load here
// Load order: BootScene → PreloadScene → GameScene
// Tiled maps: put in public/maps/ (not src/assets/) to bypass Vite filename hashing
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload(): void {
    // this.load.tilemapTiledJSON('chawl-kitchen', '/maps/chawl-kitchen.json');
    // this.load.image('chawl-tiles', '/sprites/chawl-tileset.png');
  }

  create(): void {
    this.scene.start('GameScene');
  }
}
