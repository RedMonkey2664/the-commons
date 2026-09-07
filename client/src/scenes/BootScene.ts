/**
 * Boot: build placeholder art, then hand off to the starting zone.
 *
 * Phase 5 swaps placeholder art for real art by replacing the generator calls
 * below with `this.load.spritesheet(...)` / `this.load.image(...)` under the
 * SAME keys from ASSET_KEYS. No scene, system or entity changes.
 */

import Phaser from 'phaser';
import { COLORS, TYPOGRAPHY, VIEWPORT, hex } from '@commons/shared';
import { generateAllPlaceholderArt, ASSET_KEYS } from '../art/placeholderArt';
import { registerCharacterAnimations } from '../art/characterAnimations';
import { TitleScene } from './TitleScene';
import { INITIAL_ZONE_SCENE_KEY } from './zoneSceneRegistry';
import { session } from '../session';
import { UIScene } from '../ui/UIScene';

export class BootScene extends Phaser.Scene {
  static readonly KEY = 'BootScene';

  constructor() {
    super({ key: BootScene.KEY });
  }

  preload(): void {
    // Nothing to fetch yet — placeholder art is generated, and each zone scene
    // loads its own map in preload(). A progress bar goes here in Phase 5.
    const label = this.add
      .text(VIEWPORT.width / 2, VIEWPORT.height / 2, 'THE COMMONS', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '16px',
        color: COLORS.dialogueBoxBg,
      })
      .setOrigin(0.5);
    this.cameras.main.setBackgroundColor(hex(COLORS.transitionFade));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => label.destroy());
  }

  create(): void {
    generateAllPlaceholderArt(this);

    registerCharacterAnimations(this, 'player', ASSET_KEYS.playerSheet);
    registerCharacterAnimations(this, 'remote', ASSET_KEYS.remoteSheet);
    registerCharacterAnimations(this, 'npc', ASSET_KEYS.npcSheet);

    // Returning players skip name entry — 01's "no onboarding tax each session".
    if (session.isIdentified) {
      this.scene.start(INITIAL_ZONE_SCENE_KEY);
      this.scene.launch(UIScene.KEY);
    } else {
      this.scene.start(TitleScene.KEY);
    }
  }
}
