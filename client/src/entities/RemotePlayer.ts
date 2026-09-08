/**
 * Another player's avatar.
 *
 * 05: the server sends discrete tile-move events, not per-frame positions, and
 * the client interpolates between them. 10 is specific about how:
 *
 *   - tween with the SAME 130ms walk timing as the local player, so a friend
 *     moves at your visual cadence even though the wire message was a single
 *     snap-to-value;
 *   - if an update is delayed and they jump more than one tile, SNAP rather
 *     than fast-tweening across the gap — "a subtle pop reads better than a
 *     weird zoom".
 */

import Phaser from 'phaser';
import type { Direction, PlayerStatus, TileCoord } from '@commons/shared';
import { CHAT_LIMITS, COLORS, NETWORK, TYPOGRAPHY, hex } from '@commons/shared';
import { registerCharacterAnimations, idleFrameIndex, walkAnimKey } from '../art/characterAnimations';
import { ASSET_KEYS, drinkTextureKey } from '../art/placeholderArt';
import { tileToWorld } from '../systems/GridMovement';

export interface RemotePlayerOptions {
  id: string;
  displayName: string;
  spriteKey?: string;
  tile: TileCoord;
  facing?: Direction;
  status?: PlayerStatus;
}

export class RemotePlayer {
  readonly id: string;
  readonly displayName: string;
  readonly textureKey: string;
  readonly sprite: Phaser.GameObjects.Sprite;

  tile: TileCoord;
  facing: Direction;
  status: PlayerStatus;

  private readonly nameplate: Phaser.GameObjects.Text;
  private readonly statusIcon: Phaser.GameObjects.Arc;
  /**
   * The drink they are holding (03). Created lazily and destroyed when they put
   * it down, so the overwhelming majority of players cost nothing extra.
   */
  private drinkIcon?: Phaser.GameObjects.Image;
  drink = '';
  private moveTween?: Phaser.Tweens.Tween;
  private bubble?: Phaser.GameObjects.Text;
  private bubbleTimer?: Phaser.Time.TimerEvent;

  constructor(private readonly scene: Phaser.Scene, options: RemotePlayerOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.tile = { ...options.tile };
    this.facing = options.facing ?? 'down';
    this.status = options.status ?? 'idle';

    // Fall back only if the chosen sheet was never generated; otherwise honour
    // the player's own sprite choice.
    const requested = options.spriteKey;
    this.textureKey =
      requested && scene.textures.exists(requested) ? requested : ASSET_KEYS.remoteSheet;
    registerCharacterAnimations(scene, this.textureKey);
    const textureKey = this.textureKey;

    const world = tileToWorld(this.tile);
    this.sprite = scene.add
      .sprite(world.x, world.y, textureKey, idleFrameIndex(this.facing))
      .setOrigin(0.5, 1)
      .setDepth(world.y);

    this.nameplate = scene.add
      .text(world.x, world.y - 34, options.displayName, {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '8px',
        color: COLORS.hudText,
        backgroundColor: COLORS.hudBg,
        padding: { x: 3, y: 1 },
      })
      .setOrigin(0.5, 1)
      .setDepth(world.y + 400);

    // Status dot. Shape + color together, per 07's colorblind-safe note; the
    // icon set (book / note / zzz) replaces this in Phase 3.
    this.statusIcon = scene.add
      .circle(world.x + 10, world.y - 32, 3, hex(COLORS.statusAfk))
      .setOrigin(0.5)
      .setDepth(world.y + 401)
      .setVisible(false);

    this.applyStatus(this.status);
  }

  /** Apply an authoritative position update from the server. */
  moveTo(tile: TileCoord, facing: Direction): void {
    this.setFacing(facing);

    const unchanged = tile.x === this.tile.x && tile.y === this.tile.y;
    if (unchanged) return;

    const distance = Math.abs(tile.x - this.tile.x) + Math.abs(tile.y - this.tile.y);
    this.tile = { ...tile };
    const world = tileToWorld(this.tile);

    // stop() does not fire onComplete, so the handle must be cleared by hand —
    // otherwise setFacing()'s `if (!this.moveTween)` guard stays false forever
    // and this avatar never re-renders a turn again.
    this.moveTween?.stop();
    this.moveTween = undefined;

    // More than one tile means we missed an update. Snap.
    if (distance > NETWORK.snapThresholdTiles) {
      this.setPosition(world.x, world.y);
      this.showIdleFrame();
      return;
    }

    this.sprite.anims.play(walkAnimKey(this.textureKey, facing), true);
    this.moveTween = this.scene.tweens.add({
      targets: this.sprite,
      x: world.x,
      y: world.y,
      duration: NETWORK.remoteTweenMs,
      ease: 'Linear',
      onUpdate: () => this.syncAttachments(),
      onComplete: () => {
        this.moveTween = undefined;
        this.syncAttachments();
        this.showIdleFrame();
      },
    });
  }

  /**
   * Speech bubble over the head (05). Long messages are elided here and read in
   * full in the log — a bubble that grows to fit a paragraph covers the world.
   */
  say(text: string): void {
    const shown =
      text.length > CHAT_LIMITS.bubbleMaxChars
        ? `${text.slice(0, CHAT_LIMITS.bubbleMaxChars - 1)}…`
        : text;

    this.bubbleTimer?.remove();
    this.bubble?.destroy();

    this.bubble = this.scene.add
      .text(this.sprite.x, this.sprite.y - 54, shown, {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
        backgroundColor: COLORS.dialogueBoxBg,
        padding: { x: 8, y: 5 },
        wordWrap: { width: 220 },
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setDepth(this.sprite.y + 500);

    this.bubbleTimer = this.scene.time.delayedCall(CHAT_LIMITS.bubbleMs, () => {
      this.bubble?.destroy();
      this.bubble = undefined;
    });
  }

  setFacing(facing: Direction): void {
    if (this.facing === facing) return;
    this.facing = facing;
    if (!this.moveTween) this.showIdleFrame();
  }

  /** Show, swap, or clear the mug above this player's head. */
  applyDrink(drink: string): void {
    this.drink = drink;

    if (!drink) {
      this.drinkIcon?.destroy();
      this.drinkIcon = undefined;
      return;
    }

    const key = drinkTextureKey(drink);
    if (!this.scene.textures.exists(key)) return;

    if (!this.drinkIcon) {
      this.drinkIcon = this.scene.add.image(this.sprite.x - 14, this.sprite.y - 34, key).setOrigin(0.5, 1);
    } else {
      this.drinkIcon.setTexture(key);
    }
    this.syncAttachments();
  }

  applyStatus(status: PlayerStatus): void {
    this.status = status;
    const color = {
      idle: COLORS.statusAfk,
      studying: COLORS.statusStudying,
      listening: COLORS.statusListening,
      afk: COLORS.statusAfk,
    }[status];

    this.statusIcon.setFillStyle(hex(color));
    this.statusIcon.setVisible(status !== 'idle');
  }

  private setPosition(x: number, y: number): void {
    this.sprite.setPosition(x, y);
    this.syncAttachments();
  }

  private syncAttachments(): void {
    this.sprite.setDepth(this.sprite.y);
    this.nameplate.setPosition(this.sprite.x, this.sprite.y - 34).setDepth(this.sprite.y + 400);
    this.statusIcon.setPosition(this.sprite.x + 10, this.sprite.y - 32).setDepth(this.sprite.y + 401);
    this.drinkIcon?.setPosition(this.sprite.x - 15, this.sprite.y - 30).setDepth(this.sprite.y + 401);
    this.bubble?.setPosition(this.sprite.x, this.sprite.y - 54).setDepth(this.sprite.y + 500);
  }

  private showIdleFrame(): void {
    this.sprite.anims.stop();
    this.sprite.setFrame(idleFrameIndex(this.facing));
  }

  destroy(): void {
    this.moveTween?.stop();
    this.bubbleTimer?.remove();
    this.bubble?.destroy();
    this.sprite.destroy();
    this.nameplate.destroy();
    this.statusIcon.destroy();
    this.drinkIcon?.destroy();
  }
}
