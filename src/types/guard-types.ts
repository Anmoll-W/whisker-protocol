// Guard state types for Whisker Protocol — Nosy Chawl Neighbor guard

export enum GuardState {
  PATROL = 'PATROL',
  IDLE = 'IDLE',
  SUSPICIOUS = 'SUSPICIOUS',
  ALERTED = 'ALERTED',
  SEARCHING = 'SEARCHING',
}

export interface GuardConfig {
  /** Patrol speed in pixels per second */
  patrolSpeed: number;
  /** Distance threshold (px) to consider waypoint reached */
  waypointReachThreshold: number;
  /** Time to idle at each waypoint in milliseconds */
  idleDuration: number;
}

export const DEFAULT_GUARD_CONFIG: GuardConfig = {
  patrolSpeed: 56,
  waypointReachThreshold: 4,
  idleDuration: 1800,
};

// ── Alert state machine thresholds ──────────────────────────────────────────

/** Milliseconds continuously in main cone before SUSPICIOUS → ALERTED */
export const SUSPICIOUS_TO_ALERTED_MS = 1500;

/** Milliseconds out of ALL cones before SUSPICIOUS reverts → PATROL */
export const SUSPICIOUS_COOLDOWN_MS = 500;

/** Milliseconds SEARCHING before giving up and reverting → PATROL */
export const SEARCH_DURATION_MS = 10000;

// ── Peripheral-glimpse detection (P0 fix — the `_peripheralTime` accumulator) ──

/**
 * Milliseconds Billu must remain continuously in the cone's PERIPHERY before the
 * guard catches a glimpse and turns SUSPICIOUS. A peripheral glimpse is a softer
 * trigger than the main cone (which drives ALERTED), so the threshold is well
 * above one frame — a player who only clips the edge for an instant is not seen.
 */
export const PERIPHERAL_TO_SUSPICIOUS_MS = 600;

/**
 * Decay rate of `_peripheralTime` while Billu is OUT of the periphery, expressed
 * as a multiplier on frame delta. 2.0 means the accumulator drains at twice the
 * rate it filled — a brief flicker through the edge does not bank toward SUSPICIOUS.
 */
export const PERIPHERAL_DECAY_FACTOR = 2.0;

// ── Escalation memory (R1.5) ────────────────────────────────────────────────────

/**
 * Milliseconds with NO new noise reaching an investigating guard before his
 * escalation level resets to 0 (a "clean interval"). Tracked while SUSPICIOUS or
 * SEARCHING; any fresh noise within this window bumps escalation up one level.
 */
export const ESCALATION_RESET_MS = 4000;

/** Highest escalation level. Level 0 = calm; each noise adds 1 up to this cap. */
export const MAX_ESCALATION_LEVEL = 2;

/** Per-escalation-level search-speed multiplier (faster move when escalated). */
export const ESCALATION_SPEED_MULT = [1.0, 1.35, 1.7] as const;

/** Per-escalation-level cone half-angle multiplier (wider cone when escalated). */
export const ESCALATION_CONE_MULT = [1.0, 1.25, 1.5] as const;

/** Per-escalation-level investigate-duration multiplier (longer search when escalated). */
export const ESCALATION_INVESTIGATE_MULT = [1.0, 1.5, 2.0] as const;
