/**
 * Minigame scene registry.
 *
 * The one place mapping a config entry's `sceneKey` to its class. Adding a
 * minigame is: one scene file, one entry in shared/minigames.config.ts, one
 * line here. Nothing else in the client changes — the Arcade builds cabinets
 * from config, and the cabinet handler launches by key.
 */

import type Phaser from 'phaser';
import { MemoryMatchScene } from './MemoryMatchScene';
import { ReactionTapScene } from './ReactionTapScene';
import { RetroRunnerScene } from './RetroRunnerScene';
import { RhythmTapScene } from './RhythmTapScene';
import { StackTowerScene } from './StackTowerScene';
import { WordRushScene } from './WordRushScene';
import { TriviaBlitzScene } from './TriviaBlitzScene';

export const MINIGAME_SCENE_CLASSES: Array<new () => Phaser.Scene> = [
  MemoryMatchScene,
  TriviaBlitzScene,
  ReactionTapScene,
  RetroRunnerScene,
  RhythmTapScene,
  WordRushScene,
  StackTowerScene,
];
