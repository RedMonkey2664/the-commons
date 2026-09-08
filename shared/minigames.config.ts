/**
 * Minigame registry — 06_ARCADE_MINIGAMES.md.
 *
 * ADDING A NEW MINIGAME:
 *   1. Write one self-contained scene implementing MinigameScene.
 *   2. Append one entry here.
 * The Arcade zone reads this list and places a cabinet per entry. It never
 * learns anything about a minigame's internals.
 *
 * Every entry here must have a scene registered in
 * client/src/scenes/minigames/registry.ts — a config entry pointing at a scene
 * that does not exist would put a broken cabinet on the Arcade floor.
 */

import type { MinigameConfig } from './types.js';

export const MINIGAMES: MinigameConfig[] = [
  {
    id: 'memory_match',
    displayName: 'Memory Match',
    cabinetSpriteKey: 'obj_cabinet_lit',
    sceneKey: 'MemoryMatchScene',
    minPlayers: 1,
    maxPlayers: 1,
    blurb: 'Flip tiles, find the pairs, do it quickly.',
  },
  {
    id: 'trivia_blitz',
    displayName: 'Trivia Blitz',
    cabinetSpriteKey: 'obj_cabinet_lit',
    sceneKey: 'TriviaBlitzScene',
    minPlayers: 1,
    maxPlayers: 4,
    blurb: 'Eight questions. Faster answers score more.',
  },
];

export function getMinigame(id: string): MinigameConfig | undefined {
  return MINIGAMES.find((m) => m.id === id);
}
