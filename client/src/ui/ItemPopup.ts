/**
 * Item / status popup — the "received X from Y" banner from 07, generalized.
 * Reused for cosmetic unlocks, new high scores, and "friend joined the world".
 *
 * Motion per 10: scale 1.0 -> 1.05 -> 1.0 over 250ms, hold 2s, fade out 200ms.
 * This is the one place a bouncier easing belongs — it is a reward beat.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, TYPOGRAPHY, UI, hex } from '@commons/shared';
import { sfx } from '../systems/Sfx';

const WIDTH = 380;
const HEIGHT = 76;
const ICON = 48;

export interface PopupOptions {
  /** Texture key for the portrait/icon. Falls back to a coloured swatch. */
  iconTexture?: string;
  iconFrame?: number;
  iconColor?: string;
}

interface QueuedPopup {
  message: string;
  options: PopupOptions;
}

export class ItemPopup {
  private readonly container: Phaser.GameObjects.Container;
  private readonly label: Phaser.GameObjects.Text;
  private readonly iconSwatch: Phaser.GameObjects.Rectangle;
  private readonly iconImage: Phaser.GameObjects.Image;

  private readonly queue: QueuedPopup[] = [];
  private showing = false;

  constructor(private readonly scene: Phaser.Scene) {
    const frame = scene.add.graphics();
    frame.fillStyle(0x000000, 0.28);
    frame.fillRoundedRect(4, 6, WIDTH, HEIGHT, 12);
    frame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    frame.fillRoundedRect(0, 0, WIDTH, HEIGHT, 12);
    frame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    frame.fillRoundedRect(3, 3, WIDTH - 6, HEIGHT - 6, 10);
    frame.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    frame.fillRoundedRect(3, 3, 5, HEIGHT - 6, 3);

    const iconX = 20 + ICON / 2;
    const iconY = HEIGHT / 2;

    this.iconSwatch = scene.add
      .rectangle(iconX, iconY, ICON, ICON, hex(COLORS.statusStudying))
      .setStrokeStyle(2, hex(COLORS.dialogueBoxBorder));

    this.iconImage = scene.add.image(iconX, iconY, '__DEFAULT').setVisible(false);

    this.label = scene.add
      .text(20 + ICON + 18, HEIGHT / 2, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
        wordWrap: { width: WIDTH - ICON - 60 },
        lineSpacing: 4,
      })
      .setOrigin(0, 0.5);

    this.container = scene.add
      .container(0, 0, [frame, this.iconSwatch, this.iconImage, this.label])
      .setDepth(1200)
      .setVisible(false);
    this.container.setSize(WIDTH, HEIGHT);
  }

  /** Queues a popup; they never overlap. */
  show(message: string, options: PopupOptions = {}): void {
    this.queue.push({ message, options });
    if (!this.showing) this.next();
  }

  private next(): void {
    const item = this.queue.shift();
    if (!item) {
      this.showing = false;
      return;
    }
    this.showing = true;
    sfx.reward();

    this.label.setText(item.message);

    if (item.options.iconTexture && this.scene.textures.exists(item.options.iconTexture)) {
      this.iconImage
        .setTexture(item.options.iconTexture, item.options.iconFrame ?? 0)
        .setVisible(true)
        .setDisplaySize(ICON, ICON);
      this.iconSwatch.setVisible(false);
    } else {
      this.iconSwatch
        .setFillStyle(hex(item.options.iconColor ?? COLORS.statusStudying))
        .setVisible(true);
      this.iconImage.setVisible(false);
    }

    const { width } = this.scene.scale.gameSize;
    const x = Math.round((width - WIDTH) / 2);
    const y = SPACING.hudMargin + 74;
    this.container.setPosition(x, y).setVisible(true).setAlpha(0);

    // Container scaling pivots at the origin, so nudge position to keep the
    // overshoot visually centred rather than growing down-right.
    const grow = (scale: number, duration: number, ease: string, onComplete?: () => void) =>
      this.scene.tweens.add({
        targets: this.container,
        scaleX: scale,
        scaleY: scale,
        x: x - (WIDTH * (scale - 1)) / 2,
        y: y - (HEIGHT * (scale - 1)) / 2,
        duration,
        ease,
        onComplete,
      });

    this.container.setScale(1);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: UI.popup.scaleMs / 2,
      ease: 'Quad.easeOut',
    });

    grow(UI.popup.overshoot, UI.popup.scaleMs / 2, 'Quad.easeOut', () => {
      grow(1, UI.popup.scaleMs / 2, 'Quad.easeInOut', () => {
        this.scene.time.delayedCall(UI.popup.holdMs, () => {
          this.scene.tweens.add({
            targets: this.container,
            alpha: 0,
            duration: UI.popup.fadeMs,
            ease: 'Quad.easeIn',
            onComplete: () => {
              this.container.setVisible(false);
              this.next();
            },
          });
        });
      });
    });
  }

  destroy(): void {
    this.queue.length = 0;
    this.container.destroy(true);
  }
}
