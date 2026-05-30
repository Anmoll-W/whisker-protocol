// SceneTransition — global mutex for all scene changes in Whisker Protocol.
//
// P0 race fix: When Billu reaches the exit on the same frame a guard catches
// him, GameScene's update() calls both the Guard.EVENT_ALERTED handler
// (scene.launch('GameOverScene')) and the win-check branch
// (scene.launch('WinScene')).  Two scenes starting in the same Phaser update
// tick produces undefined overlay stacking and duplicate create() calls.
//
// Solution: one module-level boolean flag.  The first call to transitionTo()
// in a given frame sets it; every subsequent call in that frame is a no-op.
// The flag resets when Phaser's SceneManager finishes the transition (via the
// 'create' event on the launched scene, or on the next scene.start restart).

import Phaser from 'phaser';

/** True while a transition is in flight — no second scene may start. */
let _transitioning = false;

/**
 * Route ALL scene changes through this function.
 *
 * Behaviour:
 * - If no transition is in flight: pauses `caller`, launches `targetKey`
 *   (overlay model), passes optional `data` to the target scene's init(),
 *   and marks the lock.
 * - If a transition is already in flight: silently no-ops.  This is the
 *   fix for the WinScene / GameOverScene race.
 *
 * @param caller     The scene that wants to hand off (typically GameScene).
 * @param targetKey  The Phaser scene key to launch as an overlay.
 * @param data       Optional data forwarded to the target scene's init().
 */
export function transitionTo(
  caller: Phaser.Scene,
  targetKey: string,
  data?: Record<string, unknown>,
): void {
  if (_transitioning) return;
  _transitioning = true;

  // Pause the calling scene before launching the overlay.
  caller.scene.pause();
  caller.scene.launch(targetKey, data);

  // Reset the lock once the target scene's create() has run — i.e., the
  // transition is fully committed and the overlay is live.
  const target = caller.scene.get(targetKey);
  target.events.once(Phaser.Scenes.Events.CREATE, () => {
    _transitioning = false;
  });
}

/**
 * Restart the game from any overlay scene (WinScene / GameOverScene).
 *
 * Stops `overlayKey` and the stale GameScene, then cold-starts a fresh
 * GameScene.  Clears the transition lock so the new run can transition.
 *
 * @param caller      The overlay scene calling restart (WinScene or GameOverScene).
 * @param overlayKey  The scene key of that overlay (same as caller.scene.key).
 */
export function restartGame(caller: Phaser.Scene, overlayKey: string): void {
  // Clear lock first — we are about to do a hard scene.start which
  // resets scene state; any in-flight guard from the previous run is gone.
  _transitioning = false;

  caller.scene.stop(overlayKey);
  caller.scene.stop('GameScene');
  caller.scene.start('GameScene');
}
