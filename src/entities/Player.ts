// Player — Billu, the Desi street cat
// A Phaser.GameObjects.Container holding a Sprite child rendered from the Billu
// texture atlas (public/sprites/billu.{png,json}, emitted by tools/billu.py).
// The displayed frame is driven by state (idle / creep) plus a transient bat
// strike pose. Facing is handled by mirroring the sprite (scaleX), matching the
// project rule: never flip coordinates manually.

import Phaser from 'phaser';
import { TileMap } from '@/entities/TileMap';
import { PlayerState, DEFAULT_PLAYER_CONFIG, type PlayerConfig } from '@/types/player-types';
import { BASE_NOISE_RADIUS } from '@/systems/noise';

// ── Atlas frame keys (A0.2 schema: billu_<state>_<facing>_<frame>) ─────────────
const FRAME_IDLE = 'billu_idle_down_0';
const FRAME_CREEP = 'billu_creep_down_0';
const FRAME_BAT_STRIKE = 'billu_bat_down_1';

/** Native atlas frame is 24px; scale up so Billu reads at the old ~60px height. */
const SPRITE_SCALE = 2.5;

/** How long the bat-strike pose holds before reverting to the state frame (ms). */
const BAT_POSE_MS = 260;

// ── Input key bindings ────────────────────────────────────────────────────────
interface InputKeys {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  w: Phaser.Input.Keyboard.Key;
  s: Phaser.Input.Keyboard.Key;
  a: Phaser.Input.Keyboard.Key;
  d: Phaser.Input.Keyboard.Key;
  shift: Phaser.Input.Keyboard.Key;
  space: Phaser.Input.Keyboard.Key;
}

export class Player extends Phaser.GameObjects.Container {
  /** Current noise level — read each frame by the surface-noise system (Task 6). */
  public noiseLevel: number = 0;

  private sprite: Phaser.GameObjects.Sprite;
  private keys: InputKeys;
  private tileMap: TileMap;
  private cfg: PlayerConfig;
  private playerState: PlayerState = PlayerState.WALK;
  /** Last horizontal direction: +1 = right, -1 = left */
  private facingX: number = 1;
  /** Track last-applied frame + facing so we only re-set on change. */
  private lastFrame: string | null = null;
  private lastFacing: number | null = null;
  /** ms remaining on the transient bat-strike pose (0 = not batting). */
  private batPoseTimer = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, tileMap: TileMap, cfg: PlayerConfig = DEFAULT_PLAYER_CONFIG) {
    super(scene, x, y);

    this.tileMap = tileMap;
    this.cfg = cfg;

    // Sprite child rendered from the Billu atlas. Use make.sprite (not add) so it
    // is NOT on the scene root — only the Container registration counts (avoids a
    // ghost render at world origin), mirroring the previous Graphics pattern.
    this.sprite = scene.make.sprite({ key: 'billu', frame: FRAME_IDLE }, false);
    this.sprite.setScale(SPRITE_SCALE);
    this.add(this.sprite);

    // Depth above tiles
    this.setDepth(10);

    // Keyboard input
    const kb = scene.input.keyboard!;
    this.keys = kb.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.UP,
      down: Phaser.Input.Keyboard.KeyCodes.DOWN,
      left: Phaser.Input.Keyboard.KeyCodes.LEFT,
      right: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      w: Phaser.Input.Keyboard.KeyCodes.W,
      s: Phaser.Input.Keyboard.KeyCodes.S,
      a: Phaser.Input.Keyboard.KeyCodes.A,
      d: Phaser.Input.Keyboard.KeyCodes.D,
      shift: Phaser.Input.Keyboard.KeyCodes.SHIFT,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
    }) as InputKeys;

    // Initial frame
    this.applyFrame();
  }

  /**
   * Show the bat-strike pose for a short beat. GameScene calls this the moment a
   * knock connects so the hero verb is visible on Billu (not just on the prop).
   */
  playBat(): void {
    this.batPoseTimer = BAT_POSE_MS;
    this.applyFrame();
  }

  // ── Public update — called by GameScene.update() each frame ─────────────────
  update(delta: number): void {
    const dt = delta / 1000; // milliseconds → seconds

    // ── 1. Resolve state ────────────────────────────────────────────────────
    const spaceDown = this.keys.space.isDown;
    const shiftDown = this.keys.shift.isDown;

    if (spaceDown) {
      this.playerState = PlayerState.FREEZE;
    } else if (shiftDown) {
      this.playerState = PlayerState.CROUCH;
    } else {
      this.playerState = PlayerState.WALK;
    }

    // ── 2. Resolve movement intent ──────────────────────────────────────────
    const moveUp = this.keys.up.isDown || this.keys.w.isDown;
    const moveDown = this.keys.down.isDown || this.keys.s.isDown;
    const moveLeft = this.keys.left.isDown || this.keys.a.isDown;
    const moveRight = this.keys.right.isDown || this.keys.d.isDown;

    let dx = 0;
    let dy = 0;

    if (this.playerState !== PlayerState.FREEZE) {
      if (moveLeft) dx -= 1;
      if (moveRight) dx += 1;
      if (moveUp) dy -= 1;
      if (moveDown) dy += 1;

      // Normalise diagonal so 8-dir speed is consistent
      if (dx !== 0 && dy !== 0) {
        const inv = 1 / Math.sqrt(2);
        dx *= inv;
        dy *= inv;
      }
    }

    const speed = this.playerState === PlayerState.CROUCH ? this.cfg.crouchSpeed : this.cfg.walkSpeed;
    const vx = dx * speed;
    const vy = dy * speed;

    // Update facing based on horizontal intent
    if (dx > 0) this.facingX = 1;
    else if (dx < 0) this.facingX = -1;

    // ── 3. Move with collision check ────────────────────────────────────────
    if (vx !== 0 || vy !== 0) {
      const newX = this.x + vx * dt;
      const newY = this.y + vy * dt;

      // Try X then Y independently (axis-aligned sliding)
      const canMoveX = this.canMoveTo(newX, this.y);
      const canMoveY = this.canMoveTo(this.x, newY);

      if (canMoveX) this.x = newX;
      if (canMoveY) this.y = newY;
    }

    // ── 4. Update noiseLevel ────────────────────────────────────────────────
    const { col, row } = this.tileMap.worldToTile(this.x, this.y);
    const currentTile = this.tileMap.getTileAt(col, row);
    const noiseMultiplier = currentTile ? currentTile.noiseMultiplier : 1.0;

    let speedMultiplier: number;
    if (this.playerState === PlayerState.FREEZE) {
      speedMultiplier = 0;
    } else if (this.playerState === PlayerState.CROUCH) {
      // Guard with movement check — CROUCH when stationary emits no noise
      speedMultiplier = (vx !== 0 || vy !== 0) ? 0.5 : 0;
    } else {
      // WALK state — only emit noise when actually moving
      speedMultiplier = (vx !== 0 || vy !== 0) ? 1.0 : 0;
    }

    this.noiseLevel = noiseMultiplier * speedMultiplier;

    // ── 5. Tick the transient bat pose, then refresh the frame on any change ──
    if (this.batPoseTimer > 0) {
      this.batPoseTimer -= delta;
    }
    this.applyFrame();
  }

  // ── Collision ────────────────────────────────────────────────────────────────
  /** Returns true if all 4 corners of the hitbox at (wx, wy) are on passable tiles. */
  private canMoveTo(wx: number, wy: number): boolean {
    const hw = this.cfg.hitboxHalfW;
    const hh = this.cfg.hitboxHalfH;

    // Sample all 4 corners of the 28×28 hitbox
    const corners: [number, number][] = [
      [wx - hw, wy - hh],
      [wx + hw, wy - hh],
      [wx - hw, wy + hh],
      [wx + hw, wy + hh],
    ];

    for (const [cx, cy] of corners) {
      const { col, row } = this.tileMap.worldToTile(cx, cy);
      const tile = this.tileMap.getTileAt(col, row);
      if (!tile || !tile.passable) return false;
    }
    return true;
  }

  // ── Frame selection ───────────────────────────────────────────────────────
  /**
   * Pick the Billu atlas frame for the current state (bat pose wins while its
   * timer is live), mirror it for facing, and apply — only when something
   * changed so we avoid redundant setFrame/setScale churn each frame.
   */
  private applyFrame(): void {
    let frame: string;
    if (this.batPoseTimer > 0) {
      frame = FRAME_BAT_STRIKE;
    } else if (this.playerState === PlayerState.CROUCH) {
      // Crouch reads as the low predatory stalk pose.
      frame = FRAME_CREEP;
    } else {
      // WALK + FREEZE both rest on the idle frame (FREEZE adds no extra pose in
      // this slice — stillness is communicated by not moving).
      frame = FRAME_IDLE;
    }

    if (frame === this.lastFrame && this.facingX === this.lastFacing) return;
    this.lastFrame = frame;
    this.lastFacing = this.facingX;

    this.sprite.setFrame(frame);
    // Mirror horizontally for left-facing (scaleX sign), preserving magnitude.
    this.sprite.setScale(SPRITE_SCALE * this.facingX, SPRITE_SCALE);
  }

  /**
   * Noise radius in pixels — pre-computed for the noise debug visualizer.
   * Equals 0 when the player is silent (FREEZE, standing still, or crouching in place).
   */
  get noiseRadius(): number {
    return this.noiseLevel <= 0 ? 0 : BASE_NOISE_RADIUS * this.noiseLevel;
  }

  /** Return current player state — useful for HUD/debug overlays. */
  getState(): PlayerState { return this.playerState; }
}
