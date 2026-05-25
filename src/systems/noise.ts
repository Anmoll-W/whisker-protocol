// noise.ts — Surface noise system for Whisker Protocol
// Computes per-frame sound events based on player position and movement state.
// Pure math module: no Phaser imports.

/** Base noise radius in pixels at noiseLevel = 1.0 */
export const BASE_NOISE_RADIUS = 64;

/**
 * A sound event emitted by the player this frame.
 * Guards within `radius` pixels may hear the noise.
 */
export interface NoiseEvent {
  sourceX: number;
  sourceY: number;
  /** Pixels — guards within this radius may hear the sound */
  radius: number;
  /** 0–1 — sound level (reserved for future audio use, not detection logic) */
  intensity: number;
}

/**
 * Compute the noise event for the current frame.
 *
 * @param playerX  Player world X
 * @param playerY  Player world Y
 * @param noiseLevel  From Player.noiseLevel (tile.noiseMultiplier × speedMultiplier).
 *                    0 when FREEZE, standing still, or crouching in place.
 * @param baseNoiseRadius  Base radius at noiseLevel=1.0 (default: BASE_NOISE_RADIUS = 64px)
 * @returns A NoiseEvent, or null if the player is silent this frame.
 */
export function computeNoise(
  playerX: number,
  playerY: number,
  noiseLevel: number,
  baseNoiseRadius: number = BASE_NOISE_RADIUS,
): NoiseEvent | null {
  if (noiseLevel <= 0) {
    return null;
  }

  const radius = baseNoiseRadius * noiseLevel;
  const intensity = Math.min(noiseLevel, 1.0);

  return { sourceX: playerX, sourceY: playerY, radius, intensity };
}

/**
 * Check whether a guard can hear a given noise event.
 * Sound propagates through walls (no raycast — audio is omnidirectional).
 *
 * @param guardPos  Guard world position
 * @param noise     The noise event produced by computeNoise()
 * @returns true if the guard is within the noise radius
 */
export function canGuardHearNoise(
  guardPos: { x: number; y: number },
  noise: NoiseEvent,
): boolean {
  const dx = guardPos.x - noise.sourceX;
  const dy = guardPos.y - noise.sourceY;
  const distanceSq = dx * dx + dy * dy;
  return distanceSq <= noise.radius * noise.radius;
}
