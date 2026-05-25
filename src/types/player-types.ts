// Player state types for Whisker Protocol — Billu the Desi street cat

export enum PlayerState {
  WALK = 'WALK',
  CROUCH = 'CROUCH',
  FREEZE = 'FREEZE',
}

export interface PlayerConfig {
  /** Walk speed in pixels per second */
  walkSpeed: number;
  /** Crouch speed in pixels per second */
  crouchSpeed: number;
  /** Half-width of collision hitbox (centered on player origin) */
  hitboxHalfW: number;
  /** Half-height of collision hitbox (centered on player origin) */
  hitboxHalfH: number;
}

export const DEFAULT_PLAYER_CONFIG: PlayerConfig = {
  walkSpeed: 96,
  crouchSpeed: 48,
  hitboxHalfW: 6,
  hitboxHalfH: 6,
};
