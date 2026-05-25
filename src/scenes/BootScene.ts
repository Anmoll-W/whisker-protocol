import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Placeholder: preload global assets here in future phases
  }

  create(): void {
    console.log('Whisker Protocol boot OK');
    this.scene.start('PreloadScene');
  }
}
