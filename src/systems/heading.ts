// heading.ts — pure facing/heading math for the guard.
//
// Framework-free so the cone-aim math is unit-testable without Phaser. The Guard
// entity keeps a separate `facingX: 1|-1` for sprite mirroring; the TRUE aim of
// the detection cone comes from a normalized heading vector run through
// headingAngle(). Conflating the two is what mis-aimed the cone by 45° on
// vertical movement (the quantized facingX was fed straight into atan2).

export interface Heading {
  /** Unit-vector X component of the heading. */
  x: number;
  /** Unit-vector Y component of the heading. */
  y: number;
}

/**
 * Normalize a direction vector to unit length. Returns null for a (near) zero
 * vector so callers can keep their previous heading instead of snapping to a
 * degenerate angle.
 */
export function normalizeHeading(dx: number, dy: number): Heading | null {
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return null;
  return { x: dx / len, y: dy / len };
}

/**
 * Heading direction as radians, matching the cone convention used by
 * checkLineOfSight(): 0 = right, π/2 = down, π = left, -π/2 = up.
 */
export function headingAngle(headingX: number, headingY: number): number {
  return Math.atan2(headingY, headingX);
}
