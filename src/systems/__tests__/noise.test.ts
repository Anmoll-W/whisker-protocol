// TDD spec for the noise system: hearing intersection, the {radius, duration,
// position} event contract, and active-event lifetime tracking.
// Pure math module — no Phaser. Run via `npm test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeNoise,
  canGuardHearNoise,
  makeActiveNoise,
  tickActiveNoises,
  BASE_NOISE_RADIUS,
  FOOTSTEP_NOISE_DURATION_MS,
  type NoiseEvent,
} from '@/systems/noise.ts';

// ── computeNoise ────────────────────────────────────────────────────────────────

test('silent player (noiseLevel 0) produces no event', () => {
  assert.equal(computeNoise(10, 10, 0), null);
});

test('noise radius scales with noiseLevel and carries duration + position', () => {
  const e = computeNoise(50, 60, 1.5);
  assert.ok(e !== null);
  assert.equal(e.radius, BASE_NOISE_RADIUS * 1.5);
  assert.equal(e.sourceX, 50);
  assert.equal(e.sourceY, 60);
  assert.equal(e.duration, FOOTSTEP_NOISE_DURATION_MS);
});

// ── canGuardHearNoise — the intersection test ───────────────────────────────────

const ev = (x: number, y: number, radius: number): NoiseEvent => ({
  sourceX: x,
  sourceY: y,
  radius,
  duration: 1000,
  intensity: 1,
});

test('guard inside the radius hears the noise', () => {
  assert.equal(canGuardHearNoise({ x: 30, y: 0 }, ev(0, 0, 40)), true);
});

test('guard exactly on the radius boundary hears it (inclusive)', () => {
  assert.equal(canGuardHearNoise({ x: 40, y: 0 }, ev(0, 0, 40)), true);
});

test('guard just outside the radius does NOT hear it', () => {
  assert.equal(canGuardHearNoise({ x: 41, y: 0 }, ev(0, 0, 40)), false);
});

test('hearing is a true 2D circle (diagonal distance counts)', () => {
  // (30,30) is ~42.4px from origin — outside a 40px radius.
  assert.equal(canGuardHearNoise({ x: 30, y: 30 }, ev(0, 0, 40)), false);
  // ...but inside a 50px radius.
  assert.equal(canGuardHearNoise({ x: 30, y: 30 }, ev(0, 0, 50)), true);
});

// ── Active-event lifetime ───────────────────────────────────────────────────────

test('a fresh active noise starts with its full duration remaining', () => {
  const a = makeActiveNoise(ev(0, 0, 100));
  assert.equal(a.remainingMs, 1000);
});

test('tickActiveNoises decrements lifetime and drops expired events', () => {
  let actives = [makeActiveNoise(ev(0, 0, 100))]; // 1000ms life
  actives = tickActiveNoises(actives, 600);
  assert.equal(actives.length, 1);
  assert.equal(actives[0].remainingMs, 400);
  actives = tickActiveNoises(actives, 400); // exactly expires
  assert.equal(actives.length, 0, 'event at <= 0 remaining is dropped');
});

test('a guard hears an event ANY frame during its lifetime, not just on emit', () => {
  // This is what `duration` buys: the prop noise lingers so a guard out of range
  // on the emit frame still reacts if it intersects later in the window.
  let actives = [makeActiveNoise(ev(0, 0, 320))]; // brass-class, 4s would be real
  const guard = { x: 300, y: 0 }; // within 320px
  actives = tickActiveNoises(actives, 500); // 500ms later, still alive
  assert.equal(actives.length, 1);
  assert.equal(canGuardHearNoise(guard, actives[0].event), true);
});
