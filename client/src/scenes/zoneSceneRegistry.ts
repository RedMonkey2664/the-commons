/**
 * Zone scene registry.
 *
 * The one place that maps zone config -> scene class. Adding a zone appends one
 * import and one array entry; nothing else in the client changes.
 */

import type Phaser from 'phaser';
import { TownSquareScene } from './TownSquareScene';
import {
  ArcadeScene,
  CafeScene,
  GreenhouseScene,
  LibraryScene,
  ParkScene,
  SkylineTerraceScene,
  StudyRoomScene,
} from './zones';

export const ZONE_SCENE_CLASSES: Array<new () => Phaser.Scene> = [
  TownSquareScene,
  LibraryScene,
  CafeScene,
  ArcadeScene,
  ParkScene,
  StudyRoomScene,
  SkylineTerraceScene,
  GreenhouseScene,
];

/** The zone the game boots into. */
export const INITIAL_ZONE_SCENE_KEY = 'TownSquareScene';
