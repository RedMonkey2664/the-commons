/**
 * Order a drink — 03_WORLD_MAP_ZONES.md, Phase 6.
 *
 * A deliberately tiny modal: six mugs in a row, click one, done. 03 calls this
 * "cheap to build, good third place texture", and the UI has to match that
 * billing — anything with a confirm step or a scroll list would make ordering a
 * coffee feel like a transaction, which is the opposite of the point.
 *
 * The mug you are already holding is highlighted, and clicking it puts it down.
 */

import Phaser from 'phaser';
import type { Drink } from '@commons/shared';
import { COLORS, DRINKS, SPACING, TYPOGRAPHY, UI, hex } from '@commons/shared';
import { drinkTextureKey } from '../art/placeholderArt';
import { sfx } from '../systems/Sfx';

const PANEL_WIDTH = 460;
const PANEL_HEIGHT = 190;
const SLOT = 66;

export class DrinkPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly scrim: Phaser.GameObjects.Rectangle;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly row: Phaser.GameObjects.Container;

  private open = false;
  private closeTween?: Phaser.Tweens.Tween;
  private current = '';
  private onChosen?: (drink: Drink | null) => void;

  constructor(private readonly scene: Phaser.Scene) {
    this.scrim = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.45).setOrigin(0, 0).setDepth(1480);

    this.frame = scene.add.graphics();
    this.title = scene.add
      .text(SPACING.dialogueBoxPadding, 26, 'WHAT CAN I GET YOU?', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5);

    this.hint = scene.add
      .text(SPACING.dialogueBoxPadding, PANEL_HEIGHT - 18, 'ESC to close', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 1)
      .setAlpha(0.6);

    this.row = scene.add.container(0, 0);

    this.container = scene.add
      .container(0, 0, [this.frame, this.title, this.hint, this.row])
      .setDepth(1490)
      .setVisible(false);

    this.paintFrame();
    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** What the player is currently holding, and where to send a new order. */
  setState(current: string, onChosen: (drink: Drink | null) => void): void {
    this.current = current;
    this.onChosen = onChosen;
    if (this.open) this.render();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    sfx.uiOpen();
    this.closeTween?.stop();
    this.closeTween = undefined;

    this.render();
    this.layout();

    this.scrim.setVisible(true).setAlpha(0);
    this.container.setVisible(true).setAlpha(0);
    this.scene.tweens.add({
      targets: [this.scrim, this.container],
      alpha: 1,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    sfx.uiClose();
    this.closeTween = this.scene.tweens.add({
      targets: [this.scrim, this.container],
      alpha: 0,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
      onComplete: () => {
        this.closeTween = undefined;
        this.scrim.setVisible(false);
        this.container.setVisible(false);
      },
    });
  }

  /** Keyboard while open. Modal: swallows everything so the world stays still. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (event.key === 'Escape') this.close();
    return true;
  }

  private paintFrame(): void {
    this.frame.clear();
    this.frame.fillStyle(hex(COLORS.dialogueBoxBg), 0.97);
    this.frame.fillRoundedRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 14);
    this.frame.lineStyle(3, hex(COLORS.dialogueBoxBorder), 1);
    this.frame.strokeRoundedRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT, 14);
    this.frame.lineStyle(1, hex(COLORS.dialogueBoxAccent), 0.5);
    this.frame.strokeRoundedRect(3, 3, PANEL_WIDTH - 6, PANEL_HEIGHT - 6, 12);
  }

  private render(): void {
    this.row.removeAll(true);

    const totalWidth = DRINKS.length * SLOT;
    const startX = Math.round((PANEL_WIDTH - totalWidth) / 2);

    DRINKS.forEach((drink, index) => {
      const x = startX + index * SLOT + SLOT / 2;
      const held = this.current === drink.id;

      const plate = this.scene.add
        .rectangle(x, 96, SLOT - 10, 78, hex(COLORS.pavingDark), held ? 0.3 : 0.12)
        .setStrokeStyle(held ? 3 : 1, hex(held ? COLORS.dialogueBoxAccent : COLORS.dialogueBoxBorder), held ? 1 : 0.35)
        .setInteractive({ useHandCursor: true });

      const key = drinkTextureKey(drink.id);
      const mug = this.scene.textures.exists(key)
        ? this.scene.add.image(x, 88, key).setScale(1.6)
        : this.scene.add.rectangle(x, 88, 20, 24, hex(drink.color));

      const label = this.scene.add
        .text(x, 122, drink.displayName, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize - 2}px`,
          color: COLORS.dialogueBoxText,
        })
        .setOrigin(0.5, 0);

      plate.on('pointerover', () =>
        this.hint.setText(held ? `${drink.displayName} — click to put it down` : drink.line),
      );
      plate.on('pointerout', () => this.hint.setText('ESC to close'));
      plate.on('pointerdown', () => {
        // Clicking what you are holding puts it down. Without this there is no
        // way back to holding nothing, and the first drink you try is forever.
        const next = held ? null : drink;
        this.current = next ? next.id : '';
        sfx.uiOpen();
        this.onChosen?.(next);
        this.render();
      });

      this.row.add([plate, mug, label]);
    });
  }

  private layout(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;

    this.scrim.setSize(width, height);
    this.container.setPosition(
      Math.round((width - PANEL_WIDTH) / 2),
      Math.round((height - PANEL_HEIGHT) / 2),
    );
  }

  destroy(): void {
    this.container.destroy(true);
    this.scrim.destroy();
  }
}
