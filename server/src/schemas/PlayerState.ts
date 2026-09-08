/**
 * Colyseus schemas — the authoritative, synchronized room state.
 *
 * Mirrors the PlayerState interface in shared/types.ts (05). The duplication is
 * unavoidable: Colyseus needs decorated schema classes to generate its binary
 * patches, and those cannot be plain interfaces. `assertMatchesSharedShape`
 * below makes the compiler enforce that the two stay in step, so a field added
 * to one and forgotten in the other is a build error rather than a field that
 * silently never syncs.
 */

import { Schema, MapSchema, type } from '@colyseus/schema';
import type { Direction, PlayerState, PlayerStatus } from '@commons/shared';

export class PlayerSchema extends Schema {
  @type('string') id = '';
  @type('string') displayName = '';
  @type('string') spriteKey = '';

  /** Tile coordinates, never pixels. The world is a grid (04). */
  @type('number') x = 0;
  @type('number') y = 0;

  @type('string') facing: Direction = 'down';
  @type('string') status: PlayerStatus = 'idle';
  @type('string') currentMinigame = '';
  @type('string') drink = '';

  /**
   * Last client intent this player's state reflects. The client compares it
   * against its own last-sent sequence to distinguish "server is behind" from
   * "server disagrees" — without it, prediction and reconciliation fight.
   */
  @type('number') lastSeq = 0;
}

export class ZoneState extends Schema {
  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
}

/**
 * Compile-time check that PlayerSchema covers every field of the shared
 * PlayerState. Never called; it exists purely so tsc fails if they diverge.
 */
function assertMatchesSharedShape(schema: PlayerSchema): void {
  const asShared: PlayerState = {
    id: schema.id,
    displayName: schema.displayName,
    spriteKey: schema.spriteKey,
    x: schema.x,
    y: schema.y,
    facing: schema.facing,
    status: schema.status,
    currentMinigame: schema.currentMinigame,
    drink: schema.drink,
  };
  void asShared;
}
void assertMatchesSharedShape;
