// guard-brain.ts — the pure decision core of the Chawl-neighbour guard.
//
// This is deliberately framework-free (no Phaser). It owns every timer and the
// full state machine; the Phaser `Guard` entity delegates all transition logic
// here and is left responsible only for movement and rendering. Keeping the
// brain pure is what makes the state machine, the peripheral-glimpse threshold
// (the P0 fix), and escalation memory unit-testable in isolation.
//
// State machine (matches the design stateDiagram exactly):
//
//   PATROL ──hears noise OR peripheral glimpse──▶ SUSPICIOUS (walk to the noise)
//   PATROL ──sees Billu in main cone (full fill)─▶ ALERTED
//   SUSPICIOUS ──reaches noise, no Billu (entity calls reachedInvestigation)──▶ SEARCHING
//   SUSPICIOUS ──sees Billu while approaching──▶ ALERTED
//   SEARCHING ──sees Billu──▶ ALERTED
//   SEARCHING ──search timer expires, clean──▶ PATROL
//
//   NOTE: SUSPICIOUS does NOT time out to PATROL. It is the "approach the noise"
//   phase and persists until the guard arrives (→ SEARCHING) or sights Billu
//   (→ ALERTED). The clean return to PATROL is owned by SEARCHING's countdown.
//   ALERTED ──catches Billu (life)──▶ (terminal, via onAlerted)
//   ALERTED ──loses sight of Billu──▶ SEARCHING
//
// ── Escalation memory (R1.5) truth table ──────────────────────────────────────
// "Noise reaches guard" = a noise event whose radius intersects his hearing range.
//
//   guard state when noise arrives | escalation before | after | effect
//   -------------------------------|-------------------|-------|---------------------------
//   PATROL / IDLE                  |        0          |   0   | enter SUSPICIOUS (single knock)
//   SUSPICIOUS                     |        0          |   1   | escalate: faster, wider, longer
//   SEARCHING                      |        1          |   2   | escalate again (3rd noise), capped
//   ALERTED                        |       n/a         |  n/a  | ignored (already chasing)
//   (any) after ESCALATION_RESET_MS|       any         |   0   | clean interval → de-escalate to 0
//
// The escalation multipliers (speed / cone width / investigate duration) are read
// by the Guard entity each frame and applied to movement, cone math, and timers.

import {
  GuardState,
  SUSPICIOUS_TO_ALERTED_MS,
  SEARCH_DURATION_MS,
  PERIPHERAL_TO_SUSPICIOUS_MS,
  PERIPHERAL_DECAY_FACTOR,
  ESCALATION_RESET_MS,
  MAX_ESCALATION_LEVEL,
  ESCALATION_SPEED_MULT,
  ESCALATION_CONE_MULT,
  ESCALATION_INVESTIGATE_MULT,
} from '@/types/guard-types';
import type { DetectionResult } from '@/systems/detection';

export interface Vec2 {
  x: number;
  y: number;
}

export class GuardBrain {
  private _state: GuardState = GuardState.PATROL;

  /** ms Billu has been continuously in the MAIN cone with clear LOS. */
  private _mainConeTime = 0;

  /**
   * ms Billu has been continuously in the cone PERIPHERY with clear LOS.
   * P0 FIX: this accumulator is now actually READ — it drives PATROL→SUSPICIOUS
   * once it crosses PERIPHERAL_TO_SUSPICIOUS_MS, decays while Billu is out of the
   * periphery, and resets to 0 on every state change.
   */
  private _peripheralTime = 0;

  /** ms spent searching after reaching lastKnownPosition. */
  private _searchTimer = 0;

  /** Whether the searcher has reached lastKnownPosition (countdown begins). */
  private _searchReached = false;

  /** Escalation memory level [0..MAX_ESCALATION_LEVEL]. */
  private _escalation = 0;

  /** ms since the last noise reached this guard (drives the clean-interval reset). */
  private _msSinceNoise = 0;

  /** Whether onAlerted has already fired this alert cycle. */
  private _alertedEventFired = false;

  /** Last position where Billu was seen or a noise was heard. */
  public lastKnownPosition: Vec2 | null = null;

  /** Fired once when the guard enters ALERTED (caller wires this to catch logic). */
  public onAlerted: (() => void) | null = null;

  // ── Read-only state + telemetry ───────────────────────────────────────────────

  get state(): GuardState {
    return this._state;
  }
  get mainConeTime(): number {
    return this._mainConeTime;
  }
  get peripheralTime(): number {
    return this._peripheralTime;
  }
  get escalationLevel(): number {
    return this._escalation;
  }
  get searchReached(): boolean {
    return this._searchReached;
  }

  // ── Escalation-derived modifiers (read by the Guard entity each frame) ────────

  get searchSpeedMult(): number {
    return ESCALATION_SPEED_MULT[this._escalation];
  }
  get coneHalfAngleMult(): number {
    return ESCALATION_CONE_MULT[this._escalation];
  }
  get investigateDurationMult(): number {
    return ESCALATION_INVESTIGATE_MULT[this._escalation];
  }

  /** Effective SEARCHING duration after escalation. */
  get effectiveSearchDurationMs(): number {
    return SEARCH_DURATION_MS * this.investigateDurationMult;
  }

  // ── State transition primitive ────────────────────────────────────────────────

  /** Set state and clear per-state transient accumulators (incl. the P0 one). */
  private setState(s: GuardState): void {
    if (this._state === s) return;
    this._state = s;
    // P0 contract: the peripheral accumulator resets on EVERY state change.
    this._peripheralTime = 0;
  }

  /** Test/entity hook to force a state without running transition logic. */
  forceState(s: GuardState): void {
    this.setState(s);
  }

  /** Mark the searcher as having arrived at lastKnownPosition (starts countdown). */
  markSearchReached(): void {
    this._searchReached = true;
    this._searchTimer = 0;
  }

  /**
   * Entity hook: the guard walking the single-knock lure has REACHED the noise
   * (lastKnownPosition) without seeing Billu. Transition SUSPICIOUS → SEARCHING
   * and begin the look-around countdown. No-op if not currently SUSPICIOUS (a
   * sighting may have already escalated him to ALERTED mid-approach).
   */
  reachedInvestigation(): void {
    if (this._state !== GuardState.SUSPICIOUS) return;
    this.setState(GuardState.SEARCHING);
    this.markSearchReached();
  }

  // ── Noise hearing + escalation memory (R1.5) ──────────────────────────────────

  /**
   * The guard heard a noise that reached him. From PATROL/IDLE this opens an
   * investigation (SUSPICIOUS). From SUSPICIOUS/SEARCHING it escalates. ALERTED
   * ignores it (already chasing). Resets the clean-interval timer every time.
   */
  hearNoise(pos: Vec2): void {
    const s = this._state;

    if (s === GuardState.ALERTED) return;

    // Any noise refreshes the "last heard" target and the clean-interval clock.
    this.lastKnownPosition = { x: pos.x, y: pos.y };
    this._msSinceNoise = 0;

    if (s === GuardState.PATROL || s === GuardState.IDLE) {
      // Single-knock lure: open the investigation. Escalation starts at 0. The
      // guard now WALKS to lastKnownPosition while SUSPICIOUS (entity-driven),
      // then flips to SEARCHING on arrival via reachedInvestigation().
      this._mainConeTime = 0;
      this.setState(GuardState.SUSPICIOUS);
      return;
    }

    // Already investigating (SUSPICIOUS or SEARCHING): escalate, capped.
    this._escalation = Math.min(this._escalation + 1, MAX_ESCALATION_LEVEL);
    // A fresh noise while SEARCHING renews the hunt: re-target lastKnownPosition
    // (set above) and re-approach it (clear "reached" so the entity walks again).
    if (s === GuardState.SEARCHING) {
      this._searchReached = false;
      this._searchTimer = 0;
    }
  }

  // ── Per-frame detection-driven state machine ──────────────────────────────────

  /**
   * Advance the state machine for one frame.
   *
   * @param result    Latest cone result from checkLineOfSight()
   * @param delta     Frame delta in milliseconds
   * @param playerPos Current world position of Billu
   * @param inMainOverride  Optional: caller-computed main-cone hit (e.g. food-carry
   *                        range expansion). Defaults to result.inMainCone.
   */
  updateDetection(
    result: DetectionResult,
    delta: number,
    playerPos: Vec2,
    inMainOverride?: boolean,
  ): void {
    // Clean-interval clock for escalation memory: ticks whenever we are mid-
    // investigation and no noise arrived this frame. Reset to 0 by hearNoise().
    if (this._state === GuardState.SUSPICIOUS || this._state === GuardState.SEARCHING) {
      this._msSinceNoise += delta;
      if (this._msSinceNoise >= ESCALATION_RESET_MS) {
        this._escalation = 0;
      }
    } else {
      this._msSinceNoise = 0;
    }

    const inMain = inMainOverride ?? result.inMainCone;

    // ── Billu in main cone ──────────────────────────────────────────────────────
    if (inMain) {
      this.lastKnownPosition = { x: playerPos.x, y: playerPos.y };
      this._mainConeTime += delta;
      this._peripheralTime = 0;

      const cur = this._state;

      // SEARCHING re-spot → ALERTED immediately.
      if (cur === GuardState.SEARCHING) {
        this.enterAlerted();
        return;
      }

      // PATROL/IDLE/SUSPICIOUS → SUSPICIOUS (stop, face, dwell).
      if (
        cur === GuardState.PATROL ||
        cur === GuardState.IDLE ||
        cur === GuardState.SUSPICIOUS
      ) {
        this.setState(GuardState.SUSPICIOUS);
      }

      // SUSPICIOUS dwell exceeded → ALERTED.
      if (
        this._state === GuardState.SUSPICIOUS &&
        this._mainConeTime >= SUSPICIOUS_TO_ALERTED_MS
      ) {
        this.enterAlerted();
        return;
      }

      // ALERTED holds; clamp the accumulator.
      this._mainConeTime = Math.min(this._mainConeTime, SUSPICIOUS_TO_ALERTED_MS);
      return;
    }

    // ── Billu NOT in main cone ──────────────────────────────────────────────────

    // P0 FIX — peripheral accumulator now drives behaviour.
    if (result.inPeripheral) {
      this._peripheralTime += delta;
      // PATROL/IDLE: a sustained peripheral glimpse turns the guard SUSPICIOUS.
      if (
        (this._state === GuardState.PATROL || this._state === GuardState.IDLE) &&
        this._peripheralTime >= PERIPHERAL_TO_SUSPICIOUS_MS
      ) {
        this.lastKnownPosition = { x: playerPos.x, y: playerPos.y };
        this._mainConeTime = 0;
        this.setState(GuardState.SUSPICIOUS); // resets _peripheralTime to 0
        return;
      }
    } else {
      // Out of the periphery: decay (do not freeze, do not hard-zero) so a brief
      // flicker through the edge cannot bank toward SUSPICIOUS.
      this._peripheralTime = Math.max(
        0,
        this._peripheralTime - delta * PERIPHERAL_DECAY_FACTOR,
      );
    }

    // SUSPICIOUS out of cone: the guard is APPROACHING the noise. He persists
    // SUSPICIOUS until the entity reports arrival (reachedInvestigation() →
    // SEARCHING) or a sighting escalates him (→ ALERTED above). The old 500ms
    // cooldown-to-PATROL revert was the lure bug — it froze him for 500ms and
    // sent him back to patrol having never moved to the noise. Removed.
    //
    // The main-cone dwell accumulator still drains so a glimpse that ends does
    // not bank toward ALERTED while he walks.
    if (this._state === GuardState.SUSPICIOUS) {
      this._mainConeTime = 0;
      return;
    }

    // ALERTED → SEARCHING (lost sight).
    if (this._state === GuardState.ALERTED) {
      this.enterSearching();
      return;
    }

    // SEARCHING countdown (only once the searcher has reached the position).
    if (this._state === GuardState.SEARCHING) {
      if (this._searchReached) {
        this._searchTimer += delta;
        if (this._searchTimer >= this.effectiveSearchDurationMs) {
          this._mainConeTime = 0;
          this._escalation = 0;
          this.setState(GuardState.PATROL);
        }
      }
      return;
    }

    // PATROL/IDLE, out of all cones — nothing pending.
    if (this._state === GuardState.PATROL || this._state === GuardState.IDLE) {
      this._mainConeTime = 0;
    }
  }

  // ── State entry helpers ───────────────────────────────────────────────────────

  private enterAlerted(): void {
    this._mainConeTime = SUSPICIOUS_TO_ALERTED_MS;
    this.setState(GuardState.ALERTED);
    if (!this._alertedEventFired) {
      this._alertedEventFired = true;
      this.onAlerted?.();
    }
  }

  private enterSearching(): void {
    this._searchTimer = 0;
    this._searchReached = false;
    this._mainConeTime = 0;
    this._alertedEventFired = false;
    this.setState(GuardState.SEARCHING);
  }
}
