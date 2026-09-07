/**
 * Persistent HUD (07): "small corner indicator: current zone name, mic/chat
 * status icon". Deliberately minimal — it must never compete with the world.
 *
 * The friends panel and Pomodoro overlay named in 07/09 are Phase 2 and Phase 3
 * respectively; they slot in as siblings here.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, TYPOGRAPHY, UI, VIEWPORT, hex } from '@commons/shared';

export class Hud {
  private readonly zoneLabel: Phaser.GameObjects.Text;
  private readonly zonePill: Phaser.GameObjects.Graphics;
  private readonly statusDot: Phaser.GameObjects.Arc;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly container: Phaser.GameObjects.Container;

  constructor(private readonly scene: Phaser.Scene) {
    const margin = SPACING.hudMargin;

    this.zonePill = scene.add.graphics();
    this.zoneLabel = scene.add
      .text(margin + 8, margin + 5, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0, 0);

    // Mic/chat state. Shape carries meaning alongside color, per 07's
    // colorblind-safe note — filled = live, hollow = muted (Phase 4 wires it).
    this.statusDot = scene.add
      .circle(VIEWPORT.width - margin - 7, margin + 11, 5, hex(COLORS.statusAfk))
      .setStrokeStyle(1, hex(COLORS.hudText));

    this.hint = scene.add
      .text(margin, VIEWPORT.height - margin - 12, 'WASD move   SPACE interact', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
        backgroundColor: COLORS.hudBg,
        padding: { x: 5, y: 3 },
      })
      .setOrigin(0, 0);

    this.container = scene.add
      .container(0, 0, [this.zonePill, this.zoneLabel, this.statusDot, this.hint])
      .setDepth(900);
  }

  /**
   * Connection state. Shape carries the meaning alongside colour (07's
   * colourblind-safe note): filled = connected, hollow ring = offline.
   */
  setConnected(connected: boolean): void {
    if (connected) {
      this.statusDot.setFillStyle(hex(COLORS.statusStudying));
      this.statusDot.setStrokeStyle(1, hex(COLORS.hudText));
    } else {
      this.statusDot.setFillStyle(hex(COLORS.hudBg), 0);
      this.statusDot.setStrokeStyle(2, hex(COLORS.statusAfk));
    }
  }

  setZoneName(name: string): void {
    this.zoneLabel.setText(name.toUpperCase());

    const margin = SPACING.hudMargin;
    const width = this.zoneLabel.width + 16;
    this.zonePill.clear();
    this.zonePill.fillStyle(hex(COLORS.hudBg), 0.8);
    this.zonePill.fillRoundedRect(margin, margin, width, 22, 4);
  }

  /** Phase 0 orientation aid; fades once the player has clearly got going. */
  fadeOutHint(delayMs = 6000): void {
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
