/**
 * Pokemon-style dialogue box (07) with the timings from 10.
 *
 *   slide up 180ms ease-out -> reveal text at 30ms/char -> Space skips the
 *   reveal -> Space again advances -> last page slides away.
 *
 * Long text is pre-wrapped and split into 3-line pages, so the box never grows
 * and never scrolls. That is why the reveal is done against pre-wrapped text:
 * revealing character-by-character through a live word-wrap makes words hop
 * between lines as they appear.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, TYPOGRAPHY, UI, VIEWPORT, hex } from '@commons/shared';

const BOX_HEIGHT = 84;
const LINES_PER_PAGE = 3;
const LINE_SPACING = 6;

export interface DialogueOptions {
  /** Optional speaker name shown in a tab above the text. */
  speaker?: string;
  onClose?: () => void;
}

export class DialogueBox {
  private readonly container: Phaser.GameObjects.Container;
  private readonly text: Phaser.GameObjects.Text;
  private readonly speakerText: Phaser.GameObjects.Text;
  private readonly advanceArrow: Phaser.GameObjects.Text;

  private pages: string[] = [];
  private pageIndex = 0;
  private revealed = 0;
  private revealTimer?: Phaser.Time.TimerEvent;
  private arrowTween?: Phaser.Tweens.Tween;
  private onClose?: () => void;
  private readonly wrapWidth: number;

  private _visible = false;

  constructor(private readonly scene: Phaser.Scene) {
    const margin = SPACING.hudMargin;
    const width = VIEWPORT.width - margin * 2;
    const boxY = VIEWPORT.height - BOX_HEIGHT - margin;

    const frame = scene.add.graphics();
    // Drop shadow, dark outline, light fill — the classic three-layer GBA box.
    frame.fillStyle(hex(COLORS.dialogueBoxShadow), 0.5);
    frame.fillRoundedRect(3, 3, width, BOX_HEIGHT, 6);
    frame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    frame.fillRoundedRect(0, 0, width, BOX_HEIGHT, 6);
    frame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    frame.fillRoundedRect(3, 3, width - 6, BOX_HEIGHT - 6, 4);
    frame.lineStyle(1, hex(COLORS.dialogueBoxShadow), 1);
    frame.strokeRoundedRect(6, 6, width - 12, BOX_HEIGHT - 12, 3);

    this.text = scene.add
      .text(SPACING.dialogueBoxPadding, SPACING.dialogueBoxPadding, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.dialogueBoxText,
        lineSpacing: LINE_SPACING,
      })
      .setOrigin(0, 0);

    this.speakerText = scene.add
      .text(SPACING.dialogueBoxPadding, -9, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.dialogueBoxBg,
        backgroundColor: COLORS.dialogueBoxBorder,
        padding: { x: 5, y: 2 },
      })
      .setOrigin(0, 0)
      .setVisible(false);

    this.advanceArrow = scene.add
      .text(width - 16, BOX_HEIGHT - 20, '▼', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '10px',
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.container = scene.add
      .container(margin, boxY, [frame, this.text, this.speakerText, this.advanceArrow])
      .setDepth(1000)
      .setVisible(false);

    // Wrap width is fixed by the box, not by the string.
    this.wrapWidth = width - SPACING.dialogueBoxPadding * 2;
    this.text.setWordWrapWidth(this.wrapWidth, true);
  }

  get isVisible(): boolean {
    return this._visible;
  }

  /** True while text is still typing out — Space should skip rather than advance. */
  get isRevealing(): boolean {
    const page = this.pages[this.pageIndex] ?? '';
    return this.revealed < page.length;
  }

  /**
   * Show dialogue. `text` may contain '|' as an explicit page break, which is
   * how map authors split lines in Tiled without needing a script.
   */
  show(text: string, options: DialogueOptions = {}): void {
    this.onClose = options.onClose;
    this.pages = this.paginate(text);
    this.pageIndex = 0;

    if (options.speaker) {
      this.speakerText.setText(options.speaker).setVisible(true);
    } else {
      this.speakerText.setVisible(false);
    }

    const wasVisible = this._visible;
    this._visible = true;
    this.container.setVisible(true);

    if (!wasVisible) {
      // Slide up from below the screen edge.
      const restY = VIEWPORT.height - BOX_HEIGHT - SPACING.hudMargin;
      this.container.y = VIEWPORT.height + 4;
      this.scene.tweens.add({
        targets: this.container,
        y: restY,
        duration: UI.dialogue.slideMs,
        ease: UI.dialogue.slideEase,
      });
    }

    this.startReveal();
  }

  /**
   * Space handler. Returns true if the box consumed the press — the caller uses
   * that to keep the world from also reacting to the same keypress.
   */
  advance(): boolean {
    if (!this._visible) return false;

    if (this.isRevealing) {
      this.completeReveal();
      return true;
    }

    this.pageIndex += 1;
    if (this.pageIndex >= this.pages.length) {
      this.close();
      return true;
    }

    this.startReveal();
    return true;
  }

  close(): void {
    if (!this._visible) return;
    this._visible = false;
    this.revealTimer?.remove();
    this.revealTimer = undefined;
    this.arrowTween?.stop();
    this.arrowTween = undefined;
    this.advanceArrow.setVisible(false);

    this.scene.tweens.add({
      targets: this.container,
      y: VIEWPORT.height + 4,
      duration: UI.dialogue.slideMs,
      ease: UI.dialogue.slideEase,
      onComplete: () => {
        this.container.setVisible(false);
        this.text.setText('');
        const callback = this.onClose;
        this.onClose = undefined;
        callback?.();
      },
    });
  }

  // -- internals -----------------------------------------------------------

  /** Split on explicit breaks, wrap each, then chunk into 3-line pages. */
  private paginate(raw: string): string[] {
    const pages: string[] = [];
    // startReveal() disables wrapping to reveal against pre-wrapped text, so
    // re-enable it here before measuring — otherwise the second and every
    // later show() would paginate against an unwrapped string.
    this.text.setWordWrapWidth(this.wrapWidth, true);
    for (const segment of raw.split('|')) {
      const trimmed = segment.trim();
      if (!trimmed) continue;
      const lines = this.text.getWrappedText(trimmed);
      for (let i = 0; i < lines.length; i += LINES_PER_PAGE) {
        pages.push(lines.slice(i, i + LINES_PER_PAGE).join('\n'));
      }
    }
    return pages.length > 0 ? pages : [''];
  }

  private startReveal(): void {
    this.revealTimer?.remove();
    this.arrowTween?.stop();
    this.advanceArrow.setVisible(false);

    this.revealed = 0;
    this.text.setText('');
    // Text is already wrapped into the page string; don't wrap again.
    this.text.setWordWrapWidth(0, false);

    const page = this.pages[this.pageIndex] ?? '';
    this.revealTimer = this.scene.time.addEvent({
      delay: UI.dialogue.revealMsPerChar,
      repeat: page.length - 1,
      callback: () => {
        this.revealed += 1;
        this.text.setText(page.slice(0, this.revealed));
        if (this.revealed >= page.length) this.showAdvanceArrow();
      },
    });

    if (page.length === 0) this.showAdvanceArrow();
  }

  private completeReveal(): void {
    this.revealTimer?.remove();
    this.revealTimer = undefined;
    const page = this.pages[this.pageIndex] ?? '';
    this.revealed = page.length;
    this.text.setText(page);
    this.showAdvanceArrow();
  }

  private showAdvanceArrow(): void {
    this.advanceArrow.setVisible(true).setY(BOX_HEIGHT - 20);
    this.arrowTween?.stop();
    this.arrowTween = this.scene.tweens.add({
      targets: this.advanceArrow,
      y: BOX_HEIGHT - 17,
      duration: 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  destroy(): void {
    this.revealTimer?.remove();
    this.arrowTween?.stop();
    this.container.destroy(true);
  }
}
