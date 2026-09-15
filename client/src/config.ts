/**
 * Phaser game configuration.
 *
 * The canvas RESIZES to the browser window rather than rendering at a fixed
 * design resolution and letterboxing. FIT mode only fills the screen when the
 * window happens to match the design aspect ratio; every other size gets black
 * bars, which does not read as a modern game.
 *
 * With RESIZE there is no single design resolution, so:
 *   - world scenes pick a camera zoom from the window height (VIEWPORT.zoomFor),
 *     keeping a roughly constant slice of world visible at a consistent scale;
 *   - the UI scene lays out against the live camera size and reflows on resize.
 */

import Phaser from 'phaser';
import { COLORS } from '@commons/shared';
import { BootScene } from './scenes/BootScene';
import { TitleScene } from './scenes/TitleScene';
import { FocusScene } from './scenes/FocusScene';
import { WorldMapScene } from './scenes/WorldMapScene';
import { UIScene } from './ui/UIScene';
import { ZONE_SCENE_CLASSES } from './scenes/zoneSceneRegistry';
import { MINIGAME_SCENE_CLASSES } from './scenes/minigames/registry';

export const GAME_CONFIG: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: COLORS.transitionFade,

  // Nearest-neighbour filtering — art is authored at final resolution and
  // camera zoom is quantized to half steps, so edges stay crisp.
  pixelArt: true,
  roundPixels: true,

  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: '100%',
    height: '100%',
  },

  // No physics engine: movement is tile-based and bespoke (04), and Arcade
  // physics would only add a second, conflicting notion of position.
  // FocusScene sits between the world and the UI: it covers the zone it was
  // launched over, and the HUD's popups still read above it.
  scene: [BootScene, TitleScene, ...ZONE_SCENE_CLASSES, ...MINIGAME_SCENE_CLASSES, FocusScene, WorldMapScene, UIScene],
};
