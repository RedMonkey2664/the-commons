/**
 * Zone text chat — 05.
 *
 * "a chat bubble over the avatar plus a persistent chat log panel."
 *
 * The log lives here; bubbles live on the avatars (ChatBubbles), because a
 * bubble belongs to a character in the world and the log belongs to the screen.
 *
 * Input model: Enter opens the composer, Enter sends, Escape cancels. While the
 * composer is open the world takes no input at all — typing "swwwd" to a friend
 * should not walk you into a pond.
 */

import Phaser from 'phaser';
import type { ChatMessage } from '@commons/shared';
import { CHAT_LIMITS, COLORS, SPACING, TYPOGRAPHY, hex } from '@commons/shared';

const PANEL_WIDTH = 340;
const VISIBLE_LINES = 7;

export class ChatPanel {
  private readonly logText: Phaser.GameObjects.Text;
  private readonly logBackdrop: Phaser.GameObjects.Graphics;
  private readonly composerFrame: Phaser.GameObjects.Graphics;
  private readonly composerText: Phaser.GameObjects.Text;
  private readonly caret: Phaser.GameObjects.Rectangle;
  private readonly hint: Phaser.GameObjects.Text;
  private readonly container: Phaser.GameObjects.Container;

  private readonly history: ChatMessage[] = [];
  private draft = '';
  private composing = false;
  private onSend?: (text: string) => void;
  private fadeTimer?: Phaser.Time.TimerEvent;

  constructor(private readonly scene: Phaser.Scene) {
    this.logBackdrop = scene.add.graphics();

    this.logText = scene.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
        lineSpacing: 5,
        wordWrap: { width: PANEL_WIDTH - 24 },
      })
      .setOrigin(0, 1);

    this.composerFrame = scene.add.graphics();
    this.composerText = scene.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize + 1}px`,
        color: COLORS.dialogueBoxText,
      })
      .setOrigin(0, 0.5);

    this.caret = scene.add.rectangle(0, 0, 2, 18, hex(COLORS.dialogueBoxAccent)).setOrigin(0, 0.5);
    scene.tweens.add({
      targets: this.caret,
      alpha: 0,
      duration: 480,
      yoyo: true,
      repeat: -1,
      ease: 'Steps',
    });

    this.hint = scene.add
      .text(0, 0, 'ENTER to chat', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize - 1}px`,
        color: COLORS.hudText,
        backgroundColor: COLORS.hudBg,
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0, 1)
      .setAlpha(0.6);

    this.container = scene.add
      .container(0, 0, [
        this.logBackdrop, this.logText,
        this.composerFrame, this.composerText, this.caret,
        this.hint,
      ])
      .setDepth(950);

    this.setComposerVisible(false);
    this.layout();

    scene.scale.on(Phaser.Scale.Events.RESIZE, this.layout, this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      scene.scale.off(Phaser.Scale.Events.RESIZE, this.layout, this);
    });
  }

  get isComposing(): boolean {
    return this.composing;
  }

  setSendHandler(handler: (text: string) => void): void {
    this.onSend = handler;
  }

  // -- composing ------------------------------------------------------------

  open(): void {
    if (this.composing) return;
    this.composing = true;
    this.draft = '';
    this.setComposerVisible(true);
    this.refreshComposer();
    this.showLog();
  }

  cancel(): void {
    if (!this.composing) return;
    this.composing = false;
    this.draft = '';
    this.setComposerVisible(false);
    this.scheduleFade();
  }

  /** Enter while composing. Sends if there is anything to send. */
  submit(): void {
    if (!this.composing) return;
    const text = this.draft.trim();
    this.composing = false;
    this.draft = '';
    this.setComposerVisible(false);
    if (text.length > 0) this.onSend?.(text);
    this.scheduleFade();
  }

  /** Raw key feed while composing. Returns true if the key was consumed. */
  handleKey(event: KeyboardEvent): boolean {
    if (!this.composing) return false;

    if (event.key === 'Backspace') {
      this.draft = this.draft.slice(0, -1);
      this.refreshComposer();
      return true;
    }
    if (event.key.length === 1 && this.draft.length < CHAT_LIMITS.maxLength) {
      this.draft += event.key;
      this.refreshComposer();
      return true;
    }
    return true; // swallow everything else while the composer owns the keyboard
  }

  // -- log ------------------------------------------------------------------

  append(message: ChatMessage): void {
    this.history.push(message);
    if (this.history.length > CHAT_LIMITS.historySize) this.history.shift();
    this.refreshLog();
    this.showLog();
    this.scheduleFade();
  }

  /** A local notice that never went through the server. */
  system(text: string): void {
    this.append({
      id: `local-${Date.now()}`,
      authorId: 'system',
      displayName: '',
      text,
      sentAt: Date.now(),
      system: true,
    });
  }

  private refreshLog(): void {
    const lines = this.history
      .slice(-VISIBLE_LINES)
      .map((m) => (m.system ? `— ${m.text}` : `${m.displayName}: ${m.text}`));
    this.logText.setText(lines.join('\n'));
    this.layout();
  }

  private showLog(): void {
    this.fadeTimer?.remove();
    this.fadeTimer = undefined;
    this.scene.tweens.killTweensOf([this.logText, this.logBackdrop]);
    this.logText.setAlpha(1);
    this.logBackdrop.setAlpha(1);
  }

  /**
   * The log fades when nothing is happening. 07 wants the HUD minimal and never
   * competing with the world; a permanent wall of text in the corner does.
   */
  private scheduleFade(): void {
    this.fadeTimer?.remove();
    this.fadeTimer = this.scene.time.delayedCall(9000, () => {
      if (this.composing) return;
      this.scene.tweens.add({
        targets: [this.logText, this.logBackdrop],
        alpha: 0.25,
        duration: 600,
        ease: 'Quad.easeIn',
      });
    });
  }

  private setComposerVisible(visible: boolean): void {
    this.composerFrame.setVisible(visible);
    this.composerText.setVisible(visible);
    this.caret.setVisible(visible);
    this.hint.setVisible(!visible);
  }

  private refreshComposer(): void {
    this.composerText.setText(this.draft);
    this.caret.setX(this.composerText.x + this.composerText.width + 3);
  }

  // -- layout ---------------------------------------------------------------

  private layout(): void {
    const { width, height } = this.scene.scale.gameSize;
    if (width === 0 || height === 0) return;

    const m = SPACING.hudMargin;
    // Bottom-left, above the controls hint, and clear of the dialogue box which
    // is centred and occupies the bottom of the screen.
    const composerY = height - m - 96;
    const logBottom = composerY - 34;

    this.logText.setPosition(m + 12, logBottom);

    const logHeight = Math.max(0, this.logText.height + 16);
    this.logBackdrop.clear();
    if (this.logText.text.length > 0) {
      this.logBackdrop.fillStyle(hex(COLORS.hudBg), 0.72);
      this.logBackdrop.fillRoundedRect(m, logBottom - logHeight, PANEL_WIDTH, logHeight, 8);
    }

    const composerWidth = PANEL_WIDTH;
    this.composerFrame.clear();
    this.composerFrame.fillStyle(hex(COLORS.dialogueBoxBorder), 1);
    this.composerFrame.fillRoundedRect(m, composerY - 20, composerWidth, 40, 8);
    this.composerFrame.fillStyle(hex(COLORS.dialogueBoxBg), 1);
    this.composerFrame.fillRoundedRect(m + 3, composerY - 17, composerWidth - 6, 34, 6);
    this.composerFrame.fillStyle(hex(COLORS.dialogueBoxAccent), 1);
    this.composerFrame.fillRoundedRect(m + 3, composerY + 13, composerWidth - 6, 4, 2);

    this.composerText.setPosition(m + 14, composerY);
    this.caret.setPosition(this.composerText.x + this.composerText.width + 3, composerY);
    this.hint.setPosition(m, composerY + 20);
  }

  destroy(): void {
    this.fadeTimer?.remove();
    this.container.destroy(true);
  }
}
