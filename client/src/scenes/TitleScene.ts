/**
 * Title / name entry — the Phase 1 auth stub.
 *
 * 08 asks for "simple auth stub (even just a name-entry, no real accounts
 * yet)", and 11 wants no character-creator gate in v1. So: type a name, press
 * Enter, you're in.
 *
 * Real Supabase auth lands in Phase 3 and replaces this scene's output, not the
 * flow — everything downstream reads identity from the session store and never
 * learns how the name was obtained.
 */

import Phaser from 'phaser';
import { COLORS, TYPOGRAPHY, hex } from '@commons/shared';
import { CityBackdrop } from '../ui/cityBackdrop';
import { ASSET_KEYS } from '../art/placeholderArt';
import { walkAnimKey } from '../art/characterAnimations';
import { INITIAL_ZONE_SCENE_KEY } from './zoneSceneRegistry';
import { session } from '../session';
import { UIScene } from '../ui/UIScene';

const MAX_NAME_LENGTH = 16;
const FIELD_WIDTH = 460;
const FIELD_HEIGHT = 62;

export class TitleScene extends Phaser.Scene {
  static readonly KEY = 'TitleScene';

  private name = '';

  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private fieldFrame!: Phaser.GameObjects.Graphics;
  private fieldLabel!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;
  private caret!: Phaser.GameObjects.Rectangle;
  private hint!: Phaser.GameObjects.Text;
  private ground!: Phaser.GameObjects.Graphics;
  private avatars: Phaser.GameObjects.Sprite[] = [];
  private starting = false;

  constructor() {
    super({ key: TitleScene.KEY });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(hex(COLORS.transitionFade));
    this.cameras.main.fadeIn(320, 0, 0, 0);
    // Registers its own resize/update/shutdown hooks; no handle needed.
    new CityBackdrop(this);

    this.title = this.add
      .text(0, 0, 'THE COMMONS', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.titleFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5)
      .setShadow(0, 4, '#000000', 16, false, true);

    this.subtitle = this.add
      .text(0, 0, 'a small town for being online together', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5)
      .setAlpha(0.72);

    this.fieldFrame = this.add.graphics();

    this.fieldLabel = this.add
      .text(0, 0, 'WHAT SHOULD WE CALL YOU?', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0, 1)
      .setAlpha(0.7);

    this.name = session.displayName ?? '';
    this.nameText = this.add
      .text(0, 0, this.name, {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '26px',
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5);

    this.caret = this.add.rectangle(0, 0, 2, 28, hex(COLORS.dialogueBoxAccent)).setOrigin(0, 0.5);
    this.tweens.add({
      targets: this.caret,
      alpha: 0,
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: 'Steps',
    });

    this.hint = this.add
      .text(0, 0, 'press  ENTER  to walk in', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5)
      .setAlpha(0.75);

    this.ground = this.add.graphics();
    this.createAvatars();

    this.layout();
    this.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input unavailable');

    keyboard.on('keydown', (event: KeyboardEvent) => {
      if (this.starting) return;

      if (event.key === 'Enter') {
        this.confirm();
        return;
      }
      if (event.key === 'Backspace') {
        this.name = this.name.slice(0, -1);
        this.refresh();
        return;
      }
      // Printable characters only; the server sanitizes again on join.
      if (
        event.key.length === 1 &&
        this.name.length < MAX_NAME_LENGTH &&
        /[\p{L}\p{N} _.-]/u.test(event.key)
      ) {
        this.name += event.key;
        this.refresh();
      }
    });

    this.input.on('pointerdown', () => this.confirm());
  }

  /** Three residents walking on the spot, so the screen has some life in it. */
  private createAvatars(): void {
    const sheets = [ASSET_KEYS.playerSheet, ASSET_KEYS.npcSheet, ASSET_KEYS.remoteSheet];
    this.avatars = sheets.map((sheet, index) => {
      const sprite = this.add.sprite(0, 0, sheet, 0).setOrigin(0.5, 1).setScale(2);
      sprite.play(walkAnimKey(sheet, index === 1 ? 'left' : 'down'));
      return sprite;
    });
  }

  private layout(): void {
    const { width, height } = this.scale.gameSize;
    if (width === 0 || height === 0) return;
    const cx = width / 2;

    this.title.setPosition(cx, height * 0.24);
    this.subtitle.setPosition(cx, height * 0.24 + TYPOGRAPHY.titleFontSize * 0.85);

    const fieldWidth = Math.min(FIELD_WIDTH, width - 80);
    const fx = Math.round(cx - fieldWidth / 2);
    const fy = Math.round(height * 0.52);

    this.fieldFrame.clear();
    this.fieldFrame.fillStyle(0x000000, 0.35);
    this.fieldFrame.fillRoundedRect(fx + 3, fy + 5, fieldWidth, FIELD_HEIGHT, 12);
    this.fieldFrame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    this.fieldFrame.fillRoundedRect(fx, fy, fieldWidth, FIELD_HEIGHT, 12);
    this.fieldFrame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.fieldFrame.fillRoundedRect(fx + 3, fy + 3, fieldWidth - 6, FIELD_HEIGHT - 6, 10);
    this.fieldFrame.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    this.fieldFrame.fillRoundedRect(fx + 3, fy + FIELD_HEIGHT - 8, fieldWidth - 6, 5, 3);

    this.fieldLabel.setPosition(fx, fy - 12);
    this.nameText.setPosition(fx + 22, fy + FIELD_HEIGHT / 2 - 2);
    this.hint.setPosition(cx, fy + FIELD_HEIGHT + 32);

    // Residents stand well clear of the hint text — they were overlapping it.
    const groundY = Math.min(height - 56, fy + FIELD_HEIGHT + 290);
    const spacing = 104;
    this.avatars.forEach((sprite, index) => {
      sprite.setPosition(cx + (index - 1) * spacing, groundY);
    });

    // A pool of light so they are standing on something rather than floating.
    this.ground.clear();
    this.ground.fillStyle(hex(COLORS.lampGlow), 0.07);
    this.ground.fillEllipse(cx, groundY + 4, spacing * 4.2, 54);
    this.ground.fillStyle(0x000000, 0.28);
    for (let i = 0; i < 3; i += 1) {
      this.ground.fillEllipse(cx + (i - 1) * spacing, groundY + 2, 44, 13);
    }

    this.refresh();
  }

  private refresh(): void {
    this.nameText.setText(this.name);
    this.caret.setPosition(this.nameText.x + this.nameText.width + 3, this.nameText.y);
  }

  private confirm(): void {
    if (this.starting) return;

    const trimmed = this.name.trim();
    if (trimmed.length === 0) {
      // Nudge rather than block — nobody should be stuck at a name box.
      this.hint.setText('go on then — ENTER again to walk in as Wanderer');
      this.name = 'Wanderer';
      this.refresh();
      return;
    }

    this.starting = true;
    session.displayName = trimmed;

    this.cameras.main.fadeOut(280, 0, 0, 0);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      this.scene.start(INITIAL_ZONE_SCENE_KEY);
      this.scene.launch(UIScene.KEY);
    });
  }
}
