/**
 * Interaction targeting and the "!" bubble.
 *
 * Two trigger paths, per 03/04:
 *   - Space  -> the tile directly in front of `facing` (signposts, NPCs).
 *   - Step   -> the tile you just walked onto (doors).
 *
 * The "!" bubble appears on any interactable within interact range, instantly
 * and with no fade. 10 is explicit that this is a functional cue rather than a
 * polish moment, and that latency here actively hurts usability.
 */

import Phaser from 'phaser';
import type { Direction, InteractableObject, TileCoord, ZoneConfig } from '@commons/shared';
import { SPACING, UI, tileInFront } from '@commons/shared';
import { ASSET_KEYS } from '../art/placeholderArt';
import type { ZoneMap } from './ZoneMap';
import {
  handlerFor,
  isPressInteractable,
  isStepInteractable,
  unhandled,
  type InteractionContext,
} from './InteractableRegistry';

const TILE = SPACING.tile;

export class InteractionSystem {
  /** One bubble per interactable id, created lazily and reused. */
  private readonly bubbles = new Map<string, Phaser.GameObjects.Image>();
  /** Its bob tween, so destroying a bubble doesn't leave the tween running. */
  private readonly bubbleTweens = new Map<string, Phaser.Tweens.Tween>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly zone: ZoneConfig,
    private readonly zoneMap: ZoneMap,
    private readonly setBlocked: (blocked: boolean) => void,
  ) {}

  private context(object: InteractableObject): InteractionContext {
    return { scene: this.scene, zone: this.zone, object, setBlocked: this.setBlocked };
  }

  /** Space. Returns true if something handled the press. */
  tryInteract(playerTile: TileCoord, facing: Direction): boolean {
    const target = tileInFront(playerTile, facing);
    const object = this.zoneMap.interactableAt(target);
    if (!object || !isPressInteractable(object.kind)) return false;

    const handler = handlerFor(object.kind);
    if (handler) handler(this.context(object));
    else unhandled(this.context(object));
    return true;
  }

  /** Called when the player finishes a step onto `tile`. Fires doors. */
  handleTileEntered(tile: TileCoord): boolean {
    const object = this.zoneMap.interactableAt(tile);
    if (!object || !isStepInteractable(object.kind)) return false;

    const handler = handlerFor(object.kind);
    if (handler) handler(this.context(object));
    return true;
  }

  /**
   * Refresh which bubbles are showing. Cheap enough to call every frame — it
   * only touches objects whose visibility actually changed.
   */
  refreshBubbles(playerTile: TileCoord): void {
    const inRange = new Set(
      this.zoneMap
        .interactablesNear(playerTile)
        .filter((object) => isPressInteractable(object.kind))
        .map((object) => object.id),
    );

    for (const object of this.zoneMap.interactables) {
      if (!isPressInteractable(object.kind)) continue;
      const shouldShow = inRange.has(object.id);
      const existing = this.bubbles.get(object.id);

      if (shouldShow && !existing) this.createBubble(object);
      else if (!shouldShow && existing) this.removeBubble(object.id);
    }
  }

  private createBubble(object: InteractableObject): void {
    const x = object.tile.x * TILE + TILE / 2;
    // Sit above the object's tile, clear of a 32px-tall sprite standing on it.
    const y = object.tile.y * TILE - 10;

    const bubble = this.scene.add
      .image(x, y, ASSET_KEYS.interactBubble)
      .setOrigin(0.5, 1)
      .setDepth(y + 500);

    // Appears instantly (appearMs is 0); the bob is idle motion only, so the
    // cue itself is never gated behind an animation.
    const bob = this.scene.tweens.add({
      targets: bubble,
      y: y - UI.interactBubble.bobPixels,
      duration: UI.interactBubble.bobMs,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.bubbles.set(object.id, bubble);
    this.bubbleTweens.set(object.id, bob);
  }

  private removeBubble(id: string): void {
    this.bubbleTweens.get(id)?.stop();
    this.bubbleTweens.delete(id);
    this.bubbles.get(id)?.destroy();
    this.bubbles.delete(id);
  }

  destroy(): void {
    for (const id of [...this.bubbles.keys()]) this.removeBubble(id);
  }
}
