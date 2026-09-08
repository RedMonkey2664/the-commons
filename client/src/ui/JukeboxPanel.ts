/**
 * Jukebox panel — the Cafe jukebox and Park bandstand UI (03).
 *
 * Shows what the ROOM is playing, not what this client is playing: the now-
 * playing line, its progress, who queued what, and the track list to add from.
 * Every number on screen is derived from the server's clock, so two people
 * looking at this panel see the same thing.
 *
 * Opened by interacting with the jukebox; closed with Esc.
 */

import Phaser from 'phaser';
import type { JukeboxState, Track } from '@commons/shared';
import { COLORS, SPACING, TRACKS, TYPOGRAPHY, UI, hex } from '@commons/shared';

const PANEL_WIDTH = 520;
const ROW_HEIGHT = 40;

export class JukeboxPanel {
  private readonly scrim: Phaser.GameObjects.Rectangle;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly nowPlaying: Phaser.GameObjects.Text;
  private readonly queuedBy: Phaser.GameObjects.Text;
  private readonly progress: Phaser.GameObjects.Graphics;
  private readonly queueText: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly rows: Phaser.GameObjects.Container;
  private readonly container: Phaser.GameObjects.Container;

  private open = false;
  private closeTween?: Phaser.Tweens.Tween;
  private panelHeight = 0;
  private state?: JukeboxState;
  /** Offset between our clock and the server's, from the last state message. */
  private clockSkewMs = 0;

  private onQueue?: (trackId: string) => void;
  private onSkip?: () => void;
  private onOpened?: () => void;

  constructor(private readonly scene: Phaser.Scene) {
    this.scrim = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.5).setOrigin(0, 0);
    this.frame = scene.add.graphics();

    this.nowPlaying = scene.add
      .text(SPACING.dialogueBoxPadding, 30, 'nothing playing', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5);

    this.queuedBy = scene.add
      .text(SPACING.dialogueBoxPadding, 54, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize - 1}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5)
      .setAlpha(0.6);

    this.progress = scene.add.graphics();

    this.queueText = scene.add
      .text(SPACING.dialogueBoxPadding, 92, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize - 1}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0)
      .setAlpha(0.75);

    this.rows = scene.add.container(0, 0);

    this.hint = scene.add
      .text(SPACING.dialogueBoxPadding, 0, 'click a track to queue it   ·   S to vote skip   ·   ESC to close', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize - 1}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 1)
      .setAlpha(0.6);

    this.container = scene.add
      .container(0, 0, [this.frame, this.nowPlaying, this.queuedBy, this.progress, this.queueText, this.rows, this.hint])
      .setDepth(1450)
      .setVisible(false);
    this.scrim.setDepth(1440).setVisible(false);

    this.buildTrackRows();
    this.layout();

    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.on(Phaser.Scenes.Events.UPDATE, this.tick, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      scene.events.off(Phaser.Scenes.Events.UPDATE, this.tick, this);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  setHandlers(handlers: {
    onQueue: (trackId: string) => void;
    onSkip: () => void;
    onOpened?: () => void;
  }): void {
    this.onQueue = handlers.onQueue;
    this.onSkip = handlers.onSkip;
    this.onOpened = handlers.onOpened;
  }

  /** Apply a state broadcast from the server. */
  applyState(state: JukeboxState): void {
    this.state = state;
    // Everything on this panel is timed against the SERVER's clock, so hold the
    // difference rather than assuming the two machines agree.
    this.clockSkewMs = state.serverNow - Date.now();
    this.refresh();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.closeTween?.stop();
    this.closeTween = undefined;

    this.refresh();
    const { width } = this.scene.scale.gameSize;
    this.scrim.setVisible(true).setAlpha(0);
    this.container.setVisible(true).setAlpha(0);

    this.scene.tweens.add({ targets: [this.scrim, this.container], alpha: 1, duration: UI.panel.slideMs, ease: UI.panel.slideEase });
    this.container.y = Math.round((this.scene.scale.gameSize.height - this.panelHeight) / 2) + 12;
    this.scene.tweens.add({
      targets: this.container,
      y: Math.round((this.scene.scale.gameSize.height - this.panelHeight) / 2),
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
    });
    void width;

    this.onOpened?.();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
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

  /** Keyboard while open. Returns true if the key was consumed. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.open) return false;
    if (event.key === 'Escape') {
      this.close();
      return true;
    }
    if (event.key.toLowerCase() === 's') {
      this.onSkip?.();
      return true;
    }
    return true; // modal: swallow everything else
  }

  // -- rendering ------------------------------------------------------------

  private buildTrackRows(): void {
    TRACKS.forEach((track, index) => {
      const row = this.scene.add.container(0, index * ROW_HEIGHT);
      const background = this.scene.add.graphics();
      const label = this.scene.add
        .text(SPACING.dialogueBoxPadding + 10, ROW_HEIGHT / 2, `${track.title}`, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize}px`,
          color: COLORS.dialogueBoxText,
        })
        .setOrigin(0, 0.5);

      const meta = this.scene.add
        .text(PANEL_WIDTH - SPACING.dialogueBoxPadding - 10, ROW_HEIGHT / 2, formatDuration(track.durationMs), {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize - 2}px`,
          color: COLORS.dialogueBoxText,
        })
        .setOrigin(1, 0.5)
        .setAlpha(0.55);

      const paint = (hover: boolean) => {
        background.clear();
        background.fillStyle(hex(hover ? COLORS.dialogueBoxAccent : COLORS.pavingDark), hover ? 0.22 : 0.12);
        background.fillRoundedRect(
          SPACING.dialogueBoxPadding,
          4,
          PANEL_WIDTH - SPACING.dialogueBoxPadding * 2,
          ROW_HEIGHT - 8,
          6,
        );
      };
      paint(false);

      row.add([background, label, meta]);
      row.setSize(PANEL_WIDTH, ROW_HEIGHT);
      row.setInteractive(
        new Phaser.Geom.Rectangle(SPACING.dialogueBoxPadding, 0, PANEL_WIDTH - SPACING.dialogueBoxPadding * 2, ROW_HEIGHT),
        Phaser.Geom.Rectangle.Contains,
      );
      row.on('pointerover', () => paint(true));
      row.on('pointerout', () => paint(false));
      row.on('pointerdown', () => this.onQueue?.(track.id));

      this.rows.add(row);
    });
  }

  private refresh(): void {
    const state = this.state;

    if (!state?.now) {
      this.nowPlaying.setText('nothing playing');
      this.queuedBy.setText('');
    } else {
      this.nowPlaying.setText(`${state.now.track.title}  —  ${state.now.track.artist}`);
      const skip = state.skipVotes > 0 ? `   ·   ${state.skipVotes} skip vote${state.skipVotes === 1 ? '' : 's'}` : '';
      this.queuedBy.setText(`queued by ${state.now.requestedBy}${skip}`);
    }

    const upNext = state?.queue ?? [];
    this.queueText.setText(
      upNext.length === 0
        ? 'nothing queued'
        : `up next:  ${upNext.slice(0, 3).map((e) => e.track.title).join('  ·  ')}${upNext.length > 3 ? `  +${upNext.length - 3}` : ''}`,
    );

    this.drawProgress();
  }

  /** Progress is recomputed every frame from the server clock, not a local timer. */
  private tick(): void {
    if (this.open) this.drawProgress();
  }

  private drawProgress(): void {
    const g = this.progress;
    g.clear();

    const state = this.state;
    const width = PANEL_WIDTH - SPACING.dialogueBoxPadding * 2;
    const x = SPACING.dialogueBoxPadding;
    const y = 72;

    g.fillStyle(hex(COLORS.pavingDark), 0.35);
    g.fillRoundedRect(x, y, width, 6, 3);

    if (!state?.now) return;

    const serverNow = Date.now() + this.clockSkewMs;
    const elapsed = Math.max(0, serverNow - state.startedAt);
    const fraction = Math.max(0, Math.min(1, elapsed / state.now.track.durationMs));

    g.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    g.fillRoundedRect(x, y, Math.max(2, width * fraction), 6, 3);
  }

  private layout(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;

    this.scrim.setSize(width, height);

    const listHeight = TRACKS.length * ROW_HEIGHT;
    this.panelHeight = 130 + listHeight + 34;

    this.container.setPosition(
      Math.round((width - PANEL_WIDTH) / 2),
      Math.round((height - this.panelHeight) / 2),
    );

    this.frame.clear();
    this.frame.fillStyle(0x000000, 0.3);
    this.frame.fillRoundedRect(5, 7, PANEL_WIDTH, this.panelHeight, 16);
    this.frame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    this.frame.fillRoundedRect(0, 0, PANEL_WIDTH, this.panelHeight, 16);
    this.frame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.frame.fillRoundedRect(3, 3, PANEL_WIDTH - 6, this.panelHeight - 6, 14);
    this.frame.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    this.frame.fillRoundedRect(3, 3, PANEL_WIDTH - 6, 5, 3);

    this.rows.setPosition(0, 122);
    this.hint.setY(this.panelHeight - 14);
  }

  destroy(): void {
    this.scrim.destroy();
    this.container.destroy(true);
  }
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export type { Track };
