// TDD spec for the pure guard "brain" — the noise→hear→investigate→return loop,
// the full PATROL/SUSPICIOUS/SEARCHING/ALERTED state machine, the peripheralTime
// threshold (P0 fix), and escalation memory (R1.5).
//
// No Phaser here: the brain is deliberately framework-free so the math/state is
// testable in isolation. Run via `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { GuardBrain } from '@/systems/guard-brain.ts';
import { GuardState } from '@/types/guard-types.ts';
import {
  SUSPICIOUS_TO_ALERTED_MS,
  SUSPICIOUS_COOLDOWN_MS,
  SEARCH_DURATION_MS,
  PERIPHERAL_TO_SUSPICIOUS_MS,
  ESCALATION_RESET_MS,
} from '@/types/guard-types.ts';
import { normalizeHeading, headingAngle } from '@/systems/heading.ts';
import type { DetectionResult } from '@/systems/detection.ts'; // type-only — no Phaser pulled in

// ── Detection-result fixtures ──────────────────────────────────────────────────

function noContact(): DetectionResult {
  return {
    inMainCone: false,
    inPeripheral: false,
    blockedByWall: false,
    distancePx: 999,
    angleFromFacing: 180,
    hitPoint: { x: 0, y: 0 },
  };
}

function inMain(): DetectionResult {
  return { ...noContact(), inMainCone: true, distancePx: 40, angleFromFacing: 0 };
}

function inPeripheralOnly(): DetectionResult {
  return { ...noContact(), inPeripheral: true, distancePx: 60, angleFromFacing: 70 };
}

const P = { x: 100, y: 100 };

// ── 1. Noise hearing → SUSPICIOUS → investigate → return loop ───────────────────

test('hearNoise turns a PATROL guard SUSPICIOUS and records the noise position', () => {
  const b = new GuardBrain();
  assert.equal(b.state, GuardState.PATROL);
  b.hearNoise({ x: 200, y: 150 });
  assert.equal(b.state, GuardState.SUSPICIOUS);
  assert.deepEqual(b.lastKnownPosition, { x: 200, y: 150 });
});

test('hearNoise does NOT downgrade an ALERTED guard', () => {
  const b = new GuardBrain();
  b.forceState(GuardState.ALERTED);
  b.hearNoise({ x: 10, y: 10 });
  assert.equal(b.state, GuardState.ALERTED);
});

test('SUSPICIOUS does NOT revert to PATROL on the old cooldown — it persists while approaching the noise (the lure-freeze bug)', () => {
  // REGRESSION: the lure bug was that a single knock set SUSPICIOUS, then the
  // 500ms cooldown reverted to PATROL having never moved the guard. The fix: the
  // guard stays SUSPICIOUS (walking to the noise) until he arrives or sees Billu.
  const b = new GuardBrain();
  b.hearNoise({ x: 200, y: 150 });
  let t = 0;
  // Tick well past the OLD cooldown window with no sighting.
  while (t < SUSPICIOUS_COOLDOWN_MS * 4) {
    b.updateDetection(noContact(), 16, P);
    t += 16;
  }
  assert.equal(
    b.state,
    GuardState.SUSPICIOUS,
    'SUSPICIOUS must persist (approach the noise), not freeze-and-revert to PATROL',
  );
  assert.deepEqual(b.lastKnownPosition, { x: 200, y: 150 }, 'still targeting the noise');
});

test('reachedInvestigation flips SUSPICIOUS → SEARCHING, then the search countdown returns to PATROL (clean return)', () => {
  const b = new GuardBrain();
  b.hearNoise({ x: 200, y: 150 }); // PATROL → SUSPICIOUS
  // Entity reports it has walked to the noise without seeing Billu.
  b.reachedInvestigation();
  assert.equal(b.state, GuardState.SEARCHING);
  assert.ok(b.searchReached, 'look-around countdown begins on arrival');
  // The look-around countdown then expires and cleanly returns to PATROL.
  let t = 0;
  while (t < SEARCH_DURATION_MS + 32) {
    b.updateDetection(noContact(), 16, P);
    t += 16;
  }
  assert.equal(b.state, GuardState.PATROL, 'clean return after the search countdown');
});

test('reachedInvestigation is a no-op when not SUSPICIOUS (sighting already escalated to ALERTED)', () => {
  const b = new GuardBrain();
  b.forceState(GuardState.ALERTED);
  b.reachedInvestigation();
  assert.equal(b.state, GuardState.ALERTED, 'arrival must not downgrade an ALERTED chase');
});

// ── 2. State machine: SUSPICIOUS → ALERTED via main cone dwell ─────────────────

test('main-cone dwell beyond threshold escalates SUSPICIOUS → ALERTED', () => {
  const b = new GuardBrain();
  let alerted = 0;
  b.onAlerted = () => alerted++;
  // First frame in main cone enters SUSPICIOUS; keep dwelling.
  let t = 0;
  while (t <= SUSPICIOUS_TO_ALERTED_MS + 16) {
    b.updateDetection(inMain(), 16, P);
    t += 16;
  }
  assert.equal(b.state, GuardState.ALERTED);
  assert.equal(alerted, 1, 'EVENT_ALERTED fires exactly once');
});

test('ALERTED → SEARCHING when Billu leaves line of sight', () => {
  const b = new GuardBrain();
  b.forceState(GuardState.ALERTED);
  b.lastKnownPosition = { x: 300, y: 300 };
  b.updateDetection(noContact(), 16, P);
  assert.equal(b.state, GuardState.SEARCHING);
});

test('SEARCHING → ALERTED when Billu is re-spotted in the main cone', () => {
  const b = new GuardBrain();
  b.forceState(GuardState.SEARCHING);
  b.lastKnownPosition = { x: 300, y: 300 };
  b.updateDetection(inMain(), 16, P);
  assert.equal(b.state, GuardState.ALERTED);
});

// ── 3. THE P0 BUG: _peripheralTime must drive SUSPICIOUS ────────────────────────
// Before the fix the accumulator incremented but nothing read it — a guard could
// stare at Billu in his periphery forever and never react. These two tests
// pin the contract: the accumulator must (a) trigger SUSPICIOUS at the threshold
// and (b) decay back down when Billu leaves the periphery.

test('P0 REPRO: continuous peripheral presence past threshold turns guard SUSPICIOUS', () => {
  const b = new GuardBrain();
  assert.equal(b.state, GuardState.PATROL);

  let t = 0;
  // Hold Billu in the periphery (NOT the main cone) past the threshold.
  while (t < PERIPHERAL_TO_SUSPICIOUS_MS && b.state === GuardState.PATROL) {
    b.updateDetection(inPeripheralOnly(), 16, P);
    t += 16;
  }
  // One more frame to cross the threshold cleanly.
  b.updateDetection(inPeripheralOnly(), 16, P);

  assert.equal(
    b.state,
    GuardState.SUSPICIOUS,
    'peripheral accumulator MUST trigger SUSPICIOUS at the threshold (dead-accumulator P0)',
  );
});

test('P0: a brief peripheral flicker below threshold does NOT trigger SUSPICIOUS', () => {
  const b = new GuardBrain();
  // Well under the threshold.
  b.updateDetection(inPeripheralOnly(), 100, P);
  assert.equal(b.state, GuardState.PATROL);
  assert.ok(b.peripheralTime > 0, 'accumulator banked time');
});

test('P0: peripheralTime decays when Billu leaves the periphery', () => {
  const b = new GuardBrain();
  // Bank some peripheral time (still below threshold).
  b.updateDetection(inPeripheralOnly(), 200, P);
  const banked = b.peripheralTime;
  assert.ok(banked > 0);
  // Now out of all cones — accumulator must drain, not freeze.
  b.updateDetection(noContact(), 200, P);
  assert.ok(b.peripheralTime < banked, 'peripheralTime must decay when out of periphery');
});

test('P0: peripheralTime resets to 0 on a state change', () => {
  const b = new GuardBrain();
  b.updateDetection(inPeripheralOnly(), 100, P);
  assert.ok(b.peripheralTime > 0);
  b.hearNoise({ x: 5, y: 5 }); // PATROL -> SUSPICIOUS
  assert.equal(b.peripheralTime, 0, 'peripheral accumulator clears on state transition');
});

// ── 4. Escalation memory (R1.5) ────────────────────────────────────────────────

test('a 2nd noise while SUSPICIOUS escalates the guard (level rises)', () => {
  const b = new GuardBrain();
  b.hearNoise({ x: 200, y: 150 }); // PATROL -> SUSPICIOUS, escalation 0
  assert.equal(b.escalationLevel, 0);
  b.hearNoise({ x: 210, y: 160 }); // already SUSPICIOUS -> escalate
  assert.equal(b.escalationLevel, 1);
});

test('escalation makes the guard faster, wider-coned, and longer-searching', () => {
  const b = new GuardBrain();
  b.hearNoise({ x: 200, y: 150 });
  const baseSpeed = b.searchSpeedMult;
  const baseCone = b.coneHalfAngleMult;
  const baseInvestigate = b.investigateDurationMult;
  b.hearNoise({ x: 210, y: 160 });
  assert.ok(b.searchSpeedMult > baseSpeed, 'faster');
  assert.ok(b.coneHalfAngleMult > baseCone, 'wider cone');
  assert.ok(b.investigateDurationMult > baseInvestigate, 'longer investigate');
});

test('escalation is capped at MAX_ESCALATION_LEVEL', () => {
  const b = new GuardBrain();
  b.hearNoise({ x: 1, y: 1 });
  for (let i = 0; i < 10; i++) b.hearNoise({ x: 1, y: 1 });
  assert.equal(b.escalationLevel, 2);
});

test('escalation resets after a clean interval with no new noise', () => {
  const b = new GuardBrain();
  b.hearNoise({ x: 1, y: 1 });
  b.hearNoise({ x: 1, y: 1 }); // escalation 1
  assert.equal(b.escalationLevel, 1);
  // Stay SUSPICIOUS but receive no noise for longer than the reset window.
  let t = 0;
  // Keep him SUSPICIOUS by feeding peripheral contact (resets cooldown) — but
  // that would re-trigger nothing; instead feed no-contact but probe escalation
  // before the cooldown reverts him. Use SEARCHING which has a long timer.
  b.forceState(GuardState.SEARCHING);
  while (t < ESCALATION_RESET_MS + 32) {
    b.updateDetection(noContact(), 16, P);
    t += 16;
  }
  assert.equal(b.escalationLevel, 0, 'clean interval resets escalation');
});

// ── 5. Sanity: SEARCH timer reverts to PATROL ──────────────────────────────────

test('SEARCHING reverts to PATROL after the (base) search duration with no sighting', () => {
  const b = new GuardBrain();
  b.forceState(GuardState.SEARCHING);
  b.lastKnownPosition = null; // give-up path is immediate; test the timer path instead
  b.lastKnownPosition = { x: P.x, y: P.y }; // already at position
  b.markSearchReached();
  let t = 0;
  while (t < SEARCH_DURATION_MS + 32) {
    b.updateDetection(noContact(), 16, P);
    t += 16;
  }
  assert.equal(b.state, GuardState.PATROL);
});

// ── 6. Cone aim: heading vector, NOT the quantized sprite-mirror flag ───────────
// REGRESSION (BLOCKER): facingAngle used to be atan2(facingY, facingX) where
// facingX was quantized to 1|-1 for sprite mirroring. Straight-up movement
// (heading 0,-1) therefore aimed the cone at atan2(-1, 1) = -45° instead of -90°
// — the cone was 45° off for the whole vertical leg of the patrol. The fix aims
// the cone from a TRUE unit heading. These pin all four cardinals.

const HALF_PI = Math.PI / 2;

test('cone aim: facing RIGHT → facingAngle ≈ 0', () => {
  const h = normalizeHeading(1, 0)!;
  assert.ok(Math.abs(headingAngle(h.x, h.y) - 0) < 1e-9);
});

test('cone aim: facing DOWN → facingAngle ≈ +π/2 (NOT +45°)', () => {
  const h = normalizeHeading(0, 5)!; // raw, unnormalized magnitude — must still aim straight down
  assert.ok(Math.abs(headingAngle(h.x, h.y) - HALF_PI) < 1e-9);
});

test('cone aim: facing UP → facingAngle ≈ -π/2 (the 45°-bug repro)', () => {
  // With the OLD math (quantized facingX=1, facingY=-1) this would be -π/4.
  const h = normalizeHeading(0, -5)!;
  assert.ok(
    Math.abs(headingAngle(h.x, h.y) - -HALF_PI) < 1e-9,
    'straight-up heading must aim the cone at -π/2, not the -π/4 of the quantized bug',
  );
});

test('cone aim: facing LEFT → |facingAngle| ≈ π', () => {
  const h = normalizeHeading(-1, 0)!;
  assert.ok(Math.abs(Math.abs(headingAngle(h.x, h.y)) - Math.PI) < 1e-9);
});

test('cone aim: a diagonal up-left heading aims at -3π/4 (true direction, not a snapped axis)', () => {
  const h = normalizeHeading(-1, -1)!;
  assert.ok(Math.abs(headingAngle(h.x, h.y) - (-3 * Math.PI) / 4) < 1e-9);
});

// ── 7. THE HERO VERB: a single knock relocates the guard to the noise ───────────
// REGRESSION (BLOCKER): the lure used to be a 500ms freeze then a revert to
// PATROL — the guard never moved. This simulates the entity's approach loop
// (the same walkToward → reachedInvestigation math the Guard entity runs) driving
// the pure brain, and asserts the guard's position CONVERGES to the noise and the
// brain progresses SUSPICIOUS → SEARCHING (reached) → PATROL (clean).

const SEARCH_REACH_THRESHOLD = 8; // mirrors Guard.SEARCH_REACH_THRESHOLD
const SEARCH_SPEED = 72; // mirrors Guard.SEARCH_SPEED (px/s)

test('LURE: hearNoise from PATROL relocates the guard to the noise, then SUSPICIOUS → SEARCHING → PATROL', () => {
  const b = new GuardBrain();

  // Guard starts here; the knock happens far away.
  const guard = { x: 0, y: 0 };
  const noise = { x: 200, y: 150 };
  const startDist = Math.hypot(noise.x - guard.x, noise.y - guard.y);

  b.hearNoise(noise); // PATROL → SUSPICIOUS (target = the noise)
  assert.equal(b.state, GuardState.SUSPICIOUS);

  const dt = 16; // ms per frame
  let frames = 0;
  let reachedFrame = -1;

  // Drive the same loop the entity drives. Billu is never seen (noContact).
  const stateOf = (): GuardState => b.state;
  while (frames < 2000) {
    const state = stateOf();
    if (state === GuardState.PATROL) break;
    const lk = b.lastKnownPosition!;
    if (state === GuardState.SUSPICIOUS) {
      // walkToward(noise): move at search speed, report arrival.
      const h = normalizeHeading(lk.x - guard.x, lk.y - guard.y);
      const dist = Math.hypot(lk.x - guard.x, lk.y - guard.y);
      if (dist <= SEARCH_REACH_THRESHOLD) {
        b.reachedInvestigation();
        if (reachedFrame < 0) reachedFrame = frames;
      } else if (h) {
        const step = (SEARCH_SPEED * b.searchSpeedMult * dt) / 1000;
        guard.x += h.x * step;
        guard.y += h.y * step;
      }
    }
    b.updateDetection(noContact(), dt, { x: guard.x, y: guard.y });
    frames++;
  }

  const endDist = Math.hypot(noise.x - guard.x, noise.y - guard.y);

  assert.ok(reachedFrame > 0, 'guard reached the noise (SUSPICIOUS → SEARCHING happened)');
  assert.ok(
    endDist < startDist,
    `guard moved toward the noise (start ${startDist.toFixed(1)} → end ${endDist.toFixed(1)})`,
  );
  assert.ok(
    endDist <= SEARCH_REACH_THRESHOLD,
    `guard ended AT the noise, not back at patrol start (endDist ${endDist.toFixed(2)} ≤ ${SEARCH_REACH_THRESHOLD})`,
  );
  assert.equal(b.state, GuardState.PATROL, 'clean return after the look-around countdown');
});

test('LURE: a sighting mid-approach interrupts SUSPICIOUS → ALERTED (the chase still wins)', () => {
  const b = new GuardBrain();
  b.hearNoise({ x: 200, y: 150 }); // SUSPICIOUS, approaching
  // Billu walks into the main cone before the guard arrives.
  let t = 0;
  while (t <= SUSPICIOUS_TO_ALERTED_MS + 16) {
    b.updateDetection(inMain(), 16, P);
    t += 16;
  }
  assert.equal(b.state, GuardState.ALERTED, 'a sighting while approaching escalates to ALERTED');
});
