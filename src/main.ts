import Phaser from 'phaser';
import { BootScene } from '@/scenes/BootScene';
import { initRNG } from '@/systems/rng';

// Initialize seeded RNG before game starts
// Seed can be overridden via URL param ?seed=... for reproducible runs
const urlSeed = new URLSearchParams(window.location.search).get('seed') ?? 'whisker-001';
initRNG(urlSeed);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: 480,
  height: 320,
  backgroundColor: '#1a1a2e',
  scene: [BootScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  // YouTube Playables: audio must be muted on load
  audio: {
    disableWebAudio: __PLAYABLES__,
  },
};

new Phaser.Game(config);
