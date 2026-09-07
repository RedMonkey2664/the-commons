/**
 * Phaser game configuration.
 *
 * Resolution rationale lives on VIEWPORT in shared/designTokens.ts: the canvas
 * is GBA-proportioned at 480x320 and world cameras zoom by tileDisplayScale (2),
 * giving exactly 15x10 visible tiles. Phaser's FIT scale mode then upscales the
 * whole canvas to the browser window, which is where legibility comes from
 * without breaking the pixel grid.
 */

import Phaser from 'phaser';
import { COLORS, VIEWPORT } from '@commons/shared';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { UIScene } from './ui/UIScene';
import { ZONE_SCENE_CLASSES } from './scenes/zoneSceneRegistry';

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  width: VIEWPORT.width,
  height: VIEWPORT.height,
  backgroundColor: COLORS.transitionFade,

  // Nearest-neighbour filtering and integer positions — no blurry pixels.
  pixelArt: true,
  roundPixels: true,

  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },

  // No physics engine: movement is tile-based and bespoke (04), and Arcade
  // physics would only add a second, conflicting notion of position.
  scene: [BootScene, TitleScene, ...ZONE_SCENE_CLASSES, UIScene],
};
