/**
 * Dialogue box (07) with the timings from 10.
 *
 *   slide up 180ms ease-out -> reveal text at 30ms/char -> Space skips the
 *   reveal -> Space again advances -> last page slides away.
 *
 * Long text is pre-wrapped and split into pages, so the box never grows and
 * never scrolls. The reveal runs against pre-wrapped text because revealing
 * character-by-character through a live word-wrap makes words hop between lines
 * as they appear.
 *
 * The canvas resizes with the window, so geometry is rebuilt on resize rather
 * than assuming a fixed design resolution.
 */

import Phaser from 'phaser';
import { COLORS, SPACING, TYPOGRAPHY, UI, hex } from '@commons/shared';

const LINES_PER_PAGE = 3;
const LINE_SPACING = 8;
const MAX_WIDTH = 1100;

export interface DialogueOptions {
  /** Optional speaker name shown in a tab above the text. */
  speaker?: string;
  onClose?: () => void;
}

export class DialogueBox {
  private readonly container: Phaser.GameObjects.Container;
  private readonly frame: Phaser.GameObjects.Graphics;
  private readonly text: Phaser.GameObjects.Text;
  private readonly speakerText: Phaser.GameObjects.Text;
  private readonly advanceArrow: Phaser.GameObjects.Text;

  private pages: string[] = [];
  private pageIndex = 0;
  private revealed = 0;
  private revealTimer?: Phaser.Time.TimerEvent;
  private arrowTween?: Phaser.Tweens.Tween;
  private closeTween?: Phaser.Tweens.Tween;
  private onClose?: () => void;

  private boxWidth = 0;
  private boxHeight = 0;
  private wrapWidth = 0;
  private restY = 0;

  private _visible = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.frame = scene.add.graphics();

    this.text = scene.add
      .text(SPACING.dialogueBoxPadding, SPACING.dialogueBoxPadding, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.dialogueBoxText,
        lineSpacing: LINE_SPACING,
      })
      .setOrigin(0, 0);

    this.speakerText = scene.add
      .text(SPACING.dialogueBoxPadding, -15, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
        backgroundColor: COLORS.dialogueBoxAccent,
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0, 0)
      .setVisible(false);

    this.advanceArrow = scene.add
      .text(0, 0, '▼', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '16px',
        color: COLORS.dialogueBoxAccent,
      })
      .setOrigin(0.5)
      .setVisible(false);

    this.container = scene.add
      .container(0, 0, [this.frame, this.text, this.speakerText, this.advanceArrow])
      .setDepth(1000)
      .setVisible(false);

    this.layout();
    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  /** Rebuild geometry for the current canvas size. */
  private layout(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;

    const margin = SPACING.hudMargin;
    this.boxWidth = Math.min(width - margin * 2, MAX_WIDTH);
    this.boxHeight = Math.max(
      120,
      SPACING.dialogueBoxPadding * 2 + LINES_PER_PAGE * (TYPOGRAPHY.dialogueFontSize + LINE_SPACING),
    );
    this.wrapWidth = this.boxWidth - SPACING.dialogueBoxPadding * 2;
    this.restY = height - this.boxHeight - margin;

    this.container.x = Math.round((width - this.boxWidth) / 2);
    this.container.y = this._visible ? this.restY : height + 8;

    this.drawFrame();
    this.text.setWordWrapWidth(this.wrapWidth, true);
    this.advanceArrow.setPosition(this.boxWidth - 28, this.boxHeight - 26);
  }

  private drawFrame(): void {
    const w = this.boxWidth;
    const h = this.boxHeight;
    const g = this.frame;
    g.clear();

    // soft drop shadow
    g.fillStyle(0x000000, 0.28);
    g.fillRoundedRect(4, 7, w, h, 16);
    // dark outer shell
    g.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    g.fillRoundedRect(0, 0, w, h, 16);
    // light panel
    g.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    g.fillRoundedRect(3, 3, w - 6, h - 6, 14);
    // accent rule along the top — the one bit of colour
    g.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    g.fillRoundedRect(3, 3, w - 6, 5, 3);
    // hairline inset
    g.lineStyle(1, hex(COLORS.pavingDark), 0.45);
    g.strokeRoundedRect(12, 15, w - 24, h - 27, 8);
  }

  get isVisible(): boolean {
    return this._visible;
  }

  get isRevealing(): boolean {
    const page = this.pages[this.pageIndex] ?? '';
    return this.revealed < page.length;
  }

  /** `text` may contain '|' as an explicit page break. */
  show(text: string, options: DialogueOptions = {}): void {
    this.onClose = options.onClose;
    this.pages = this.paginate(text);
    this.pageIndex = 0;

    if (options.speaker) {
      this.speakerText.setText(options.speaker.toUpperCase()).setVisible(true);
    } else {
      this.speakerText.setVisible(false);
    }

    // A show() landing inside the close animation must cancel it, or that
    // tween completes and hides the container while _visible is true.
    const closing = this.closeTween !== undefined;
    this.closeTween?.stop();
    this.closeTween = undefined;

    const wasVisible = this._visible;
    this._visible = true;
    this.container.setVisible(true);

    if (!wasVisible || closing) {
      this.container.y = this.scene.scale.gameSize.height + 8;
      this.scene.tweens.add({
        targets: this.container,
        y: this.restY,
        duration: UI.dialogue.slideMs,
        ease: UI.dialogue.slideEase,
      });
    }

    this.startReveal();
  }

  /** Space handler. Returns true if the box consumed the press. */
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

    this.closeTween = this.scene.tweens.add({
      targets: this.container,
      y: this.scene.scale.gameSize.height + 8,
      duration: UI.dialogue.slideMs,
      ease: UI.dialogue.slideEase,
      onComplete: () => {
        this.closeTween = undefined;
        this.container.setVisible(false);
        this.text.setText('');
        const callback = this.onClose;
        this.onClose = undefined;
        callback?.();
      },
    });
  }

  // -- internals -----------------------------------------------------------

  private paginate(raw: string): string[] {
    const pages: string[] = [];
    // startReveal() disables wrapping to reveal against pre-wrapped text, so
    // re-enable it before measuring.
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
    this.text.setWordWrapWidth(0, false);

    const page = this.pages[this.pageIndex] ?? '';

    // Guard the empty page: `repeat: -1` means INFINITE in Phaser, so a blank
    // page would spin the timer forever and stack an arrow tween every 30ms.
    if (page.length === 0) {
      this.showAdvanceArrow();
      return;
    }

    this.revealTimer = this.scene.time.addEvent({
      delay: UI.dialogue.revealMsPerChar,
      repeat: page.length - 1,
      callback: () => {
        this.revealed += 1;
        this.text.setText(page.slice(0, this.revealed));
        if (this.revealed >= page.length) this.showAdvanceArrow();
      },
    });
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
    const restY = this.boxHeight - 26;
    this.advanceArrow.setVisible(true).setY(restY);
    this.arrowTween?.stop();
    this.arrowTween = this.scene.tweens.add({
      targets: this.advanceArrow,
      y: restY + 4,
      duration: 420,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  destroy(): void {
    this.revealTimer?.remove();
    this.arrowTween?.stop();
    this.closeTween?.stop();
    this.container.destroy(true);
  }
}
