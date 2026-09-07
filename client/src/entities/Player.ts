/**
 * The local player.
 *
 * Thin by design: it owns a sprite and a GridMovement, and exposes the state
 * that 05's PlayerState will be built from in Phase 1 (tile, facing, status).
 * All movement rules live in GridMovement so that RemotePlayer can share them.
 */

import Phaser from 'phaser';
import type { CharacterState, Direction, PlayerStatus, TileCoord } from '@commons/shared';
import { GridMovement } from '../systems/GridMovement';
import { registerCharacterAnimations } from '../art/characterAnimations';
import { ASSET_KEYS } from '../art/placeholderArt';

export interface PlayerOptions {
  tile: TileCoord;
  facing?: Direction;
  textureKey?: string;
  animPrefix?: string;
  isWalkable: (tile: TileCoord) => boolean;
  onDepart?: (from: TileCoord, to: TileCoord, facing: Direction) => void;
  onArrive?: (tile: TileCoord) => void;
  /** Fires on a turn that does not move — the network needs these too, or a
   *  remote player's facing goes stale whenever they turn on the spot. */
  onFacingChanged?: (facing: Direction) => void;
}

export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly movement: GridMovement;

  /**
   * Status is inferred from location and action, never set by a toggle — 11:
   * "Status flows from location + action, not manual toggles."
   */
  status: PlayerStatus = 'idle';

  constructor(scene: Phaser.Scene, options: PlayerOptions) {
    const textureKey = options.textureKey ?? ASSET_KEYS.playerSheet;
    const animPrefix = options.animPrefix ?? 'player';

    registerCharacterAnimations(scene, animPrefix, textureKey);

    this.sprite = scene.add.sprite(0, 0, textureKey, 0);
    this.movement = new GridMovement(scene, this.sprite, {
      tile: options.tile,
      facing: options.facing ?? 'down',
      isWalkable: options.isWalkable,
      animPrefix,
      onDepart: options.onDepart,
      onArrive: options.onArrive,
      onFacingChanged: options.onFacingChanged,
    });
  }

  get tile(): TileCoord {
    return this.movement.tile;
  }

  get facing(): Direction {
    return this.movement.facing;
  }

  get state(): CharacterState {
    return this.movement.state;
  }

  update(time: number, held: Direction | null): void {
    this.movement.update(time, held);
  }

  setBlocked(blocked: boolean): void {
    this.movement.setBlocked(blocked);
  }

  destroy(): void {
    this.movement.destroy();
    this.sprite.destroy();
  }
}
