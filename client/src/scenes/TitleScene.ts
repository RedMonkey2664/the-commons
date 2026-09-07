/**
 * Title / name entry — the Phase 1 auth stub.
 *
 * 08 asks for "simple auth stub (even just a name-entry, no real accounts
 * yet)", and 11 wants no character-creator gate in v1: "a simple name + preset
 * sprite pick is enough friction". So: type a name, press Enter, you're in.
 *
 * Real Supabase auth lands in Phase 3 and replaces this scene's `identity`
 * output, not the rest of the flow — every zone reads identity from the session
 * store, so nothing downstream knows how the name was obtained.
 */

import Phaser from 'phaser';
import { COLORS, TYPOGRAPHY, VIEWPORT, hex } from '@commons/shared';
import { INITIAL_ZONE_SCENE_KEY } from './zoneSceneRegistry';
import { session } from '../session';

const MAX_NAME_LENGTH = 16;

export class TitleScene extends Phaser.Scene {
  static readonly KEY = 'TitleScene';

  private name = '';
  private nameText!: Phaser.GameObjects.Text;
  private caret!: Phaser.GameObjects.Rectangle;
  private hint!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: TitleScene.KEY });
  }

  create(): void {
    const centreX = VIEWPORT.width / 2;
    this.cameras.main.setBackgroundColor(hex(COLORS.townSquareBg));

    this.add
      .text(centreX, 62, 'THE COMMONS', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '24px',
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0.5);

    this.add
      .text(centreX, 92, 'a small town for being online together', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0.5)
      .setAlpha(0.75);

    // Name field, drawn in the same three-layer style as the dialogue box.
    const fieldWidth = 240;
    const fieldHeight = 38;
    const fieldX = centreX - fieldWidth / 2;
    const fieldY = 150;

    const frame = this.add.graphics();
    frame.fillStyle(hex(COLORS.dialogueBoxShadow), 0.5);
    frame.fillRoundedRect(fieldX + 3, fieldY + 3, fieldWidth, fieldHeight, 5);
    frame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    frame.fillRoundedRect(fieldX, fieldY, fieldWidth, fieldHeight, 5);
    frame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    frame.fillRoundedRect(fieldX + 3, fieldY + 3, fieldWidth - 6, fieldHeight - 6, 3);

    this.add
      .text(fieldX, fieldY - 16, 'WHAT SHOULD WE CALL YOU?', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0);

    this.name = session.displayName ?? '';
    this.nameText = this.add
      .text(fieldX + 14, fieldY + fieldHeight / 2, this.name, {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5);

    this.caret = this.add
      .rectangle(0, fieldY + fieldHeight / 2, 2, 16, hex(COLORS.dialogueBoxText))
      .setOrigin(0, 0.5);
    this.tweens.add({
      targets: this.caret,
      alpha: 0,
      duration: 450,
      yoyo: true,
      repeat: -1,
      ease: 'Steps',
    });

    this.hint = this.add
      .text(centreX, fieldY + fieldHeight + 26, 'type a name, then press ENTER', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0.5)
      .setAlpha(0.75);

    this.refresh();

    const keyboard = this.input.keyboard;
    if (!keyboard) throw new Error('Keyboard input unavailable');

    keyboard.on('keydown', (event: KeyboardEvent) => {
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
      if (event.key.length === 1 && this.name.length < MAX_NAME_LENGTH && /[\p{L}\p{N} _.-]/u.test(event.key)) {
        this.name += event.key;
        this.refresh();
      }
    });

    // Clicking anywhere also starts, for anyone who missed the hint.
    this.input.on('pointerdown', () => this.confirm());
  }

  private refresh(): void {
    this.nameText.setText(this.name);
    this.caret.setX(this.nameText.x + this.nameText.width + 2);
  }

  private confirm(): void {
    const trimmed = this.name.trim();
    if (trimmed.length === 0) {
      // Nudge rather than block — nobody should be stuck at a name box.
      this.hint.setText('a name would be nice, but ENTER again to go as Wanderer');
      this.name = 'Wanderer';
      this.refresh();
      return;
    }

    session.displayName = trimmed;
    this.scene.start(INITIAL_ZONE_SCENE_KEY);
    this.scene.launch('UIScene');
  }
}
