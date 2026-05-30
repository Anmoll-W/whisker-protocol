// noise.ts — Surface noise system for Whisker Protocol
// Computes per-frame sound events based on player position and movement state.
// Pure math module: no Phaser imports.

/** Base noise radius in pixels at noiseLevel = 1.0 */
export const BASE_NOISE_RADIUS = 64;

/** Default lifetime (ms) of a footstep noise event (one frame's worth of sound). */
export const FOOTSTEP_NOISE_DURATION_MS = 100;

/**
 * A sound event in the world.
 *
 * The design contract (R1.2) defines a noise event as `{radius, duration, position}`.
 * Here `position` is carried as `sourceX`/`sourceY` (a flat pair avoids an extra
 * allocation per frame for the footstep path). `duration` is how long the event
 * stays audible: a guard whose hearing range intersects the event at ANY point
 * during its lifetime reacts. `intensity` is reserved for audio mixing only and
 * never drives detection logic.
 *
 * Two producers:
 *   - `computeNoise()`  — continuous per-frame footstep noise (short duration).
 *   - a knocked `Prop`  — a single discrete event (long duration, wide radius),
 *                         emitted at t≈500ms post-contact (fairness buffer).
 */
export interface NoiseEvent {
  sourceX: number;
  sourceY: number;
  /** Pixels — guards within this radius may hear the sound */
  radius: number;
  /** Milliseconds the event remains audible after it is emitted */
  duration: number;
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

  return {
    sourceX: playerX,
    sourceY: playerY,
    radius,
    duration: FOOTSTEP_NOISE_DURATION_MS,
    intensity,
  };
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

// ── Active noise-event registry ────────────────────────────────────────────────
// Discrete events (a knocked prop) live for their `duration`. A guard whose
// hearing range intersects an active event AT ANY POINT during its lifetime
// reacts. This is what `duration` buys: the guard does not have to be in range
// on the single frame the prop lands. Pure data + time math — no Phaser.

/** A noise event with a remaining-lifetime counter, tracked frame to frame. */
export interface ActiveNoiseEvent {
  event: NoiseEvent;
  /** Milliseconds of audibility still remaining. Event is dropped at <= 0. */
  remainingMs: number;
}

/**
 * Wrap a freshly-emitted noise event for lifetime tracking.
 * `remainingMs` starts at the event's full `duration`.
 */
export function makeActiveNoise(event: NoiseEvent): ActiveNoiseEvent {
  return { event, remainingMs: event.duration };
}

/**
 * Advance a list of active noise events by `deltaMs`, dropping any whose
 * lifetime has expired. Returns a NEW filtered array (does not mutate input
 * entries beyond their `remainingMs`). Caller reassigns its list to the result.
 */
export function tickActiveNoises(
  actives: ActiveNoiseEvent[],
  deltaMs: number,
): ActiveNoiseEvent[] {
  const next: ActiveNoiseEvent[] = [];
  for (const a of actives) {
    a.remainingMs -= deltaMs;
    if (a.remainingMs > 0) next.push(a);
  }
  return next;
}
