/**
 * Character animation registration.
 *
 * One place that knows how a character sheet is laid out, so swapping in real
 * sprite sheets later means matching the frame layout (or changing it here),
 * not editing every scene.
 */

import Phaser from 'phaser';
import type { Direction } from '@commons/shared';
import { MOVEMENT } from '@commons/shared';
import { CHAR_FRAMES_PER_ROW, CHAR_ROWS } from './placeholderArt';

export function walkAnimKey(prefix: string, direction: Direction): string {
  return `${prefix}-walk-${direction}`;
}

/** First frame of a direction's cycle doubles as its idle pose (04). */
export function idleFrameIndex(direction: Direction): number {
  return CHAR_ROWS[direction] * CHAR_FRAMES_PER_ROW;
}

/**
 * Registers walk cycles for one character sheet.
 *
 * frameRate is MOVEMENT.walkFrameRate (8fps) — deliberately choppy. Per 10:
 * "not smooth 60fps human walking — the slight choppiness is the aesthetic."
 */
export function registerCharacterAnimations(
  scene: Phaser.Scene,
  prefix: string,
  textureKey: string,
): void {
  const directions: Direction[] = ['down', 'left', 'right', 'up'];

  for (const direction of directions) {
    const key = walkAnimKey(prefix, direction);
    if (scene.anims.exists(key)) continue;

    const base = CHAR_ROWS[direction] * CHAR_FRAMES_PER_ROW;
    scene.anims.create({
      key,
      // [idle, step-left, idle, step-right] — a full 4-frame cycle.
      frames: scene.anims.generateFrameNumbers(textureKey, {
        frames: [base, base + 1, base + 2, base + 3],
      }),
      frameRate: MOVEMENT.walkFrameRate,
      repeat: -1,
    });
  }
}
