// Single global RNG instance — never use Math.random() anywhere in the codebase
import Phaser from 'phaser';

let _rng: Phaser.Math.RandomDataGenerator | null = null;

export function initRNG(seed: string): void {
  if (_rng) return; // idempotent — seed is locked at game start, never overwritten mid-session
  _rng = new Phaser.Math.RandomDataGenerator([seed]);
}

export function getRNG(): Phaser.Math.RandomDataGenerator {
  if (!_rng) throw new Error('RNG not initialized — call initRNG(seed) first');
  return _rng;
}
