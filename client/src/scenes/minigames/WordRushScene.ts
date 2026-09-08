/**
 * Word Rush — Phase 6, 1-4 players, server-scored.
 *
 * Seven letters, one word each, longest wins. 06 suggests trivia "could later
 * pull from a study-relevant question bank"; this is the same instinct without
 * needing anyone to write questions — the letters are the content.
 *
 * Server-authoritative for the same reason Trivia Blitz is: the accepted words
 * live only on the server, so a client cannot read the answers off the wire or
 * mark its own submission. What arrives here is a rack of letters and nothing
 * else.
 *
 * Input is captured off raw keydown rather than a DOM field. A hidden input
 * would fight the Phaser keyboard plugin for focus, and the only characters
 * this game accepts are the seven on screen.
 */

import Phaser from 'phaser';
import type { FinishedPayload, PlayerRef } from '@commons/shared';
import {
  COLORS,
  MINIGAME_CLIENT_MESSAGE,
  MINIGAME_ROOM_TYPE,
  MINIGAME_SERVER_MESSAGE,
  TYPOGRAPHY,
  WORD_RUSH_RULES,
  getMinigame,
} from '@commons/shared';
import { Client, type Room } from 'colyseus.js';
import { BaseMinigameScene } from './BaseMinigameScene';
import { session } from '../../session';
import { sfx } from '../../systems/Sfx';

interface WordRoundPayload {
  index: number;
  total: number;
  durationMs: number;
  letters: string;
  minLength: number;
}

interface WordResultPayload {
  best: string;
  examples: string[];
  scores: Array<{ playerId: string; displayName: string; correct: boolean; score: number }>;
}

export class WordRushScene extends BaseMinigameScene {
  static readonly KEY = 'WordRushScene';

  private room?: Room;
  private promptText!: Phaser.GameObjects.Text;
  private rackText!: Phaser.GameObjects.Text;
  private entryText!: Phaser.GameObjects.Text;
  private resultText!: Phaser.GameObjects.Text;

  private letters = '';
  private typed = '';
  private submitted = false;
  private roundEndsAt = 0;

  constructor() {
    super(getMinigame('word_rush')!);
  }

  onStart(_players: PlayerRef[]): void {
    this.letters = '';
    this.typed = '';
    this.submitted = false;

    this.promptText = this.add
      .text(0, 0, 'waiting for players…', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.dialogueFontSize}px`,
        color: COLORS.hudText,
        align: 'center',
      })
      .setOrigin(0.5, 0);
    this.playfield.add(this.promptText);

    this.rackText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '44px',
        color: COLORS.hudAccent,
      })
      .setOrigin(0.5, 0);
    this.playfield.add(this.rackText);

    this.entryText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: '32px',
        color: COLORS.hudText,
      })
      .setOrigin(0.5, 0);
    this.playfield.add(this.entryText);

    this.resultText = this.add
      .text(0, 0, '', {
        fontFamily: TYPOGRAPHY.dialogueFont,
        fontSize: `${TYPOGRAPHY.hudFontSize}px`,
        color: COLORS.hudText,
        align: 'center',
      })
      .setOrigin(0.5, 0)
      .setAlpha(0.85);
    this.playfield.add(this.resultText);

    this.statusText.setText('waiting for players   ·   ESC to quit');
    this.input.keyboard?.on('keydown', this.onKey, this);
    void this.connect();
  }

  override onEnd(): void {
    this.input.keyboard?.off('keydown', this.onKey, this);
    const room = this.room;
    this.room = undefined;
    void room?.leave().catch(() => undefined);
  }

  // -- input ----------------------------------------------------------------

  private onKey(event: KeyboardEvent): void {
    // Escape belongs to the base class's quit handler.
    if (event.key === 'Escape') return;
    if (!this.letters || this.submitted) return;

    if (event.key === 'Backspace') {
      this.typed = this.typed.slice(0, -1);
      this.paintEntry();
      return;
    }

    if (event.key === 'Enter') {
      this.submit();
      return;
    }

    if (!/^[a-zA-Z]$/.test(event.key)) return;

    const letter = event.key.toUpperCase();
    // Only letters that are actually on the rack, and only as many times as
    // they appear there. Enforcing it here means the rack is a real constraint
    // rather than a suggestion, and the server still rechecks the word itself.
    const available = [...this.letters];
    for (const used of this.typed.toUpperCase()) {
      const at = available.indexOf(used);
      if (at >= 0) available.splice(at, 1);
    }
    if (!available.includes(letter)) {
      sfx.bump();
      return;
    }

    this.typed += letter;
    this.paintEntry();
  }

  private submit(): void {
    if (this.submitted || this.typed.length < WORD_RUSH_RULES.minWordLength) {
      if (this.typed.length > 0) sfx.bump();
      return;
    }
    this.submitted = true;
    this.room?.send(MINIGAME_CLIENT_MESSAGE.answer, { word: this.typed.toLowerCase() });
    sfx.uiOpen();
    this.statusText.setText('submitted — waiting for the others');
    this.paintEntry();
  }

  private paintEntry(): void {
    const placeholder = this.submitted ? this.typed : `${this.typed}_`;
    this.entryText.setText(placeholder);
    this.entryText.setColor(
      this.typed.length >= WORD_RUSH_RULES.minWordLength ? COLORS.statusStudying : COLORS.hudText,
    );
  }

  // -- networking -----------------------------------------------------------

  private async connect(): Promise<void> {
    try {
      const client = new Client(session.serverUrl);
      const room = await client.joinOrCreate(MINIGAME_ROOM_TYPE, {
        minigameId: this.minigame.id,
        displayName: session.displayName ?? 'Wanderer',
        userId: session.userId,
      });
      if (!this.scene.isActive()) {
        void room.leave().catch(() => undefined);
        return;
      }
      this.room = room;

      room.onMessage(MINIGAME_SERVER_MESSAGE.round, (payload: WordRoundPayload) => {
        this.showRound(payload);
      });
      room.onMessage(MINIGAME_SERVER_MESSAGE.result, (payload: WordResultPayload) => {
        this.showResult(payload);
      });
      room.onMessage(MINIGAME_SERVER_MESSAGE.finished, (payload: FinishedPayload) => {
        this.showFinished(payload);
      });
      room.onLeave(() => {
        this.room = undefined;
      });

      room.send(MINIGAME_CLIENT_MESSAGE.ready, {});
      this.promptText.setText(
        `waiting for players…\n\nstarting in up to ${Math.round(WORD_RUSH_RULES.lobbyWaitMs / 1000)}s`,
      );
    } catch (error) {
      if (!this.scene.isActive()) return;
      this.promptText.setText(
        'Word Rush needs the game server.\n\nThe word list lives there, so nobody\ncan read the answers off the wire.',
      );
      this.statusText.setText('ESC to return');
      console.warn('[word rush] could not join room:', (error as Error).message);
    }
  }

  private showRound(payload: WordRoundPayload): void {
    this.letters = payload.letters.toUpperCase();
    this.typed = '';
    this.submitted = false;
    this.roundEndsAt = this.time.now + payload.durationMs;

    this.headerText.setText(
      `${this.minigame.displayName.toUpperCase()}   ${payload.index + 1}/${payload.total}`,
    );
    this.promptText.setText(`longest word wins — at least ${payload.minLength} letters`);
    this.rackText.setText([...this.letters].join(' '));
    this.resultText.setText('');
    this.paintEntry();
    this.layoutTexts();
  }

  private showResult(payload: WordResultPayload): void {
    this.letters = '';
    const mine = payload.scores.find((s) => s.playerId === this.room?.sessionId);

    const lines = [
      mine?.correct ? `${this.typed.toUpperCase()} — good` : `${this.typed || '(nothing)'} — no score`,
      `best possible: ${payload.best.toUpperCase()}`,
      payload.examples.length > 0 ? `also there: ${payload.examples.join(', ')}` : '',
      '',
      ...[...payload.scores]
        .sort((a, b) => b.score - a.score)
        .map((s) => `${s.displayName}  ${s.score}`),
    ];
    this.resultText.setText(lines.filter(Boolean).join('\n'));
    this.rackText.setText('');
    this.entryText.setText('');
    this.statusText.setText('next round shortly');
    this.layoutTexts();
  }

  private showFinished(payload: FinishedPayload): void {
    const mine = payload.standings.find((s) => s.playerId === this.room?.sessionId);
    const position = payload.standings.findIndex((s) => s.playerId === this.room?.sessionId) + 1;
    const summary =
      payload.standings.length > 1
        ? `Finished ${position} of ${payload.standings.length}`
        : 'Run complete';

    // Server-scored: report it so the board shows it, but the base class knows
    // not to POST a multiplayer score.
    this.reportScore(session.userId, mine?.score ?? 0);
    void this.finishRun(summary);
  }

  override update(): void {
    if (!this.letters || this.submitted) return;
    const remaining = Math.max(0, this.roundEndsAt - this.time.now);
    this.statusText.setText(
      `${Math.ceil(remaining / 1000)}s   ·   type a word, ENTER to submit`,
    );
  }

  protected override onLayout(): void {
    this.layoutTexts();
  }

  private layoutTexts(): void {
    if (!this.promptText) return;
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;

    this.promptText.setPosition(cx, height * 0.22);
    this.rackText.setPosition(cx, height * 0.32);
    this.entryText.setPosition(cx, height * 0.46);
    this.resultText.setPosition(cx, height * 0.3);
  }
}
