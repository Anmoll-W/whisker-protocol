// detection-renderer.ts — Debug overlays for detection cone and noise radius.
// Draws the cone arcs, peripheral ring, detection/blocked LOS lines,
// and the player noise radius circle.
// Rendered each frame by GameScene into Graphics objects.

import Phaser from 'phaser';
import { type ConeConfig, type DetectionResult } from '@/systems/detection';

/**
 * Render the detection cone debug overlay.
 *
 * @param gfx       The Phaser Graphics object to draw into (cleared by caller each frame).
 * @param guardPos  Guard world-space position.
 * @param facingAngleRad  Guard facing direction in radians (0=right, π/2=down, π=left, -π/2=up).
 *                        4-way cone — replaces the old facingX: 1|-1 (2-way) signature.
 * @param result    Latest DetectionResult from checkLineOfSight().
 * @param cone      Cone configuration used to produce the result.
 */
export function renderDetectionDebug(
  gfx: Phaser.GameObjects.Graphics,
  guardPos: { x: number; y: number },
  facingAngleRad: number,
  result: DetectionResult,
  cone: ConeConfig,
): void {
  const halfAngleRad = (cone.halfAngle * Math.PI) / 180;
  const peripheralHalfAngleRad = (cone.peripheralHalfAngle * Math.PI) / 180;

  const { x, y } = guardPos;

  // ── Peripheral zone arc — semi-transparent blue ───────────────────────────
  // Draw peripheral ring as a filled arc (full peripheral zone including inner)
  // then we'll draw the main cone on top to visually differentiate.
  gfx.fillStyle(0x4488ff, 0.08);
  gfx.beginPath();
  gfx.moveTo(x, y);
  gfx.arc(
    x,
    y,
    cone.peripheralRange,
    facingAngleRad - peripheralHalfAngleRad,
    facingAngleRad + peripheralHalfAngleRad,
    false,
  );
  gfx.closePath();
  gfx.fillPath();

  // Peripheral outline
  gfx.lineStyle(1, 0x4488ff, 0.3);
  gfx.beginPath();
  gfx.moveTo(x, y);
  gfx.arc(
    x,
    y,
    cone.peripheralRange,
    facingAngleRad - peripheralHalfAngleRad,
    facingAngleRad + peripheralHalfAngleRad,
    false,
  );
  gfx.closePath();
  gfx.strokePath();

  // ── Main cone arc — semi-transparent yellow ───────────────────────────────
  gfx.fillStyle(0xffee44, 0.15);
  gfx.beginPath();
  gfx.moveTo(x, y);
  gfx.arc(
    x,
    y,
    cone.range,
    facingAngleRad - halfAngleRad,
    facingAngleRad + halfAngleRad,
    false,
  );
  gfx.closePath();
  gfx.fillPath();

  // Main cone outline
  gfx.lineStyle(1, 0xffee44, 0.5);
  gfx.beginPath();
  gfx.moveTo(x, y);
  gfx.arc(
    x,
    y,
    cone.range,
    facingAngleRad - halfAngleRad,
    facingAngleRad + halfAngleRad,
    false,
  );
  gfx.closePath();
  gfx.strokePath();

  // ── LOS line — from guard to player (or wall hit point) ──────────────────
  const { hitPoint, inMainCone, inPeripheral, blockedByWall } = result;

  const showLOS = inMainCone || inPeripheral || blockedByWall;
  if (showLOS) {
    if (blockedByWall) {
      // Orange line: LOS blocked by wall
      gfx.lineStyle(2, 0xff8800, 0.9);
    } else {
      // Bright red line: player detected
      gfx.lineStyle(2, 0xff2222, 1);
    }
    gfx.beginPath();
    gfx.moveTo(x, y);
    gfx.lineTo(hitPoint.x, hitPoint.y);
    gfx.strokePath();

    // Small dot at hit point
    const dotColor = blockedByWall ? 0xff8800 : 0xff2222;
    gfx.fillStyle(dotColor, 1);
    gfx.fillCircle(hitPoint.x, hitPoint.y, 3);
  }
}

/**
 * Render the noise radius debug overlay.
 * Draws an orange dashed-look circle around the player when they are making noise.
 *
 * @param gfx         The Phaser Graphics object to draw into (cleared by caller each frame).
 * @param playerX     Player world X.
 * @param playerY     Player world Y.
 * @param noiseRadius Player.noiseRadius — 0 means silent, skip drawing.
 */
export function renderNoiseDebug(
  gfx: Phaser.GameObjects.Graphics,
  playerX: number,
  playerY: number,
  noiseRadius: number,
): void {
  if (noiseRadius <= 0) return;

  gfx.lineStyle(1, 0xff6600, 0.35);
  gfx.strokeCircle(playerX, playerY, noiseRadius);
}
