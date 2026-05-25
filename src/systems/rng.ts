// Single global RNG instance — never use Math.random() anywhere in the codebase
import Phaser from 'phaser';

let _rng: Phaser.Math.RandomDataGenerator | null = null;

export function initRNG(seed: string): void {
  _rng = new Phaser.Math.RandomDataGenerator([seed]);
}

export function getRNG(): Phaser.Math.RandomDataGenerator {
  if (!_rng) throw new Error('RNG not initialized — call initRNG(seed) first');
  return _rng;
}
