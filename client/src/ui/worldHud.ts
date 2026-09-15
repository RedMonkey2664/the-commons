/**
 * Fading the world HUD out from under a full-screen scene.
 *
 * Focus Mode and the journey screen both cover the world, and both need the
 * zone's HUD — its zone pill, connection state, chat prompt and control hints —
 * to get out of the way. Done on the UI scene's CAMERA rather than by hiding
 * its objects: everything it owns keeps running and keeps its state (the focus
 * timer carries on counting), and there is nothing to restore afterwards but
 * an alpha.
 *
 * Extracted because the second scene to need it is the point at which two
 * copies start to drift.
 */

import Phaser from 'phaser';

const UI_SCENE_KEY = 'UIScene';

export function fadeWorldHud(scene: Phaser.Scene, alpha: number, duration: number): void {
  const camera = scene.scene.get(UI_SCENE_KEY)?.cameras?.main;
  if (!camera) return;

  scene.tweens.add({ targets: camera, alpha, duration, ease: 'Sine.easeInOut' });
}

/**
 * Put it back without animating.
 *
 * For teardown: a scene stopped mid-fade would otherwise leave the HUD at
 * whatever alpha it had reached, with nothing left running to finish the job.
 */
export function restoreWorldHud(scene: Phaser.Scene): void {
  const camera = scene.scene.get(UI_SCENE_KEY)?.cameras?.main;
  if (camera) camera.setAlpha(1);
}
