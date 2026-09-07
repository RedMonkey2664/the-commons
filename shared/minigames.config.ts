/**
 * Minigame registry — 06_ARCADE_MINIGAMES.md.
 *
 * ADDING A NEW MINIGAME:
 *   1. Write one self-contained scene implementing MinigameScene.
 *   2. Append one entry here.
 * The Arcade zone reads this list and places a cabinet per entry. It never
 * learns anything about a minigame's internals.
 *
 * Entries land here in Phase 3 alongside their scene files. The array is empty
 * rather than pre-populated on purpose: a config entry pointing at a scene that
 * does not exist would put a broken cabinet in the Arcade.
 */

import type { MinigameConfig } from './types.js';

export const MINIGAMES: MinigameConfig[] = [];

export function getMinigame(id: string): MinigameConfig | undefined {
  return MINIGAMES.find((m) => m.id === id);
}
