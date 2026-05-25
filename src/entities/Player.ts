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

    // Sample all 4 corners of the 12×12 hitbox
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
   * WALK state — upright orange-brown cat.
   * Body is centered at origin; head above; ears, eyes, tail, legs.
   * All coordinates are right-facing; scaleX handles left-facing mirroring.
   */
  private drawWalk(g: Phaser.GameObjects.Graphics): void {
    // ── Body ── warm orange-brown rounded rect 12×10, centered
    const bW = 12; const bH = 10;
    const bX = -bW / 2; // left edge of body
    const bY = -bH / 2; // top edge of body (centered vertically)
    g.fillStyle(0xc87941, 1);
    g.fillRoundedRect(bX, bY, bW, bH, 2);

    // ── Legs ── 4 tiny dark-orange rects at bottom corners of body
    g.fillStyle(0xb06030, 1);
    const legW = 2; const legH = 4;
    g.fillRect(bX + 1,             bY + bH - 1, legW, legH);
    g.fillRect(bX + bW - 1 - legW, bY + bH - 1, legW, legH);
    g.fillRect(bX + 2,             bY + bH,     legW, legH - 1);
    g.fillRect(bX + bW - 2 - legW, bY + bH,     legW, legH - 1);

    // ── Tail ── quadratic curve behind the body (left side when facing right)
    // Control point: dx+8 dy-8 from start; end: dx+12 dy-3
    g.lineStyle(2, 0xb06030, 1);
    const tailStartX = bX - 1;      // just behind back of body
    const tailStartY = 0;
    const tailCpX = tailStartX - 8;
    const tailCpY = tailStartY - 8;
    const tailEndX = tailStartX - 12;
    const tailEndY = tailStartY - 3;
    g.beginPath();
    g.moveTo(tailStartX, tailStartY);
    // quadraticCurveTo exists on Phaser.GameObjects.Graphics at runtime but is
    // missing from the bundled Phaser type declarations — cast to access it.
    (g as unknown as { quadraticCurveTo(cpX: number, cpY: number, x: number, y: number): void })
      .quadraticCurveTo(tailCpX, tailCpY, tailEndX, tailEndY);
    g.strokePath();

    // ── Head ── slightly lighter circle, above body center
    const headR = 4; // radius = 4 → 8px diameter
    const headCX = 2; // slightly forward (toward facing direction = right)
    const headCY = bY - headR;
    g.fillStyle(0xd4894d, 1);
    g.fillCircle(headCX, headCY, headR);

    // ── Ears ── two triangles at top of head (right-facing: back ear at left, front ear at right)
    g.fillStyle(0xc87941, 1);
    // Back ear (left side of head)
    g.fillTriangle(
      headCX - 3, headCY - headR,     // outer base
      headCX - 1, headCY - headR,     // inner base
      headCX - 3, headCY - headR - 4  // tip
    );
    // Front ear (right side of head)
    g.fillTriangle(
      headCX + 1, headCY - headR,
      headCX + 3, headCY - headR,
      headCX + 3, headCY - headR - 4
    );

    // ── Eyes ── two tiny dark dots
    g.fillStyle(0x1a1a1a, 1);
    g.fillRect(headCX - 3, headCY - 1, 2, 2); // back eye
    g.fillRect(headCX + 0, headCY - 1, 2, 2); // front eye
  }

  /**
   * CROUCH state — squashed body, flattened ears, slit eyes.
   * All coordinates are right-facing; scaleX handles left-facing mirroring.
   */
  private drawCrouch(g: Phaser.GameObjects.Graphics): void {
    // ── Body ── squashed to 12×7
    const bW = 12; const bH = 7;
    const bX = -bW / 2;
    const bY = -bH / 2;
    g.fillStyle(0xc87941, 1);
    g.fillRoundedRect(bX, bY, bW, bH, 2);

    // ── Legs — barely visible stubs ──
    g.fillStyle(0xb06030, 1);
    const legW = 2; const legH = 3;
    g.fillRect(bX + 1,             bY + bH - 1, legW, legH);
    g.fillRect(bX + bW - 1 - legW, bY + bH - 1, legW, legH);

    // ── Tail ── low and flat behind body ──
    g.lineStyle(2, 0xb06030, 1);
    g.beginPath();
    g.moveTo(bX - 1, 2);
    g.lineTo(bX - 5, 2);
    g.strokePath();

    // ── Head ── closer to body (body is squashed, head drops down)
    const headR = 4;
    const headCX = 2;
    const headCY = bY - headR + 1; // 1px closer than walk
    g.fillStyle(0xd4894d, 1);
    g.fillCircle(headCX, headCY, headR);

    // ── Ears ── flattened, pointing sideways
    g.fillStyle(0xc87941, 1);
    // Back ear (flat triangle, pointing away from face = left)
    g.fillTriangle(
      headCX - headR,     headCY - 1,
      headCX - headR,     headCY + 2,
      headCX - headR - 4, headCY
    );
    // Front ear (right)
    g.fillTriangle(
      headCX + headR - 1, headCY - 1,
      headCX + headR - 1, headCY + 2,
      headCX + headR + 3, headCY
    );

    // ── Eyes ── slit (2×1px horizontal lines) ──
    g.fillStyle(0x1a1a1a, 1);
    g.fillRect(headCX - 3, headCY, 2, 1);
    g.fillRect(headCX + 0, headCY, 2, 1);
  }

  /**
   * FREEZE state — desaturated cool body, frost star above head.
   * All coordinates are right-facing; scaleX handles left-facing mirroring.
   */
  private drawFreeze(g: Phaser.GameObjects.Graphics): void {
    // ── Body ── desaturated cool tint
    const bW = 12; const bH = 10;
    const bX = -bW / 2;
    const bY = -bH / 2;
    g.fillStyle(0x9a7060, 1);
    g.fillRoundedRect(bX, bY, bW, bH, 2);

    // ── Legs ──
    g.fillStyle(0x806050, 1);
    const legW = 2; const legH = 4;
    g.fillRect(bX + 1,             bY + bH - 1, legW, legH);
    g.fillRect(bX + bW - 1 - legW, bY + bH - 1, legW, legH);
    g.fillRect(bX + 2,             bY + bH,     legW, legH - 1);
    g.fillRect(bX + bW - 2 - legW, bY + bH,     legW, legH - 1);

    // ── Tail ──
    g.lineStyle(2, 0x806050, 1);
    g.beginPath();
    g.moveTo(bX - 1, 0);
    g.lineTo(bX - 4, -4);
    g.strokePath();

    // ── Head ── cool tint
    const headR = 4;
    const headCX = 2;
    const headCY = bY - headR;
    g.fillStyle(0xaa8878, 1);
    g.fillCircle(headCX, headCY, headR);

    // ── Ears ──
    g.fillStyle(0x9a7060, 1);
    g.fillTriangle(
      headCX - 3, headCY - headR,
      headCX - 1, headCY - headR,
      headCX - 3, headCY - headR - 4
    );
    g.fillTriangle(
      headCX + 1, headCY - headR,
      headCX + 3, headCY - headR,
      headCX + 3, headCY - headR - 4
    );

    // ── Eyes ── squinting (frozen)
    g.fillStyle(0x1a1a1a, 1);
    g.fillRect(headCX - 3, headCY, 2, 1);
    g.fillRect(headCX + 0, headCY, 2, 1);

    // ── Frost star ── 4 crossing lines above head (white glint)
    // Center of star: above head; star is symmetric so scaleX mirroring is neutral
    const starCX = headCX;
    const starCY = headCY - headR - 5;
    const starR = 3;
    g.lineStyle(1, 0xffffff, 1);
    // Horizontal
    g.beginPath();
    g.moveTo(starCX - starR, starCY);
    g.lineTo(starCX + starR, starCY);
    g.strokePath();
    // Vertical
    g.beginPath();
    g.moveTo(starCX, starCY - starR);
    g.lineTo(starCX, starCY + starR);
    g.strokePath();
    // Diagonal /
    g.beginPath();
    g.moveTo(starCX - 2, starCY + 2);
    g.lineTo(starCX + 2, starCY - 2);
    g.strokePath();
    // Diagonal \
    g.beginPath();
    g.moveTo(starCX - 2, starCY - 2);
    g.lineTo(starCX + 2, starCY + 2);
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
