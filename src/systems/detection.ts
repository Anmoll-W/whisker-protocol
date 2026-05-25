// detection.ts — Line-of-sight detection cone for Whisker Protocol
// Computes whether the player is visible to the guard: within cone angle + range
// AND not blocked by a wall tile.

import { TileMap, TILE_SIZE } from '@/entities/TileMap';

// ── Cone configuration ────────────────────────────────────────────────────────

export interface ConeConfig {
  /** Maximum detection range in pixels (main cone) */
  range: number;
  /** Half-angle of the main cone in degrees (full width = 2 × halfAngle) */
  halfAngle: number;
  /** Peripheral ring max range in pixels */
  peripheralRange: number;
  /** Half-angle of peripheral zone in degrees (outside main cone, within this) */
  peripheralHalfAngle: number;
}

export const DEFAULT_CONE_CONFIG: ConeConfig = {
  range: 160,
  halfAngle: 45,
  peripheralRange: 80,
  peripheralHalfAngle: 90,
};

// ── Detection result ──────────────────────────────────────────────────────────

export interface DetectionResult {
  /** Player is within main cone (angle + range) and LOS is not blocked */
  inMainCone: boolean;
  /** Player is within peripheral zone (outside main cone, within peripheral range/angle) and LOS clear */
  inPeripheral: boolean;
  /** A wall tile blocked LOS before reaching the player */
  blockedByWall: boolean;
  /** Euclidean distance from guard to player in pixels */
  distancePx: number;
  /** Angle from guard's facing direction to player, in degrees [-180, 180] */
  angleFromFacing: number;
  /** World-space point where the raycast hit a wall (or player pos if unblocked) */
  hitPoint: { x: number; y: number };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalise an angle in radians to [-π, π]. */
function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Raycast from (ox, oy) toward (tx, ty) stepping TILE_SIZE/2 at a time.
 * Returns the world position of the first non-passable tile center hit,
 * or null if the player is reached with LOS clear.
 */
function raycast(
  ox: number,
  oy: number,
  tx: number,
  ty: number,
  tileMap: TileMap,
): { x: number; y: number } | null {
  const dx = tx - ox;
  const dy = ty - oy;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (dist === 0) return null; // Guard and player at same spot — clear

  const stepSize = TILE_SIZE / 2; // 16px
  const steps = Math.ceil(dist / stepSize);
  const nx = dx / dist;
  const ny = dy / dist;

  for (let i = 1; i <= steps; i++) {
    const fraction = Math.min(i * stepSize, dist);
    const wx = ox + nx * fraction;
    const wy = oy + ny * fraction;

    const { col, row } = tileMap.worldToTile(wx, wy);
    const tile = tileMap.getTileAt(col, row);

    if (tile && !tile.passable) {
      // Wall hit — return the world-space center of this tile
      return {
        x: tile.worldX + TILE_SIZE / 2,
        y: tile.worldY + TILE_SIZE / 2,
      };
    }

    // If we've marched past the player position, LOS is clear
    if (fraction >= dist) break;
  }

  return null; // No wall found before player
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Check whether the guard has line-of-sight to the player.
 *
 * Facing convention:
 *   facingX = 1  → facing right → facing angle = 0 radians
 *   facingX = -1 → facing left  → facing angle = Math.PI radians
 */
export function checkLineOfSight(
  guardPos: { x: number; y: number },
  facingX: 1 | -1,
  playerPos: { x: number; y: number },
  tileMap: TileMap,
  cone: ConeConfig,
): DetectionResult {
  const dx = playerPos.x - guardPos.x;
  const dy = playerPos.y - guardPos.y;
  const distancePx = Math.sqrt(dx * dx + dy * dy);

  // Angle from guard to player in world-space radians
  const angleToPlayer = Math.atan2(dy, dx);

  // Guard facing angle: right = 0, left = π
  const facingAngle = facingX === 1 ? 0 : Math.PI;

  // Angular difference, normalised to [-π, π]
  const rawDiff = normalizeAngle(angleToPlayer - facingAngle);
  const angleFromFacingRad = Math.abs(rawDiff);
  const angleFromFacing = (rawDiff * 180) / Math.PI; // signed degrees for result

  const halfAngleRad = (cone.halfAngle * Math.PI) / 180;
  const peripheralHalfAngleRad = (cone.peripheralHalfAngle * Math.PI) / 180;

  // Check angular containment
  const inMainAngle = angleFromFacingRad <= halfAngleRad;
  const inPeripheralAngle = angleFromFacingRad <= peripheralHalfAngleRad;

  // Check range containment
  const inMainRange = distancePx <= cone.range;
  const inPeripheralRange = distancePx <= cone.peripheralRange;

  // Determine which zone (main takes precedence)
  const candidateMain = inMainAngle && inMainRange;
  // Peripheral: within peripheral angle+range, but NOT already in the main cone range
  const candidatePeripheral = inPeripheralAngle && inPeripheralRange && !inMainRange;

  const anyCone = candidateMain || candidatePeripheral;

  // Default hit point is the player's position
  let hitPoint: { x: number; y: number } = { x: playerPos.x, y: playerPos.y };
  let blockedByWall = false;

  if (anyCone) {
    const wallHit = raycast(guardPos.x, guardPos.y, playerPos.x, playerPos.y, tileMap);
    if (wallHit !== null) {
      blockedByWall = true;
      hitPoint = wallHit;
    }
  }

  const losClear = anyCone && !blockedByWall;

  return {
    inMainCone: candidateMain && losClear,
    inPeripheral: candidatePeripheral && losClear,
    blockedByWall,
    distancePx,
    angleFromFacing,
    hitPoint,
  };
}
