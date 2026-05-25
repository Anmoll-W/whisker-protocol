// Player — Billu, the Desi street cat
// A Phaser.GameObjects.Container holding a Graphics child that draws Billu
// in one of three states: WALK, CROUCH, FREEZE.
// All rendering is programmatic — no external sprites.

import Phaser from 'phaser';
import { TileMap } from '@/entities/TileMap';
import { PlayerState, DEFAULT_PLAYER_CONFIG, type PlayerConfig } from '@/types/player-types';
import { BASE_NOISE_RADIUS } from '@/systems/noise';

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

  private gfx: Phaser.GameObjects.Graphics;
  private keys: InputKeys;
  private tileMap: TileMap;
  private cfg: PlayerConfig;
  private playerState: PlayerState = PlayerState.WALK;
  /** Last horizontal direction: +1 = right, -1 = left */
  private facingX: number = 1;
  /** Track last drawn state + facing so we only redraw on change. */
  private lastDrawnState: PlayerState | null = null;
  private lastDrawnFacing: number | null = null;

  constructor(scene: Phaser.Scene, x: number, y: number, tileMap: TileMap, cfg: PlayerConfig = DEFAULT_PLAYER_CONFIG) {
    super(scene, x, y);

    this.tileMap = tileMap;
    this.cfg = cfg;

    // Graphics child — all cat drawing goes here
    // Use make.graphics (not add.graphics) so it is NOT added to the scene's root
    // display list. Only the Container registration below counts — avoids a ghost
    // render at world origin.
    this.gfx = scene.make.graphics({});
    this.add(this.gfx);

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

    // Initial draw
    this.redraw();
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

    // ── 5. Redraw if state or facing changed ────────────────────────────────
    if (this.playerState !== this.lastDrawnState || this.facingX !== this.lastDrawnFacing) {
      this.redraw();
    }
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

  // ── Drawing ──────────────────────────────────────────────────────────────────
  /** Redraws Billu entirely based on current state + facing direction. */
  private redraw(): void {
    this.lastDrawnState = this.playerState;
    this.lastDrawnFacing = this.facingX;

    const g = this.gfx;
    g.clear();

    // Mirror the entire Graphics object when facing left. All draw calls below
    // use right-facing constants only (no fx multiplier). Phaser mirrors
    // the Graphics around its origin (the container center) when scaleX = -1.
    g.scaleX = this.facingX;

    switch (this.playerState) {
      case PlayerState.WALK:
        this.drawWalk(g);
        break;
      case PlayerState.CROUCH:
        this.drawCrouch(g);
        break;
      case PlayerState.FREEZE:
        this.drawFreeze(g);
        break;
    }
  }

  /**
   * WALK state — upright desi street cat, 3× larger than original.
   * Body ~36×28px, head radius 10px, proper anatomy with shadow + outline.
   * All coordinates are right-facing; scaleX handles left-facing mirroring.
   */
  private drawWalk(g: Phaser.GameObjects.Graphics): void {
    // ── Ground shadow ── drawn first (behind everything)
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(0, 14, 32, 8);

    // ── Body outline + fill ──
    g.fillStyle(0x331100, 1);
    g.fillRoundedRect(-20, -10, 38, 30, 5); // outline (1px bigger each side)
    g.fillStyle(0xE8751A, 1);
    g.fillRoundedRect(-19, -9, 36, 28, 4);  // actual body

    // ── Belly patch (cream oval) ──
    g.fillStyle(0xF5D5A0, 1);
    g.fillEllipse(0, 3, 18, 14);

    // ── Legs — 4 rounded stubs ──
    g.fillStyle(0xC05E10, 1);
    g.fillRoundedRect(8,   16, 8, 12, 3); // front-right
    g.fillRoundedRect(-2,  16, 8, 12, 3); // front-left
    g.fillRoundedRect(-8,  16, 7, 10, 3); // back-right
    g.fillRoundedRect(-14, 16, 7, 10, 3); // back-left

    // ── Tail — thick kinked line behind body ──
    g.lineStyle(4, 0xC05E10, 1);
    g.beginPath();
    g.moveTo(-19, 5);
    g.lineTo(-28, -5);
    g.lineTo(-24, -16);
    g.strokePath();

    // ── Head outline + fill ──
    g.fillStyle(0x331100, 1);
    g.fillCircle(10, -22, 12); // outline (1px bigger)
    g.fillStyle(0xF0963A, 1);
    g.fillCircle(10, -22, 11); // actual head

    // ── Head highlight (light spot) ──
    g.fillStyle(0xFFB060, 0.4);
    g.fillCircle(7, -26, 5);

    // ── Ears — left ──
    g.fillStyle(0xE8751A, 1);
    g.fillTriangle(1, -33, 6, -33, 3, -44);   // outer left ear
    g.fillStyle(0xFFAABB, 1);
    g.fillTriangle(2, -33, 5, -33, 3, -41);   // pink inner left ear

    // ── Ears — right ──
    g.fillStyle(0xE8751A, 1);
    g.fillTriangle(12, -33, 17, -33, 18, -44); // outer right ear
    g.fillStyle(0xFFAABB, 1);
    g.fillTriangle(13, -33, 16, -33, 17, -41); // pink inner right ear

    // ── Eyes — bright green with dark pupils ──
    g.fillStyle(0x22CC44, 1);
    g.fillCircle(5, -23, 4);   // left eye (green)
    g.fillStyle(0x111111, 1);
    g.fillCircle(5, -23, 2);   // left pupil
    g.fillStyle(0x22CC44, 1);
    g.fillCircle(14, -23, 4);  // right eye (green)
    g.fillStyle(0x111111, 1);
    g.fillCircle(14, -23, 2);  // right pupil

    // ── Nose — tiny pink triangle ──
    g.fillStyle(0xFF7788, 1);
    g.fillTriangle(8, -18, 12, -18, 10, -16);

    // ── Whiskers ──
    g.lineStyle(1, 0xFFDDCC, 0.6);
    g.beginPath();
    g.moveTo(5, -18);
    g.lineTo(-8, -16);
    g.strokePath();
    g.beginPath();
    g.moveTo(14, -18);
    g.lineTo(27, -16);
    g.strokePath();
  }

  /**
   * CROUCH state — squashed body, flattened ears, slit eyes, flat tail.
   * All coordinates are right-facing; scaleX handles left-facing mirroring.
   */
  private drawCrouch(g: Phaser.GameObjects.Graphics): void {
    // ── Ground shadow ── slightly wider when crouching
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(0, 16, 38, 6);

    // ── Body outline + fill (squashed) ──
    g.fillStyle(0x331100, 1);
    g.fillRoundedRect(-20, -4, 38, 22, 5); // outline
    g.fillStyle(0xD06A18, 1);              // slightly darker when crouching
    g.fillRoundedRect(-19, -3, 36, 20, 4); // squashed body

    // ── Belly patch ──
    g.fillStyle(0xF5D5A0, 1);
    g.fillEllipse(0, 6, 18, 10);

    // ── Legs — stubs visible below squashed body ──
    g.fillStyle(0xC05E10, 1);
    g.fillRoundedRect(8,   14, 8, 8, 3);
    g.fillRoundedRect(-2,  14, 8, 8, 3);
    g.fillRoundedRect(-8,  14, 7, 6, 3);
    g.fillRoundedRect(-14, 14, 7, 6, 3);

    // ── Tail — flat along ground ──
    g.lineStyle(4, 0xC05E10, 1);
    g.beginPath();
    g.moveTo(-19, 8);
    g.lineTo(-30, 8);
    g.strokePath();

    // ── Head outline + fill (drops lower) ──
    g.fillStyle(0x331100, 1);
    g.fillCircle(10, -14, 12);
    g.fillStyle(0xD06A18, 1);
    g.fillCircle(10, -14, 10);

    // ── Head highlight ──
    g.fillStyle(0xFFB060, 0.3);
    g.fillCircle(7, -17, 4);

    // ── Ears — flattened sideways ──
    g.fillStyle(0xD06A18, 1);
    // Left ear — points left
    g.fillTriangle(1, -20, 1, -16, -8, -18);
    g.fillStyle(0xFFAABB, 1);
    g.fillTriangle(1, -19, 1, -17, -5, -18);
    // Right ear — points right
    g.fillStyle(0xD06A18, 1);
    g.fillTriangle(18, -20, 18, -16, 27, -18);
    g.fillStyle(0xFFAABB, 1);
    g.fillTriangle(18, -19, 18, -17, 24, -18);

    // ── Eyes — horizontal slits (crouching/stalking) ──
    g.fillStyle(0x111111, 1);
    g.fillRect(3, -15, 6, 2);   // left eye slit
    g.fillRect(12, -15, 6, 2);  // right eye slit

    // ── Nose ──
    g.fillStyle(0xFF7788, 1);
    g.fillTriangle(8, -10, 12, -10, 10, -8);

    // ── Whiskers ──
    g.lineStyle(1, 0xFFDDCC, 0.6);
    g.beginPath();
    g.moveTo(5, -10);
    g.lineTo(-8, -8);
    g.strokePath();
    g.beginPath();
    g.moveTo(14, -10);
    g.lineTo(27, -8);
    g.strokePath();
  }

  /**
   * FREEZE state — desaturated body, squinting eyes, frost star, blue tint overlay.
   * All coordinates are right-facing; scaleX handles left-facing mirroring.
   */
  private drawFreeze(g: Phaser.GameObjects.Graphics): void {
    // ── Ground shadow ──
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(0, 14, 32, 8);

    // ── Body outline + fill (desaturated) ──
    g.fillStyle(0x331100, 1);
    g.fillRoundedRect(-20, -10, 38, 30, 5);
    g.fillStyle(0x8B6E5A, 1); // desaturated warm grey
    g.fillRoundedRect(-19, -9, 36, 28, 4);

    // ── Blue frost tint overlay ──
    g.fillStyle(0x8899CC, 0.2);
    g.fillRoundedRect(-19, -9, 36, 28, 4);

    // ── Belly patch (muted) ──
    g.fillStyle(0xD5BFA0, 1);
    g.fillEllipse(0, 3, 18, 14);

    // ── Legs ──
    g.fillStyle(0x7A5E4A, 1);
    g.fillRoundedRect(8,   16, 8, 12, 3);
    g.fillRoundedRect(-2,  16, 8, 12, 3);
    g.fillRoundedRect(-8,  16, 7, 10, 3);
    g.fillRoundedRect(-14, 16, 7, 10, 3);

    // ── Tail — same position as walk ──
    g.lineStyle(4, 0x7A5E4A, 1);
    g.beginPath();
    g.moveTo(-19, 5);
    g.lineTo(-28, -5);
    g.lineTo(-24, -16);
    g.strokePath();

    // ── Head outline + fill (desaturated) ──
    g.fillStyle(0x331100, 1);
    g.fillCircle(10, -22, 12);
    g.fillStyle(0x9E7E6A, 1);
    g.fillCircle(10, -22, 11);

    // ── Blue frost tint on head ──
    g.fillStyle(0x8899CC, 0.2);
    g.fillCircle(10, -22, 11);

    // ── Ears ──
    g.fillStyle(0x8B6E5A, 1);
    g.fillTriangle(1, -33, 6, -33, 3, -44);
    g.fillStyle(0xCC9999, 1); // muted pink inner
    g.fillTriangle(2, -33, 5, -33, 3, -41);
    g.fillStyle(0x8B6E5A, 1);
    g.fillTriangle(12, -33, 17, -33, 18, -44);
    g.fillStyle(0xCC9999, 1);
    g.fillTriangle(13, -33, 16, -33, 17, -41);

    // ── Eyes — squinting slits (frozen) ──
    g.fillStyle(0x111111, 1);
    g.fillRect(3, -24, 6, 2);   // left eye slit
    g.fillRect(12, -24, 6, 2);  // right eye slit

    // ── Nose ──
    g.fillStyle(0xCC6677, 1);
    g.fillTriangle(8, -18, 12, -18, 10, -16);

    // ── Whiskers ──
    g.lineStyle(1, 0xCCCCDD, 0.5);
    g.beginPath();
    g.moveTo(5, -18);
    g.lineTo(-8, -16);
    g.strokePath();
    g.beginPath();
    g.moveTo(14, -18);
    g.lineTo(27, -16);
    g.strokePath();

    // ── Frost star above head — 5 lines (cross + diagonals) ──
    const starCX = 10;
    const starCY = -38; // above head
    const starR = 6;
    const diag = Math.round(starR * 0.707); // ~4px
    g.lineStyle(1.5, 0xCCEEFF, 1);
    // Horizontal arm
    g.beginPath();
    g.moveTo(starCX - starR, starCY);
    g.lineTo(starCX + starR, starCY);
    g.strokePath();
    // Vertical arm
    g.beginPath();
    g.moveTo(starCX, starCY - starR);
    g.lineTo(starCX, starCY + starR);
    g.strokePath();
    // Diagonal /
    g.beginPath();
    g.moveTo(starCX - diag, starCY + diag);
    g.lineTo(starCX + diag, starCY - diag);
    g.strokePath();
    // Diagonal \
    g.beginPath();
    g.moveTo(starCX - diag, starCY - diag);
    g.lineTo(starCX + diag, starCY + diag);
    g.strokePath();
    // Extra short horizontal tick (5th line — sparkle effect)
    g.beginPath();
    g.moveTo(starCX - 3, starCY - 3);
    g.lineTo(starCX + 3, starCY - 3);
    g.strokePath();
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
