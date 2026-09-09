/**
 * Focus session timer (07's "Pomodoro overlay", 11's study loop).
 *
 * Sitting at a focus pod already changed your status and quietly accrued study
 * time on the server; the only feedback was a popup at each end. Time you
 * cannot see is time you cannot feel yourself spending, which is the whole
 * point of sitting down — so this puts the running session on screen next to
 * the total it is adding to.
 *
 * Three numbers, and they answer different questions:
 *   - THIS SESSION — the pod you are sitting at right now, ticking.
 *   - TODAY        — how long this visit has lasted, focused or not.
 *   - TOTAL        — every focus session ever, from the server.
 *
 * The server remains the authority on the total: it opens a session when you
 * sit and writes it when you stand, so this displays `total + live` while
 * seated and re-reads the real figure once the write has landed. A client-side
 * clock that kept its own running total would drift from the persisted one and
 * disagree with the stats panel.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, TYPOGRAPHY, UI, hex } from '@commons/shared';
import { fetchStudyTotals } from '../systems/scoreClient';

/** mm:ss, or h:mm:ss once a session runs past an hour. */
export function clockText(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** "1h 24m" / "24m" / "45s" — for totals, where seconds stop being interesting. */
export function durationText(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export class FocusTimer {
  private readonly panel: Phaser.GameObjects.Graphics;
  private readonly heading: Phaser.GameObjects.Text;
  private readonly elapsed: Phaser.GameObjects.Text;
  private readonly totals: Phaser.GameObjects.Text;
  private readonly ring: Phaser.GameObjects.Arc;
  private readonly container: Phaser.GameObjects.Container;

  /** Wall clock, not a frame counter: a backgrounded tab must not lose time. */
  private startedAt = 0;
  private running = false;
  private tick?: Phaser.Time.TimerEvent;

  /** Persisted focus seconds, excluding whatever is running right now. */
  private storedSeconds = 0;
  /** When this visit began — "today" in the sense a player means it. */
  private readonly visitStartedAt = Date.now();

  constructor(private readonly scene: Phaser.Scene) {
    this.panel = scene.add.graphics();

    this.heading = scene.add
      .text(0, 0, 'FOCUS SESSION', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize - 3}px`,
        color: COLORS.hudText,
      })
      .setOrigin(0, 0.5)
      .setAlpha(0.7);

    this.elapsed = scene.add
      .text(0, 0, '00:00', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize + 13}px`,
        color: COLORS.statusStudying,
      })
      .setOrigin(0, 0.5);

    this.totals = scene.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize - 2}px`,
        color: COLORS.hudText,
        lineSpacing: 4,
      })
      .setOrigin(0, 0)
      .setAlpha(0.85);

    // A slow pulse, so a session reads as running at a glance rather than
    // needing the seconds digit watched.
    this.ring = scene.add.circle(0, 0, 5, hex(COLORS.statusStudying));

    this.container = scene.add
      .container(0, 0, [this.panel, this.ring, this.heading, this.elapsed, this.totals])
      .setDepth(895)
      .setAlpha(0);

    this.container.setVisible(false);

    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
      this.tick?.remove();
    });

    // Seed the total so the first session shows a real figure rather than 0.
    void this.refreshStored();
  }

  /** Seconds on the clock right now, 0 when not sitting. */
  get liveSeconds(): number {
    return this.running ? (Date.now() - this.startedAt) / 1000 : 0;
  }

  /** Persisted focus time plus anything currently running. */
  get totalStudySeconds(): number {
    return this.storedSeconds + this.liveSeconds;
  }

  /** How long this visit has lasted, focused or not. */
  get visitSeconds(): number {
    return (Date.now() - this.visitStartedAt) / 1000;
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();

    this.container.setVisible(true);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
    });

    this.scene.tweens.add({
      targets: this.ring,
      scale: { from: 1, to: 1.6 },
      alpha: { from: 1, to: 0.25 },
      duration: 1200,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    this.tick?.remove();
    this.tick = this.scene.time.addEvent({
      delay: 250,
      loop: true,
      callback: () => this.render(),
    });
    this.render();
  }

  /** Ends the session and returns what it was worth, for the caller's popup. */
  stop(): number {
    if (!this.running) return 0;
    const seconds = this.liveSeconds;

    this.running = false;
    this.tick?.remove();
    this.tick = undefined;
    this.scene.tweens.killTweensOf(this.ring);
    this.ring.setScale(1).setAlpha(1);

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
      onComplete: () => this.container.setVisible(false),
    });

    // Optimistic, so the stats panel is right the moment the session ends; the
    // authoritative figure lands a beat later, once the server has written it.
    this.storedSeconds += seconds;
    this.scene.time.delayedCall(900, () => void this.refreshStored());

    return seconds;
  }

  /** Re-read the persisted total. Safe to call when offline — it just no-ops. */
  async refreshStored(): Promise<void> {
    const totals = await fetchStudyTotals();
    if (totals && !this.running) this.storedSeconds = totals.totalSeconds;
    else if (totals) {
      // Mid-session: the server has not written the running one yet, so its
      // figure is the base this session is accruing on top of.
      this.storedSeconds = totals.totalSeconds;
    }
    this.render();
  }

  private render(): void {
    this.elapsed.setText(clockText(this.liveSeconds));
    this.totals.setText(
      `here today   ${durationText(this.visitSeconds)}\n` +
        `focused all time   ${durationText(this.totalStudySeconds)}`,
    );
    this.layout();
  }

  private layout(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;

    const m = SPACING.hudMargin;
    // Under the zone pill, which is 34 tall at the same margin.
    const top = m + 34 + 10;
    const panelWidth = Math.max(196, this.totals.width + 34, this.elapsed.width + 34);
    const panelHeight = 96;

    this.panel.clear();
    this.panel.fillStyle(0x000000, 0.25);
    this.panel.fillRoundedRect(m + 2, top + 3, panelWidth, panelHeight, 10);
    this.panel.fillStyle(hex(COLORS.hudBg), 0.92);
    this.panel.fillRoundedRect(m, top, panelWidth, panelHeight, 10);
    this.panel.fillStyle(hex(COLORS.statusStudying), 1);
    this.panel.fillRoundedRect(m, top + 10, 4, panelHeight - 20, 2);

    this.ring.setPosition(m + 20, top + 17);
    this.heading.setPosition(m + 32, top + 17);
    this.elapsed.setPosition(m + 16, top + 45);
    this.totals.setPosition(m + 16, top + 62);
  }
}
