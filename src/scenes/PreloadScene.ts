import Phaser from 'phaser';

// PreloadScene — loads the data + art the playable level needs, then starts it.
// Load order: BootScene → PreloadScene → GameScene
//
// Assets live in public/ (served at site root, no Vite filename hashing):
//   • public/sprites/billu.{png,json} — the Billu texture atlas (frame-key schema,
//     emitted by tools/billu.py --atlas). Loaded once here; rendered by Player.
//   • public/levels/level2.json — the data-driven level (LevelLoader parses it).
export class PreloadScene extends Phaser.Scene {
  constructor() {
    super({ key: 'PreloadScene' });
  }

  preload(): void {
    this.load.atlas('billu', '/sprites/billu.png', '/sprites/billu.json');
    // Composed, lit chawl tile + scene-object atlas (tools/tiles.py). Tiles render
    // the level as a depth-layered golden-hour chawl, not flat programmatic rects.
    this.load.atlas('chawl', '/sprites/chawl_tiles.png', '/sprites/chawl_tiles.json');
    this.load.json('level2', '/levels/level2.json');

    // Audio — wired to game events (knock, collect, caught, guard stings).
    // OGG everywhere; the runtime resumes the AudioContext on first input (iOS-safe).
    this.load.audio('footstep', '/audio/footstep.ogg');
    this.load.audio('footstep_clay', '/audio/footstep_clay.ogg');
    this.load.audio('footstep_marble', '/audio/footstep_marble.ogg');
    this.load.audio('footstep_water', '/audio/footstep_water.ogg');
    this.load.audio('footstep_carpet', '/audio/footstep_carpet.ogg');
    this.load.audio('brass_clang', '/audio/brass_clang.ogg');
    this.load.audio('clay_shatter', '/audio/clay_shatter.ogg');
    this.load.audio('collect_chime', '/audio/collect_chime.ogg');
    this.load.audio('caught_thud', '/audio/caught_thud.ogg');
    this.load.audio('guard_suspicious', '/audio/guard_suspicious.ogg');
    this.load.audio('guard_searching', '/audio/guard_searching.ogg');
    this.load.audio('guard_alerted', '/audio/guard_alerted.ogg');
    this.load.audio('exit_fanfare', '/audio/exit_fanfare.ogg');
  }

  create(): void {
    this.scene.start('GameScene');
  }
}
