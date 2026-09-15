/**
 * The moment a focus session is worth something.
 *
 * Shown after standing up from a pod, once the server has written the session:
 *
 *     FOCUS SESSION COMPLETE
 *            + 52m
 *     total focus   15h 02m
 *     ─────────────────────
 *     NEW WORLD UNLOCKED
 *        Low Orbit
 *     your rocket is ready  ·  J
 *
 * The top half appears after every session, because every session counts. The
 * bottom half only when a threshold was crossed — and then it is the loudest
 * thing on screen, because "my studying unlocked something" is the feeling the
 * whole progression system exists to deliver.
 *
 * The numbers count up rather than appearing. That is the one piece of motion
 * here that carries meaning: you watch the total move by what you just did.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, TYPOGRAPHY, UI, WORLD_PALETTES, hex, type WorldDefinition } from '@commons/shared';
import { sfx } from '../systems/Sfx';
import { durationText } from './FocusTimer';

const PANEL_WIDTH = 380;

export class SessionSummary {
  private readonly container: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly heading: Phaser.GameObjects.Text;
  private readonly added: Phaser.GameObjects.Text;
  private readonly total: Phaser.GameObjects.Text;
  private readonly unlockHeading: Phaser.GameObjects.Text;
  private readonly unlockName: Phaser.GameObjects.Text;
  private readonly unlockHint: Phaser.GameObjects.Text;

  private hideTimer?: Phaser.Time.TimerEvent;
  private readonly tweens = new Set<Phaser.Tweens.Tween>();
  private panelHeight = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.frame = scene.add.graphics();

    const text = (size: number, color: string = COLORS.dialogueBoxText) =>
      scene.add
        .text(PANEL_WIDTH / 2, 0, '', { fontFamily: TYPOGRAPHY.dialogueFont, fontSize: `${size}px`, color })
        .setOrigin(0.5);

    this.heading = text(TYPOGRAPHY.hudFontSize - 1).setAlpha(0.6);
    this.added = text(40, COLORS.statusStudying);
    this.total = text(TYPOGRAPHY.hudFontSize).setAlpha(0.75);
    this.unlockHeading = text(TYPOGRAPHY.hudFontSize - 1, COLORS.interactBubbleMark);
    this.unlockName = text(28);
    this.unlockHint = text(TYPOGRAPHY.hudFontSize - 1).setAlpha(0.6);

    this.container = scene.add
      .container(0, 0, [
        this.frame, this.heading, this.added, this.total,
        this.unlockHeading, this.unlockName, this.unlockHint,
      ])
      .setDepth(1500)
      .setVisible(false);

    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.clear();
    });
  }

  get isVisible(): boolean {
    return this.container.visible;
  }

  /**
   * Show the result of a session. `addedSeconds` and `totalSeconds` are the
   * server's figures, not the client's clock.
   */
  show(addedSeconds: number, totalSeconds: number, unlocked: WorldDefinition[] = [], simulated = false): void {
    this.clear();

    const world = unlocked[unlocked.length - 1];
    const accent = world ? WORLD_PALETTES[world.palette].accent : COLORS.statusStudying;

    this.heading.setText(simulated ? 'SESSION COMPLETE  ·  SIMULATED' : 'FOCUS SESSION COMPLETE');
    this.added.setText('+ 0m');
    this.total.setText(`total focus   ${durationText(Math.max(0, totalSeconds - addedSeconds))}`);

    const hasUnlock = world !== undefined;
    this.unlockHeading.setText(hasUnlock ? (unlocked.length > 1 ? `${unlocked.length} NEW WORLDS UNLOCKED` : 'NEW WORLD UNLOCKED') : '');
    this.unlockName.setText(world?.name ?? '').setColor(accent);
    this.unlockHint.setText(hasUnlock ? 'your rocket is ready   ·   J  journey' : '');
    for (const t of [this.unlockHeading, this.unlockName, this.unlockHint]) t.setVisible(hasUnlock).setAlpha(0);

    this.panelHeight = hasUnlock ? 262 : 150;
    this.drawFrame(accent);
    this.layout();

    this.container.setVisible(true).setAlpha(0);
    this.container.y -= 16;
    sfx.uiOpen();

    this.track(this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      y: this.container.y + 16,
      duration: UI.panel.slideMs * 1.5,
      ease: 'Back.easeOut',
    }));

    // The count-up: what you just did, then the total moving by it.
    const counter = { added: 0, total: Math.max(0, totalSeconds - addedSeconds) };
    this.track(this.scene.tweens.add({
      targets: counter,
      added: addedSeconds,
      total: totalSeconds,
      delay: 260,
      duration: Phaser.Math.Clamp(addedSeconds * 4, 700, 1600),
      ease: 'Cubic.easeOut',
      onUpdate: () => {
        this.added.setText(`+ ${durationText(counter.added)}`);
        this.total.setText(`total focus   ${durationText(counter.total)}`);
      },
    }));

    if (hasUnlock) {
      // The unlock arrives AFTER the count finishes, as its own beat. Shown
      // together, the number and the new world compete and neither lands.
      this.track(this.scene.tweens.add({
        targets: [this.unlockHeading, this.unlockName, this.unlockHint],
        alpha: { from: 0, to: 1 },
        delay: 1900,
        duration: 420,
        ease: 'Sine.easeOut',
        onStart: () => sfx.uiOpen(),
      }));
      this.unlockName.setScale(0.8);
      this.track(this.scene.tweens.add({
        targets: this.unlockName,
        scale: 1,
        delay: 1900,
        duration: 520,
        ease: 'Back.easeOut',
      }));
    }

    this.hideTimer = this.scene.time.delayedCall(hasUnlock ? 8000 : 4800, () => this.hide());
  }

  hide(): void {
    if (!this.container.visible) return;
    this.hideTimer?.remove();
    this.hideTimer = undefined;
    this.track(this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: UI.panel.slideMs,
      ease: 'Sine.easeIn',
      onComplete: () => this.container.setVisible(false),
    }));
  }

  private drawFrame(accent: string): void {
    this.frame.clear();
    this.frame.fillStyle(0x000000, 0.3);
    this.frame.fillRoundedRect(5, 7, PANEL_WIDTH, this.panelHeight, 16);
    this.frame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    this.frame.fillRoundedRect(0, 0, PANEL_WIDTH, this.panelHeight, 16);
    this.frame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.frame.fillRoundedRect(3, 3, PANEL_WIDTH - 6, this.panelHeight - 6, 14);
    this.frame.fillStyle(hex(accent), 1);
    this.frame.fillRoundedRect(3, 3, PANEL_WIDTH - 6, 5, 3);

    if (this.panelHeight > 150) {
      this.frame.fillStyle(hex(COLORS.dialogueBoxBorder), 0.12);
      this.frame.fillRect(36, 148, PANEL_WIDTH - 72, 1);
    }
  }

  private layout(): void {
    const { width } = this.scene.scale.gameSize;
    if (width === 0) return;

    this.container.setPosition(Math.round((width - PANEL_WIDTH) / 2), SPACING.hudMargin + 56);
    this.heading.setY(30);
    this.added.setY(74);
    this.total.setY(118);
    this.unlockHeading.setY(180);
    this.unlockName.setY(212);
    this.unlockHint.setY(244);
  }

  private track(tween: Phaser.Tweens.Tween): void {
    this.tweens.add(tween);
    tween.once(Phaser.Tweens.Events.TWEEN_COMPLETE, () => this.tweens.delete(tween));
  }

  private clear(): void {
    this.hideTimer?.remove();
    this.hideTimer = undefined;
    for (const tween of this.tweens) tween.stop();
    this.tweens.clear();
  }
}
