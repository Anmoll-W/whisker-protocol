// Prop type definitions for Whisker Protocol — knockable Cat Chaos props (R1.1).
//
// Three classes per the design + bat-choreography contract. Single-knock only in
// this slice; stacked-prop CASCADE (R1.4) is deferred and intentionally not
// modelled here. Each class defines its noise event {radius, duration} — emitted
// at t≈500ms post-contact (the fairness buffer), NOT at impact.

export enum PropType {
  BRASS = 'BRASS',
  CLAY = 'CLAY',
  BOTTLE = 'BOTTLE',
}

export interface PropClassSpec {
  /** Noise-event radius in pixels (guards within it may hear). */
  noiseRadiusPx: number;
  /** Noise-event lifetime in milliseconds. */
  noiseDurationMs: number;
  /** Whether the prop is consumed (removed) on floor contact. */
  consumedOnContact: boolean;
  /** Body fill colour for the programmatic draw. */
  color: number;
}

/**
 * Per-class noise contract (from whisker-protocol-bat-choreography.md).
 *   brass:  radius 320, duration 4000ms  (widest, loudest)
 *   clay:   radius 200, duration 2500ms  (shatters — consumed)
 *   bottle: radius 200, duration 2500ms  (rolls — moving emitter is a later slice;
 *           single static emit here, consistent with single-knock scope)
 */
export const PROP_CLASS: Record<PropType, PropClassSpec> = {
  [PropType.BRASS]: {
    noiseRadiusPx: 320,
    noiseDurationMs: 4000,
    consumedOnContact: false,
    color: 0xc8901e,
  },
  [PropType.CLAY]: {
    noiseRadiusPx: 200,
    noiseDurationMs: 2500,
    consumedOnContact: true,
    color: 0xb05a2a,
  },
  [PropType.BOTTLE]: {
    noiseRadiusPx: 200,
    noiseDurationMs: 2500,
    consumedOnContact: false,
    color: 0x3a7a4a,
  },
};

/** Fairness buffer: noise emits this long AFTER the bat contact, not on impact. */
export const NOISE_EMIT_DELAY_MS = 500;
