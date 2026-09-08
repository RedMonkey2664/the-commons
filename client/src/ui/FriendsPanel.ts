/**
 * Friends panel — Esc menu (07).
 *
 * 08 puts a friends list in Phase 2 and explicitly allows it to be
 * "mocked/local before real backend accounts". So the roster here has two
 * sources:
 *
 *   - LIVE: everyone actually in your current zone room, read from the
 *     multiplayer system. These are real, and their zone is real.
 *   - LOCAL: names you've seen before, remembered in localStorage, shown
 *     offline. This is the mock half, and it is labelled as such in the UI
 *     rather than dressed up as a real friends graph.
 *
 * Phase 3 replaces the local half with a Postgres `friends` table and a
 * mutual-accept model (05). Nothing else about this panel changes.
 */

import Phaser from 'phaser';
import type { Cosmetic, CosmeticProgress } from '@commons/shared';
import { COLORS, COSMETICS, SPACING, TYPOGRAPHY, UI, describeRequirement, hex, isUnlocked } from '@commons/shared';
import { sfx } from '../systems/Sfx';
import { session } from '../session';

const PANEL_WIDTH = 400;
const ROW_HEIGHT = 52;
const STORAGE_KEY = 'commons.knownPeople';

export interface FriendEntry {
  displayName: string;
  /** Zone display name when online, undefined when not. */
  zone?: string;
  online: boolean;
  status?: string;
}

interface KnownPerson {
  displayName: string;
  lastSeenZone: string;
  lastSeenAt: number;
}

function readKnown(): KnownPerson[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as KnownPerson[]) : [];
  } catch {
    return [];
  }
}

function writeKnown(people: KnownPerson[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(people.slice(0, 40)));
  } catch {
    /* not persisting is acceptable */
  }
}

/** Remember someone we shared a room with, so they show up offline later. */
export function rememberPerson(displayName: string, zone: string): void {
  const people = readKnown().filter((p) => p.displayName !== displayName);
  people.unshift({ displayName, lastSeenZone: zone, lastSeenAt: Date.now() });
  writeKnown(people);
}

export class FriendsPanel {
  private readonly container: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly title: Phaser.GameObjects.Text;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly rows: Phaser.GameObjects.Container;
  private readonly scrim: Phaser.GameObjects.Rectangle;

  private open = false;
  private closeTween?: Phaser.Tweens.Tween;
  private panelHeight = 0;
  private entriesProvider: () => FriendEntry[] = () => [];

  /**
   * Cosmetics (06). Lives in this panel rather than its own screen because it
   * is a small, occasional thing — a separate menu would give it more weight
   * than "pick a colour" deserves.
   */
  private readonly cosmeticRow: Phaser.GameObjects.Container;
  private progress: CosmeticProgress = { bestScores: {}, totalPlays: 0, studyMinutes: 0 };
  private onCosmeticChosen?: (cosmetic: Cosmetic) => void;

  constructor(private readonly scene: Phaser.Scene) {
    this.scrim = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.45).setOrigin(0, 0);

    this.frame = scene.add.graphics();

    this.title = scene.add
      .text(SPACING.dialogueBoxPadding, 24, 'WHO’S AROUND', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5);

    this.hint = scene.add
      .text(SPACING.dialogueBoxPadding, 0, 'ESC to close', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 1)
      .setAlpha(0.6);

    this.rows = scene.add.container(0, 0);
    this.cosmeticRow = scene.add.container(0, 0);

    this.container = scene.add
      .container(0, 0, [this.frame, this.title, this.hint, this.rows, this.cosmeticRow])
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

  /** ZoneScene supplies the live roster; the panel owns presentation only. */
  setEntriesProvider(provider: () => FriendEntry[]): void {
    this.entriesProvider = provider;
  }

  /** Unlock facts from the server, and where to send a chosen cosmetic. */
  setCosmetics(progress: CosmeticProgress, onChosen: (cosmetic: Cosmetic) => void): void {
    this.progress = progress;
    this.onCosmeticChosen = onChosen;
    if (this.open) this.renderCosmetics();
  }

  toggle(): void {
    if (this.open) this.close();
    else this.show();
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    sfx.uiOpen();

    // Cancel an in-flight close, or its onComplete hides the panel again a
    // moment after it reopens — leaving it invisible but still modal, which
    // soft-locks world input.
    this.closeTween?.stop();
    this.closeTween = undefined;

    this.render();
    this.renderCosmetics();

    const { width } = this.scene.scale.gameSize;
    this.scrim.setVisible(true).setAlpha(0);
    this.container.setVisible(true);
    this.container.x = width; // slide in from the right edge (10)

    this.scene.tweens.add({
      targets: this.scrim,
      alpha: 1,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
    });
    this.scene.tweens.add({
      targets: this.container,
      x: width - PANEL_WIDTH - SPACING.hudMargin,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
    });
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    sfx.uiClose();

    const { width } = this.scene.scale.gameSize;
    this.scene.tweens.add({
      targets: this.scrim,
      alpha: 0,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
      onComplete: () => this.scrim.setVisible(false),
    });
    this.closeTween = this.scene.tweens.add({
      targets: this.container,
      x: width,
      duration: UI.panel.slideMs,
      ease: UI.panel.slideEase,
      onComplete: () => {
        this.closeTween = undefined;
        this.container.setVisible(false);
      },
    });
  }

  // -- rendering -----------------------------------------------------------

  /**
   * Swatches for every cosmetic, locked ones included.
   *
   * Locked entries are shown greyed with their requirement rather than hidden:
   * 06 wants the arcade to have "a reason to be revisited", and a reward you
   * cannot see is not a reason.
   */
  private renderCosmetics(): void {
    this.cosmeticRow.removeAll(true);

    const outfits = COSMETICS.filter((c) => c.slot === 'outfit');
    const chosen = session.cosmetic('outfit');
    const size = 30;
    const gap = 10;

    this.cosmeticRow.add(
      this.scene.add
        .text(SPACING.dialogueBoxPadding, -6, 'LOOK', {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize - 2}px`,
          color: COLORS.dialogueBoxText,
        })
        .setOrigin(0, 1)
        .setAlpha(0.55),
    );

    outfits.forEach((cosmetic, index) => {
      const unlocked = isUnlocked(cosmetic, this.progress);
      const x = SPACING.dialogueBoxPadding + index * (size + gap);

      const swatch = this.scene.add
        .rectangle(x, 4, size, size, hex(cosmetic.color), unlocked ? 1 : 0.18)
        .setOrigin(0, 0)
        .setStrokeStyle(
          chosen === cosmetic.id ? 3 : 1,
          hex(chosen === cosmetic.id ? COLORS.dialogueBoxAccent : COLORS.dialogueBoxBorder),
          unlocked ? 1 : 0.4,
        );

      if (unlocked) {
        swatch.setInteractive({ useHandCursor: true });
        swatch.on('pointerdown', () => {
          session.setCosmetic('outfit', cosmetic.id);
          sfx.uiOpen();
          this.onCosmeticChosen?.(cosmetic);
          this.renderCosmetics();
        });
      } else {
        // A padlock mark, so locked reads as locked without relying on opacity.
        this.cosmeticRow.add(
          this.scene.add
            .text(x + size / 2, 4 + size / 2, '·', {
              fontFamily: TYPOGRAPHY.dialogueFont,
              fontSize: '20px',
              color: COLORS.dialogueBoxText,
            })
            .setOrigin(0.5)
            .setAlpha(0.5),
        );
      }

      swatch.on('pointerover', () => {
        this.hint.setText(
          unlocked ? `${cosmetic.displayName}` : `${cosmetic.displayName} — ${describeRequirement(cosmetic)}`,
        );
      });
      swatch.on('pointerout', () => this.hint.setText('ESC to close'));

      this.cosmeticRow.add(swatch);
    });
  }

  private layout(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;

    this.scrim.setSize(width, height);

    const panelHeight = Math.min(height - SPACING.hudMargin * 2, 620);
    this.panelHeight = panelHeight;
    this.container.y = Math.round((height - panelHeight) / 2);
    this.container.x = this.open ? width - PANEL_WIDTH - SPACING.hudMargin : width;

    this.frame.clear();
    this.frame.fillStyle(0x000000, 0.3);
    this.frame.fillRoundedRect(5, 7, PANEL_WIDTH, panelHeight, 16);
    this.frame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    this.frame.fillRoundedRect(0, 0, PANEL_WIDTH, panelHeight, 16);
    this.frame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.frame.fillRoundedRect(3, 3, PANEL_WIDTH - 6, panelHeight - 6, 14);
    this.frame.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    this.frame.fillRoundedRect(3, 3, PANEL_WIDTH - 6, 5, 3);

    this.hint.setY(panelHeight - 18);
    this.rows.setPosition(0, 56);
    this.cosmeticRow.setPosition(0, panelHeight - 96);
    if (this.open) {
      this.render();
      this.renderCosmetics();
    }
  }

  private render(): void {
    this.rows.removeAll(true);

    const live = this.entriesProvider();
    const liveNames = new Set(live.map((e) => e.displayName));
    const offline: FriendEntry[] = readKnown()
      .filter((p) => !liveNames.has(p.displayName))
      .slice(0, 8)
      .map((p) => ({ displayName: p.displayName, online: false, zone: p.lastSeenZone }));

    // Clip to what actually fits inside the frame. Without this a busy room
    // draws rows straight through the panel and out over the world.
    const available = Math.max(0, this.panelHeight - 56 - 110);
    const maxRows = Math.max(1, Math.floor(available / ROW_HEIGHT));
    const all = [...live, ...offline];
    const overflow = Math.max(0, all.length - maxRows);
    const entries = overflow > 0 ? all.slice(0, maxRows - 1) : all;

    if (entries.length === 0) {
      this.rows.add(
        this.scene.add
          .text(SPACING.dialogueBoxPadding, 8, 'Nobody else is here yet.\n\nOpen a second window, or\nsend someone the link.', {
            fontFamily: TYPOGRAPHY.dialogueFont,
            fontSize: `${TYPOGRAPHY.hudFontSize}px`,
            color: COLORS.dialogueBoxText,
            lineSpacing: 6,
          })
          .setOrigin(0, 0)
          .setAlpha(0.65),
      );
      return;
    }

    entries.forEach((entry, index) => {
      const y = index * ROW_HEIGHT;
      const row = this.scene.add.container(0, y);

      const divider = this.scene.add.graphics();
      divider.fillStyle(hex(COLORS.pavingDark), 0.35);
      divider.fillRect(SPACING.dialogueBoxPadding, ROW_HEIGHT - 2, PANEL_WIDTH - SPACING.dialogueBoxPadding * 2, 1);

      // Presence dot: filled when online, hollow when not — shape as well as
      // colour, per 07's colourblind-safe note.
      const dot = this.scene.add.circle(SPACING.dialogueBoxPadding + 8, 20, 6);
      if (entry.online) {
        dot.setFillStyle(hex(entry.status === 'studying' ? COLORS.statusStudying : COLORS.dialogueBoxAccent), 1);
      } else {
        dot.setFillStyle(0x000000, 0).setStrokeStyle(2, hex(COLORS.statusAfk));
      }

      const name = this.scene.add
        .text(SPACING.dialogueBoxPadding + 26, 14, entry.displayName, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize + 2}px`,
          color: COLORS.dialogueBoxText,
        })
        .setOrigin(0, 0);

      const detail = entry.online
        ? `in the ${entry.zone ?? 'town'}${entry.status === 'studying' ? ' · studying' : ''}`
        : `last seen in the ${entry.zone ?? 'town'}`;

      const sub = this.scene.add
        .text(SPACING.dialogueBoxPadding + 26, 32, detail, {
          fontFamily: TYPOGRAPHY.dialogueFont,
          fontSize: `${TYPOGRAPHY.hudFontSize - 2}px`,
          color: COLORS.dialogueBoxText,
        })
        .setOrigin(0, 0)
        .setAlpha(entry.online ? 0.7 : 0.45);

      row.add([divider, dot, name, sub]);
      this.rows.add(row);
    });

    if (overflow > 0) {
      this.rows.add(
        this.scene.add
          .text(SPACING.dialogueBoxPadding + 26, entries.length * ROW_HEIGHT + 14,
            `and ${overflow + 1} more`, {
              fontFamily: TYPOGRAPHY.dialogueFont,
              fontSize: `${TYPOGRAPHY.hudFontSize - 1}px`,
              color: COLORS.dialogueBoxText,
            })
          .setOrigin(0, 0)
          .setAlpha(0.55),
      );
    }
  }

  destroy(): void {
    this.scrim.destroy();
    this.container.destroy(true);
  }
}
