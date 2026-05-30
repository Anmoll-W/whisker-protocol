// save.ts — Save interface + in-memory stub for Whisker Protocol.
//
// Contract: E2 (level select) and E3 (grade card) build against the
// ISaveStore interface defined here.  D3 replaces the InMemorySaveStore
// body with a localStorage + in-memory fallback implementation while
// keeping this interface and the same export name `saveStore`.
//
// Star grades: 0 = not yet played, 1–3 = earned stars.
// Nine Lives: integer 0–9, persisted across the run (reset on New Game).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Star rating for a completed level run. */
export type StarGrade = 0 | 1 | 2 | 3;

/** Per-level persistent record. */
export interface LevelRecord {
  /** Best star grade earned across all attempts. */
  bestStars: StarGrade;
}

/**
 * Root shape of the persisted save data.
 *
 * D3 serialises this to JSON and stores it in localStorage under the key
 * `whisker-save-v1`.  The in-memory stub holds it in a plain object.
 */
export interface SaveData {
  /** Map from level key (e.g. "chawl-kitchen") to that level's record. */
  levels: Record<string, LevelRecord>;
  /** Nine-Lives count for the current run (0–9). */
  nineLives: number;
  /** Schema version — bump when the shape changes. */
  version: 1;
}

/**
 * The save-store interface all game systems must use.
 *
 * D3 provides the real implementation; until then the in-memory stub
 * shipped below is wired in.
 */
export interface ISaveStore {
  /** Load (or initialise) the save data.  Must be called before any read/write. */
  load(): SaveData;

  /** Flush current state to the backing store (no-op for in-memory stub). */
  save(): void;

  /**
   * Return the best star grade for a level, or 0 if never played.
   * @param levelKey  Canonical level identifier (e.g. "chawl-kitchen").
   */
  getBestStars(levelKey: string): StarGrade;

  /**
   * Persist a new star grade for a level.  Only updates if `stars` beats the
   * existing record — never downgrades.
   * @param levelKey  Canonical level identifier.
   * @param stars     Stars earned in this run (1–3).
   */
  setBestStars(levelKey: string, stars: StarGrade): void;

  /** Current Nine-Lives count. */
  getNineLives(): number;

  /**
   * Overwrite the Nine-Lives count.
   * @param lives  New count clamped to [0, 9].
   */
  setNineLives(lives: number): void;

  /** Decrement Nine-Lives by 1, minimum 0.  Returns the new count. */
  spendLife(): number;

  /** Reset Nine-Lives to the starting value (9) and clear level records. */
  resetRun(): void;
}

// ---------------------------------------------------------------------------
// Default save data
// ---------------------------------------------------------------------------

const DEFAULT_SAVE: SaveData = {
  levels: {},
  nineLives: 9,
  version: 1,
};

// ---------------------------------------------------------------------------
// In-memory stub (D3 replaces this body with localStorage + fallback)
// ---------------------------------------------------------------------------

/**
 * InMemorySaveStore — stub implementation used by E2 / E3 until D3 lands.
 *
 * NOTE TO D3 IMPLEMENTOR: Replace this class body with localStorage read/write
 * logic.  Keep the class name, keep every method signature, keep this file's
 * exports unchanged so E2/E3 compile without modification.
 */
class InMemorySaveStore implements ISaveStore {
  private _data: SaveData = { ...DEFAULT_SAVE, levels: {} };

  load(): SaveData {
    // Stub: nothing to read from disk; return a fresh default on first call.
    return this._data;
  }

  save(): void {
    // Stub: no backing store — no-op.
    // D3 replaces with: localStorage.setItem('whisker-save-v1', JSON.stringify(this._data));
  }

  getBestStars(levelKey: string): StarGrade {
    return this._data.levels[levelKey]?.bestStars ?? 0;
  }

  setBestStars(levelKey: string, stars: StarGrade): void {
    if (stars < 1) return; // 0 is "not played" — never written explicitly
    const existing = this.getBestStars(levelKey);
    if (stars > existing) {
      this._data.levels[levelKey] = { bestStars: stars };
    }
  }

  getNineLives(): number {
    return this._data.nineLives;
  }

  setNineLives(lives: number): void {
    this._data.nineLives = Math.max(0, Math.min(9, lives));
  }

  spendLife(): number {
    this.setNineLives(this._data.nineLives - 1);
    return this._data.nineLives;
  }

  resetRun(): void {
    this._data = { ...DEFAULT_SAVE, levels: {} };
  }
}

// ---------------------------------------------------------------------------
// Singleton export — the only instance all systems reference
// ---------------------------------------------------------------------------

/**
 * Global save store.  Call `saveStore.load()` once at game boot (PreloadScene).
 * D3 replaces InMemorySaveStore with the localStorage implementation; this
 * export name and the ISaveStore interface remain unchanged.
 */
export const saveStore: ISaveStore = new InMemorySaveStore();
