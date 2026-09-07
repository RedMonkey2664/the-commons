/**
 * Boot / loading screen.
 *
 * Generating the tileset and four character sheets is real work, and doing it
 * on a black screen makes the game feel broken before it starts. So the
 * backdrop is drawn first, then assets are built one step per frame with a
 * progress bar reporting what is actually happening — the bar tracks genuine
 * steps, it is not an animation pretending to load.
 *
 * Phase 5 swaps generated art for real files by replacing the build steps below
 * with `this.load.*` calls under the SAME keys from ASSET_KEYS.
 */

import Phaser from 'phaser';
import { COLORS, TYPOGRAPHY, hex } from '@commons/shared';
import {
  ASSET_KEYS,
  generateCharacterSheet,
  generateInteractableSprites,
  generateObjectSprites,
  generateTileset,
} from '../art/placeholderArt';
import { registerCharacterAnimations } from '../art/characterAnimations';
import { CityBackdrop } from '../ui/cityBackdrop';
import { INITIAL_ZONE_SCENE_KEY } from './zoneSceneRegistry';
import { session } from '../session';
import { TitleScene } from './TitleScene';
import { UIScene } from '../ui/UIScene';

interface BuildStep {
  label: string;
  run: () => void;
}

const BAR_WIDTH = 420;
const BAR_HEIGHT = 10;

export class BootScene extends Phaser.Scene {
  static readonly KEY = 'BootScene';

  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private stepLabel!: Phaser.GameObjects.Text;
  private barBg!: Phaser.GameObjects.Graphics;
  private barFill!: Phaser.GameObjects.Graphics;

  private steps: BuildStep[] = [];
  private stepIndex = 0;
  private progress = 0;
  private displayedProgress = 0;
  private finished = false;

  constructor() {
    super({ key: BootScene.KEY });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(hex(COLORS.transitionFade));
    // Registers its own resize/update/shutdown hooks; no handle needed.
    new CityBackdrop(this);

    this.title = this.add
      .text(0, 0, 'THE COMMONS', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.titleFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000000', 14, false, true);

    this.subtitle = this.add
      .text(0, 0, 'a small town for being online together', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5)
      .setAlpha(0.7);

    this.barBg = this.add.graphics();
    this.barFill = this.add.graphics();

    this.stepLabel = this.add
      .text(0, 0, 'starting up', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
        // Backed, not just faded: a lit skyline behind low-contrast text is
        // unreadable exactly where the eye goes to check progress.
        backgroundColor: COLORS.hudBg,
        padding: { x: 12, y: 6 },
      })
      .setOrigin(0.5)
      .setAlpha(0.95);

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });

    this.steps = this.buildSteps();

    // One step per frame, so the bar and backdrop keep animating while the
    // textures are actually being drawn.
    this.time.addEvent({
      delay: 60,
      repeat: this.steps.length - 1,
      callback: () => this.runNextStep(),
    });
  }

  private buildSteps(): BuildStep[] {
    return [
      { label: 'laying out the streets', run: () => generateTileset(this) },
      {
        label: 'waking the residents',
        run: () => {
          generateCharacterSheet(this, ASSET_KEYS.playerSheet, COLORS.playerBody);
          generateCharacterSheet(this, ASSET_KEYS.remoteSheet, COLORS.remoteBody);
          generateCharacterSheet(this, ASSET_KEYS.npcSheet, COLORS.npcBody);
        },
      },
      {
        label: 'putting up the signs',
        run: () => {
          generateObjectSprites(this);
          // Pods, seats, cabinets, jukeboxes. Easy to forget here because
          // generateAllPlaceholderArt() covers them for isolation-booted zones,
          // which masks the omission everywhere except the real boot path.
          generateInteractableSprites(this);
        },
      },
      {
        label: 'teaching everyone to walk',
        run: () => {
          for (const sheet of [ASSET_KEYS.playerSheet, ASSET_KEYS.remoteSheet, ASSET_KEYS.npcSheet]) {
            registerCharacterAnimations(this, sheet);
          }
        },
      },
      { label: 'unlocking the front door', run: () => {} },
    ];
  }

  private runNextStep(): void {
    const step = this.steps[this.stepIndex];
    if (!step) return;

    this.stepLabel.setText(step.label);
    step.run();

    this.stepIndex += 1;
    this.progress = this.stepIndex / this.steps.length;

    if (this.stepIndex >= this.steps.length) this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;

    // Let the bar visibly reach the end before leaving.
    this.time.delayedCall(340, () => {
      this.cameras.main.fadeOut(260, 0, 0, 0);
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        // Returning players skip name entry — 01's "no onboarding tax".
        if (session.isIdentified) {
          this.scene.start(INITIAL_ZONE_SCENE_KEY);
          this.scene.launch(UIScene.KEY);
        } else {
          this.scene.start(TitleScene.KEY);
        }
      });
    });
  }

  override update(_time: number, delta: number): void {
    // Ease the bar toward the true progress so it glides instead of jumping.
    this.displayedProgress += (this.progress - this.displayedProgress) * Math.min(1, delta / 120);
    this.drawBar();
  }

  private layout(): void {
    const { width, height } = this.scale.gameSize;
    if (width === 0 || height === 0) return;
    const cx = width / 2;

    this.title.setPosition(cx, height * 0.42);
    this.subtitle.setPosition(cx, height * 0.42 + TYPOGRAPHY.titleFontSize * 0.9);
    this.stepLabel.setPosition(cx, height * 0.72 + 34);
    this.drawBar();
  }

  private drawBar(): void {
    const { width, height } = this.scale.gameSize;
    if (width === 0 || height === 0) return;

    const barWidth = Math.min(BAR_WIDTH, width - 80);
    const x = Math.round((width - barWidth) / 2);
    const y = Math.round(height * 0.72);

    this.barBg.clear();
    this.barBg.fillStyle(0x000000, 0.45);
    this.barBg.fillRoundedRect(x, y, barWidth, BAR_HEIGHT, BAR_HEIGHT / 2);

    const filled = Math.max(0, Math.min(1, this.displayedProgress)) * barWidth;
    this.barFill.clear();
    if (filled > 1) {
      this.barFill.fillStyle(hex(COLORS.hudAccent), 1);
      this.barFill.fillRoundedRect(x, y, filled, BAR_HEIGHT, BAR_HEIGHT / 2);
      // leading glow
      this.barFill.fillStyle(hex(COLORS.hudText), 0.5);
      this.barFill.fillCircle(x + filled, y + BAR_HEIGHT / 2, BAR_HEIGHT * 0.9);
    }
  }
}
