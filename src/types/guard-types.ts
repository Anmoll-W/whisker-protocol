// Guard state types for Whisker Protocol — Nosy Chawl Neighbor guard

export enum GuardState {
  PATROL = 'PATROL',
  IDLE = 'IDLE',
  SUSPICIOUS = 'SUSPICIOUS', // placeholder — Task 4
  ALERTED = 'ALERTED',       // placeholder — Task 5
  SEARCHING = 'SEARCHING',   // placeholder — Task 5
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
