/**
 * Player stats — the P panel.
 *
 * Everything here was already being recorded and none of it was ever shown
 * back: focus time and session counts per zone, plays and best scores per
 * cabinet, cosmetics earned, people met. 11 puts presence over progression, so
 * this deliberately reads as a record of time spent rather than a score to
 * climb — the headline is hours focused, not a level.
 *
 * The server owns every number except two: how long this visit has lasted, and
 * how many people this browser has shared a room with (the same local list the
 * friends panel shows offline). Both are honestly labelled as this-browser
 * facts rather than dressed up as account history.
 */

import Phaser from 'phaser';
import type { CosmeticProgress } from '@commons/shared';
import {
  COLORS,
  COSMETICS,
  MINIGAMES,
  SPACING,
  TYPOGRAPHY,
  UI,
  ZONES,
  hex,
  isUnlocked,
} from '@commons/shared';
import { sfx } from '../systems/Sfx';
import { fetchProgress, fetchStudyTotals } from '../systems/scoreClient';
import { durationText } from './FocusTimer';
import { knownPeopleCount } from './FriendsPanel';

const PANEL_WIDTH = 430;

interface StatRow {
  label: string;
  value: string;
  /** Section headings are rows too, so one list drives the whole layout. */
  heading?: boolean;
  dim?: boolean;
}

export class StatsPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly headline: Phaser.GameObjects.Text;
  private readonly headlineLabel: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly rows: Phaser.GameObjects.Container;
  private readonly scrim: Phaser.GameObjects.Rectangle;

  private open = false;
  private closeTween?: Phaser.Tweens.Tween;

  /** Filled from the server each time the panel opens. */
  private progress: CosmeticProgress = { bestScores: {}, totalPlays: 0, studyMinutes: 0 };
  private studySeconds = 0;
  private sessionCount = 0;
  private byZone: Record<string, number> = {};
  /** How long this visit has lasted; supplied by the caller, which owns the clock. */
  private visitSeconds: () => number = () => 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.scrim = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.45).setOrigin(0, 0);
    this.frame = scene.add.graphics();

    this.title = scene.add
      .text(SPACING.dialogueBoxPadding, 24, 'YOUR STATS', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5);

    this.headline = scene.add
      .text(SPACING.dialogueBoxPadding, 68, '0m', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '38px',
        color: COLORS.statusStudying,
      })
      .setOrigin(0, 0.5);

    this.headlineLabel = scene.add
      .text(SPACING.dialogueBoxPadding, 94, 'focused, all time', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5)
      .setAlpha(0.65);

    this.hint = scene.add
      .text(SPACING.dialogueBoxPadding, 0, 'P or ESC to close', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 1)
      .setAlpha(0.6);

    this.rows = scene.add.container(0, 0);

    this.container = scene.add
      .container(0, 0, [this.frame, this.title, this.headline, this.headlineLabel, this.hint, this.rows])
      .setDepth(1400)
      .setVisible(false);

    this.scrim.setDepth(1390).setVisible(false);

    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** The visit clock lives in the focus timer; this panel only reads it. */
  setVisitClock(visitSeconds: () => number): void {
    this.visitSeconds = visitSeconds;
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    sfx.uiOpen();

    this.closeTween?.stop();
    this.closeTween = undefined;

    // Render immediately from whatever is cached so the panel never opens
    // empty, then again when the server answers.
    this.render();
    void this.refresh();

    this.scrim.setVisible(true).setAlpha(0);
    this.container.setVisible(true);
    this.container.x = -PANEL_WIDTH;

    this.scene.tweens.add({
      targets: this.scrim,
      alpha: 1,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
    });
    this.scene.tweens.add({
      targets: this.container,
      x: SPACING.hudMargin,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    sfx.uiClose();

    this.scene.tweens.add({
      targets: this.scrim,
      alpha: 0,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
      onComplete: () => this.scrim.setVisible(false),
    });
    this.closeTween = this.scene.tweens.add({
      targets: this.container,
      x: -PANEL_WIDTH,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
      onComplete: () => {
        this.closeTween = undefined;
        this.container.setVisible(false);
      },
    });
  }

  /** Both endpoints at once — the panel wants one coherent picture, not two. */
  private async refresh(): Promise<void> {
    const [progress, study] = await Promise.all([fetchProgress(), fetchStudyTotals()]);

    if (progress) this.progress = progress;
    if (study) {
      this.studySeconds = study.totalSeconds;
      this.sessionCount = study.sessionCount;
      this.byZone = study.byZone;
    }
    if (this.open) this.render();
  }

  private buildRows(): StatRow[] {
    const rows: StatRow[] = [];

    rows.push({ label: 'TIME', value: '', heading: true });
    rows.push({ label: 'focus sessions', value: String(this.sessionCount) });
    rows.push({
      label: 'average session',
      value:
        this.sessionCount > 0 ? durationText(this.studySeconds / this.sessionCount) : '—',
    });
    rows.push({ label: 'here this visit', value: durationText(this.visitSeconds()) });

    // Only zones actually studied in, best first. A list of eight zeroes says
    // nothing; three real entries say where this person likes to work.
    const zoneRows = Object.entries(this.byZone)
      .filter(([, seconds]) => seconds > 0)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3);

    if (zoneRows.length > 0) {
      rows.push({ label: 'WHERE', value: '', heading: true });
      for (const [zoneId, seconds] of zoneRows) {
        const zone = ZONES.find((z) => z.id === zoneId);
        rows.push({ label: (zone?.displayName ?? zoneId).toLowerCase(), value: durationText(seconds) });
      }
    }

    rows.push({ label: 'ARCADE', value: '', heading: true });
    rows.push({ label: 'games played', value: String(this.progress.totalPlays) });

    const played = MINIGAMES.filter((game) => (this.progress.bestScores[game.id] ?? 0) > 0);
    if (played.length === 0) {
      rows.push({ label: 'no scores yet', value: '—', dim: true });
    } else {
      for (const game of played) {
        rows.push({
          label: game.displayName.toLowerCase(),
          value: String(this.progress.bestScores[game.id] ?? 0),
        });
      }
    }

    rows.push({ label: 'EARNED', value: '', heading: true });
    const unlocked = COSMETICS.filter((cosmetic) => isUnlocked(cosmetic, this.progress));
    rows.push({ label: 'cosmetics', value: `${unlocked.length} / ${COSMETICS.length}` });
    rows.push({ label: 'people met', value: String(knownPeopleCount()), dim: true });

    return rows;
  }

  private render(): void {
    this.headline.setText(durationText(this.studySeconds));
    this.rows.removeAll(true);

    const rows = this.buildRows();
    let y = 0;

    for (const row of rows) {
      if (row.heading) {
        y += 14;
        const heading = this.scene.add
          .text(SPACING.dialogueBoxPadding, y, row.label, {
            fontFamily: TYPOGRAPHY.dialogueFont,
            fontSize: `${TYPOGRAPHY.hudFontSize - 2}px`,
            color: COLORS.dialogueBoxAccent,
          })
          .setOrigin(0, 0.5);

        const rule = this.scene.add.graphics();
        rule.fillStyle(hex(COLORS.dialogueBoxAccent), 0.25);
        rule.fillRect(
          SPACING.dialogueBoxPadding + heading.width + 10,
          y - 1,
          PANEL_WIDTH - SPACING.dialogueBoxPadding * 2 - heading.width - 10,
          1,
        );

        this.rows.add([rule, heading]);
        y += 22;
        continue;
      }

      const label = this.scene.add
        .text(SPACING.dialogueBoxPadding, y, row.label, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize}px`,
          color: COLORS.dialogueBoxText,
        })
        .setOrigin(0, 0.5)
        .setAlpha(row.dim ? 0.5 : 0.8);

      const value = this.scene.add
        .text(PANEL_WIDTH - SPACING.dialogueBoxPadding, y, row.value, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize}px`,
          color: COLORS.dialogueBoxText,
        })
        .setOrigin(1, 0.5)
        .setAlpha(row.dim ? 0.6 : 1);

      this.rows.add([label, value]);
      y += 24;
    }
  }

  private layout(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;

    this.scrim.setSize(width, height);

    const panelHeight = Math.min(height - SPACING.hudMargin * 2, 640);
    this.container.y = Math.round((height - panelHeight) / 2);
    this.container.x = this.open ? SPACING.hudMargin : -PANEL_WIDTH;

    this.frame.clear();
    this.frame.fillStyle(0x000000, 0.3);
    this.frame.fillRoundedRect(5, 7, PANEL_WIDTH, panelHeight, 16);
    this.frame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    this.frame.fillRoundedRect(0, 0, PANEL_WIDTH, panelHeight, 16);
    this.frame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.frame.fillRoundedRect(3, 3, PANEL_WIDTH - 6, panelHeight - 6, 14);
    this.frame.fillStyle(hex(COLORS.statusStudying), 1);
    this.frame.fillRoundedRect(3, 3, PANEL_WIDTH - 6, 5, 3);

    this.hint.setY(panelHeight - 18);
    this.rows.setPosition(0, 128);

    if (this.open) this.render();
  }
}
