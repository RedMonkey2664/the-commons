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
import type { VoiceAvailability, VoiceConnectionState } from '@commons/shared';
import { COLORS, SPACING, TYPOGRAPHY, UI, hex } from '@commons/shared';

export class Hud {
  private readonly zonePill: Phaser.GameObjects.Graphics;
  private readonly zoneLabel: Phaser.GameObjects.Text;
  private readonly statusPill: Phaser.GameObjects.Graphics;
  private readonly statusDot: Phaser.GameObjects.Arc;
  private readonly statusLabel: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly micPill: Phaser.GameObjects.Graphics;
  private readonly micLabel: Phaser.GameObjects.Text;
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

    this.micPill = scene.add.graphics();
    this.micLabel = scene.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
      })
      .setOrigin(1, 0.5);

    this.hint = scene.add
      .text(0, 0, 'WASD move   SPACE interact   ENTER chat   M mic   ESC friends', {
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
        this.micPill, this.micLabel,
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

    // Mic pill sits under the connection pill, top-right.
    this.micLabel.setPosition(width - m - 14, m + pillHeight + 10 + pillHeight / 2);
    const micWidth = this.micLabel.width + 28;
    const micX = width - m - micWidth;
    this.micPill.clear();
    if (this.micLabel.text.length > 0) {
      this.micPill.fillStyle(0x000000, 0.25);
      this.micPill.fillRoundedRect(micX + 2, m + pillHeight + 13, micWidth, pillHeight, 8);
      this.micPill.fillStyle(hex(COLORS.hudBg), 0.92);
      this.micPill.fillRoundedRect(micX, m + pillHeight + 10, micWidth, pillHeight, 8);
    }

    this.hint.setPosition(m, height - m);
  }

  /**
   * Voice state (05, 07's "mic/chat status icon").
   *
   * Says WHY the mic is off, not just that it is. "muted" and "voice isn't set
   * up on this server" are completely different situations for a player, and a
   * single greyed-out icon would conflate them.
   */
  setVoice(state: VoiceConnectionState, availability: VoiceAvailability, muted: boolean): void {
    let text = '';
    if (availability === 'not_configured') text = 'MIC  —  not set up';
    else if (availability === 'no_permission') text = 'MIC  —  blocked';
    else if (availability === 'unavailable') text = 'MIC  —  unavailable';
    else if (state === 'connecting') text = 'MIC  …';
    else if (state === 'failed') text = 'MIC  —  failed';
    else if (state === 'connected') text = muted ? 'MIC  muted' : 'MIC  live';
    else text = muted ? 'MIC  muted' : 'MIC  on';

    this.micLabel.setText(text);
    this.micLabel.setColor(
      state === 'connected' && !muted ? COLORS.statusStudying : COLORS.hudText,
    );
    this.micLabel.setAlpha(availability === 'ready' ? 1 : 0.6);
    this.layout();
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
