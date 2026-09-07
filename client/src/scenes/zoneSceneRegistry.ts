/**
 * Zone scene registry.
 *
 * The one place that maps zone config -> scene class. Adding a zone appends one
 * import and one array entry; nothing else in the client changes.
 *
 * Phase 0 ships Town Square only. Library, Cafe, Arcade, Park and Study Rooms
 * are declared in zones.config.ts already, and their doors report themselves as
 * closed until a scene lands here in Phase 2.
 */

import type Phaser from 'phaser';
import { TownSquareScene } from './TownSquareScene';

export const ZONE_SCENE_CLASSES: Array<new () => Phaser.Scene> = [TownSquareScene];

/** The zone the game boots into. */
export const INITIAL_ZONE_SCENE_KEY = 'TownSquareScene';
