/**
 * Grid movement — the FireRed feel, implemented to 04 and 10.
 *
 * Hard requirement from 04: one tile at a time, tweened, NOT free-form pixel
 * movement. Every timing here comes from shared/animationConfig.ts.
 *
 * Behaviour, in the order the player experiences it:
 *   - Tap a direction you aren't facing  -> turn in place, don't move.
 *   - Hold it                            -> turn, then walk, then keep walking.
 *   - Walk into something solid          -> face it, bump, stay put.
 *   - Hold a direction while walking     -> next tile starts the instant the
 *                                           current tween ends, no frame gap.
 *
 * This class drives a sprite but knows nothing about the map: walkability is
 * injected. That is what lets RemotePlayer (Phase 1) reuse the same tween
 * cadence for networked avatars, per 10's remote-interpolation section.
 */

import Phaser from 'phaser';
import type { CharacterState, Direction, TileCoord } from '@commons/shared';
import { BUMP, DIRECTION_VECTORS, MOVEMENT, SPACING, tileInFront } from '@commons/shared';
import { idleFrameIndex, walkAnimKey } from '../art/characterAnimations';

const TILE = SPACING.tile;

export type StepResult = 'moved' | 'turned' | 'blocked' | 'ignored';

export interface GridMovementOptions {
  /** Starting tile. */
  tile: TileCoord;
  facing?: Direction;
  /** Injected collision query. Returning false triggers a bump. */
  isWalkable: (tile: TileCoord) => boolean;
  /** Animation key prefix, e.g. 'player'. */
  animPrefix: string;
  /** Override the 130ms default (used by remote players and a future run toggle). */
  stepDurationMs?: number;
  /** Set 0 to move immediately on a direction press instead of turning first. */
  turnInPlaceMs?: number;
  /** Fires as a move BEGINS — the network hook, so intent is sent on commit. */
  onDepart?: (from: TileCoord, to: TileCoord, facing: Direction) => void;
  /** Fires as a move COMPLETES. */
  onArrive?: (tile: TileCoord) => void;
  onFacingChanged?: (facing: Direction) => void;
  onBump?: (facing: Direction) => void;
  onStateChanged?: (state: CharacterState) => void;
}

/** World pixel position for a tile: horizontally centred, feet on the tile floor. */
export function tileToWorld(tile: TileCoord): { x: number; y: number } {
  return { x: tile.x * TILE + TILE / 2, y: tile.y * TILE + TILE };
}

export class GridMovement {
  tile: TileCoord;
  facing: Direction;

  private _state: CharacterState = 'IDLE';
  private activeTween?: Phaser.Tweens.Tween;

  /** Direction held right now; consumed the instant a tween completes. */
  private bufferedDirection: Direction | null = null;

  /** Turn-in-place bookkeeping. */
  private turningDirection: Direction | null = null;
  private turnStartedAt = 0;

  private readonly stepDurationMs: number;
  private readonly turnInPlaceMs: number;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly sprite: Phaser.GameObjects.Sprite,
    private readonly options: GridMovementOptions,
  ) {
    this.tile = { ...options.tile };
    this.facing = options.facing ?? 'down';
    this.stepDurationMs = options.stepDurationMs ?? MOVEMENT.walkTileMs;
    this.turnInPlaceMs = options.turnInPlaceMs ?? MOVEMENT.turnInPlaceMs;

    // Feet-on-tile anchoring: a 16x32 sprite standing on a 16x16 tile.
    this.sprite.setOrigin(0.5, 1);
    this.snapSpriteToTile();
    this.showIdleFrame();
  }

  // -- state ---------------------------------------------------------------

  get state(): CharacterState {
    return this._state;
  }

  private setState(next: CharacterState): void {
    if (this._state === next) return;
    this._state = next;
    this.options.onStateChanged?.(next);
  }

  /** True while a tween owns the sprite. */
  get isBusy(): boolean {
    return this._state === 'WALKING';
  }

  /**
   * Locks movement (dialogue, zone transition, minigame). Per 10, BLOCKED
   * ignores WASD entirely, so a player cannot walk out from under a dialogue box.
   */
  setBlocked(blocked: boolean): void {
    if (blocked) {
      this.bufferedDirection = null;
      this.turningDirection = null;
      this.setState('BLOCKED');
      this.showIdleFrame();
    } else if (this._state === 'BLOCKED') {
      this.setState('IDLE');
    }
  }

  setSitting(sitting: boolean): void {
    if (sitting) {
      this.bufferedDirection = null;
      this.setState('SITTING');
    } else if (this._state === 'SITTING') {
      this.setState('IDLE');
    }
  }

  // -- per-frame -----------------------------------------------------------

  /**
   * @param time  Phaser's frame timestamp.
   * @param held  Direction the player is asking for, or null.
   */
  update(time: number, held: Direction | null): void {
    if (this._state === 'BLOCKED' || this._state === 'SITTING') {
      this.bufferedDirection = null;
      return;
    }

    if (this._state === 'WALKING') {
      // Buffer only. The tween's completion handler consumes this so the next
      // tile starts with no gap — this is what makes holding W feel continuous.
      this.bufferedDirection = held;
      return;
    }

    if (!held) {
      this.bufferedDirection = null;
      this.turningDirection = null;
      this.showIdleFrame();
      return;
    }

    this.bufferedDirection = held;

    // Turn in place first. A tap turns and stops; a hold turns then walks.
    //
    // The second clause is load-bearing: face() updates `facing` immediately,
    // so from the next frame onward `held !== facing` is false. Gating on the
    // turn we are actually mid-way through is what makes the delay last its
    // full duration instead of a single frame.
    if (held !== this.facing || this.turningDirection === held) {
      if (this.turningDirection !== held) {
        this.face(held);
        this.turningDirection = held;
        this.turnStartedAt = time;
      }
      if (time - this.turnStartedAt < this.turnInPlaceMs) return;
    }

    this.turningDirection = null;
    this.step(held);
  }

  // -- movement ------------------------------------------------------------

  /** Turn without moving. Used by the turn-in-place path and on a bump. */
  face(direction: Direction): void {
    if (this.facing === direction) return;
    this.facing = direction;
    this.showIdleFrame();
    this.options.onFacingChanged?.(direction);
  }

  /**
   * Attempt one tile step. Public so interactions and scripted movement can
   * drive a character without going through the input path.
   */
  step(direction: Direction): StepResult {
    if (this._state === 'BLOCKED' || this._state === 'SITTING' || this._state === 'WALKING') {
      return 'ignored';
    }

    this.face(direction);

    const target = tileInFront(this.tile, direction);
    if (!this.options.isWalkable(target)) {
      this.bump(direction);
      return 'blocked';
    }

    const from = { ...this.tile };
    this.tile = target;
    this.setState('WALKING');
    this.options.onDepart?.(from, target, direction);

    // `true` = ignoreIfPlaying, so chained tiles don't restart the walk cycle.
    this.sprite.anims.play(walkAnimKey(this.options.animPrefix, direction), true);

    const to = tileToWorld(target);
    this.activeTween = this.scene.tweens.add({
      targets: this.sprite,
      x: to.x,
      y: to.y,
      duration: this.stepDurationMs,
      // Snappy and deliberate; 10 explicitly rules out bounce/elastic here.
      ease: MOVEMENT.easing,
      onUpdate: () => this.syncDepth(),
      onComplete: () => {
        this.activeTween = undefined;
        this.setState('IDLE');
        this.syncDepth();
        this.options.onArrive?.({ ...this.tile });

        // Chain immediately rather than waiting for the next update() tick.
        const next = this.bufferedDirection;
        if (next && this._state === 'IDLE') this.step(next);
        else this.showIdleFrame();
      },
    });

    return 'moved';
  }

  /**
   * Blocked-movement feedback (10): quarter-tile nudge, spring back, and the
   * character still turns to face the obstacle — which matters because the
   * interact system targets the tile you're facing.
   */
  private bump(direction: Direction): void {
    if (this.activeTween) return;

    this.setState('WALKING'); // input-locked for the duration of the nudge
    this.showIdleFrame();
    this.options.onBump?.(direction);

    const vector = DIRECTION_VECTORS[direction];
    const origin = tileToWorld(this.tile);
    const nudge = TILE * BUMP.nudgeFraction;

    this.activeTween = this.scene.tweens.add({
      targets: this.sprite,
      x: origin.x + vector.x * nudge,
      y: origin.y + vector.y * nudge,
      duration: BUMP.nudgeMs,
      ease: BUMP.easing,
      yoyo: true,
      onComplete: () => {
        this.activeTween = undefined;
        this.snapSpriteToTile();
        this.setState('IDLE');
      },
    });
  }

  /** Hard-set position with no tween — spawns and zone arrivals. */
  teleport(tile: TileCoord, facing?: Direction): void {
    this.activeTween?.stop();
    this.activeTween = undefined;
    this.tile = { ...tile };
    if (facing) this.facing = facing;
    this.bufferedDirection = null;
    this.turningDirection = null;
    this.snapSpriteToTile();
    this.showIdleFrame();
    this.setState('IDLE');
  }

  // -- rendering helpers ---------------------------------------------------

  private snapSpriteToTile(): void {
    const world = tileToWorld(this.tile);
    this.sprite.setPosition(world.x, world.y);
    this.syncDepth();
  }

  /** Depth = feet Y, so characters sort correctly against each other. */
  private syncDepth(): void {
    this.sprite.setDepth(this.sprite.y);
  }

  private showIdleFrame(): void {
    this.sprite.anims.stop();
    this.sprite.setFrame(idleFrameIndex(this.facing));
  }

  destroy(): void {
    this.activeTween?.stop();
    this.activeTween = undefined;
  }
}
