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
