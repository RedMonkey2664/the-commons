/**
 * Title / name entry — the Phase 1 auth stub, and the only onboarding there is.
 *
 * 08 asks for "simple auth stub (even just a name-entry, no real accounts
 * yet)", and 11 wants no character-creator gate in v1. So: type a name, press
 * Enter, you're in. That constraint is kept — this is still one field and one
 * key — but the screen around it now does the job a first screen has to do.
 *
 * What it has to do, in order:
 *   1. Say what this place IS. "A small town for being online together" is a
 *      mood, not an answer; someone who has just been sent a link needs to know
 *      there are people, study rooms and an arcade behind the field.
 *   2. Be readable. The copy used to sit directly on the skyline, where lit
 *      windows ran straight through the type — hence the scrim and the card.
 *   3. Teach the three keys that matter, BEFORE arrival rather than through a
 *      HUD hint that fades. Nobody reads a control list twice.
 *
 * Real Supabase auth lands in Phase 3 and replaces this scene's output, not the
 * flow — everything downstream reads identity from the session store and never
 * learns how the name was obtained.
 */

import Phaser from 'phaser';
import { COLORS, TYPOGRAPHY, UI, hex } from '@commons/shared';
import { CityBackdrop } from '../ui/cityBackdrop';
import { ASSET_KEYS } from '../art/placeholderArt';
import { walkAnimKey } from '../art/characterAnimations';
import { INITIAL_ZONE_SCENE_KEY } from './zoneSceneRegistry';
import { session } from '../session';
import { UIScene } from '../ui/UIScene';

const MAX_NAME_LENGTH = 16;
const FIELD_WIDTH = 460;
const FIELD_HEIGHT = 62;
const CARD_PADDING = 34;

/**
 * What is actually in there, in the player's terms.
 *
 * Three, not five: this is read in the second before someone starts typing,
 * and a list long enough to scan is a list nobody scans.
 */
const PITCH: readonly { readonly icon: string; readonly text: string }[] = [
  { icon: 'statusStudying', text: 'sit down and study together' },
  { icon: 'interactBubbleMark', text: 'seven arcade cabinets' },
  { icon: 'dialogueBoxAccent', text: 'one jukebox, everyone in time' },
];

export class TitleScene extends Phaser.Scene {
  static readonly KEY = 'TitleScene';

  private name = '';

  private scrim!: Phaser.GameObjects.Graphics;
  private title!: Phaser.GameObjects.Text;
  private subtitle!: Phaser.GameObjects.Text;
  private card!: Phaser.GameObjects.Graphics;
  private fieldFrame!: Phaser.GameObjects.Graphics;
  private fieldLabel!: Phaser.GameObjects.Text;
  private nameText!: Phaser.GameObjects.Text;
  private placeholder!: Phaser.GameObjects.Text;
  private counter!: Phaser.GameObjects.Text;
  private caret!: Phaser.GameObjects.Rectangle;
  private hint!: Phaser.GameObjects.Text;
  private controls!: Phaser.GameObjects.Text;
  private pitchRows: { dot: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text }[] = [];
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

    // Everything below sits on this rather than directly on lit windows.
    this.scrim = this.add.graphics();

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

    this.pitchRows = PITCH.map((item) => ({
      dot: this.add.circle(0, 0, 3, hex(COLORS[item.icon as keyof typeof COLORS] as string)),
      label: this.add
        .text(0, 0, item.text, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize}px`,
          color: COLORS.hudText,
        })
        .setOrigin(0, 0.5)
        .setAlpha(0.78),
    }));

    this.card = this.add.graphics();
    this.fieldFrame = this.add.graphics();

    this.fieldLabel = this.add
      .text(0, 0, 'WHAT SHOULD WE CALL YOU?', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 1)
      .setAlpha(0.75);

    this.name = session.displayName ?? '';
    this.nameText = this.add
      .text(0, 0, this.name, {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '26px',
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5);

    // An empty box with a blinking caret says "type" to someone who is already
    // looking at it; this says it to someone who is not.
    this.placeholder = this.add
      .text(0, 0, 'your name here', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '26px',
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5)
      .setAlpha(0.28);

    // Only appears near the limit — a counter at 3/16 is noise.
    this.counter = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize - 2}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(1, 0.5)
      .setAlpha(0.45);

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
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0.5)
      .setAlpha(0.75);

    // Taught here rather than only in the HUD: the HUD hint fades, and the
    // first thirty seconds are when not knowing how to move actually hurts.
    this.controls = this.add
      .text(0, 0, 'WASD  walk        SPACE  interact        ENTER  chat', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0.5)
      .setAlpha(0.62);

    this.ground = this.add.graphics();
    this.createAvatars();

    this.layout();
    this.playEntrance();

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

  /**
   * A short staggered settle, rather than everything arriving at once.
   *
   * It reads as the screen assembling itself and gives the eye an order to
   * follow — name last, which is where it should end up.
   */
  private playEntrance(): void {
    // Structural rather than Phaser's Alpha component: Graphics and Rectangle
    // both fade but do not implement the four-corner alpha that interface
    // demands, and all this needs is "has an alpha you can tween".
    type Fadeable = { alpha: number; setAlpha: (value: number) => unknown };

    const groups: Fadeable[][] = [
      [this.title, this.subtitle],
      this.pitchRows.flatMap((row) => [row.dot, row.label]),
      [this.card, this.fieldFrame, this.fieldLabel, this.nameText, this.placeholder, this.caret],
      [this.hint, this.controls],
    ];

    groups.forEach((targets, index) => {
      const finalAlphas = targets.map((t) => t.alpha);
      targets.forEach((t) => t.setAlpha(0));

      targets.forEach((target, i) => {
        this.tweens.add({
          targets: target,
          alpha: finalAlphas[i] ?? 1,
          duration: 320,
          delay: 120 + index * 110,
          ease: UI.panel.slideEase,
        });
      });
    });
  }

  /** Three residents walking on the spot, so the screen has some life in it. */
  private createAvatars(): void {
    const sheets = [ASSET_KEYS.playerSheet, ASSET_KEYS.npcSheet, ASSET_KEYS.remoteSheet];
    this.avatars = sheets.map((sheet, index) => {
      const sprite = this.add.sprite(0, 0, sheet, 0).setOrigin(0.5, 1).setScale(2);
      sprite.play(walkAnimKey(sheet, index === 1 ? 'left' : 'down'));

      // A slow, offset bob on top of the walk cycle: three identical loops in a
      // row read as one sprite copied, which is exactly what they are.
      this.tweens.add({
        targets: sprite,
        y: '-=3',
        duration: 1400 + index * 220,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
      return sprite;
    });
  }

  private layout(): void {
    const { width, height } = this.scale.gameSize;
    if (width === 0 || height === 0) return;
    const cx = width / 2;

    const fieldWidth = Math.min(FIELD_WIDTH, width - 80);
    const cardWidth = fieldWidth + CARD_PADDING * 2;
    const cardHeight = 168;

    // The whole column is measured from the card, so it stays centred as a
    // group instead of each piece being placed against the window separately.
    const cardY = Math.round(height * 0.47);
    const cardX = Math.round(cx - cardWidth / 2);

    this.title.setPosition(cx, cardY - 168);
    this.subtitle.setPosition(cx, cardY - 168 + TYPOGRAPHY.titleFontSize * 0.8);

    // Pitch rows, centred as a block above the card.
    const pitchGap = 22;
    const pitchTop = cardY - 92;
    const widest = Math.max(...this.pitchRows.map((row) => row.label.width));
    this.pitchRows.forEach((row, index) => {
      const y = pitchTop + index * pitchGap;
      const left = Math.round(cx - widest / 2);
      row.dot.setPosition(left - 14, y);
      row.label.setPosition(left, y);
    });

    // Scrim: a soft dark pool so type never has to compete with lit windows.
    this.scrim.clear();
    const scrimTop = cardY - 230;
    const scrimHeight = cardHeight + 330;
    for (let i = 0; i < 24; i += 1) {
      // Cheap vertical falloff — strongest in the middle, gone at both edges.
      const t = i / 23;
      const alpha = 0.42 * Math.sin(Math.PI * t);
      this.scrim.fillStyle(0x000000, alpha);
      this.scrim.fillRect(0, scrimTop + (scrimHeight / 24) * i, width, scrimHeight / 24 + 1);
    }

    // Card behind the field.
    this.card.clear();
    this.card.fillStyle(0x000000, 0.35);
    this.card.fillRoundedRect(cardX + 4, cardY + 6, cardWidth, cardHeight, 18);
    this.card.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    this.card.fillRoundedRect(cardX, cardY, cardWidth, cardHeight, 18);
    this.card.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.card.fillRoundedRect(cardX + 3, cardY + 3, cardWidth - 6, cardHeight - 6, 16);
    this.card.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    this.card.fillRoundedRect(cardX + 3, cardY + 3, cardWidth - 6, 5, 3);

    const fx = cardX + CARD_PADDING;
    const fy = cardY + 58;

    this.fieldFrame.clear();
    this.fieldFrame.fillStyle(hex(COLORS.dialogueBoxBorder), 0.14);
    this.fieldFrame.fillRoundedRect(fx, fy, fieldWidth, FIELD_HEIGHT, 12);
    this.fieldFrame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.fieldFrame.fillRoundedRect(fx + 2, fy + 2, fieldWidth - 4, FIELD_HEIGHT - 4, 10);
    this.fieldFrame.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    this.fieldFrame.fillRoundedRect(fx + 2, fy + FIELD_HEIGHT - 7, fieldWidth - 4, 4, 2);

    this.fieldLabel.setPosition(fx + 2, fy - 12);
    this.nameText.setPosition(fx + 22, fy + FIELD_HEIGHT / 2 - 2);
    this.placeholder.setPosition(fx + 22, fy + FIELD_HEIGHT / 2 - 2);
    this.counter.setPosition(fx + fieldWidth - 16, fy + FIELD_HEIGHT / 2 - 2);
    this.hint.setPosition(cx, cardY + cardHeight - 22);

    this.controls.setPosition(cx, cardY + cardHeight + 34);

    // Residents stand well clear of the copy above them.
    const groundY = Math.min(height - 48, cardY + cardHeight + 190);
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
    this.placeholder.setVisible(this.name.length === 0);
    this.counter.setText(
      this.name.length >= MAX_NAME_LENGTH - 4 ? `${this.name.length}/${MAX_NAME_LENGTH}` : '',
    );
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
