// atlas-types.ts — Canonical sprite atlas contract for Whisker Protocol.
//
// Frame-key schema: <entity>_<state>_<facing>_<frame>
//   entity  — billu | guard | tile_<name>
//   state   — idle | walk | creep | bat | pounce | squeeze | hide | startle | caught
//             (guard also: patrol | suspicious | alerted | searching)
//   facing  — down | up | left | right
//   frame   — zero-based integer within the state animation (0, 1, 2, …)
//
// Example frame keys
//   billu_walk_down_0
//   billu_bat_left_2
//   guard_alerted_right_0
//
// Atlas sheet layout
//   • One atlas PNG + one atlas JSON per entity (billu.png / billu.json, etc.)
//   • Sheet dimensions must be a power of two (256, 512, 1024 …)
//   • Maximum sheet dimension: 512×512 px for entity atlases; 1024×1024 for tile sets
//   • Frame budget per state follows FRAME_BUDGET in tools/shading.py:
//       idle 2 · walk 4 · creep 4 · bat 3 · pounce 3 · squeeze 2 · hide 2 · startle 2 · caught 2
//       Total Billu frames across all states × 4 facings = 24 × 4 = 96 frames
//       All fit comfortably in a 512×512 sheet at 24×24 px native resolution.
//
// Phaser load call (PreloadScene):
//   this.load.atlas('billu', '/sprites/billu.png', '/sprites/billu.json');

// ---------------------------------------------------------------------------
// Phaser atlas-manifest types (what sprite_gen.py must emit)
// ---------------------------------------------------------------------------

/** A single frame entry inside the atlas JSON. */
export interface AtlasFrameEntry {
  /** Pixel rect on the sheet (trimmed or untrimmed). */
  frame: { x: number; y: number; w: number; h: number };
  /** True if the source PNG was rotated 90° to pack tighter. */
  rotated: boolean;
  /** True if the frame was trimmed of transparent padding. */
  trimmed: boolean;
  /** Original draw size before trim (equals frame size when trimmed = false). */
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  /** Full unscaled source image size. */
  sourceSize: { w: number; h: number };
  /**
   * Optional pivot point as a 0–1 fraction of sourceSize.
   * Defaults to (0.5, 0.5) — centre — when absent.
   */
  pivot?: { x: number; y: number };
}

/** Top-level atlas JSON object (Phaser texture-atlas format). */
export interface AtlasManifest {
  /** Map of canonical frame key → frame data. */
  frames: Record<string, AtlasFrameEntry>;
  meta: {
    /** Source PNG path relative to the JSON file (e.g. "billu.png"). */
    image: string;
    /** Sheet dimensions in pixels ("512x512"). */
    size: { w: number; h: number };
    /** Always 1 for non-retina sheets; use 2 for @2x atlas. */
    scale: string;
    /** Generator tag for traceability ("sprite_gen.py"). */
    app?: string;
    /** Palette lock sentinel ("whisker-v1"). */
    palette?: string;
  };
}

// ---------------------------------------------------------------------------
// Helper: build a canonical frame key
// ---------------------------------------------------------------------------

export type AtlasEntity = 'billu' | 'guard';

export type AtlasState =
  | 'idle' | 'walk' | 'creep' | 'bat' | 'pounce'
  | 'squeeze' | 'hide' | 'startle' | 'caught'
  | 'patrol' | 'suspicious' | 'alerted' | 'searching';

export type AtlasFacing = 'down' | 'up' | 'left' | 'right';

/**
 * Build a canonical frame key string.
 *
 * @example
 * frameKey('billu', 'walk', 'down', 0) // → 'billu_walk_down_0'
 */
export function frameKey(
  entity: AtlasEntity,
  state: AtlasState,
  facing: AtlasFacing,
  frame: number,
): string {
  return `${entity}_${state}_${facing}_${frame}`;
}
