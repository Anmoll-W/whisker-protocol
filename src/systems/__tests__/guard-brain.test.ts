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

test('SUSPICIOUS with no sighting reverts to PATROL after the cooldown (clean return)', () => {
  const b = new GuardBrain();
  b.hearNoise({ x: 200, y: 150 });
  // Tick out-of-cone frames until cooldown elapses.
  let t = 0;
  while (t < SUSPICIOUS_COOLDOWN_MS + 16) {
    b.updateDetection(noContact(), 16, P);
    t += 16;
  }
  assert.equal(b.state, GuardState.PATROL);
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
