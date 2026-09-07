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
import { COLORS, NETWORK, TYPOGRAPHY, hex } from '@commons/shared';
import { registerCharacterAnimations, idleFrameIndex, walkAnimKey } from '../art/characterAnimations';
import { ASSET_KEYS } from '../art/placeholderArt';
import { tileToWorld } from '../systems/GridMovement';

const ANIM_PREFIX = 'remote';

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
  readonly sprite: Phaser.GameObjects.Sprite;

  tile: TileCoord;
  facing: Direction;
  status: PlayerStatus;

  private readonly nameplate: Phaser.GameObjects.Text;
  private readonly statusIcon: Phaser.GameObjects.Arc;
  private moveTween?: Phaser.Tweens.Tween;

  constructor(private readonly scene: Phaser.Scene, options: RemotePlayerOptions) {
    this.id = options.id;
    this.displayName = options.displayName;
    this.tile = { ...options.tile };
    this.facing = options.facing ?? 'down';
    this.status = options.status ?? 'idle';

    const textureKey = options.spriteKey ?? ASSET_KEYS.remoteSheet;
    registerCharacterAnimations(scene, ANIM_PREFIX, textureKey);

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

    this.moveTween?.stop();

    // More than one tile means we missed an update. Snap.
    if (distance > NETWORK.snapThresholdTiles) {
      this.setPosition(world.x, world.y);
      this.showIdleFrame();
      return;
    }

    this.sprite.anims.play(walkAnimKey(ANIM_PREFIX, facing), true);
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

  setFacing(facing: Direction): void {
    if (this.facing === facing) return;
    this.facing = facing;
    if (!this.moveTween) this.showIdleFrame();
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
  }

  private showIdleFrame(): void {
    this.sprite.anims.stop();
    this.sprite.setFrame(idleFrameIndex(this.facing));
  }

  destroy(): void {
    this.moveTween?.stop();
    this.sprite.destroy();
    this.nameplate.destroy();
    this.statusIcon.destroy();
  }
}
