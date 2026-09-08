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
  {
    id: 'reaction_tap',
    displayName: 'Reaction Tap',
    cabinetSpriteKey: 'obj_cabinet_lit',
    sceneKey: 'ReactionTapScene',
    minPlayers: 1,
    maxPlayers: 4,
    blurb: 'Tap when it turns green. Not before.',
  },
  {
    id: 'retro_runner',
    displayName: 'Retro Runner',
    cabinetSpriteKey: 'obj_cabinet_lit',
    sceneKey: 'RetroRunnerScene',
    minPlayers: 1,
    maxPlayers: 1,
    blurb: 'Run, jump, last as long as you can.',
  },
  {
    id: 'rhythm_tap',
    displayName: 'Rhythm Tap',
    cabinetSpriteKey: 'obj_cabinet_lit',
    sceneKey: 'RhythmTapScene',
    minPlayers: 1,
    maxPlayers: 1,
    blurb: 'The jukebox tracks, played back at you.',
  },
  {
    id: 'word_rush',
    displayName: 'Word Rush',
    cabinetSpriteKey: 'obj_cabinet_lit',
    sceneKey: 'WordRushScene',
    minPlayers: 1,
    maxPlayers: 4,
    blurb: 'Seven letters. Longest word wins the round.',
  },
  {
    id: 'stack_tower',
    displayName: 'Stack Tower',
    cabinetSpriteKey: 'obj_cabinet_lit',
    sceneKey: 'StackTowerScene',
    minPlayers: 1,
    maxPlayers: 1,
    blurb: 'Drop the block. Miss, and the tower gets thinner.',
  },
];

export function getMinigame(id: string): MinigameConfig | undefined {
  return MINIGAMES.find((m) => m.id === id);
}
