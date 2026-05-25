// detection-renderer.ts — Debug overlay for the line-of-sight detection cone
// Draws the cone arcs, peripheral ring, and detection/blocked LOS lines.
// Rendered each frame by GameScene into a Graphics object at depth 20.

import Phaser from 'phaser';
import { type ConeConfig, type DetectionResult } from '@/systems/detection';

/**
 * Render the detection cone debug overlay.
 *
 * @param gfx     The Phaser Graphics object to draw into (cleared by caller each frame).
 * @param guardPos  Guard world-space position.
 * @param facingX   Guard facing direction (1 = right, -1 = left).
 * @param result    Latest DetectionResult from checkLineOfSight().
 * @param cone      Cone configuration used to produce the result.
 */
export function renderDetectionDebug(
  gfx: Phaser.GameObjects.Graphics,
  guardPos: { x: number; y: number },
  facingX: 1 | -1,
  result: DetectionResult,
  cone: ConeConfig,
): void {
  const facingAngleRad = facingX === 1 ? 0 : Math.PI;
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
