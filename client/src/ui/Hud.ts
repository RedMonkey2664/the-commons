/**
 * Persistent HUD (07): current zone, connection state, and a fading controls
 * hint. Deliberately minimal — it must never compete with the world.
 *
 * Lays out against the live canvas size and reflows on resize.
 *
 * The friends panel and Pomodoro overlay named in 07/09 are Phase 2 and Phase 3
 * respectively; they slot in as siblings here.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, TYPOGRAPHY, UI, hex } from '@commons/shared';

export class Hud {
  private readonly zonePill: Phaser.GameObjects.Graphics;
  private readonly zoneLabel: Phaser.GameObjects.Text;
  private readonly statusPill: Phaser.GameObjects.Graphics;
  private readonly statusDot: Phaser.GameObjects.Arc;
  private readonly statusLabel: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly container: Phaser.GameObjects.Container;

  private connected = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.zonePill = scene.add.graphics();
    this.zoneLabel = scene.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0, 0.5);

    this.statusPill = scene.add.graphics();
    this.statusDot = scene.add.circle(0, 0, 5, hex(COLORS.statusAfk));
    this.statusLabel = scene.add
      .text(0, 0, 'OFFLINE', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(1, 0.5);

    this.hint = scene.add
      .text(0, 0, 'WASD move   SPACE interact   ENTER chat   ESC friends', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
        backgroundColor: COLORS.hudBg,
        padding: { x: 12, y: 8 },
      })
      .setOrigin(0, 1);

    this.container = scene.add
      .container(0, 0, [
        this.zonePill, this.zoneLabel,
        this.statusPill, this.statusDot, this.statusLabel,
        this.hint,
      ])
      .setDepth(900);

    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  private layout(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;
    const m = SPACING.hudMargin;
    const pillHeight = 34;

    // zone pill, top-left
    this.zoneLabel.setPosition(m + 16, m + pillHeight / 2);
    const zoneWidth = this.zoneLabel.width + 32;
    this.zonePill.clear();
    this.zonePill.fillStyle(0x000000, 0.25);
    this.zonePill.fillRoundedRect(m + 2, m + 3, zoneWidth, pillHeight, 8);
    this.zonePill.fillStyle(hex(COLORS.hudBg), 0.92);
    this.zonePill.fillRoundedRect(m, m, zoneWidth, pillHeight, 8);
    this.zonePill.fillStyle(hex(COLORS.hudAccent), 1);
    this.zonePill.fillRoundedRect(m, m + 8, 4, pillHeight - 16, 2);

    // connection pill, top-right
    this.statusLabel.setPosition(width - m - 16, m + pillHeight / 2);
    const statusWidth = this.statusLabel.width + 46;
    const statusX = width - m - statusWidth;
    this.statusDot.setPosition(statusX + 18, m + pillHeight / 2);
    this.statusPill.clear();
    this.statusPill.fillStyle(0x000000, 0.25);
    this.statusPill.fillRoundedRect(statusX + 2, m + 3, statusWidth, pillHeight, 8);
    this.statusPill.fillStyle(hex(COLORS.hudBg), 0.92);
    this.statusPill.fillRoundedRect(statusX, m, statusWidth, pillHeight, 8);

    this.hint.setPosition(m, height - m);
  }

  setZoneName(name: string): void {
    this.zoneLabel.setText(name.toUpperCase());
    this.layout();
  }

  /**
   * Connection state. Shape and text carry the meaning alongside colour (07's
   * colourblind-safe note): filled dot + "ONLINE", hollow ring + "OFFLINE".
   */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (connected) {
      this.statusDot.setFillStyle(hex(COLORS.statusStudying), 1);
      this.statusDot.setStrokeStyle(0);
      this.statusLabel.setText('ONLINE');
    } else {
      this.statusDot.setFillStyle(0x000000, 0);
      this.statusDot.setStrokeStyle(2, hex(COLORS.statusAfk));
      this.statusLabel.setText('OFFLINE');
    }
    this.layout();
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Hidden while a dialogue box is open, which would otherwise cover it. */
  setHintVisible(visible: boolean): void {
    this.hint.setVisible(visible);
  }

  /** Orientation aid; fades once the player has clearly got going. */
  fadeOutHint(delayMs = 8000): void {
    this.scene.tweens.add({
      targets: this.hint,
      alpha: 0,
      delay: delayMs,
      duration: UI.panel.slideMs * 2,
      ease: 'Quad.easeIn',
    });
  }

  destroy(): void {
    this.container.destroy(true);
  }
}
