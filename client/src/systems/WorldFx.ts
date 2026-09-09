/**
 * Small world effects — 10's "cheap, high impact" budget, spent on the moments
 * the player causes rather than the ones the map does.
 *
 * AmbientAnimator already animates the WORLD: grass sways, steam rises, bulbs
 * drift. Nothing animated in response to the PLAYER, so walking across a plaza
 * felt like sliding a token over a board. These are the reactive half:
 *
 *   - dust under a footfall, so a step lands on something
 *   - a ripple where someone arrives in a zone, so a door is an event
 *   - a soft settle on the tile you turn to face
 *
 * Every effect here is fire-and-forget: it creates its own object, tweens it,
 * and destroys it on completion. None of them touch the player sprite, because
 * movement and the sit poses already own its position and scaleY — a second
 * tween on either fights the first and the player visibly stutters.
 *
 * All of it is capped. `live` counts what is on screen and refuses new effects
 * past a ceiling, so a room full of people walking cannot turn into a particle
 * demo on a laptop.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, hex } from '@commons/shared';

const TILE = SPACING.tile;

/**
 * Ceiling on simultaneous effects. Twenty-four is roughly a full room walking
 * at once; past that the newest are simply dropped, which is invisible in
 * practice because they last a third of a second.
 */
const MAX_LIVE = 24;

export class WorldFx {
  private live = 0;

  constructor(private readonly scene: Phaser.Scene) {}

  private track(object: Phaser.GameObjects.GameObject): void {
    this.live += 1;
    object.once(Phaser.GameObjects.Events.DESTROY, () => {
      this.live -= 1;
    });
  }

  private get saturated(): boolean {
    return this.live >= MAX_LIVE;
  }

  /**
   * A puff under a completed step.
   *
   * Drawn at the sprite's feet and BEHIND it (depth just under the walker's own
   * y-sorted depth), so it reads as under the shoe rather than over it.
   */
  footstep(x: number, y: number): void {
    if (this.saturated) return;

    const puff = this.scene.add
      .ellipse(x, y - 2, 12, 5, hex(COLORS.pavingDark), 0.5)
      .setDepth(y - 1);

    this.track(puff);
    this.scene.tweens.add({
      targets: puff,
      scaleX: 1.9,
      scaleY: 1.5,
      alpha: 0,
      duration: 320,
      ease: 'Quad.easeOut',
      onComplete: () => puff.destroy(),
    });
  }

  /**
   * A ring where somebody appears — walking in through a door, or joining the
   * room. Presence is the whole point of the game, so an arrival should be
   * something you notice out of the corner of your eye.
   */
  arrival(x: number, y: number, color: string = COLORS.dialogueBoxAccent): void {
    if (this.saturated) return;

    const ring = this.scene.add.circle(x, y, TILE * 0.35);
    ring.setStrokeStyle(2, hex(color), 0.9);
    ring.setFillStyle(hex(color), 0.12);
    ring.setDepth(y - 1);

    this.track(ring);
    this.scene.tweens.add({
      targets: ring,
      scale: 2.1,
      alpha: 0,
      duration: 520,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
  }

  /**
   * A brief highlight on the tile an interaction landed on.
   *
   * The "!" bubble says what CAN be interacted with; this confirms that the
   * press was received, which is a different question and the one that gets
   * asked when a key does not seem to have done anything.
   */
  interactPulse(tileX: number, tileY: number): void {
    if (this.saturated) return;

    const x = tileX * TILE + TILE / 2;
    const y = tileY * TILE + TILE / 2;

    const square = this.scene.add
      .rectangle(x, y, TILE - 4, TILE - 4)
      .setStrokeStyle(2, hex(COLORS.interactBubbleMark), 0.85)
      .setDepth(y + 200);

    this.track(square);
    this.scene.tweens.add({
      targets: square,
      scale: 1.25,
      alpha: 0,
      duration: 380,
      ease: 'Quad.easeOut',
      onComplete: () => square.destroy(),
    });
  }
}
